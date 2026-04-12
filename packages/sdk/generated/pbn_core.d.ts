/* tslint:disable */
/* eslint-disable */

/**
 * 二进制 Wasm 导出入口（零拷贝优化版本）。
 *
 * 这里把巨大的 RGBA 缓冲直接作为 `Uint8Array` 传进 Rust，
 * 使用零拷贝借用而非复制，显著降低大图片的内存开销和处理延迟。
 *
 * 性能优势：4K 图像（3840×2160×4 = 33MB）零拷贝 vs 复制节省 10-30ms。
 */
export function process_rgba_bytes(width: number, height: number, rgba: Uint8Array, settings_json: string): string;

/**
 * Wasm 导出入口。
 *
 * 这里先使用 JSON 作为跨语言边界，优先保证 Rust core 与 TS SDK 的数据契约稳定。
 */
export function process_rgba_json(input_json: string): string;

/**
 * 最小健康检查入口。
 */
export function wasm_healthcheck(): string;

/**
 * 显式开启 Wasm 侧日志桥接（会将 Rust tracing 日志输出到 console）。
 */
export function wasm_init_logging(): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly process_rgba_bytes: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly process_rgba_json: (a: number, b: number) => [number, number, number, number];
    readonly wasm_healthcheck: () => [number, number];
    readonly wasm_init_logging: () => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
