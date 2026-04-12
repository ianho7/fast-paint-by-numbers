import type { GenerateOptions, ProcessOutput, RgbaInput, WasmInitOptions } from "./types.js";
import type { Logger } from "./logger.js";

export interface PaintByNumbersRuntime {
  /** 执行核心处理。 */
  generate(input: RgbaInput, options?: GenerateOptions, logger?: Logger): Promise<ProcessOutput>;
}

let runtime: PaintByNumbersRuntime | null = null;

/** 注入实际运行时。后续接入 Wasm 时只需替换这里。 */
export function setPaintByNumbersRuntime(nextRuntime: PaintByNumbersRuntime): void {
  runtime = nextRuntime;
}

export function hasPaintByNumbersRuntime(): boolean {
  return runtime !== null;
}

export function getPaintByNumbersRuntime(): PaintByNumbersRuntime {
  if (!runtime) {
    throw new Error("Paint By Numbers runtime 尚未初始化。请先加载 Wasm 或注入运行时。");
  }
  return runtime;
}

export type { WasmInitOptions };
