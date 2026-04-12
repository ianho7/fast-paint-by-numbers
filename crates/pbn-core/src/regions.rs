use crate::models::FacetSummary;
use std::collections::{BTreeMap, BTreeSet};
use tracing::debug;

#[derive(Debug, Clone)]
pub struct Facet {
    pub id: usize,
    pub color_index: usize,
    pub point_count: usize,
    pub bbox_min_x: u32,
    pub bbox_min_y: u32,
    pub bbox_max_x: u32,
    pub bbox_max_y: u32,
    pub border_points: Vec<(u32, u32)>,
    pub pixels: Vec<(u32, u32)>,
    pub neighbour_facets: Vec<usize>,
}

#[derive(Debug, Clone)]
pub struct RegionsResult {
    pub facets: Vec<Facet>,
    pub facet_map: Vec<u32>,
}

#[derive(Debug, Clone)]
struct FacetAccumulator {
    color_index: usize,
    point_count: usize,
    bbox_min_x: u32,
    bbox_min_y: u32,
    bbox_max_x: u32,
    bbox_max_y: u32,
    pixels: Vec<(u32, u32)>,
}

/// 使用两遍式 CCL + union-find 构建 facet。
///
/// 这一版保留旧实现的四邻域连通语义和扫描顺序编号语义，
/// 但把实现替换为更适合 M3 性能演进的 connected components labeling。
pub fn build_regions(width: u32, height: u32, indexed_pixels: &[usize]) -> RegionsResult {
    let len = (width * height) as usize;
    if len == 0 {
        return RegionsResult {
            facets: Vec::new(),
            facet_map: Vec::new(),
        };
    }

    let mut provisional_labels = vec![u32::MAX; len];
    let mut union_find = UnionFind::new(len);
    let mut next_label = 0usize;

    // 第一遍：沿扫描顺序打临时标签，并合并四邻域中的等价标签。
    for y in 0..height {
        for x in 0..width {
            let index = flat_index(width, x, y);
            let color_index = indexed_pixels[index];
            let mut matching_labels = Vec::with_capacity(2);

            if x > 0 {
                let left_index = flat_index(width, x - 1, y);
                if indexed_pixels[left_index] == color_index {
                    matching_labels.push(provisional_labels[left_index] as usize);
                }
            }
            if y > 0 {
                let up_index = flat_index(width, x, y - 1);
                if indexed_pixels[up_index] == color_index {
                    matching_labels.push(provisional_labels[up_index] as usize);
                }
            }

            if matching_labels.is_empty() {
                provisional_labels[index] = next_label as u32;
                next_label += 1;
                continue;
            }

            let base = *matching_labels.iter().min().unwrap();
            provisional_labels[index] = base as u32;
            for label in matching_labels {
                union_find.union(base, label);
            }
        }
    }

    let mut root_to_facet_id = BTreeMap::<usize, usize>::new();
    let mut accumulators = Vec::<FacetAccumulator>::new();
    let mut facet_map = vec![u32::MAX; len];

    // 第二遍：把等价临时标签压缩成稳定 facet id，并同步统计像素、bbox 等结果。
    for y in 0..height {
        for x in 0..width {
            let index = flat_index(width, x, y);
            let root = union_find.find(provisional_labels[index] as usize);
            let facet_id = *root_to_facet_id.entry(root).or_insert_with(|| {
                let id = accumulators.len();
                accumulators.push(FacetAccumulator {
                    color_index: indexed_pixels[index],
                    point_count: 0,
                    bbox_min_x: x,
                    bbox_min_y: y,
                    bbox_max_x: x,
                    bbox_max_y: y,
                    pixels: Vec::new(),
                });
                id
            });

            facet_map[index] = facet_id as u32;
            let accumulator = &mut accumulators[facet_id];
            accumulator.point_count += 1;
            accumulator.bbox_min_x = accumulator.bbox_min_x.min(x);
            accumulator.bbox_min_y = accumulator.bbox_min_y.min(y);
            accumulator.bbox_max_x = accumulator.bbox_max_x.max(x);
            accumulator.bbox_max_y = accumulator.bbox_max_y.max(y);
            accumulator.pixels.push((x, y));
        }
    }

    let mut facets = accumulators
        .into_iter()
        .enumerate()
        .map(|(id, accumulator)| Facet {
            id,
            color_index: accumulator.color_index,
            point_count: accumulator.point_count,
            bbox_min_x: accumulator.bbox_min_x,
            bbox_min_y: accumulator.bbox_min_y,
            bbox_max_x: accumulator.bbox_max_x,
            bbox_max_y: accumulator.bbox_max_y,
            border_points: Vec::new(),
            pixels: accumulator.pixels,
            neighbour_facets: Vec::new(),
        })
        .collect::<Vec<_>>();

    rebuild_border_points(width, height, &facet_map, &mut facets);
    rebuild_neighbours(width, height, &facet_map, &mut facets);

    debug!(
        target: "pbn_core::regions",
        width,
        height,
        provisional_label_count = next_label,
        final_facet_count = facets.len(),
        "CCL facet 构建完成"
    );

    RegionsResult { facets, facet_map }
}

