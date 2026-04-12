use crate::contours::{ContourLoop, FacetContourData};
use crate::models::LabelBounds;
use crate::regions::Facet;
use std::cmp::Ordering;
use std::collections::BinaryHeap;
use tracing::debug;

/// 计算 facet 的标签框。
///
/// 这一版改为优先消费 segment 回放后的 contour 结果，
/// 这样 polylabel 会基于与旧版更接近的 outer/inner ring 语义运行。
pub fn build_label_bounds(
    facets: &[Facet],
    contours: &[FacetContourData],
    width: u32,
    height: u32,
) -> Vec<LabelBounds> {
    facets
        .iter()
        .map(|facet| build_single_label_bounds(facet, contours, width, height))
        .collect()
}

fn build_single_label_bounds(
    facet: &Facet,
    contours: &[FacetContourData],
    _width: u32,
    _height: u32,
) -> LabelBounds {
    let Some(contour_data) = contours.iter().find(|data| data.facet_id == facet.id) else {
        return fallback_label_bounds(facet);
    };
    let Some(outer_ring) = pick_outer_ring(&contour_data.loops) else {
        return fallback_label_bounds(facet);
    };

    let mut polygon_rings = vec![outer_ring.points.clone()];
    for loop_item in contour_data.loops.iter().filter(|loop_item| !loop_item.is_outer) {
        polygon_rings.push(loop_item.points.clone());
    }

    let result = polylabel(&polygon_rings, 1.0);
    let half_box_size = (result.distance.max(0.0) / std::f64::consts::SQRT_2).max(0.5);
    let min_x = (result.x - half_box_size)
        .floor()
        .clamp(facet.bbox_min_x as f64, facet.bbox_max_x as f64) as u32;
    let min_y = (result.y - half_box_size)
        .floor()
        .clamp(facet.bbox_min_y as f64, facet.bbox_max_y as f64) as u32;
    let max_x = (result.x + half_box_size)
        .ceil()
        .clamp((facet.bbox_min_x + 1) as f64, (facet.bbox_max_x + 1) as f64) as u32;
    let max_y = (result.y + half_box_size)
        .ceil()
        .clamp((facet.bbox_min_y + 1) as f64, (facet.bbox_max_y + 1) as f64) as u32;

    debug!(
        target: "pbn_core::labels",
        facet_id = facet.id,
        inner_ring_count = polygon_rings.len().saturating_sub(1),
        label_x = result.x,
        label_y = result.y,
        label_distance = result.distance,
        traced_path_point_count = contour_data.traced_path_point_count,
        "标签放置完成"
    );

    LabelBounds {
        min_x,
        min_y,
        width: max_x.saturating_sub(min_x).max(1),
        height: max_y.saturating_sub(min_y).max(1),
    }
}

fn pick_outer_ring(loops: &[ContourLoop]) -> Option<&ContourLoop> {
    loops.iter().max_by(|left, right| {
        left.signed_area
            .abs()
            .partial_cmp(&right.signed_area.abs())
            .unwrap_or(Ordering::Equal)
    })
}

fn fallback_label_bounds(facet: &Facet) -> LabelBounds {
    LabelBounds {
        min_x: facet.bbox_min_x,
        min_y: facet.bbox_min_y,
        width: facet.bbox_max_x - facet.bbox_min_x + 1,
        height: facet.bbox_max_y - facet.bbox_min_y + 1,
    }
}

#[derive(Debug, Clone, Copy)]
struct PolylabelResult {
    x: f64,
    y: f64,
    distance: f64,
}

#[derive(Debug, Clone, Copy)]
struct Cell {
    x: f64,
    y: f64,
    h: f64,
    d: f64,
    max: f64,
}

impl Cell {
    fn new(x: f64, y: f64, h: f64, polygon: &[Vec<(f64, f64)>]) -> Self {
        let d = point_to_polygon_dist(x, y, polygon);
        Self {
            x,
            y,
            h,
            d,
            max: d + h * std::f64::consts::SQRT_2,
        }
    }
}

impl PartialEq for Cell {
    fn eq(&self, other: &Self) -> bool {
        self.max == other.max
    }
}

impl Eq for Cell {}

impl PartialOrd for Cell {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        self.max.partial_cmp(&other.max)
    }
}

impl Ord for Cell {
    fn cmp(&self, other: &Self) -> Ordering {
        self.partial_cmp(other).unwrap_or(Ordering::Equal)
    }
}

