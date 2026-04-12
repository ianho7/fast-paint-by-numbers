use crate::models::{ColorSpace, ProcessSettings};
use std::collections::BTreeMap;
use tracing::{debug, warn};

#[derive(Debug, Clone)]
pub struct QuantizeResult {
    pub quantized_rgba: Vec<u8>,
    pub indexed_pixels: Vec<usize>,
    pub palette: Vec<[u8; 3]>,
    pub original_unique_colors: usize,
    pub iterations: usize,
    pub sample_colors: usize,
}

#[derive(Debug, Clone)]
struct Centroid {
    values: [f64; 3],
}

/// 量化 RGBA 图像。
///
/// M1 先实现稳定、可观测的 RGB K-Means++，其余颜色空间先记录告警并回退到 RGB。
pub fn quantize_rgba_pixels(
    width: u32,
    height: u32,
    rgba: &[u8],
    settings: &ProcessSettings,
) -> QuantizeResult {
    if settings.kmeans_color_space != ColorSpace::Rgb {
        warn!(
            target: "pbn_core::quantize",
            requested = ?settings.kmeans_color_space,
            "M1 仅完整支持 RGB 量化，当前已回退到 RGB 处理"
        );
    }

    let mut unique = BTreeMap::<[u8; 3], usize>::new();
    for chunk in rgba.chunks_exact(4) {
        let color = [chunk[0] >> 2 << 2, chunk[1] >> 2 << 2, chunk[2] >> 2 << 2];
        *unique.entry(color).or_insert(0) += 1;
    }

    let original_unique_colors = unique.len();
    let desired_k = settings.kmeans_clusters.max(1).min(original_unique_colors.max(1));
    let samples: Vec<([u8; 3], usize)> = unique.into_iter().collect();

    let mut centroids = initialize_kmeans_plus_plus(&samples, desired_k, settings.random_seed);
    let mut assignments = vec![0usize; samples.len()];
    let mut iterations = 0usize;

    loop {
        iterations += 1;
        let mut changed = 0.0;
        let mut sums = vec![[0.0f64; 3]; desired_k];
        let mut weights = vec![0.0f64; desired_k];

        for (index, (color, frequency)) in samples.iter().enumerate() {
            let point = [color[0] as f64, color[1] as f64, color[2] as f64];
            let cluster = nearest_centroid(&point, &centroids);
            assignments[index] = cluster;
            let weight = *frequency as f64;
            sums[cluster][0] += point[0] * weight;
            sums[cluster][1] += point[1] * weight;
            sums[cluster][2] += point[2] * weight;
            weights[cluster] += weight;
        }

        for idx in 0..desired_k {
            if weights[idx] == 0.0 {
                continue;
            }

            let next = [
                sums[idx][0] / weights[idx],
                sums[idx][1] / weights[idx],
                sums[idx][2] / weights[idx],
            ];
            changed += distance_sq(&centroids[idx].values, &next).sqrt();
            centroids[idx].values = next;
        }

        if changed <= settings.kmeans_min_delta || iterations >= 32 {
            debug!(
                target: "pbn_core::quantize",
                iterations,
                centroid_delta = changed,
                sample_colors = samples.len(),
                desired_k,
                "量化阶段结束"
            );
            break;
        }
    }

    let palette: Vec<[u8; 3]> = centroids
        .iter()
        .map(|centroid| {
            let mut rgb = [
                centroid.values[0].round().clamp(0.0, 255.0) as u8,
                centroid.values[1].round().clamp(0.0, 255.0) as u8,
                centroid.values[2].round().clamp(0.0, 255.0) as u8,
            ];
            if !settings.color_restrictions.is_empty() {
                rgb = find_closest_restriction(rgb, &settings.color_restrictions);
            }
            rgb
        })
        .collect();

    let mut sample_map = BTreeMap::<[u8; 3], usize>::new();
    for (index, (color, _)) in samples.iter().enumerate() {
        sample_map.insert(*color, assignments[index]);
    }

    let mut quantized_rgba = vec![0u8; rgba.len()];
    let mut indexed_pixels = Vec::with_capacity((width * height) as usize);

    for (pixel_index, chunk) in rgba.chunks_exact(4).enumerate() {
        let chopped = [chunk[0] >> 2 << 2, chunk[1] >> 2 << 2, chunk[2] >> 2 << 2];
        let palette_index = *sample_map.get(&chopped).unwrap_or(&0);
        let mapped = palette[palette_index];
        let offset = pixel_index * 4;
        quantized_rgba[offset] = mapped[0];
        quantized_rgba[offset + 1] = mapped[1];
        quantized_rgba[offset + 2] = mapped[2];
        quantized_rgba[offset + 3] = chunk[3];
        indexed_pixels.push(palette_index);
    }

    QuantizeResult {
        quantized_rgba,
        indexed_pixels,
        palette,
        original_unique_colors,
        iterations,
        sample_colors: samples.len(),
    }
}

fn initialize_kmeans_plus_plus(
    samples: &[([u8; 3], usize)],
    k: usize,
    seed: u64,
) -> Vec<Centroid> {
    let mut centroids = Vec::with_capacity(k);
    let first_index = (seed as usize) % samples.len().max(1);
    centroids.push(Centroid {
        values: [
            samples[first_index].0[0] as f64,
            samples[first_index].0[1] as f64,
            samples[first_index].0[2] as f64,
        ],
    });

    while centroids.len() < k {
        let mut best_index = 0usize;
        let mut best_score = -1.0f64;

        for (index, (color, weight)) in samples.iter().enumerate() {
            let point = [color[0] as f64, color[1] as f64, color[2] as f64];
            let nearest_distance = centroids
                .iter()
                .map(|centroid| distance_sq(&point, &centroid.values))
                .fold(f64::MAX, f64::min);
            let score = nearest_distance * *weight as f64;
            if score > best_score {
                best_score = score;
                best_index = index;
            }
        }

        let color = samples[best_index].0;
        centroids.push(Centroid {
            values: [color[0] as f64, color[1] as f64, color[2] as f64],
        });
    }

    centroids
}

fn nearest_centroid(point: &[f64; 3], centroids: &[Centroid]) -> usize {
    let mut best_index = 0usize;
    let mut best_distance = f64::MAX;
    for (index, centroid) in centroids.iter().enumerate() {
        let distance = distance_sq(point, &centroid.values);
        if distance < best_distance {
            best_distance = distance;
            best_index = index;
        }
    }
    best_index
}

fn distance_sq(a: &[f64; 3], b: &[f64; 3]) -> f64 {
    let dx = a[0] - b[0];
    let dy = a[1] - b[1];
    let dz = a[2] - b[2];
    dx * dx + dy * dy + dz * dz
}

fn find_closest_restriction(color: [u8; 3], restrictions: &[[u8; 3]]) -> [u8; 3] {
    let mut best = restrictions[0];
    let mut best_distance = f64::MAX;

    for candidate in restrictions {
        let dx = color[0] as f64 - candidate[0] as f64;
        let dy = color[1] as f64 - candidate[1] as f64;
        let dz = color[2] as f64 - candidate[2] as f64;
        let distance = dx * dx + dy * dy + dz * dz;
        if distance < best_distance {
            best_distance = distance;
            best = *candidate;
        }
    }

    best
}
