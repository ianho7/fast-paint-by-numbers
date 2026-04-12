use crate::regions::{Facet, RegionsResult, build_regions, flat_index, neighbours};
use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap, HashSet};
use tracing::{debug, info, trace, warn};

#[derive(Debug, Clone, Default)]
pub struct ReductionStats {
    pub removed_facets: usize,
    pub replaced_pixels: usize,
    pub rounds: usize,
    pub max_facets_seen: usize,
    pub fast_path_facets: usize,
    pub bfs_facets: usize,
}

#[derive(Debug, Clone, Copy)]
struct RemovalCandidate {
    facet_id: usize,
    due_to_cap: bool,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct FacetOwnerNode {
    distance: usize,
    tie_break_color_distance: f64,
    owner: usize,
    facet_id: usize,
}

pub fn reduce_facets(
    width: u32,
    height: u32,
    mut indexed_pixels: Vec<usize>,
    palette: &[[u8; 3]],
    smaller_than: usize,
    remove_large_to_small: bool,
    maximum_number_of_facets: usize,
) -> (Vec<usize>, RegionsResult, ReductionStats) {
    let mut stats = ReductionStats::default();
    let mut cap_strategy_applied = false;

    loop {
        let regions = build_regions(width, height, &indexed_pixels);
        let before_count = regions.facets.len();
        stats.rounds += 1;
        stats.max_facets_seen = stats.max_facets_seen.max(before_count);

        let removal_plan = build_removal_plan(
            &regions,
            smaller_than,
            remove_large_to_small,
            maximum_number_of_facets,
        );

        if removal_plan.is_empty() {
            debug!(
                target: "pbn_core::reduction",
                reduction_rounds = stats.rounds,
                facets_before_reduction = before_count,
                facets_after_reduction = regions.facets.len(),
                removed_facets = stats.removed_facets,
                replaced_pixels = stats.replaced_pixels,
                max_facets_seen = stats.max_facets_seen,
                fast_path_facets = stats.fast_path_facets,
                bfs_facets = stats.bfs_facets,
                "facet reduction 阶段结束"
            );
            return (indexed_pixels, regions, stats);
        }

        debug!(
            target: "pbn_core::reduction",
            round = stats.rounds,
            facets_in_snapshot = before_count,
            removal_count = removal_plan.len(),
            "Starting facet reduction round"
        );

        let mut round_replaced_pixels = 0usize;
        let has_cap_candidates = removal_plan.iter().any(|item| item.due_to_cap);
        if has_cap_candidates && !cap_strategy_applied {
            let replaced_pixels = reassign_cap_facets_globally(
                width,
                &mut indexed_pixels,
                &regions,
                palette,
                maximum_number_of_facets,
            );
            cap_strategy_applied = true;
            let cap_removed = removal_plan.iter().filter(|item| item.due_to_cap).count();
            stats.removed_facets += cap_removed;
            stats.replaced_pixels += replaced_pixels;
            stats.fast_path_facets += cap_removed;
            info!(
                target: "pbn_core::reduction",
                round = stats.rounds,
                replaced_pixels,
                kept_facets = maximum_number_of_facets.min(before_count),
                "facet cap 使用全局多源归属传播完成一轮收敛"
            );
            continue;
        }

        let protected = removal_plan
            .iter()
            .filter(|item| !item.due_to_cap)
            .map(|item| item.facet_id)
            .collect::<HashSet<_>>();
        for (ordinal, candidate) in removal_plan.iter().copied().enumerate() {
            let facet = &regions.facets[candidate.facet_id];
            if facet.neighbour_facets.is_empty() {
                warn!(
                    target: "pbn_core::reduction",
                    facet_id = candidate.facet_id,
                    "检测到没有邻居的 facet，当前跳过删除"
                );
                continue;
            }

            if candidate.due_to_cap {
                continue;
            }

            let replaced = reassign_facet_pixels(
                width,
                height,
                &mut indexed_pixels,
                facet,
                &regions,
                palette,
                &protected,
                false,
                &mut stats,
            );

            if replaced > 0 {
                stats.removed_facets += 1;
                stats.replaced_pixels += replaced;
                round_replaced_pixels += replaced;
            }

            if (ordinal + 1) % 1000 == 0 {
                debug!(
                    target: "pbn_core::reduction",
                    round = stats.rounds,
                    processed_in_round = ordinal + 1,
                    total_in_round = removal_plan.len(),
                    fast_path_facets = stats.fast_path_facets,
                    bfs_facets = stats.bfs_facets,
                    "facet reduction round progress"
                );
            }
        }

        if round_replaced_pixels == 0 {
            debug!(
                target: "pbn_core::reduction",
                round = stats.rounds,
                "本轮没有面片被合并（可能已达收敛极限），强制退出削减循环"
            );
            break;
        }
    }
    
    let final_regions = build_regions(width, height, &indexed_pixels);
    stats.max_facets_seen = stats.max_facets_seen.max(final_regions.facets.len());

    debug!(
        target: "pbn_core::reduction",
        reduction_rounds = stats.rounds,
        facets_after_reduction = final_regions.facets.len(),
        removed_facets = stats.removed_facets,
        replaced_pixels = stats.replaced_pixels,
        "facet reduction 阶段结束"
    );

    (indexed_pixels, final_regions, stats)
}

fn build_removal_plan(
    regions: &RegionsResult,
    smaller_than: usize,
    remove_large_to_small: bool,
    maximum_number_of_facets: usize,
) -> Vec<RemovalCandidate> {
    let mut processing_order: Vec<usize> = regions.facets.iter().map(|facet| facet.id).collect();
    processing_order.sort_by_key(|facet_id| regions.facets[*facet_id].point_count);
    if remove_large_to_small {
        processing_order.reverse();
    }

    let mut removal_plan = Vec::new();
    let mut remaining = regions.facets.len();
    for facet_id in processing_order {
        let facet = &regions.facets[facet_id];
        let due_to_cap = remaining > maximum_number_of_facets;
        let under_size = facet.point_count < smaller_than;
        if !(due_to_cap || under_size) {
            continue;
        }
        removal_plan.push(RemovalCandidate {
            facet_id,
            due_to_cap,
        });
        remaining = remaining.saturating_sub(1);
    }
    removal_plan
}

fn reassign_cap_facets_globally(
    width: u32,
    indexed_pixels: &mut [usize],
    regions: &RegionsResult,
    palette: &[[u8; 3]],
    maximum_number_of_facets: usize,
) -> usize {
    if regions.facets.len() <= maximum_number_of_facets {
        return 0;
    }

    let keepers = select_kept_facets(&regions.facets, maximum_number_of_facets);
    let kept_set = keepers.iter().copied().collect::<HashSet<_>>();
    let ownership = propagate_facet_owners(&regions.facets, palette, &keepers);
    let mut replaced_pixels = 0usize;

    // 对 facet 数上限场景，按 facet 图做一次全局归属传播。
    // 这样每个被移除 facet 都会稳定归并到某个保留 facet，避免局部接管导致多轮震荡。
    for facet in &regions.facets {
        if kept_set.contains(&facet.id) {
            continue;
        }
        let owner = ownership[facet.id]
            .unwrap_or_else(|| fallback_owner(facet, &regions.facets, palette, &keepers));
        for &(x, y) in &facet.pixels {
            indexed_pixels[flat_index(width, x, y)] = regions.facets[owner].color_index;
        }
        replaced_pixels += facet.point_count;
        trace!(
            target: "pbn_core::reduction",
            facet_id = facet.id,
            owner,
            point_count = facet.point_count,
            "facet cap 全局归并完成"
        );
    }

    debug!(
        target: "pbn_core::reduction",
        facet_count_before = regions.facets.len(),
        kept_facets = keepers.len(),
        replaced_pixels,
        "facet cap 全局多源归属传播完成"
    );

    replaced_pixels
}

fn select_kept_facets(facets: &[Facet], maximum_number_of_facets: usize) -> Vec<usize> {
    let mut ordered = facets.iter().map(|facet| facet.id).collect::<Vec<_>>();
    ordered.sort_by(|left, right| {
        facets[*right]
            .point_count
            .cmp(&facets[*left].point_count)
            .then_with(|| left.cmp(right))
    });
    ordered.truncate(maximum_number_of_facets.max(1));
    ordered
}

fn propagate_facet_owners(
    facets: &[Facet],
    palette: &[[u8; 3]],
    keepers: &[usize],
) -> Vec<Option<usize>> {
    let mut best = vec![None; facets.len()];
    let mut heap = BinaryHeap::new();

    for &keeper in keepers {
        let node = FacetOwnerNode {
            distance: 0,
            tie_break_color_distance: 0.0,
            owner: keeper,
            facet_id: keeper,
        };
        best[keeper] = Some(node);
        heap.push(node);
    }

    while let Some(node) = heap.pop() {
        if best[node.facet_id] != Some(node) {
            continue;
        }

        for &neighbour_id in &facets[node.facet_id].neighbour_facets {
            let candidate = FacetOwnerNode {
                distance: node.distance + 1,
                tie_break_color_distance: node.tie_break_color_distance
                    + rgb_distance(
                        palette[facets[node.facet_id].color_index],
                        palette[facets[neighbour_id].color_index],
                    ),
                owner: node.owner,
                facet_id: neighbour_id,
            };

            let should_replace = match best[neighbour_id] {
                None => true,
                Some(existing) => candidate.is_better_than(existing),
            };
            if should_replace {
                best[neighbour_id] = Some(candidate);
                heap.push(candidate);
            }
        }
    }

    best.into_iter()
        .map(|node| node.map(|value| value.owner))
        .collect()
}

fn fallback_owner(
    facet_to_remove: &Facet,
    facets: &[Facet],
    palette: &[[u8; 3]],
    keepers: &[usize],
) -> usize {
    if let Some(owner) = facet_to_remove
        .neighbour_facets
        .iter()
        .copied()
        .find(|facet_id| keepers.contains(facet_id))
    {
        return owner;
    }
    choose_facet_owner(facet_to_remove, keepers, facets, palette)
}

fn reassign_facet_pixels(
    width: u32,
    height: u32,
    indexed_pixels: &mut [usize],
    facet_to_remove: &Facet,
    regions: &RegionsResult,
    palette: &[[u8; 3]],
    protected_facet_ids: &HashSet<usize>,
    due_to_cap: bool,
    stats: &mut ReductionStats,
) -> usize {
    let available_neighbours = facet_to_remove
        .neighbour_facets
        .iter()
        .copied()
        .filter(|facet_id| !protected_facet_ids.contains(facet_id))
        .collect::<Vec<_>>();
    let usable_neighbours = if available_neighbours.is_empty() {
        // 如果所有邻居也都要删除，则仅允许向 ID 比自己大的邻居合并。
        // 这通过打破对称性确保了在每一个小面片集群中，至少有一个 Facet（ID 最大的那个）
        // 在本轮能够留存作为“锚点”，防止出现 A->B, B->A 的互换死循环。
        facet_to_remove
            .neighbour_facets
            .iter()
            .copied()
            .filter(|&id| id > facet_to_remove.id)
            .collect::<Vec<_>>()
    } else {
        available_neighbours
    };

    if usable_neighbours.is_empty() {
        return 0;
    }

    if due_to_cap || usable_neighbours.len() == 1 || facet_to_remove.point_count <= 64 {
        stats.fast_path_facets += 1;
        return reassign_facet_pixels_fast_path(
            width,
            indexed_pixels,
            facet_to_remove,
            &regions.facets,
            palette,
            &usable_neighbours,
            due_to_cap,
        );
    }

    stats.bfs_facets += 1;
    reassign_facet_pixels_with_bfs(
        width,
        height,
        indexed_pixels,
        facet_to_remove,
        &regions.facets,
        &regions.facet_map,
        palette,
        &usable_neighbours,
    )
}

fn reassign_facet_pixels_fast_path(
    width: u32,
    indexed_pixels: &mut [usize],
    facet_to_remove: &Facet,
    facets: &[Facet],
    palette: &[[u8; 3]],
    usable_neighbours: &[usize],
    due_to_cap: bool,
) -> usize {
    let owner = choose_facet_owner(facet_to_remove, usable_neighbours, facets, palette);
    for &(x, y) in &facet_to_remove.pixels {
        indexed_pixels[flat_index(width, x, y)] = facets[owner].color_index;
    }
    trace!(
        target: "pbn_core::reduction",
        facet_id = facet_to_remove.id,
        owner,
        point_count = facet_to_remove.point_count,
        due_to_cap,
        "facet 走整块接管路径"
    );
    facet_to_remove.point_count
}

fn choose_facet_owner(
    facet_to_remove: &Facet,
    usable_neighbours: &[usize],
    facets: &[Facet],
    palette: &[[u8; 3]],
) -> usize {
    let mut best_owner = usable_neighbours[0];
    let mut best_distance = f64::MAX;
    let mut best_color_distance = f64::MAX;

    for &neighbour_id in usable_neighbours {
        let neighbour = &facets[neighbour_id];
        let distance =
            border_set_distance_sq(&facet_to_remove.border_points, &neighbour.border_points);
        let color_distance = rgb_distance(
            palette[facet_to_remove.color_index],
            palette[neighbour.color_index],
        );
        if distance < best_distance
            || ((distance - best_distance).abs() < f64::EPSILON
                && color_distance < best_color_distance)
        {
            best_owner = neighbour_id;
            best_distance = distance;
            best_color_distance = color_distance;
        }
    }

    best_owner
}

fn border_set_distance_sq(left: &[(u32, u32)], right: &[(u32, u32)]) -> f64 {
    let mut best = f64::MAX;
    for &(lx, ly) in left {
        for &(rx, ry) in right {
            let dx = lx as f64 - rx as f64;
            let dy = ly as f64 - ry as f64;
            best = best.min(dx * dx + dy * dy);
        }
    }
    best
}

fn reassign_facet_pixels_with_bfs(
    width: u32,
    height: u32,
    indexed_pixels: &mut [usize],
    facet_to_remove: &Facet,
    facets: &[Facet],
    facet_map: &[u32],
    palette: &[[u8; 3]],
    usable_neighbours: &[usize],
) -> usize {
    let bucket_size = calculate_uniform_grid_bucket_size(width, height, facets.len());
    let grid = UniformGrid::build(facets, usable_neighbours, bucket_size);
    let pixel_set = facet_to_remove
        .pixels
        .iter()
        .copied()
        .collect::<HashSet<_>>();
    let mut best_nodes = HashMap::<(u32, u32), BfsNode>::new();

    for &(x, y) in &facet_to_remove.pixels {
        let mut candidate_neighbours = Vec::new();
        for (nx, ny) in neighbours(width, height, x, y) {
            if pixel_set.contains(&(nx, ny)) {
                continue;
            }
            let neighbour_facet_id = facet_map[flat_index(width, nx, ny)] as usize;
            if usable_neighbours.contains(&neighbour_facet_id) {
                candidate_neighbours.push(neighbour_facet_id);
            }
        }

        if candidate_neighbours.is_empty() {
            continue;
        }

        let owner = choose_boundary_owner(
            x,
            y,
            facet_to_remove,
            &candidate_neighbours,
            facets,
            palette,
            &grid,
        );
        best_nodes.insert(
            (x, y),
            BfsNode::seed(
                x,
                y,
                owner,
                rgb_distance(
                    palette[facet_to_remove.color_index],
                    palette[facets[owner].color_index],
                ),
            ),
        );
    }

    if best_nodes.is_empty() {
        let fallback_owner = usable_neighbours[0];
        for &(x, y) in &facet_to_remove.pixels {
            best_nodes.insert(
                (x, y),
                BfsNode::seed(
                    x,
                    y,
                    fallback_owner,
                    rgb_distance(
                        palette[facet_to_remove.color_index],
                        palette[facets[fallback_owner].color_index],
                    ),
                ),
            );
        }
        trace!(
            target: "pbn_core::reduction",
            facet_id = facet_to_remove.id,
            fallback_owner,
            "多源 BFS 未找到边界种子，退回单邻居接管"
        );
    }

    let boundary_seed_count = best_nodes.len();
    let mut heap = BinaryHeap::new();
    for node in best_nodes.values().copied() {
        heap.push(node);
    }

    while let Some(node) = heap.pop() {
        if best_nodes.get(&(node.x, node.y)).copied() != Some(node) {
            continue;
        }

        for (nx, ny) in neighbours(width, height, node.x, node.y) {
            if !pixel_set.contains(&(nx, ny)) {
                continue;
            }
            let candidate = BfsNode {
                distance: node.distance + 1,
                tie_break_color_distance: node.tie_break_color_distance,
                owner: node.owner,
                x: nx,
                y: ny,
            };

            let should_replace = match best_nodes.get(&(nx, ny)).copied() {
                None => true,
                Some(existing) => candidate.is_better_than(existing),
            };
            if should_replace {
                best_nodes.insert((nx, ny), candidate);
                heap.push(candidate);
            }
        }
    }

    for &(x, y) in &facet_to_remove.pixels {
        let owner = best_nodes
            .get(&(x, y))
            .map(|node| node.owner)
            .unwrap_or(usable_neighbours[0]);
        indexed_pixels[flat_index(width, x, y)] = facets[owner].color_index;
    }

    debug!(
        target: "pbn_core::reduction",
        facet_id = facet_to_remove.id,
        removed_point_count = facet_to_remove.point_count,
        boundary_seed_count,
        bucket_size,
        neighbour_count = usable_neighbours.len(),
        "多源 BFS facet merging 完成"
    );

    facet_to_remove.point_count
}

fn choose_boundary_owner(
    x: u32,
    y: u32,
    facet_to_remove: &Facet,
    candidate_neighbours: &[usize],
    facets: &[Facet],
    palette: &[[u8; 3]],
    grid: &UniformGrid,
) -> usize {
    let mut best_owner = candidate_neighbours[0];
    let mut best_distance = f64::MAX;
    let mut best_color_distance = f64::MAX;

    for &neighbour_id in candidate_neighbours {
        let nearest_distance = grid
            .nearest_distance(x, y, neighbour_id)
            .unwrap_or_else(|| brute_force_nearest_distance(x, y, &facets[neighbour_id]));
        let color_distance = rgb_distance(
            palette[facet_to_remove.color_index],
            palette[facets[neighbour_id].color_index],
        );

        if nearest_distance < best_distance
            || ((nearest_distance - best_distance).abs() < f64::EPSILON
                && color_distance < best_color_distance)
        {
            best_owner = neighbour_id;
            best_distance = nearest_distance;
            best_color_distance = color_distance;
        }
    }

    best_owner
}

fn brute_force_nearest_distance(x: u32, y: u32, facet: &Facet) -> f64 {
    facet
        .border_points
        .iter()
        .map(|&(bx, by)| {
            let dx = bx as f64 - x as f64;
            let dy = by as f64 - y as f64;
            dx * dx + dy * dy
        })
        .fold(f64::MAX, f64::min)
}

fn calculate_uniform_grid_bucket_size(width: u32, height: u32, expected_facets: usize) -> u32 {
    let area = (width as f64) * (height as f64);
    let expected_facets = expected_facets.max(1) as f64;
    (area / expected_facets).sqrt().ceil().max(1.0) as u32
}

fn rgb_distance(a: [u8; 3], b: [u8; 3]) -> f64 {
    let dx = a[0] as f64 - b[0] as f64;
    let dy = a[1] as f64 - b[1] as f64;
    let dz = a[2] as f64 - b[2] as f64;
    dx * dx + dy * dy + dz * dz
}

#[derive(Debug, Clone)]
struct UniformGrid {
    bucket_size: u32,
    buckets: HashMap<(u32, u32), Vec<BorderPoint>>,
}

#[derive(Debug, Clone, Copy)]
struct BorderPoint {
    facet_id: usize,
    x: u32,
    y: u32,
}

impl UniformGrid {
    fn build(facets: &[Facet], neighbour_ids: &[usize], bucket_size: u32) -> Self {
        let mut buckets = HashMap::<(u32, u32), Vec<BorderPoint>>::new();
        for &facet_id in neighbour_ids {
            for &(x, y) in &facets[facet_id].border_points {
                let key = (x / bucket_size, y / bucket_size);
                buckets
                    .entry(key)
                    .or_default()
                    .push(BorderPoint { facet_id, x, y });
            }
        }
        Self {
            bucket_size,
            buckets,
        }
    }

