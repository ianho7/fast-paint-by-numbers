use crate::contours::build_facet_contours;
use crate::debug_render::{
    render_border_paths_rgba, render_indexed_pixels_rgba, render_label_placement_rgba,
};
use crate::labels::build_label_bounds;
use crate::models::{
    DebugOutput, MetricsOutput, PipelineStats, ProcessError, ProcessInput, ProcessInputRef,
    ProcessOutput, StageTimings,
};
use crate::palette::palette_stats;
use crate::quantize::quantize_rgba_pixels;
use crate::reduction::reduce_facets;
use crate::regions::{build_regions, summarize_facets};
use crate::render::render_svg_document;
use tracing::info;

pub fn quantize_rgba(
    input: &ProcessInput,
) -> Result<crate::quantize::QuantizeResult, ProcessError> {
    validate_input(input)?;
    Ok(quantize_rgba_pixels(
        input.width,
        input.height,
        &input.rgba,
        &input.settings,
    ))
}

pub fn quantize_rgba_ref(
    input: &ProcessInputRef,
) -> Result<crate::quantize::QuantizeResult, ProcessError> {
    validate_input_ref(input)?;
    Ok(quantize_rgba_pixels(
        input.width,
        input.height,
        input.rgba,
        &input.settings,
    ))
}

pub fn render_svg(
    width: u32,
    height: u32,
    facets: &[crate::regions::Facet],
    facet_map: &[u32],
    palette: &[[u8; 3]],
    labels: &[crate::models::LabelBounds],
    smoothing_passes: u8,
    settings: &crate::models::ProcessSettings,
) -> String {
    let contours = build_facet_contours(width, height, facets, facet_map, smoothing_passes);
    render_svg_document(width, height, facets, &contours, palette, labels, settings)
}

pub fn process_rgba(input: ProcessInput) -> Result<ProcessOutput, ProcessError> {
    // 委托给零拷贝版本
    process_rgba_ref(ProcessInputRef {
        width: input.width,
        height: input.height,
        rgba: &input.rgba,
        settings: input.settings,
    })
}