fn polylabel(polygon: &[Vec<(f64, f64)>], precision: f64) -> PolylabelResult {
    if polygon.is_empty() || polygon[0].is_empty() {
        return PolylabelResult {
            x: 0.0,
            y: 0.0,
            distance: 0.0,
        };
    }

    let mut min_x = f64::MAX;
    let mut min_y = f64::MAX;
    let mut max_x = f64::MIN;
    let mut max_y = f64::MIN;
    for &(x, y) in &polygon[0] {
        min_x = min_x.min(x);
        min_y = min_y.min(y);
        max_x = max_x.max(x);
        max_y = max_y.max(y);
    }

    let width = max_x - min_x;
    let height = max_y - min_y;
    let cell_size = width.min(height);
    if cell_size <= f64::EPSILON {
        return PolylabelResult {
            x: min_x,
            y: min_y,
            distance: 0.0,
        };
    }

    let mut queue = BinaryHeap::new();
    let mut half = cell_size / 2.0;
    let mut x = min_x;
    while x < max_x {
        let mut y = min_y;
        while y < max_y {
            queue.push(Cell::new(x + half, y + half, half, polygon));
            y += cell_size;
        }
        x += cell_size;
    }

    let mut best_cell = centroid_cell(polygon);
    let bbox_cell = Cell::new(min_x + width / 2.0, min_y + height / 2.0, 0.0, polygon);
    if bbox_cell.d > best_cell.d {
        best_cell = bbox_cell;
    }

    while let Some(cell) = queue.pop() {
        if cell.d > best_cell.d {
            best_cell = cell;
        }

        if cell.max - best_cell.d <= precision {
            continue;
        }

        half = cell.h / 2.0;
        queue.push(Cell::new(cell.x - half, cell.y - half, half, polygon));
        queue.push(Cell::new(cell.x + half, cell.y - half, half, polygon));
        queue.push(Cell::new(cell.x - half, cell.y + half, half, polygon));
        queue.push(Cell::new(cell.x + half, cell.y + half, half, polygon));
    }

    PolylabelResult {
        x: best_cell.x,
        y: best_cell.y,
        distance: best_cell.d.max(0.0),
    }
}

fn point_to_polygon_dist(x: f64, y: f64, polygon: &[Vec<(f64, f64)>]) -> f64 {
    let mut inside = false;
    let mut min_dist_sq = f64::INFINITY;

    for ring in polygon {
        if ring.is_empty() {
            continue;
        }

        let mut previous = ring[ring.len() - 1];
        for &current in ring {
            if ((current.1 > y) != (previous.1 > y))
                && (x < (previous.0 - current.0) * (y - current.1) / (previous.1 - current.1) + current.0)
            {
                inside = !inside;
            }

            min_dist_sq = min_dist_sq.min(segment_distance_sq((x, y), current, previous));
            previous = current;
        }
    }

    let signed_distance = min_dist_sq.sqrt();
    if inside {
        signed_distance
    } else {
        -signed_distance
    }
}

fn centroid_cell(polygon: &[Vec<(f64, f64)>]) -> Cell {
    let points = &polygon[0];
    if points.is_empty() {
        return Cell {
            x: 0.0,
            y: 0.0,
            h: 0.0,
            d: 0.0,
            max: 0.0,
        };
    }

    let mut area = 0.0;
    let mut x = 0.0;
    let mut y = 0.0;
    let mut previous = points[points.len() - 1];
    for &current in points {
        let factor = previous.0 * current.1 - current.0 * previous.1;
        x += (previous.0 + current.0) * factor;
        y += (previous.1 + current.1) * factor;
        area += factor * 3.0;
        previous = current;
    }

    if area.abs() <= f64::EPSILON {
        return Cell::new(points[0].0, points[0].1, 0.0, polygon);
    }
    Cell::new(x / area, y / area, 0.0, polygon)
}

fn segment_distance_sq(point: (f64, f64), start: (f64, f64), end: (f64, f64)) -> f64 {
    let dx = end.0 - start.0;
    let dy = end.1 - start.1;
    if dx.abs() <= f64::EPSILON && dy.abs() <= f64::EPSILON {
        return (point.0 - start.0).powi(2) + (point.1 - start.1).powi(2);
    }

    let t = ((point.0 - start.0) * dx + (point.1 - start.1) * dy) / (dx * dx + dy * dy);
    let t = t.clamp(0.0, 1.0);
    let px = start.0 + t * dx;
    let py = start.1 + t * dy;
    (point.0 - px).powi(2) + (point.1 - py).powi(2)
}