/// 根据像素级 facet map 重建 border point。
///
/// border point 语义保持与旧版一致：只要四邻域或画布边界存在不同 facet，就认为该像素在边界上。
pub fn rebuild_border_points(width: u32, height: u32, facet_map: &[u32], facets: &mut [Facet]) {
    let mut border_points = vec![Vec::<(u32, u32)>::new(); facets.len()];
    for y in 0..height {
        for x in 0..width {
            let index = flat_index(width, x, y);
            let facet_id = facet_map[index] as usize;
            let mut is_border = x == 0 || y == 0 || x + 1 == width || y + 1 == height;
            if !is_border {
                for (nx, ny) in neighbours(width, height, x, y) {
                    let neighbour_index = flat_index(width, nx, ny);
                    if facet_map[neighbour_index] != facet_map[index] {
                        is_border = true;
                        break;
                    }
                }
            }
            if is_border {
                border_points[facet_id].push((x, y));
            }
        }
    }

    for (facet, points) in facets.iter_mut().zip(border_points.into_iter()) {
        facet.border_points = points;
    }
}

/// 根据像素级 facet map 重建邻接关系。
pub fn rebuild_neighbours(width: u32, height: u32, facet_map: &[u32], facets: &mut [Facet]) {
    let mut neighbour_sets = vec![BTreeSet::<usize>::new(); facets.len()];
    for y in 0..height {
        for x in 0..width {
            let current = facet_map[flat_index(width, x, y)] as usize;
            for (nx, ny) in neighbours(width, height, x, y) {
                let next = facet_map[flat_index(width, nx, ny)] as usize;
                if current != next {
                    neighbour_sets[current].insert(next);
                }
            }
        }
    }

    for (facet, neighbours) in facets.iter_mut().zip(neighbour_sets.into_iter()) {
        facet.neighbour_facets = neighbours.into_iter().collect();
    }
}

pub fn summarize_facets(facets: &[Facet]) -> Vec<FacetSummary> {
    facets
        .iter()
        .map(|facet| FacetSummary {
            id: facet.id,
            color_index: facet.color_index,
            point_count: facet.point_count,
            bbox_min_x: facet.bbox_min_x,
            bbox_min_y: facet.bbox_min_y,
            bbox_max_x: facet.bbox_max_x,
            bbox_max_y: facet.bbox_max_y,
            neighbour_facets: facet.neighbour_facets.clone(),
        })
        .collect()
}

pub fn flat_index(width: u32, x: u32, y: u32) -> usize {
    (y * width + x) as usize
}

pub fn neighbours(width: u32, height: u32, x: u32, y: u32) -> Vec<(u32, u32)> {
    let mut output = Vec::with_capacity(4);
    if x > 0 {
        output.push((x - 1, y));
    }
    if y > 0 {
        output.push((x, y - 1));
    }
    if x + 1 < width {
        output.push((x + 1, y));
    }
    if y + 1 < height {
        output.push((x, y + 1));
    }
    output
}

#[derive(Debug, Clone)]
struct UnionFind {
    parent: Vec<usize>,
    rank: Vec<u8>,
}

impl UnionFind {
    fn new(capacity: usize) -> Self {
        Self {
            parent: (0..capacity).collect(),
            rank: vec![0; capacity],
        }
    }

    fn find(&mut self, value: usize) -> usize {
        if self.parent[value] != value {
            let root = self.find(self.parent[value]);
            self.parent[value] = root;
        }
        self.parent[value]
    }

    fn union(&mut self, left: usize, right: usize) {
        let left_root = self.find(left);
        let right_root = self.find(right);
        if left_root == right_root {
            return;
        }

        if self.rank[left_root] < self.rank[right_root] {
            self.parent[left_root] = right_root;
        } else if self.rank[left_root] > self.rank[right_root] {
            self.parent[right_root] = left_root;
        } else {
            self.parent[right_root] = left_root;
            self.rank[left_root] += 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ccl_keeps_scan_order_for_stable_facet_ids() {
        let indexed = vec![
            0, 1, 1,
            0, 1, 2,
            3, 3, 2,
        ];
        let regions = build_regions(3, 3, &indexed);
        assert_eq!(regions.facets.len(), 4);
        assert_eq!(regions.facets[0].color_index, 0);
        assert_eq!(regions.facets[1].color_index, 1);
        assert_eq!(regions.facets[2].color_index, 2);
        assert_eq!(regions.facets[3].color_index, 3);
    }

    #[test]
    fn ccl_builds_border_points_and_neighbours() {
        let indexed = vec![
            0, 0, 1,
            0, 1, 1,
            2, 2, 1,
        ];
        let regions = build_regions(3, 3, &indexed);
        assert!(!regions.facets[0].border_points.is_empty());
        assert!(regions.facets[0].neighbour_facets.contains(&1));
        assert!(regions.facets[0].neighbour_facets.contains(&2));
    }
}
