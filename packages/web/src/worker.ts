import {
  createConsoleLogger,
  generatePaintByNumbers,
  initializeWasmRuntime,
} from "fast-paint-by-numbers";
import type {
  GenerateOptions,
  LogLevel,
  ProcessOutput,
  RgbaInput,
} from "fast-paint-by-numbers";
import wasmUrl from "./assets/pbn_core_bg.wasm?url";

type WorkerRequest =
  | { id: number; type: "init" }
  | { id: number; type: "generate"; input: RgbaInput; options: GenerateOptions };

type WorkerResponse =
  | { id: number; type: "init:ok" }
  | { id: number; type: "generate:ok"; result: ProcessOutput }
  | { id: number; type: "error"; error: Record<string, unknown> }
  | { id: number; type: "progress"; stage: WorkerProgressStage; label: string }
  | { id: number; type: "log"; level: LogLevel; message: string; context?: Record<string, unknown> };

type WorkerProgressStage = "init" | "decode" | "quantize" | "reduction" | "contours" | "labels" | "render" | "done";

let ready = false;

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  void handleMessage(event.data);
});

async function handleMessage(message: WorkerRequest): Promise<void> {
  try {
    if (message.type === "init") {
      await ensureReady(message.id);
      postMessage({ id: message.id, type: "init:ok" } satisfies WorkerResponse);
      return;
    }

    if (message.type === "generate") {
      await ensureReady(message.id);
      const logger = createWorkerLogger(message.id, message.options.logLevel ?? "info");
      postMessage({ id: message.id, type: "progress", stage: "decode", label: "Preparing input" } satisfies WorkerResponse);
      const result = await generatePaintByNumbers(message.input, message.options, logger);
      postMessage({ id: message.id, type: "progress", stage: "done", label: "Processing Complete" } satisfies WorkerResponse);
      postMessage({ id: message.id, type: "generate:ok", result } satisfies WorkerResponse);
    }
  } catch (error) {
    postMessage({
      id: message.id,
      type: "error",
      error: formatUnknownError(error),
    } satisfies WorkerResponse);
  }
}

async function ensureReady(requestId: number): Promise<void> {
  if (ready) {
    return;
  }

  const logger = createWorkerLogger(requestId, "info");
  postMessage({ id: requestId, type: "progress", stage: "init", label: "初始化 Wasm worker" } satisfies WorkerResponse);
  await initializeWasmRuntime({ source: wasmUrl }, logger);
  ready = true;
}

function createWorkerLogger(requestId: number, level: LogLevel) {
  const base = createConsoleLogger(level);
  const emit = (name: LogLevel, message: string, context?: Record<string, unknown>) => {
    postMessage({ id: requestId, type: "log", level: name, message, context } satisfies WorkerResponse);
    const progress = mapLogToProgress(message);
    if (progress) {
      postMessage({ id: requestId, type: "progress", stage: progress.stage, label: progress.label } satisfies WorkerResponse);
    }
  };

  return {
    error(message: string, context?: Record<string, unknown>) { emit("error", message, context); base.error(message, context); },
    warn(message: string, context?: Record<string, unknown>) { emit("warn", message, context); base.warn(message, context); },
    info(message: string, context?: Record<string, unknown>) { emit("info", message, context); base.info(message, context); },
    debug(message: string, context?: Record<string, unknown>) { emit("debug", message, context); base.debug(message, context); },
    trace(message: string, context?: Record<string, unknown>) { emit("trace", message, context); base.trace(message, context); },
  };
}

function mapLogToProgress(message: string): { stage: WorkerProgressStage; label: string } | null {
  if (message.includes("SDK processing started")) {
    return { stage: "decode", label: "Sent to Wasm worker" };
  }
  if (message.includes("Quantization phase completed")) {
    return { stage: "quantize", label: "Quantized image Complete" };
  }
  if (message.includes("Facet reduction phase completed")) {
    return { stage: "reduction", label: "Facet reduction Complete" };
  }
  if (message.includes("Contour building phase completed")) {
    return { stage: "contours", label: "Border tracing / segmentation Complete" };
  }
  if (message.includes("Labeling phase completed")) {
    return { stage: "labels", label: "Label placement Complete" };
  }
  if (message.includes("Rendering phase completed") || message.includes("SDK processing completed")) {
    return { stage: "render", label: "Output Complete" };
  }
  return null;
}

function formatUnknownError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { value: String(error) };
}