/// 零拷贝版本的 process_rgba，直接借用 RGBA 数据。
/// 用于 WASM 边界优化，避免大图片的内存复制开销。
pub fn process_rgba_ref(input: ProcessInputRef) -> Result<ProcessOutput, ProcessError> {
    validate_input_ref(&input)?;

    let total_start = StageClock::start();
    let mut timings = StageTimings::default();
    let mut stats = PipelineStats::default();

    info!(
        target: "pbn_core::pipeline",
        width = input.width,
        height = input.height,
        rgba_len = input.rgba.len(),
        kmeans_clusters = input.settings.kmeans_clusters,
        remove_facets_smaller_than = input.settings.remove_facets_smaller_than,
        maximum_number_of_facets = input.settings.maximum_number_of_facets,
        border_smoothing_passes = input.settings.border_smoothing_passes,
        "Started processing RGBA image"
    );

    let quantize_start = StageClock::start();
    let quantized = quantize_rgba_pixels(input.width, input.height, &input.rgba, &input.settings);
    timings.quantize_ms = quantize_start.elapsed_ms();
    stats.original_unique_colors = quantized.original_unique_colors;
    stats.quantized_palette_size = quantized.palette.len();
    stats.quantize_iterations = quantized.iterations;
    stats.quantize_sample_colors = quantized.sample_colors;
    info!(
        target: "pbn_core::pipeline",
        quantize_ms = timings.quantize_ms,
        original_unique_colors = stats.original_unique_colors,
        quantized_palette_size = stats.quantized_palette_size,
        quantize_iterations = stats.quantize_iterations,
        quantize_sample_colors = stats.quantize_sample_colors,
        "Quantization phase completed"
    );

    let cleanup_start = StageClock::start();
    let mut indexed_pixels = quantized.indexed_pixels.clone();
    let mut replaced_pixels = 0usize;
    for _ in 0..input.settings.narrow_pixel_cleanup_runs {
        replaced_pixels +=
            cleanup_narrow_pixel_strips(input.width, input.height, &mut indexed_pixels);
    }
    timings.cleanup_ms = cleanup_start.elapsed_ms();
    stats.narrow_cleanup_replaced_pixels = replaced_pixels;
    info!(
        target: "pbn_core::pipeline",
        cleanup_ms = timings.cleanup_ms,
        replaced_pixels = stats.narrow_cleanup_replaced_pixels,
        "Narrow pixel strip cleanup phase completed"
    );

    let regions_start = StageClock::start();
    let initial_regions = build_regions(input.width, input.height, &indexed_pixels);
    timings.regions_ms = regions_start.elapsed_ms();
    stats.facets_before_reduction = initial_regions.facets.len();
    info!(
        target: "pbn_core::pipeline",
        regions_ms = timings.regions_ms,
        facets_before_reduction = stats.facets_before_reduction,
        "Region building phase completed"
    );

    let reduction_start = StageClock::start();
    let (reduced_pixels, reduced_regions, reduction_stats) = reduce_facets(
        input.width,
        input.height,
        indexed_pixels,
        &quantized.palette,
        input.settings.remove_facets_smaller_than,
        input.settings.remove_facets_from_large_to_small,
        input.settings.maximum_number_of_facets,
    );
    timings.reduction_ms = reduction_start.elapsed_ms();
    stats.removed_facets = reduction_stats.removed_facets;
    stats.reduction_rounds = reduction_stats.rounds;
    stats.max_facets_seen_during_reduction = reduction_stats.max_facets_seen;
    stats.reduction_fast_path_facets = reduction_stats.fast_path_facets;
    stats.reduction_bfs_facets = reduction_stats.bfs_facets;
    stats.facets_after_reduction = reduced_regions.facets.len();
    info!(
        target: "pbn_core::pipeline",
        reduction_ms = timings.reduction_ms,
        removed_facets = stats.removed_facets,
        reduction_rounds = stats.reduction_rounds,
        max_facets_seen = stats.max_facets_seen_during_reduction,
        fast_path_facets = stats.reduction_fast_path_facets,
        bfs_facets = stats.reduction_bfs_facets,
        facets_after_reduction = stats.facets_after_reduction,
        "Facet reduction phase completed"
    );

    let contour_start = StageClock::start();
    let contours = build_facet_contours(
        input.width,
        input.height,
        &reduced_regions.facets,
        &reduced_regions.facet_map,
        input.settings.border_smoothing_passes,
    );
    let contour_ms = contour_start.elapsed_ms();
    stats.contour_traced_path_points = contours
        .iter()
        .map(|item| item.traced_path_point_count)
        .sum();
    stats.contour_raw_segments = contours.iter().map(|item| item.raw_segment_count).sum();
    stats.contour_shared_segments = contours.iter().map(|item| item.shared_segment_count).sum();
    stats.contour_reverse_segments = contours.iter().map(|item| item.reverse_segment_count).sum();
    info!(
        target: "pbn_core::pipeline",
        contour_ms,
        contour_facet_count = contours.len(),
        traced_path_points = stats.contour_traced_path_points,
        raw_segments = stats.contour_raw_segments,
        shared_segments = stats.contour_shared_segments,
        reverse_segments = stats.contour_reverse_segments,
        "Contour building phase completed"
    );

    let labels_start = StageClock::start();
    let label_bounds = build_label_bounds(
        &reduced_regions.facets,
        &contours,
        input.width,
        input.height,
    );
    timings.labels_ms = labels_start.elapsed_ms();
    info!(
        target: "pbn_core::pipeline",
        labels_ms = timings.labels_ms,
        label_count = label_bounds.len(),
        "Labeling phase completed"
    );

    let render_start = StageClock::start();
    let svg = render_svg_document(
        input.width,
        input.height,
        &reduced_regions.facets,
        &contours,
        &quantized.palette,
        &label_bounds,
        &input.settings,
    );
    timings.render_ms = render_start.elapsed_ms();
    timings.total_ms = total_start.elapsed_ms();
    info!(
        target: "pbn_core::pipeline",
        render_ms = timings.render_ms,
        svg_bytes = svg.len(),
        "Rendering phase completed"
    );

    let palette = palette_stats(&reduced_pixels, &quantized.palette, &input.settings);
    let facets_summary = summarize_facets(&reduced_regions.facets);
    let include_stage_rgba = input
        .settings
        .debug_flags
        .iter()
        .any(|flag| flag == "stage_rgba" || flag == "web_demo_stage_rgba");
    let traced_loops = contours
        .iter()
        .map(|contour| contour.traced_loops.clone())
        .collect::<Vec<_>>();
    let segmented_loops = contours
        .iter()
        .map(|contour| contour.loops.clone())
        .collect::<Vec<_>>();

    info!(
        target: "pbn_core::pipeline",
        palette_size = palette.len(),
        facet_count = reduced_regions.facets.len(),
        svg_bytes = svg.len(),
        total_ms = timings.total_ms,
        "Image processing completed"
    );

    let debug = Some(DebugOutput {
        quantized_rgba: quantized.quantized_rgba,
        facet_map: reduced_regions.facet_map,
        reduction_rgba: include_stage_rgba.then(|| {
            render_indexed_pixels_rgba(
                input.width,
                input.height,
                &reduced_pixels,
                &quantized.palette,
            )
        }),
        border_path_rgba: include_stage_rgba.then(|| {
            render_border_paths_rgba(
                input.width,
                input.height,
                &reduced_regions.facets,
                &traced_loops,
                &quantized.palette,
            )
        }),
        border_segmentation_rgba: include_stage_rgba.then(|| {
            render_border_paths_rgba(
                input.width,
                input.height,
                &reduced_regions.facets,
                &segmented_loops,
                &quantized.palette,
            )
        }),
        label_placement_rgba: include_stage_rgba.then(|| {
            render_label_placement_rgba(
                input.width,
                input.height,
                &reduced_regions.facets,
                &segmented_loops,
                &label_bounds,
                &quantized.palette,
            )
        }),
    });

    Ok(ProcessOutput {
        palette,
        svg,
        facet_count: reduced_regions.facets.len(),
        label_bounds,
        facets_summary,
        debug,
        metrics: MetricsOutput {
            stage_timings: timings,
            pipeline_stats: stats,
        },
    })
}

