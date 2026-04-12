use crate::regions::{flat_index, Facet};
use std::cmp::Ordering;
use std::collections::HashMap;
use tracing::{debug, trace, warn};

/// 单个闭合轮廓。
///
/// 点坐标使用浮点网格顶点坐标，便于后续直接转换成 SVG path 和曲线控制点。
#[derive(Debug, Clone)]
pub struct ContourLoop {
    pub points: Vec<(f64, f64)>,
    pub signed_area: f64,
    pub is_outer: bool,
}

/// 墙朝向语义，保持与旧版 `PathPoint` 的四向命名一致。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Orientation {
    Left,
    Top,
    Right,
    Bottom,
}

/// 路径点携带当前边的墙朝向与邻居 facet 语义。
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct PathPoint {
    pub x: f64,
    pub y: f64,
    pub orientation: Orientation,
    pub neighbour: isize,
}

#[derive(Debug, Clone)]
pub struct FacetContourData {
    pub facet_id: usize,
    pub traced_loops: Vec<ContourLoop>,
    pub loops: Vec<ContourLoop>,
    pub traced_path_point_count: usize,
    pub raw_segment_count: usize,
    pub shared_segment_count: usize,
    pub reverse_segment_count: usize,
}

#[derive(Debug, Clone)]
struct BoundaryStep {
    pixel_x: u32,
    pixel_y: u32,
    start: (u32, u32),
    end: (u32, u32),
    orientation: Orientation,
    neighbour: isize,
}

#[derive(Debug, Clone)]
struct TracedLoop {
    steps: Vec<BoundaryStep>,
    signed_area: f64,
    is_outer: bool,
}

#[derive(Debug, Clone)]
struct SegmentRecord {
    facet_id: usize,
    neighbour: isize,
    points: Vec<(f64, f64)>,
    smoothed_points: Vec<(f64, f64)>,
    reverse: bool,
    shared_segment_id: Option<usize>,
}

#[derive(Debug, Clone)]
struct SegmentLoopRef {
    segment_ids: Vec<usize>,
    is_outer: bool,
}

