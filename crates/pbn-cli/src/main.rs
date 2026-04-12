use anyhow::{Context, Result};
use clap::{ArgAction, Parser};
use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, GenericImageView, ImageBuffer, ImageFormat, Rgb, Rgba};
use pbn_core::logger::as_tracing_level;
use pbn_core::models::{LogLevel, ProcessInput, ProcessSettings};
use pbn_core::process_rgba;
use resvg::tiny_skia::{Pixmap, Transform};
use resvg::usvg::{Options, Tree};
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;

/// 原生 CLI 参数。
#[derive(Debug, Parser)]
#[command(name = "paintbynumbers")]
#[command(about = "将输入图片转换为可调试的数字填色输出")]
struct Cli {
    /// Input image path.
    #[arg(short = 'i', long = "input")]
    input: PathBuf,
    /// Output base path. If a directory is provided, output will be saved as result.* within that directory.
    #[arg(short = 'o', long = "output")]
    output: PathBuf,
    /// JSON configuration file path.
    #[arg(short = 'c', long = "config")]
    config: Option<PathBuf>,
    /// Output format(s), separate multiple formats with commas.
    #[arg(long = "format", default_value = "svg,palette.json,quantized.png")]
    format: String,
    /// Number of colors to quantize.
    #[arg(short = 'k', long = "kmeans-clusters")]
    kmeans_clusters: Option<usize>,
    /// Minimum facet size in pixels.
    #[arg(long = "remove-facets-smaller-than")]
    remove_facets_smaller_than: Option<usize>,
    /// Number of smoothing passes for borders.
    #[arg(long = "border-smoothing-passes")]
    border_smoothing_passes: Option<u8>,
    /// Explicitly specify the log level.
    #[arg(long = "log-level")]
    log_level: Option<String>,
    /// Quiet mode, prints errors only.
    #[arg(long = "quiet", action = ArgAction::SetTrue)]
    quiet: bool,
    /// Verbose mode, equivalent to enabling debug logging.
    #[arg(long = "verbose", action = ArgAction::SetTrue)]
    verbose: bool,
}