fn validate_input(input: &ProcessInput) -> Result<(), ProcessError> {
    validate_input_ref(&ProcessInputRef {
        width: input.width,
        height: input.height,
        rgba: &input.rgba,
        settings: input.settings.clone(),
    })
}

fn validate_input_ref(input: &ProcessInputRef) -> Result<(), ProcessError> {
    if input.width == 0 || input.height == 0 {
        return Err(ProcessError::EmptyImage);
    }
    let expected = (input.width as usize) * (input.height as usize) * 4;
    if input.rgba.len() != expected {
        return Err(ProcessError::InvalidRgbaLength {
            expected,
            actual: input.rgba.len(),
        });
    }
    Ok(())
}

fn cleanup_narrow_pixel_strips(width: u32, height: u32, indexed_pixels: &mut [usize]) -> usize {
    let mut replaced = 0usize;
    let snapshot = indexed_pixels.to_vec();
    for y in 1..height.saturating_sub(1) {
        for x in 1..width.saturating_sub(1) {
            let index = (y * width + x) as usize;
            let top = snapshot[((y - 1) * width + x) as usize];
            let bottom = snapshot[((y + 1) * width + x) as usize];
            let left = snapshot[(y * width + (x - 1)) as usize];
            let right = snapshot[(y * width + (x + 1)) as usize];
            let current = snapshot[index];

            if current != top && current != bottom {
                indexed_pixels[index] = top;
                replaced += 1;
            } else if current != left && current != right {
                indexed_pixels[index] = left;
                replaced += 1;
            }
        }
    }
    replaced
}