#[derive(Debug, Clone)]
struct FacetWork {
    facet_id: usize,
    loops: Vec<TracedLoop>,
    segment_loops: Vec<SegmentLoopRef>,
    traced_path_point_count: usize,
    raw_segment_count: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StepDirection {
    North,
    East,
    South,
    West,
}

/// 为所有 facet 构建 contour / segment / shared-edge 结果。
///
/// 这一版显式补齐 M1 parity 的核心中间层：
/// 1. 先按外露边追踪带朝向的 tracer loops
/// 2. 再按邻居变化和紧转角切分 segment
/// 3. 最后匹配共享边并回放成可渲染的闭环路径
pub fn build_facet_contours(
    width: u32,
    height: u32,
    facets: &[Facet],
    facet_map: &[u32],
    smoothing_passes: u8,
) -> Vec<FacetContourData> {
    let mut facet_works = facets
        .iter()
        .map(|facet| trace_facet_boundary_paths(width, height, facet, facet_map))
        .collect::<Vec<_>>();

    let mut segments = Vec::<SegmentRecord>::new();
    let mut segments_per_facet = vec![Vec::<usize>::new(); facets.len()];
    let mut transition_counts = vec![0usize; facets.len()];
    for work in facet_works.iter_mut() {
        let prepared = prepare_segments_for_facet(
            width,
            height,
            facet_map,
            smoothing_passes,
            work,
            &mut segments,
            &mut transition_counts,
        );
        segments_per_facet[work.facet_id] = prepared;
    }

    let (shared_segment_points, match_stats) =
        match_segments_with_neighbours(&mut segments, &segments_per_facet);

    facet_works
        .into_iter()
        .map(|work| {
            let traced_loops = work
                .loops
                .iter()
                .map(|loop_item| ContourLoop {
                    points: loop_points_from_steps(&loop_item.steps),
                    signed_area: loop_item.signed_area,
                    is_outer: loop_item.is_outer,
                })
                .collect::<Vec<_>>();
            let loops = reconstruct_loops_from_segments(&work, &segments, &shared_segment_points);
            let reverse_segment_count = work
                .segment_loops
                .iter()
                .flat_map(|loop_ref| loop_ref.segment_ids.iter())
                .filter(|&&segment_id| segments[segment_id].reverse)
                .count();
            let shared_segment_count = work
                .segment_loops
                .iter()
                .flat_map(|loop_ref| loop_ref.segment_ids.iter())
                .filter(|&&segment_id| {
                    let Some(shared_segment_id) = segments[segment_id].shared_segment_id else {
                        return false;
                    };
                    shared_segment_id < shared_segment_points.len()
                })
                .count();

            let stats = &match_stats[work.facet_id];
            debug!(
                target: "pbn_core::contours::shared_edge",
                facet_id = work.facet_id,
                matched_count = stats.matched_count,
                reverse_matched_count = stats.reverse_matched_count,
                unmatched_count = stats.unmatched_count,
                ambiguous_match_resolved_count = stats.ambiguous_match_resolved_count,
                "共享边匹配完成"
            );

            FacetContourData {
                facet_id: work.facet_id,
                traced_loops,
                loops,
                traced_path_point_count: work.traced_path_point_count,
                raw_segment_count: work.raw_segment_count,
                shared_segment_count,
                reverse_segment_count,
            }
        })
        .collect()
}

/// 保留给兼容调用方的简化入口。
#[allow(dead_code)]
pub fn trace_facet_loops(
    width: u32,
    height: u32,
    facet: &Facet,
    facet_map: &[u32],
    smoothing_passes: u8,
) -> Vec<ContourLoop> {
    build_facet_contours(width, height, std::slice::from_ref(facet), facet_map, smoothing_passes)
        .into_iter()
        .next()
        .map(|data| data.loops)
        .unwrap_or_default()
}

fn trace_facet_boundary_paths(
    width: u32,
    height: u32,
    facet: &Facet,
    facet_map: &[u32],
) -> FacetWork {
    let steps = build_boundary_steps(width, height, facet, facet_map);
    let mut outgoing = HashMap::<(u32, u32), Vec<usize>>::new();
    for (index, step) in steps.iter().enumerate() {
        outgoing.entry(step.start).or_default().push(index);
    }

    let mut visited = vec![false; steps.len()];
    let mut loops = Vec::<TracedLoop>::new();
    let mut guard_hits = 0usize;
    let ordered_start_indices = stable_start_edge_order(facet, &steps);

    for start_index in ordered_start_indices {
        if visited[start_index] {
            continue;
        }

        let mut loop_steps = Vec::<BoundaryStep>::new();
        let mut current_index = start_index;
        let start_vertex = steps[start_index].start;
        let limit = steps.len().saturating_mul(4).max(16);
        let mut guard = 0usize;

        loop {
            if visited[current_index] {
                break;
            }

            visited[current_index] = true;
            let current_step = steps[current_index].clone();
            let current_end = current_step.end;
            loop_steps.push(current_step.clone());
            guard += 1;

            if current_end == start_vertex {
                break;
            }
            if guard > limit {
                guard_hits += 1;
                warn!(
                    target: "pbn_core::contours::tracer",
                    facet_id = facet.id,
                    start_index,
                    guard,
                    limit,
                    "边界追踪触发回路保护"
                );
                break;
            }

            let Some(candidates) = outgoing.get(&current_end) else {
                warn!(
                    target: "pbn_core::contours::tracer",
                    facet_id = facet.id,
                    vertex_x = current_end.0,
                    vertex_y = current_end.1,
                    "边界追踪在中途失去后续边"
                );
                break;
            };

            let next_index = choose_next_step(&steps, candidates, current_index, &visited);
            let Some(next_index) = next_index else {
                warn!(
                    target: "pbn_core::contours::tracer",
                    facet_id = facet.id,
                    vertex_x = current_end.0,
                    vertex_y = current_end.1,
                    "边界追踪未找到可用后续边"
                );
                break;
            };

            current_index = next_index;
        }

        if !loop_steps.is_empty() {
            normalize_loop_start(facet, &mut loop_steps);
            let signed_area = polygon_signed_area(&loop_points_from_steps(&loop_steps));
            loops.push(TracedLoop {
                steps: loop_steps,
                signed_area,
                is_outer: false,
            });
        }
    }

    loops.sort_by(|left, right| {
        right
            .signed_area
            .abs()
            .partial_cmp(&left.signed_area.abs())
            .unwrap_or(Ordering::Equal)
    });
    if let Some(first) = loops.first_mut() {
        first.is_outer = true;
    }

    let traced_path_point_count = loops.iter().map(|loop_item| loop_item.steps.len()).sum();
    let outer_loop_count = loops.iter().filter(|loop_item| loop_item.is_outer).count();
    let inner_loop_count = loops.len().saturating_sub(outer_loop_count);
    if let Some(first_step) = loops.first().and_then(|loop_item| loop_item.steps.first()) {
        debug!(
            target: "pbn_core::contours::tracer",
            facet_id = facet.id,
            border_start_x = first_step.start.0,
            border_start_y = first_step.start.1,
            border_start_orientation = ?first_step.orientation,
            traced_path_point_count,
            outer_loop_count,
            inner_loop_count,
            guard_hits,
            "边界追踪完成"
        );
    }

    FacetWork {
        facet_id: facet.id,
        loops,
        segment_loops: Vec::new(),
        traced_path_point_count,
        raw_segment_count: 0,
    }
}

fn build_boundary_steps(width: u32, height: u32, facet: &Facet, facet_map: &[u32]) -> Vec<BoundaryStep> {
    let mut steps = Vec::new();
    for &(x, y) in &facet.pixels {
        let top_neighbour = neighbour_at(width, height, facet_map, x as i32, y as i32 - 1);
        if top_neighbour != Some(facet.id) {
            steps.push(BoundaryStep {
                pixel_x: x,
                pixel_y: y,
                start: (x + 1, y),
                end: (x, y),
                orientation: Orientation::Top,
                neighbour: top_neighbour.map(|value| value as isize).unwrap_or(-1),
            });
        }

        let right_neighbour = neighbour_at(width, height, facet_map, x as i32 + 1, y as i32);
        if right_neighbour != Some(facet.id) {
            steps.push(BoundaryStep {
                pixel_x: x,
                pixel_y: y,
                start: (x + 1, y + 1),
                end: (x + 1, y),
                orientation: Orientation::Right,
                neighbour: right_neighbour.map(|value| value as isize).unwrap_or(-1),
            });
        }

        let bottom_neighbour = neighbour_at(width, height, facet_map, x as i32, y as i32 + 1);
        if bottom_neighbour != Some(facet.id) {
            steps.push(BoundaryStep {
                pixel_x: x,
                pixel_y: y,
                start: (x, y + 1),
                end: (x + 1, y + 1),
                orientation: Orientation::Bottom,
                neighbour: bottom_neighbour.map(|value| value as isize).unwrap_or(-1),
            });
        }

        let left_neighbour = neighbour_at(width, height, facet_map, x as i32 - 1, y as i32);
        if left_neighbour != Some(facet.id) {
            steps.push(BoundaryStep {
                pixel_x: x,
                pixel_y: y,
                start: (x, y),
                end: (x, y + 1),
                orientation: Orientation::Left,
                neighbour: left_neighbour.map(|value| value as isize).unwrap_or(-1),
            });
        }
    }
    steps
}

fn stable_start_edge_order(facet: &Facet, steps: &[BoundaryStep]) -> Vec<usize> {
    let mut indices = (0..steps.len()).collect::<Vec<_>>();
    indices.sort_by_key(|&index| {
        let step = &steps[index];
        let on_bbox = step.pixel_x == facet.bbox_min_x
            || step.pixel_x == facet.bbox_max_x
            || step.pixel_y == facet.bbox_min_y
            || step.pixel_y == facet.bbox_max_y;
        (
            !on_bbox,
            step.start.1,
            step.start.0,
            orientation_order(step.orientation),
        )
    });
    indices
}

fn choose_next_step(
    steps: &[BoundaryStep],
    candidates: &[usize],
    current_index: usize,
    visited: &[bool],
) -> Option<usize> {
    let current_direction = step_direction(&steps[current_index]);
    let mut available = candidates
        .iter()
        .copied()
        .filter(|candidate| !visited[*candidate])
        .collect::<Vec<_>>();
    if available.is_empty() {
        return None;
    }
    if available.len() == 1 {
        return available.pop();
    }

    let priority = next_direction_priority(current_direction);
    available.sort_by_key(|candidate| {
        let candidate_direction = step_direction(&steps[*candidate]);
        let turn_rank = priority
            .iter()
            .position(|direction| *direction == candidate_direction)
            .unwrap_or(priority.len());
        let step = &steps[*candidate];
        (turn_rank, step.start.1, step.start.0, orientation_order(step.orientation))
    });

    trace!(
        target: "pbn_core::contours::tracer",
        current_index,
        candidate_count = available.len(),
        chosen_index = available[0],
        "边界追踪在同一顶点上按紧转角优先选择下一条边"
    );
    available.into_iter().next()
}

fn normalize_loop_start(facet: &Facet, loop_steps: &mut Vec<BoundaryStep>) {
    if loop_steps.is_empty() {
        return;
    }

    let best_index = loop_steps
        .iter()
        .enumerate()
        .min_by_key(|(_, step)| {
            let on_bbox = step.pixel_x == facet.bbox_min_x
                || step.pixel_x == facet.bbox_max_x
                || step.pixel_y == facet.bbox_min_y
                || step.pixel_y == facet.bbox_max_y;
            (
                !on_bbox,
                step.start.1,
                step.start.0,
                orientation_order(step.orientation),
            )
        })
        .map(|(index, _)| index)
        .unwrap_or(0);

    loop_steps.rotate_left(best_index);
}

fn prepare_segments_for_facet(
    width: u32,
    height: u32,
    facet_map: &[u32],
    smoothing_passes: u8,
    work: &mut FacetWork,
    segments: &mut Vec<SegmentRecord>,
    transition_counts: &mut [usize],
) -> Vec<usize> {
    let mut flat_segment_ids = Vec::new();
    let mut segment_loops = Vec::new();

    for (loop_index, traced_loop) in work.loops.iter().enumerate() {
        let raw_segments = split_loop_into_segments(width, height, facet_map, traced_loop, &mut transition_counts[work.facet_id]);
        let mut loop_segment_ids = Vec::new();
        for segment in raw_segments {
            let mut smoothed_points = segment.points.clone();
            let original_point_count = smoothed_points.len();
            for _ in 0..smoothing_passes {
                smoothed_points = smooth_segment_points(&smoothed_points, width, height);
            }
            debug!(
                target: "pbn_core::contours::segmenter",
                facet_id = work.facet_id,
                loop_index,
                neighbour = segment.neighbour,
                raw_point_count = original_point_count,
                smoothed_point_count = smoothed_points.len(),
                "边界 segment 平滑完成"
            );
            let segment_id = segments.len();
            segments.push(SegmentRecord {
                facet_id: work.facet_id,
                neighbour: segment.neighbour,
                points: segment.points,
                smoothed_points,
                reverse: false,
                shared_segment_id: None,
            });
            loop_segment_ids.push(segment_id);
            flat_segment_ids.push(segment_id);
        }
        segment_loops.push(SegmentLoopRef {
            segment_ids: loop_segment_ids,
            is_outer: traced_loop.is_outer,
        });
    }

    work.raw_segment_count = flat_segment_ids.len();
    work.segment_loops = segment_loops;
    debug!(
        target: "pbn_core::contours::segmenter",
        facet_id = work.facet_id,
        raw_segment_count = work.raw_segment_count,
        transition_count = transition_counts[work.facet_id],
        "边界 segment 切分完成"
    );

    flat_segment_ids
}

fn split_loop_into_segments(
    width: u32,
    height: u32,
    facet_map: &[u32],
    traced_loop: &TracedLoop,
    transition_counter: &mut usize,
) -> Vec<SegmentRecord> {
    if traced_loop.steps.is_empty() {
        return Vec::new();
    }

    let mut segments = Vec::<SegmentRecord>::new();
    let steps = &traced_loop.steps;
    let mut current_points = vec![
        (steps[0].start.0 as f64, steps[0].start.1 as f64),
        (steps[0].end.0 as f64, steps[0].end.1 as f64),
    ];

    for index in 1..steps.len() {
        let previous = &steps[index - 1];
        let current = &steps[index];
        let mut is_transition = previous.neighbour != current.neighbour;
        if !is_transition && previous.neighbour != -1 {
            is_transition = has_diagonal_transition(width, height, facet_map, previous, current);
        }

        if is_transition {
            *transition_counter += 1;
            segments.push(SegmentRecord {
                facet_id: 0,
                neighbour: previous.neighbour,
                points: current_points.clone(),
                smoothed_points: Vec::new(),
                reverse: false,
                shared_segment_id: None,
            });
            current_points = vec![
                (previous.end.0 as f64, previous.end.1 as f64),
                (current.end.0 as f64, current.end.1 as f64),
            ];
        } else {
            current_points.push((current.end.0 as f64, current.end.1 as f64));
        }
    }

    if !current_points.is_empty() {
        let last_neighbour = steps.last().map(|step| step.neighbour).unwrap_or(-1);
        if let Some(first_segment) = segments.first_mut() {
            if first_segment.neighbour == last_neighbour {
                let mut merged_points = current_points;
                if merged_points.last() == first_segment.points.first() {
                    merged_points.pop();
                }
                merged_points.extend(first_segment.points.iter().copied());
                first_segment.points = merged_points;
            } else {
                segments.push(SegmentRecord {
                    facet_id: 0,
                    neighbour: last_neighbour,
                    points: current_points,
                    smoothed_points: Vec::new(),
                    reverse: false,
                    shared_segment_id: None,
                });
            }
        } else {
            segments.push(SegmentRecord {
                facet_id: 0,
                neighbour: last_neighbour,
                points: current_points,
                smoothed_points: Vec::new(),
                reverse: false,
                shared_segment_id: None,
            });
        }
    }

    segments
}

#[derive(Debug, Clone, Default)]
struct MatchStats {
    matched_count: usize,
    reverse_matched_count: usize,
    unmatched_count: usize,
    ambiguous_match_resolved_count: usize,
}

fn match_segments_with_neighbours(
    segments: &mut [SegmentRecord],
    segments_per_facet: &[Vec<usize>],
) -> (Vec<Vec<(f64, f64)>>, Vec<MatchStats>) {
    let mut shared_segments = Vec::<Vec<(f64, f64)>>::new();
    let mut stats = vec![MatchStats::default(); segments_per_facet.len()];
    const MAX_DISTANCE: f64 = 4.0;

    for facet_segment_ids in segments_per_facet {
        for &segment_id in facet_segment_ids {
            if segments[segment_id].shared_segment_id.is_some() {
                continue;
            }

            let neighbour = segments[segment_id].neighbour;
            let own_facet = segments[segment_id].facet_id;
            if neighbour < 0 {
                let shared_segment_id = shared_segments.len();
                shared_segments.push(segments[segment_id].smoothed_points.clone());
                segments[segment_id].shared_segment_id = Some(shared_segment_id);
                stats[own_facet].unmatched_count += 1;
                continue;
            }

            let neighbour = neighbour as usize;
            let mut match_result = None;
            let mut ambiguous = false;

            for &candidate_id in &segments_per_facet[neighbour] {
                if segments[candidate_id].shared_segment_id.is_some() {
                    continue;
                }
                if segments[candidate_id].neighbour != own_facet as isize {
                    continue;
                }

                let own_points = &segments[segment_id].smoothed_points;
                let candidate_points = &segments[candidate_id].smoothed_points;
                let own_start = own_points.first().copied().unwrap_or((0.0, 0.0));
                let own_end = own_points.last().copied().unwrap_or((0.0, 0.0));
                let candidate_start = candidate_points.first().copied().unwrap_or((0.0, 0.0));
                let candidate_end = candidate_points.last().copied().unwrap_or((0.0, 0.0));

                let straight_distance = point_distance(own_start, candidate_start) + point_distance(own_end, candidate_end);
                let reverse_distance = point_distance(own_start, candidate_end) + point_distance(own_end, candidate_start);
                let mut matches_straight = point_distance(own_start, candidate_start) <= MAX_DISTANCE
                    && point_distance(own_end, candidate_end) <= MAX_DISTANCE;
                let mut matches_reverse = point_distance(own_start, candidate_end) <= MAX_DISTANCE
                    && point_distance(own_end, candidate_start) <= MAX_DISTANCE;

                if matches_straight && matches_reverse {
                    ambiguous = true;
                    if straight_distance <= reverse_distance {
                        matches_reverse = false;
                    } else {
                        matches_straight = false;
                    }
                }

                if matches_straight {
                    match_result = Some((candidate_id, false));
                    break;
                }
                if matches_reverse {
                    match_result = Some((candidate_id, true));
                    break;
                }
            }

            let shared_segment_id = shared_segments.len();
            shared_segments.push(segments[segment_id].smoothed_points.clone());
            segments[segment_id].shared_segment_id = Some(shared_segment_id);
            if let Some((candidate_id, reverse)) = match_result {
                segments[candidate_id].shared_segment_id = Some(shared_segment_id);
                segments[candidate_id].reverse = reverse;
                stats[own_facet].matched_count += 1;
                stats[neighbour].matched_count += 1;
                if reverse {
                    stats[own_facet].reverse_matched_count += 1;
                    stats[neighbour].reverse_matched_count += 1;
                }
                if ambiguous {
                    stats[own_facet].ambiguous_match_resolved_count += 1;
                    stats[neighbour].ambiguous_match_resolved_count += 1;
                }
            } else {
                stats[own_facet].unmatched_count += 1;
                trace!(
                    target: "pbn_core::contours::shared_edge",
                    facet_id = own_facet,
                    neighbour_id = neighbour,
                    segment_point_count = segments[segment_id].smoothed_points.len(),
                    "共享边未找到匹配 segment，保留为本 facet 独占路径"
                );
            }
        }
    }

    (shared_segments, stats)
}

fn reconstruct_loops_from_segments(
    work: &FacetWork,
    segments: &[SegmentRecord],
    shared_segment_points: &[Vec<(f64, f64)>],
) -> Vec<ContourLoop> {
    let mut loops = Vec::new();

    for loop_ref in &work.segment_loops {
        let mut points = Vec::<(f64, f64)>::new();
        let mut last_point = None;
        for &segment_id in &loop_ref.segment_ids {
            let segment = &segments[segment_id];
            let mut segment_points = segment
                .shared_segment_id
                .and_then(|shared_segment_id| shared_segment_points.get(shared_segment_id))
                .cloned()
                .unwrap_or_else(|| segment.smoothed_points.clone());
            if segment.reverse {
                segment_points.reverse();
            }

            if let Some(previous_last) = last_point {
                points.push(previous_last);
            }
            points.extend(segment_points.iter().copied());
            last_point = segment_points.last().copied();
        }

        let mut points = dedupe_consecutive_points(points);
        if points.first() != points.last() {
            if let Some(first) = points.first().copied() {
                points.push(first);
            }
        }

        if points.len() >= 4 {
            loops.push(ContourLoop {
                signed_area: polygon_signed_area(&points),
                points,
                is_outer: loop_ref.is_outer,
            });
        }
    }

    loops.sort_by(|left, right| {
        right
            .signed_area
            .abs()
            .partial_cmp(&left.signed_area.abs())
            .unwrap_or(Ordering::Equal)
    });
    if let Some(first) = loops.first_mut() {
        first.is_outer = true;
    }
    for loop_item in loops.iter_mut().skip(1) {
        loop_item.is_outer = false;
    }
    loops
}

fn loop_points_from_steps(steps: &[BoundaryStep]) -> Vec<(f64, f64)> {
    let mut points = steps
        .iter()
        .map(|step| (step.start.0 as f64, step.start.1 as f64))
        .collect::<Vec<_>>();
    if let Some(last) = steps.last() {
        points.push((last.end.0 as f64, last.end.1 as f64));
    }
    points
}

fn has_diagonal_transition(
    width: u32,
    height: u32,
    facet_map: &[u32],
    previous: &BoundaryStep,
    current: &BoundaryStep,
) -> bool {
    if previous.end != current.start {
        return false;
    }

    let vertex_x = previous.end.0 as i32;
    let vertex_y = previous.end.1 as i32;
    let diagonal = match (previous.orientation, current.orientation) {
        (Orientation::Top, Orientation::Left) | (Orientation::Left, Orientation::Top) => {
            Some((vertex_x - 1, vertex_y - 1))
        }
        (Orientation::Top, Orientation::Right) | (Orientation::Right, Orientation::Top) => {
            Some((vertex_x, vertex_y - 1))
        }
        (Orientation::Bottom, Orientation::Left) | (Orientation::Left, Orientation::Bottom) => {
            Some((vertex_x - 1, vertex_y))
        }
        (Orientation::Bottom, Orientation::Right) | (Orientation::Right, Orientation::Bottom) => {
            Some((vertex_x, vertex_y))
        }
        _ => None,
    };

    let Some((diag_x, diag_y)) = diagonal else {
        return false;
    };
    let neighbour = neighbour_at(width, height, facet_map, diag_x, diag_y)
        .map(|value| value as isize)
        .unwrap_or(-1);
    neighbour != previous.neighbour
}

fn smooth_segment_points(points: &[(f64, f64)], width: u32, height: u32) -> Vec<(f64, f64)> {
    if points.len() <= 5 {
        return points.to_vec();
    }

    let mut reduced = Vec::with_capacity(points.len() / 2 + 2);
    reduced.push(points[0]);
    let mut index = 1usize;
    while index + 1 < points.len() - 1 {
        let current = points[index];
        let next = points[index + 1];
        if is_outside_border(current, width, height) || is_outside_border(next, width, height) {
            reduced.push(current);
            reduced.push(next);
        } else {
            reduced.push(((current.0 + next.0) / 2.0, (current.1 + next.1) / 2.0));
        }
        index += 2;
    }
    reduced.push(*points.last().unwrap_or(&points[0]));
    dedupe_consecutive_points(reduced)
}

fn dedupe_consecutive_points(points: Vec<(f64, f64)>) -> Vec<(f64, f64)> {
    let mut deduped = Vec::new();
    for point in points {
        if deduped.last().copied() != Some(point) {
            deduped.push(point);
        }
    }
    deduped
}

fn point_distance(left: (f64, f64), right: (f64, f64)) -> f64 {
    ((left.0 - right.0).powi(2) + (left.1 - right.1).powi(2)).sqrt()
}

fn is_outside_border(point: (f64, f64), width: u32, height: u32) -> bool {
    point.0 <= 0.0 || point.1 <= 0.0 || point.0 >= width as f64 || point.1 >= height as f64
}

fn neighbour_at(width: u32, height: u32, facet_map: &[u32], x: i32, y: i32) -> Option<usize> {
    if x < 0 || y < 0 || x >= width as i32 || y >= height as i32 {
        return None;
    }
    Some(facet_map[flat_index(width, x as u32, y as u32)] as usize)
}

fn orientation_order(orientation: Orientation) -> u8 {
    match orientation {
        Orientation::Left => 0,
        Orientation::Top => 1,
        Orientation::Right => 2,
        Orientation::Bottom => 3,
    }
}

fn step_direction(step: &BoundaryStep) -> StepDirection {
    if step.end.0 > step.start.0 {
        StepDirection::East
    } else if step.end.0 < step.start.0 {
        StepDirection::West
    } else if step.end.1 > step.start.1 {
        StepDirection::South
    } else {
        StepDirection::North
    }
}

fn next_direction_priority(direction: StepDirection) -> [StepDirection; 4] {
    match direction {
        StepDirection::West => [StepDirection::South, StepDirection::West, StepDirection::North, StepDirection::East],
        StepDirection::North => [StepDirection::West, StepDirection::North, StepDirection::East, StepDirection::South],
        StepDirection::East => [StepDirection::North, StepDirection::East, StepDirection::South, StepDirection::West],
        StepDirection::South => [StepDirection::East, StepDirection::South, StepDirection::West, StepDirection::North],
    }
}

fn polygon_signed_area(points: &[(f64, f64)]) -> f64 {
    let mut area = 0.0f64;
    for index in 0..points.len().saturating_sub(1) {
        let (x1, y1) = points[index];
        let (x2, y2) = points[index + 1];
        area += x1 * y2 - x2 * y1;
    }
    area * 0.5
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::regions::build_regions;

    fn build_test_regions(width: u32, height: u32, indexed_pixels: &[usize]) -> (Vec<Facet>, Vec<u32>) {
        let regions = build_regions(width, height, indexed_pixels);
        (regions.facets, regions.facet_map)
    }

    #[test]
    fn tracer_prefers_outer_bbox_start() {
        let indexed = vec![0, 0, 0, 0];
        let (facets, facet_map) = build_test_regions(2, 2, &indexed);
        let contour_data = build_facet_contours(2, 2, &facets, &facet_map, 0);
        let first_loop = &contour_data[0].loops[0];
        assert_eq!(first_loop.points[0], (0.0, 0.0));
        assert!(first_loop.is_outer);
    }

    #[test]
    fn tracer_builds_outer_and_inner_loops_for_donut() {
        let indexed = vec![
            0, 0, 0,
            0, 1, 0,
            0, 0, 0,
        ];
        let (facets, facet_map) = build_test_regions(3, 3, &indexed);
        let contour_data = build_facet_contours(3, 3, &facets, &facet_map, 0);
        assert_eq!(contour_data[0].loops.len(), 2);
        assert!(contour_data[0].loops[0].is_outer);
        assert!(!contour_data[0].loops[1].is_outer);
    }

    #[test]
    fn segment_split_breaks_on_neighbour_change() {
        let indexed = vec![
            0, 0, 1,
            0, 0, 1,
            2, 2, 1,
        ];
        let (facets, facet_map) = build_test_regions(3, 3, &indexed);
        let contour_data = build_facet_contours(3, 3, &facets, &facet_map, 0);
        assert!(contour_data[0].raw_segment_count >= 3);
    }

    #[test]
    fn shared_edge_reuses_same_segment() {
        let indexed = vec![
            0, 1,
            0, 1,
        ];
        let (facets, facet_map) = build_test_regions(2, 2, &indexed);
        let contour_data = build_facet_contours(2, 2, &facets, &facet_map, 0);
        assert!(contour_data[0].shared_segment_count > 0);
        assert!(contour_data[1].shared_segment_count > 0);
    }

    #[test]
    fn shared_edge_tracks_reverse_order_for_opposite_facets() {
        let indexed = vec![
            0, 1,
            0, 1,
        ];
        let (facets, facet_map) = build_test_regions(2, 2, &indexed);
        let contour_data = build_facet_contours(2, 2, &facets, &facet_map, 0);
        assert!(
            contour_data.iter().any(|data| data.reverse_segment_count > 0),
            "至少应有一个 facet 以反向顺序复用共享边"
        );
    }
}