#[derive(Debug, Serialize)]
struct CliProfile<'a> {
    input: String,
    output: String,
    requested_formats: Vec<&'a str>,
    width: u32,
    height: u32,
    palette_size: usize,
    facet_count: usize,
    svg_bytes: usize,
    stage_timings: Value,
    pipeline_stats: Value,
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let mut settings = load_settings(cli.config.as_deref())?;

    if cli.quiet {
        settings.log_level = LogLevel::Error;
    } else if cli.verbose {
        settings.log_level = LogLevel::Debug;
    } else if let Some(log_level) = &cli.log_level {
        settings.log_level = parse_log_level(log_level);
    } else if settings.log_level == LogLevel::Warn {
        settings.log_level = LogLevel::Info;
    }

    if let Some(k) = cli.kmeans_clusters {
        settings.kmeans_clusters = k;
    }
    if let Some(r) = cli.remove_facets_smaller_than {
        settings.remove_facets_smaller_than = r;
    }
    if let Some(b) = cli.border_smoothing_passes {
        settings.border_smoothing_passes = b;
    }

    install_logger(settings.log_level)?;

    info!(
        target: "pbn_cli",
        input = %cli.input.display(),
        output = %cli.output.display(),
        format = %cli.format,
        log_level = ?settings.log_level,
        "CLI started"
    );

    let image = image::open(&cli.input)
        .with_context(|| format!("无法打开输入图片: {}", cli.input.display()))?;
    let (width, height, rgba) = image_to_rgba(image);

    info!(
        target: "pbn_cli",
        width,
        height,
        rgba_len = rgba.len(),
        "Input image decoded"
    );

    let output = process_rgba(ProcessInput {
        width,
        height,
        rgba,
        settings: settings.clone(),
    })?;

    let (output_dir, output_stem) = if cli.output.extension().is_some() {
        (
            cli.output.parent().unwrap_or(Path::new(".")).to_path_buf(),
            cli.output
                .file_stem()
                .map(|stem| stem.to_string_lossy().to_string())
                .unwrap_or_else(|| "result".to_string()),
        )
    } else {
        (cli.output.clone(), "result".to_string())
    };
    fs::create_dir_all(&output_dir)
        .with_context(|| format!("无法创建输出目录: {}", output_dir.display()))?;

    let formats = cli
        .format
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>();
    let mut rendered_preview: Option<(u32, u32, Vec<u8>)> = None;

    for format in &formats {
        match *format {
            "svg" => {
                let path = output_dir.join(format!("{output_stem}.svg"));
                fs::write(&path, output.svg.as_bytes())
                    .with_context(|| format!("无法写入 SVG: {}", path.display()))?;
                info!(target: "pbn_cli", path = %path.display(), "Wrote SVG output");
            }
            "png" => {
                let path = output_dir.join(format!("{output_stem}.png"));
                let (render_width, render_height, rgba) =
                    ensure_rendered_preview(&output.svg, &mut rendered_preview)?;
                write_rgba_png(render_width, render_height, rgba, &path)?;
                info!(target: "pbn_cli", path = %path.display(), "Wrote PNG rasterization");
            }
            "jpg" => {
                let path = output_dir.join(format!("{output_stem}.jpg"));
                let (render_width, render_height, rgba) =
                    ensure_rendered_preview(&output.svg, &mut rendered_preview)?;
                write_rgba_jpeg(render_width, render_height, rgba, &path, 90)?;
                info!(target: "pbn_cli", path = %path.display(), "Wrote JPG rasterization");
            }
            "palette.json" => {
                let path = output_dir.join(format!("{output_stem}.palette.json"));
                let json = serde_json::to_string_pretty(&output.palette)?;
                fs::write(&path, json)
                    .with_context(|| format!("无法写入调色板 JSON: {}", path.display()))?;
                info!(target: "pbn_cli", path = %path.display(), "Wrote palette JSON");
            }
            "debug.json" => {
                let path = output_dir.join(format!("{output_stem}.debug.json"));
                let json = serde_json::to_string_pretty(&output)?;
                fs::write(&path, json)
                    .with_context(|| format!("无法写入调试 JSON: {}", path.display()))?;
                info!(target: "pbn_cli", path = %path.display(), "Wrote debug JSON");
            }
            "profile.json" => {
                let path = output_dir.join(format!("{output_stem}.profile.json"));
                let profile = CliProfile {
                    input: cli.input.display().to_string(),
                    output: cli.output.display().to_string(),
                    requested_formats: formats.clone(),
                    width,
                    height,
                    palette_size: output.palette.len(),
                    facet_count: output.facet_count,
                    svg_bytes: output.svg.len(),
                    stage_timings: serde_json::to_value(&output.metrics.stage_timings)?,
                    pipeline_stats: serde_json::to_value(&output.metrics.pipeline_stats)?,
                };
                let json = serde_json::to_string_pretty(&profile)?;
                fs::write(&path, json)
                    .with_context(|| format!("无法写入 profile JSON: {}", path.display()))?;
                info!(target: "pbn_cli", path = %path.display(), "Wrote profile JSON");
            }
            "quantized.png" => {
                let path = output_dir.join(format!("{output_stem}.quantized.png"));
                if let Some(debug) = &output.debug {
                    write_rgba_png(width, height, &debug.quantized_rgba, &path)?;
                    info!(target: "pbn_cli", path = %path.display(), "Wrote quantized PNG");
                } else {
                    warn!(target: "pbn_cli", "Missing quantized_rgba, skipping quantized.png");
                }
            }
            "quantized.jpg" => {
                let path = output_dir.join(format!("{output_stem}.quantized.jpg"));
                if let Some(debug) = &output.debug {
                    write_rgba_jpeg(width, height, &debug.quantized_rgba, &path, 90)?;
                    info!(target: "pbn_cli", path = %path.display(), "Wrote quantized JPG");
                } else {
                    warn!(target: "pbn_cli", "Missing quantized_rgba, skipping quantized.jpg");
                }
            }
            other => {
                warn!(target: "pbn_cli", format = other, "Unrecognized output format, skipping");
            }
        }
    }

    info!(
        target: "pbn_cli",
        palette_size = output.palette.len(),
        facet_count = output.facet_count,
        total_ms = output.metrics.stage_timings.total_ms,
        "CLI execution completed"
    );

    Ok(())
}

fn load_settings(path: Option<&Path>) -> Result<ProcessSettings> {
    let Some(path) = path else {
        return Ok(ProcessSettings::default());
    };

    let content = fs::read_to_string(path)
        .with_context(|| format!("无法读取配置文件: {}", path.display()))?;
    let mut value: Value = serde_json::from_str(&content)
        .with_context(|| format!("配置文件不是合法 JSON: {}", path.display()))?;

    if let Some(object) = value.as_object_mut() {
        rename_field(object, "kMeansNrOfClusters", "kmeans_clusters");
        rename_field(object, "kMeansMinDeltaDifference", "kmeans_min_delta");
        rename_field(object, "kMeansClusteringColorSpace", "kmeans_color_space");
        rename_field(object, "kMeansColorRestrictions", "color_restrictions");
        rename_field(object, "colorAliases", "color_aliases");
        rename_field(
            object,
            "narrowPixelStripCleanupRuns",
            "narrow_pixel_cleanup_runs",
        );
        rename_field(
            object,
            "removeFacetsSmallerThanNrOfPoints",
            "remove_facets_smaller_than",
        );
        rename_field(
            object,
            "removeFacetsFromLargeToSmall",
            "remove_facets_from_large_to_small",
        );
        rename_field(object, "maximumNumberOfFacets", "maximum_number_of_facets");
        rename_field(
            object,
            "nrOfTimesToHalveBorderSegments",
            "border_smoothing_passes",
        );
        rename_field(object, "randomSeed", "random_seed");
        rename_field(object, "showLabels", "show_labels");
        rename_field(object, "showBorders", "show_borders");
        rename_field(object, "fillFacets", "fill_facets");
    }

    Ok(serde_json::from_value(value)?)
}

