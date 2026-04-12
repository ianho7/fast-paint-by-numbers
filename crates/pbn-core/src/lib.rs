//! Fast Paint By Numbers 的 Rust 核心库。
//! 这里优先提供稳定输入输出模型、可观测日志与可运行的基础处理管线。

pub mod logger;
pub mod models;
pub mod palette;
pub mod pipeline;

mod labels;
mod contours;
mod debug_render;
mod quantize;
mod reduction;
mod regions;
mod render;
mod wasm;

pub use palette::palette_stats;
pub use pipeline::{process_rgba, quantize_rgba, render_svg};
