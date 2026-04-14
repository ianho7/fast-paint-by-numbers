use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ColorSpace {
    Rgb,
    Hsl,
    Lab,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum LogLevel {
    Error,
    Warn,
    Info,
    Debug,
    Trace,
}

impl Default for LogLevel {
    fn default() -> Self {
        Self::Warn
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResizeSettings {
    pub enabled: bool,
    pub max_width: u32,
    pub max_height: u32,
}

impl Default for ResizeSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            max_width: 1024,
            max_height: 1024,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessSettings {
    pub random_seed: u64,
    pub kmeans_clusters: usize,
    pub kmeans_min_delta: f64,
    pub kmeans_color_space: ColorSpace,
    pub color_restrictions: Vec<[u8; 3]>,
    pub color_aliases: BTreeMap<String, [u8; 3]>,
    pub narrow_pixel_cleanup_runs: u8,
    pub remove_facets_smaller_than: usize,
    pub remove_facets_from_large_to_small: bool,
    pub maximum_number_of_facets: usize,
    pub border_smoothing_passes: u8,
    pub resize: ResizeSettings,
    pub show_labels: bool,
    pub show_borders: bool,
    pub fill_facets: bool,
    pub log_level: LogLevel,
    pub debug_flags: Vec<String>,
}

impl Default for ProcessSettings {
    fn default() -> Self {
        Self {
            random_seed: 0,
            kmeans_clusters: 16,
            kmeans_min_delta: 1.0,
            kmeans_color_space: ColorSpace::Rgb,
            color_restrictions: Vec::new(),
            color_aliases: BTreeMap::new(),
            narrow_pixel_cleanup_runs: 3,
            remove_facets_smaller_than: 20,
            remove_facets_from_large_to_small: true,
            maximum_number_of_facets: usize::MAX,
            border_smoothing_passes: 2,
            resize: ResizeSettings::default(),
            show_labels: false,
            show_borders: false,
            fill_facets: true,
            log_level: LogLevel::Warn,
            debug_flags: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessInput {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
    pub settings: ProcessSettings,
}

/// 零拷贝版本的 ProcessInput，用于 WASM 边界优化。
/// 借用 RGBA 数据而非拥有，避免大图片的内存复制开销。
#[derive(Debug)]
pub struct ProcessInputRef<'a> {
    pub width: u32,
    pub height: u32,
    pub rgba: &'a [u8],
    pub settings: ProcessSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LabelBounds {
    pub min_x: u32,
    pub min_y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FacetSummary {
    pub id: usize,
    pub color_index: usize,
    pub point_count: usize,
    pub bbox_min_x: u32,
    pub bbox_min_y: u32,
    pub bbox_max_x: u32,
    pub bbox_max_y: u32,
    pub neighbour_facets: Vec<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaletteEntry {
    pub index: usize,
    pub color: [u8; 3],
    pub color_alias: Option<String>,
    pub frequency: usize,
    pub area_percentage: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DebugOutput {
    pub quantized_rgba: Vec<u8>,
    pub facet_map: Vec<u32>,
    pub reduction_rgba: Option<Vec<u8>>,
    pub border_path_rgba: Option<Vec<u8>>,
    pub border_segmentation_rgba: Option<Vec<u8>>,
    pub label_placement_rgba: Option<Vec<u8>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StageTimings {
    pub quantize_ms: u128,
    pub cleanup_ms: u128,
    pub regions_ms: u128,
    pub reduction_ms: u128,
    pub labels_ms: u128,
    pub render_ms: u128,
    pub total_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PipelineStats {
    pub original_unique_colors: usize,
    pub quantized_palette_size: usize,
    pub quantize_iterations: usize,
    pub quantize_sample_colors: usize,
    pub facets_before_reduction: usize,
    pub facets_after_reduction: usize,
    pub removed_facets: usize,
    pub reduction_rounds: usize,
    pub max_facets_seen_during_reduction: usize,
    pub reduction_fast_path_facets: usize,
    pub reduction_bfs_facets: usize,
    pub narrow_cleanup_replaced_pixels: usize,
    pub contour_traced_path_points: usize,
    pub contour_raw_segments: usize,
    pub contour_shared_segments: usize,
    pub contour_reverse_segments: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MetricsOutput {
    pub stage_timings: StageTimings,
    pub pipeline_stats: PipelineStats,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessOutput {
    pub palette: Vec<PaletteEntry>,
    pub svg: String,
    pub facet_count: usize,
    pub label_bounds: Vec<LabelBounds>,
    pub facets_summary: Vec<FacetSummary>,
    pub debug: Option<DebugOutput>,
    pub metrics: MetricsOutput,
}

#[derive(Debug, thiserror::Error)]
pub enum ProcessError {
    #[error("RGBA 缓冲长度与图像尺寸不匹配: expected={expected}, actual={actual}")]
    InvalidRgbaLength { expected: usize, actual: usize },
    #[error("图像尺寸不能为 0")]
    EmptyImage,
}