struct StageClock {
    #[cfg(not(target_arch = "wasm32"))]
    start: std::time::Instant,
}

impl StageClock {
    fn start() -> Self {
        Self {
            #[cfg(not(target_arch = "wasm32"))]
            start: std::time::Instant::now(),
        }
    }

    fn elapsed_ms(&self) -> u128 {
        #[cfg(not(target_arch = "wasm32"))]
        {
            return self.start.elapsed().as_millis();
        }

        #[cfg(target_arch = "wasm32")]
        {
            0
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ProcessSettings;

    #[test]
    fn invalid_rgba_length_returns_error() {
        let input = ProcessInput {
            width: 2,
            height: 2,
            rgba: vec![0; 4],
            settings: ProcessSettings::default(),
        };
        assert!(matches!(
            process_rgba(input),
            Err(ProcessError::InvalidRgbaLength { .. })
        ));
    }

    #[test]
    fn quantize_rgba_returns_expected_pixel_count() {
        let input = ProcessInput {
            width: 2,
            height: 1,
            rgba: vec![255, 0, 0, 255, 0, 255, 0, 255],
            settings: ProcessSettings::default(),
        };
        let result = quantize_rgba(&input).expect("quantize should succeed");
        assert_eq!(result.quantized_rgba.len(), input.rgba.len());
        assert_eq!(result.indexed_pixels.len(), 2);
    }

    #[test]
    fn process_rgba_returns_svg_and_palette() {
        let settings = ProcessSettings {
            kmeans_clusters: 2,
            narrow_pixel_cleanup_runs: 0,
            remove_facets_smaller_than: 1,
            maximum_number_of_facets: usize::MAX,
            border_smoothing_passes: 1,
            ..ProcessSettings::default()
        };
        let input = ProcessInput {
            width: 2,
            height: 2,
            rgba: vec![
                255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255,
            ],
            settings,
        };
        let output = process_rgba(input).expect("process should succeed");
        assert!(output.svg.contains("<svg"));
        assert_eq!(output.palette.len(), 2);
        assert_eq!(output.facet_count, 2);
        assert!(output.metrics.stage_timings.total_ms >= output.metrics.stage_timings.quantize_ms);
        let debug = output.debug.expect("debug output should be present");
        assert!(debug.reduction_rgba.is_none());
        assert!(debug.border_path_rgba.is_none());
        assert!(debug.border_segmentation_rgba.is_none());
        assert!(debug.label_placement_rgba.is_none());
    }

    #[test]
    fn process_rgba_emits_stage_rgba_when_flag_enabled() {
        let settings = ProcessSettings {
            kmeans_clusters: 2,
            narrow_pixel_cleanup_runs: 0,
            remove_facets_smaller_than: 1,
            maximum_number_of_facets: usize::MAX,
            border_smoothing_passes: 1,
            debug_flags: vec!["stage_rgba".to_string()],
            ..ProcessSettings::default()
        };
        let input = ProcessInput {
            width: 2,
            height: 2,
            rgba: vec![
                255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255,
            ],
            settings,
        };
        let output = process_rgba(input).expect("process should succeed");
        let debug = output.debug.expect("debug output should be present");
        let expected_len = 2 * 2 * 4;
        assert_eq!(debug.quantized_rgba.len(), expected_len);
        assert_eq!(
            debug.reduction_rgba.expect("reduction_rgba").len(),
            expected_len
        );
        assert_eq!(
            debug.border_path_rgba.expect("border_path_rgba").len(),
            expected_len
        );
        assert_eq!(
            debug
                .border_segmentation_rgba
                .expect("border_segmentation_rgba")
                .len(),
            expected_len
        );
        assert_eq!(
            debug
                .label_placement_rgba
                .expect("label_placement_rgba")
                .len(),
            expected_len
        );
    }

    #[test]
    fn donut_svg_uses_multiple_subpaths_for_ring_facet() {
        let settings = ProcessSettings {
            kmeans_clusters: 3,
            narrow_pixel_cleanup_runs: 0,
            remove_facets_smaller_than: 1,
            border_smoothing_passes: 0,
            ..ProcessSettings::default()
        };
        let rgba = build_donut_rgba();
        let output = process_rgba(ProcessInput {
            width: 5,
            height: 5,
            rgba,
            settings,
        })
        .expect("process should succeed");

        assert!(output.svg.contains("fill-rule=\"evenodd\""));
        let ring_facet = output
            .facets_summary
            .iter()
            .find(|facet| facet.point_count == 16)
            .expect("ring facet should exist");
        let marker = format!("data-facet-id=\"{}\"", ring_facet.id);
        let path_start = output
            .svg
            .find(&marker)
            .expect("ring facet path should exist");
        let path_fragment = &output.svg[path_start..];
        let path_end = path_fragment.find("/>").expect("path should close");
        let path = &path_fragment[..path_end];
        assert!(path.matches("M ").count() >= 2);
    }

    #[test]
    fn donut_label_bounds_should_not_cover_center_hole() {
        let settings = ProcessSettings {
            kmeans_clusters: 3,
            narrow_pixel_cleanup_runs: 0,
            remove_facets_smaller_than: 1,
            border_smoothing_passes: 0,
            ..ProcessSettings::default()
        };
        let output = process_rgba(ProcessInput {
            width: 5,
            height: 5,
            rgba: build_donut_rgba(),
            settings,
        })
        .expect("process should succeed");

        let ring_index = output
            .facets_summary
            .iter()
            .position(|facet| facet.point_count == 16)
            .expect("ring facet should exist");
        let bounds = &output.label_bounds[ring_index];
        let covers_center_x = bounds.min_x <= 2 && 2 < bounds.min_x + bounds.width;
        let covers_center_y = bounds.min_y <= 2 && 2 < bounds.min_y + bounds.height;
        assert!(!(covers_center_x && covers_center_y));
    }

    #[test]
    fn nested_island_svg_keeps_multiple_subpaths() {
        let settings = ProcessSettings {
            kmeans_clusters: 4,
            narrow_pixel_cleanup_runs: 0,
            remove_facets_smaller_than: 1,
            border_smoothing_passes: 0,
            ..ProcessSettings::default()
        };
        let output = process_rgba(ProcessInput {
            width: 7,
            height: 7,
            rgba: build_nested_island_rgba(),
            settings,
        })
        .expect("process should succeed");

        let outer_ring = output
            .facets_summary
            .iter()
            .find(|facet| facet.point_count == 24)
            .expect("outer ring facet should exist");
        let marker = format!("data-facet-id=\"{}\"", outer_ring.id);
        let path_start = output
            .svg
            .find(&marker)
            .expect("outer ring path should exist");
        let path_fragment = &output.svg[path_start..];
        let path_end = path_fragment.find("/>").expect("path should close");
        let path = &path_fragment[..path_end];
        assert!(path.matches("M ").count() >= 2);
    }

    fn build_donut_rgba() -> Vec<u8> {
        let mut rgba = Vec::new();
        for y in 0..5 {
            for x in 0..5 {
                let color = if x == 0 || y == 0 || x == 4 || y == 4 {
                    [255, 0, 0, 255]
                } else if x == 2 && y == 2 {
                    [0, 0, 255, 255]
                } else {
                    [0, 255, 0, 255]
                };
                rgba.extend_from_slice(&color);
            }
        }
        rgba
    }

    fn build_nested_island_rgba() -> Vec<u8> {
        let mut rgba = Vec::new();
        for y in 0..7 {
            for x in 0..7 {
                let color = if x == 0 || y == 0 || x == 6 || y == 6 {
                    [255, 0, 0, 255]
                } else if (2..=4).contains(&x) && (2..=4).contains(&y) {
                    if x == 3 && y == 3 {
                        [0, 0, 255, 255]
                    } else {
                        [255, 0, 0, 255]
                    }
                } else {
                    [0, 255, 0, 255]
                };
                rgba.extend_from_slice(&color);
            }
        }
        rgba
    }
}