    fn nearest_distance(&self, x: u32, y: u32, target_facet_id: usize) -> Option<f64> {
        let base_bucket_x = x / self.bucket_size;
        let base_bucket_y = y / self.bucket_size;
        let mut best = f64::MAX;
        let mut found = false;

        for radius in 0..=2u32 {
            let min_x = base_bucket_x.saturating_sub(radius);
            let min_y = base_bucket_y.saturating_sub(radius);
            let max_x = base_bucket_x + radius;
            let max_y = base_bucket_y + radius;
            for bucket_x in min_x..=max_x {
                for bucket_y in min_y..=max_y {
                    let Some(points) = self.buckets.get(&(bucket_x, bucket_y)) else {
                        continue;
                    };
                    for point in points {
                        if point.facet_id != target_facet_id {
                            continue;
                        }
                        let dx = point.x as f64 - x as f64;
                        let dy = point.y as f64 - y as f64;
                        best = best.min(dx * dx + dy * dy);
                        found = true;
                    }
                }
            }
            if found {
                break;
            }
        }

        found.then_some(best)
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct BfsNode {
    distance: usize,
    tie_break_color_distance: f64,
    owner: usize,
    x: u32,
    y: u32,
}

impl BfsNode {
    fn seed(x: u32, y: u32, owner: usize, tie_break_color_distance: f64) -> Self {
        Self {
            distance: 0,
            tie_break_color_distance,
            owner,
            x,
            y,
        }
    }

    fn is_better_than(self, other: Self) -> bool {
        self.distance < other.distance
            || (self.distance == other.distance
                && self.tie_break_color_distance < other.tie_break_color_distance)
            || (self.distance == other.distance
                && (self.tie_break_color_distance - other.tie_break_color_distance).abs()
                    < f64::EPSILON
                && self.owner < other.owner)
    }
}

impl Eq for BfsNode {}

impl PartialOrd for BfsNode {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for BfsNode {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .distance
            .cmp(&self.distance)
            .then_with(|| {
                other
                    .tie_break_color_distance
                    .partial_cmp(&self.tie_break_color_distance)
                    .unwrap_or(Ordering::Equal)
            })
            .then_with(|| other.owner.cmp(&self.owner))
            .then_with(|| other.y.cmp(&self.y))
            .then_with(|| other.x.cmp(&self.x))
    }
}

impl FacetOwnerNode {
    fn is_better_than(self, other: Self) -> bool {
        self.distance < other.distance
            || (self.distance == other.distance
                && self.tie_break_color_distance < other.tie_break_color_distance)
            || (self.distance == other.distance
                && (self.tie_break_color_distance - other.tie_break_color_distance).abs()
                    < f64::EPSILON
                && self.owner < other.owner)
    }
}

impl Eq for FacetOwnerNode {}

impl PartialOrd for FacetOwnerNode {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for FacetOwnerNode {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .distance
            .cmp(&self.distance)
            .then_with(|| {
                other
                    .tie_break_color_distance
                    .partial_cmp(&self.tie_break_color_distance)
                    .unwrap_or(Ordering::Equal)
            })
            .then_with(|| other.owner.cmp(&self.owner))
            .then_with(|| other.facet_id.cmp(&self.facet_id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uniform_grid_bucket_size_is_positive() {
        assert_eq!(calculate_uniform_grid_bucket_size(16, 16, 4), 8);
        assert_eq!(calculate_uniform_grid_bucket_size(3, 3, 10), 1);
    }

    #[test]
    fn reduction_merges_small_facet_into_neighbour_with_bfs() {
        let palette = vec![[255, 0, 0], [0, 0, 255]];
        let indexed = vec![0, 0, 0, 0, 1, 0, 0, 0, 0];
        let (reduced, regions, stats) =
            reduce_facets(3, 3, indexed, &palette, 2, false, usize::MAX);
        assert_eq!(stats.removed_facets, 1);
        assert_eq!(regions.facets.len(), 1);
        assert!(reduced.iter().all(|&color_index| color_index == 0));
    }

    #[test]
    fn reduction_respects_maximum_number_of_facets() {
        let palette = vec![[255, 0, 0], [0, 255, 0], [0, 0, 255]];
        let indexed = vec![0, 1, 2, 0, 1, 2, 0, 1, 2];
        let (_reduced, regions, stats) = reduce_facets(3, 3, indexed, &palette, 1, false, 2);
        assert!(stats.removed_facets >= 1);
        assert!(stats.rounds >= 1);
        assert!(regions.facets.len() <= 2);
    }

    #[test]
    fn cap_strategy_converges_by_propagating_to_kept_facets() {
        let palette = vec![[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]];
        let indexed = vec![0, 0, 1, 1, 0, 2, 2, 1, 3, 3, 2, 1, 3, 3, 2, 1];
        let (_reduced, regions, stats) = reduce_facets(4, 4, indexed, &palette, 1, false, 2);
        assert!(stats.removed_facets >= 2);
        assert!(regions.facets.len() <= 2);
    }
}
