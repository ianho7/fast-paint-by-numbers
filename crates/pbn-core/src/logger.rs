use crate::models::LogLevel;

/// 将核心日志级别映射为 `tracing` 可理解的文本。
///
/// 这里单独抽出映射函数，是为了保证 CLI 和未来 Wasm 绑定复用完全一致的等级语义。
pub fn as_tracing_level(level: LogLevel) -> &'static str {
    match level {
        LogLevel::Error => "error",
        LogLevel::Warn => "warn",
        LogLevel::Info => "info",
        LogLevel::Debug => "debug",
        LogLevel::Trace => "trace",
    }
}