fn rename_field(object: &mut serde_json::Map<String, Value>, from: &str, to: &str) {
    if let Some(value) = object.remove(from) {
        object.insert(to.to_string(), value);
    }
}

fn parse_log_level(value: &str) -> LogLevel {
    match value.to_ascii_lowercase().as_str() {
        "error" => LogLevel::Error,
        "warn" => LogLevel::Warn,
        "info" => LogLevel::Info,
        "debug" => LogLevel::Debug,
        "trace" => LogLevel::Trace,
        _ => LogLevel::Info,
    }
}

fn install_logger(level: LogLevel) -> Result<()> {
    let filter =
        EnvFilter::new(as_tracing_level(level)).add_directive("fontdb=error".parse().unwrap());
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(true)
        .with_ansi(false)
        .try_init()
        .ok();
    Ok(())
}

fn image_to_rgba(image: DynamicImage) -> (u32, u32, Vec<u8>) {
    let rgba = image.to_rgba8();
    let (width, height) = image.dimensions();
    (width, height, rgba.into_raw())
}

fn ensure_rendered_preview<'a>(
    svg: &str,
    cache: &'a mut Option<(u32, u32, Vec<u8>)>,
) -> Result<(u32, u32, &'a [u8])> {
    if cache.is_none() {
        let rendered = render_svg_to_rgba(svg)?;
        *cache = Some(rendered);
    }
    let (width, height, rgba) = cache.as_ref().context("SVG 预览缓存缺失")?;
    Ok((*width, *height, rgba.as_slice()))
}

/// 将 SVG 栅格化为 RGBA 预览图。
///
/// 这里让 CLI 的 `png/jpg` 输出都基于同一份 SVG 渲染结果，
/// 避免不同文件格式各自走不同几何路径，导致视觉语义不一致。
fn render_svg_to_rgba(svg: &str) -> Result<(u32, u32, Vec<u8>)> {
    let mut options = Options::default();
    options.fontdb_mut().load_system_fonts();
    let tree = Tree::from_str(svg, &options).context("无法解析 SVG 文档")?;
    let size = tree.size().to_int_size();
    let mut pixmap = Pixmap::new(size.width(), size.height()).context("无法创建 SVG 栅格缓冲")?;
    resvg::render(&tree, Transform::default(), &mut pixmap.as_mut());
    Ok((size.width(), size.height(), pixmap.data().to_vec()))
}

fn write_rgba_png(width: u32, height: u32, rgba: &[u8], path: &Path) -> Result<()> {
    let buffer = ImageBuffer::<Rgba<u8>, Vec<u8>>::from_vec(width, height, rgba.to_vec())
        .context("RGBA 缓冲无法转换为图像")?;
    DynamicImage::ImageRgba8(buffer)
        .save_with_format(path, ImageFormat::Png)
        .with_context(|| format!("无法保存 PNG 输出图像: {}", path.display()))?;
    Ok(())
}

fn write_rgba_jpeg(width: u32, height: u32, rgba: &[u8], path: &Path, quality: u8) -> Result<()> {
    // JPEG 不支持 alpha，这里显式丢弃透明通道，避免编码阶段报 `Rgba8` 不支持。
    let rgb = rgba
        .chunks_exact(4)
        .flat_map(|chunk| [chunk[0], chunk[1], chunk[2]])
        .collect::<Vec<_>>();
    let buffer = ImageBuffer::<Rgb<u8>, Vec<u8>>::from_vec(width, height, rgb)
        .context("RGB 缓冲无法转换为 JPEG 图像")?;

    let mut bytes = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(&mut bytes, quality);
    encoder
        .encode_image(&DynamicImage::ImageRgb8(buffer))
        .with_context(|| format!("无法编码 JPEG 图像: {}", path.display()))?;
    fs::write(path, bytes).with_context(|| format!("无法保存 JPG 输出图像: {}", path.display()))?;
    Ok(())
}
