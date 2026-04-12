import { createConsoleLogger } from "./logger.js";
import type { Logger } from "./logger.js";
import { getPaintByNumbersRuntime, hasPaintByNumbersRuntime, setPaintByNumbersRuntime } from "./runtime.js";
import type { PaintByNumbersRuntime } from "./runtime.js";
import type { GenerateOptions, PaletteEntry, ProcessOutput, RgbaInput, WasmInitOptions } from "./types.js";
import { buildRustSettings, normalizeProcessOutput } from "./serde.js";

export * from "./types.js";
export { createConsoleLogger, setPaintByNumbersRuntime };
export type { Logger, PaintByNumbersRuntime };

/**
 * 将常见的像素数据格式转换为 SDK 要求的 RgbaInput 格式。
 * 支持浏览器 ImageData、Node.js Buffer 等。
 */
export function prepareRgbaInput(
  width: number,
  height: number,
  rgba: Uint8Array | Uint8ClampedArray | ArrayBuffer
): RgbaInput {
  return {
    width,
    height,
    rgba: rgba instanceof Uint8Array ? rgba : new Uint8Array(rgba)
  };
}

/**
 * [浏览器环境专用] 从图像源（File, Blob, HTMLImageElement, ImageBitmap, Canvas 等）异步加载并转换为 RgbaInput。
 * 在 Node.js 环境中调用会抛出错误。
 */
export async function prepareRgbaFromImageSource(
  source: Blob | TexImageSource | ImageBitmap
): Promise<RgbaInput> {
  if (typeof globalThis.createImageBitmap !== "function" || typeof globalThis.document === "undefined") {
    throw new Error(
      "prepareRgbaFromImageSource 仅支持在具备 ImageBitmap 和 DOM 环境中运行（通常为浏览器）。\n" +
      "在 Node.js 环境中，请先使用 sharp 等库解出像素，再调用 prepareRgbaInput。"
    );
  }

  const imageBitmap = source instanceof ImageBitmap
    ? source
    : await createImageBitmap(source as Blob | TexImageSource);

  try {
    const canvas = globalThis.document.createElement("canvas");
    canvas.width = imageBitmap.width;
    canvas.height = imageBitmap.height;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      throw new Error("无法获取 Canvas 2D 上下文");
    }

    ctx.drawImage(imageBitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    return {
      width: imageData.width,
      height: imageData.height,
      rgba: new Uint8Array(imageData.data)
    };
  } finally {
    if (source instanceof ImageBitmap) {
      // 如果传入的是 ImageBitmap，由调用者负责关闭
    } else {
      imageBitmap.close();
    }
  }
}

/** 初始化默认 Wasm runtime。 */
export async function initializeWasmRuntime(
  options: WasmInitOptions = {},
  logger: Logger = createConsoleLogger("warn")
): Promise<void> {
  if (hasPaintByNumbersRuntime()) {
    logger.debug("Wasm runtime 已存在，跳过重复初始化");
    return;
  }

  logger.info("Starting Wasm runtime initialization");
  const wasmModule = await import("../generated/pbn_core.js");
  const source = options.source ?? new URL("../generated/pbn_core_bg.wasm", import.meta.url);

  let wasmSource: URL | RequestInfo | ArrayBuffer | Uint8Array = source;
  // Node.js 的 fetch 不支持 file:// 协议，手动读取本地文件
  if (
    wasmSource instanceof URL &&
    wasmSource.protocol === "file:" &&
    typeof process !== "undefined" &&
    typeof process.versions === "object" &&
    process.versions?.node
  ) {
    const fs = await import("node:fs/promises");
    wasmSource = await fs.readFile(wasmSource);
  }

  await wasmModule.default({ module_or_path: wasmSource });

  if (options.enableWasmLogging) {
    wasmModule.wasm_init_logging();
  }

  const runtime: PaintByNumbersRuntime = {
    async generate(input, generateOptions = {}, runtimeLogger = logger) {
      runtimeLogger.debug("Invoking Wasm core processing", {
        width: input.width,
        height: input.height,
        rgbaLength: input.rgba.length
      });

      const settings = buildRustSettings(generateOptions);
      const settingsJson = JSON.stringify(settings);
      const outputJson = typeof wasmModule.process_rgba_bytes === "function"
        ? wasmModule.process_rgba_bytes(input.width, input.height, input.rgba, settingsJson)
        : wasmModule.process_rgba_json(
            JSON.stringify({
              width: input.width,
              height: input.height,
              rgba: Array.from(input.rgba),
              settings
            })
          );
      return normalizeProcessOutput(JSON.parse(outputJson));
    }
  };

  setPaintByNumbersRuntime(runtime);
  logger.info("Wasm runtime initialization completed");
}

/** 统一顶层生成入口。 */
export async function generatePaintByNumbers(
  input: RgbaInput,
  options: GenerateOptions = {},
  logger: Logger = createConsoleLogger(options.logLevel ?? "warn")
): Promise<ProcessOutput> {
  logger.info("SDK processing started", {
    width: input.width,
    height: input.height,
    rgbaLength: input.rgba.length,
    kmeansClusters: options.kmeansClusters
  });

  const runtime = getPaintByNumbersRuntime();
  const result = await runtime.generate(input, options, logger);

  logger.info("SDK processing completed", {
    paletteSize: result.palette.length,
    facetCount: result.facetCount,
    svgLength: result.svg.length
  });

  return result;
}

/** 重新渲染 SVG。M1 先直接返回已有结果，后续接入独立渲染入口。 */
export async function renderSvg(result: ProcessOutput): Promise<string> {
  return result.svg;
}

/** 汇总调色板信息。 */
export async function analyzePalette(result: ProcessOutput): Promise<PaletteEntry[]> {
  return result.palette;
}
