
import {
  createConsoleLogger,
  type FacetSummary,
} from "fast-paint-by-numbers";
import type {
  GenerateOptions,
  KmeansColorSpace,
  LabelBounds,
  Logger,
  LogLevel,
  ProcessOutput,
  RgbaInput,
} from "fast-paint-by-numbers";

interface DemoElements {
  form: HTMLFormElement;
  fileInput: HTMLInputElement;
  resizeEnabledInput: HTMLInputElement;
  resizeWidthInput: HTMLInputElement;
  resizeHeightInput: HTMLInputElement;
  clusterInput: HTMLInputElement;
  clusterPrecisionInput: HTMLInputElement;
  randomSeedInput: HTMLInputElement;
  colorRestrictionsInput: HTMLTextAreaElement;
  cleanupRunsInput: HTMLInputElement;
  removeFacetsInput: HTMLInputElement;
  maximumFacetsInput: HTMLInputElement;
  smoothingInput: HTMLInputElement;
  sizeMultiplierInput: HTMLInputElement;
  showLabelsInput: HTMLInputElement;
  fillFacetsInput: HTMLInputElement;
  showBordersInput: HTMLInputElement;
  labelFontSizeInput: HTMLInputElement;
  labelFontColorInput: HTMLInputElement;
  generateButton: HTMLButtonElement;
  downloadSvgButton: HTMLButtonElement;
  downloadPngButton: HTMLButtonElement;
  status: HTMLElement;
  stageTabs: HTMLButtonElement[];
  stagePanels: HTMLElement[];
  quantizedCanvas: HTMLCanvasElement;
  reductionCanvas: HTMLCanvasElement;
  borderPathCanvas: HTMLCanvasElement;
  borderSegmentationCanvas: HTMLCanvasElement;
  labelPlacementCanvas: HTMLCanvasElement;
  quantizedEmpty: HTMLElement;
  reductionEmpty: HTMLElement;
  borderPathEmpty: HTMLElement;
  borderSegmentationEmpty: HTMLElement;
  labelPlacementEmpty: HTMLElement;
  svgPreview: HTMLElement;
  summary: HTMLElement;
  palette: HTMLElement;
  logs: HTMLTextAreaElement;
  exampleButtons: HTMLButtonElement[];
}

type StageKey = "quantized" | "reduction" | "borderPath" | "borderSegmentation" | "labelPlacement" | "output";
type WorkerProgressStage = "init" | "decode" | "quantize" | "reduction" | "contours" | "labels" | "render" | "done";
type StageRgbaMap = Partial<Record<Exclude<StageKey, "output">, { rgba: Uint8Array; width: number; height: number }>>;

interface RenderProfile {
  sizeMultiplier: number;
  showLabels: boolean;
  fillFacets: boolean;
  showBorders: boolean;
  labelFontSize: number;
  labelFontColor: string;
}

interface PreviewTimingSummary {
  decodeImageMs: number;
  sdkGenerateMs: number;
  processingMs: number;
  previewBuildMs: number;
  applyShapeProfileMs: number;
  rebuildLabelsMs: number;
  renderDomMs: number;
  endToEndMs: number;
  exportSvgMs?: number;
  exportPngRasterizeMs?: number;
  exportPngEncodeMs?: number;
  exportPngMs?: number;
}

interface BuiltPreview {
  svg: string;
  timing: Pick<PreviewTimingSummary, "previewBuildMs" | "applyShapeProfileMs" | "rebuildLabelsMs">;
  labelCount: number;
}

interface DemoState {
  wasmReady: boolean;
  busy: boolean;
  worker: Worker | null;
  nextRequestId: number;
  lastResult: ProcessOutput | null;
  pendingSamplePath: string | null;
  lastOptions: GenerateOptions | null;
  lastRenderProfile: RenderProfile | null;
  lastInputSize: { width: number; height: number } | null;
  lastInputName: string | null;
  lastPreviewSvg: string | null;
  lastTimingSummary: PreviewTimingSummary | null;
  stageImages: StageRgbaMap;
  renderedStages: Partial<Record<Exclude<StageKey, "output">, boolean>>;
  currentStage: StageKey;
}

const SVG_NS = "http://www.w3.org/2000/svg";

const state: DemoState = {
  wasmReady: false,
  busy: false,
  worker: null,
  nextRequestId: 1,
  lastResult: null,
  pendingSamplePath: null,
  lastOptions: null,
  lastRenderProfile: null,
  lastInputSize: null,
  lastInputName: null,
  lastPreviewSvg: null,
  lastTimingSummary: null,
  stageImages: {},
  renderedStages: {},
  currentStage: "output",
};

type WorkerRequest =
  | { id: number; type: "init" }
  | { id: number; type: "generate"; input: RgbaInput; options: GenerateOptions };

type WorkerResponse =
  | { id: number; type: "init:ok" }
  | { id: number; type: "generate:ok"; result: ProcessOutput }
  | { id: number; type: "error"; error: Record<string, unknown> }
  | { id: number; type: "progress"; stage: WorkerProgressStage; label: string }
  | { id: number; type: "log"; level: LogLevel; message: string; context?: Record<string, unknown> };

export async function bootstrapWebDemo(root: ParentNode = document): Promise<void> {
  const elements = queryElements(root);
  const logger = createUiLogger(elements.logs, "info");

  bindForm(elements, logger);
  bindExamples(elements, logger);
  bindStageTabs(elements);
  bindRenderProfilePreview(elements, logger);
  bindDownloads(elements, logger);
  selectStage(elements, "output");
  syncBusyState(elements, false);
  await ensureWasmReady(elements, logger);
  await maybeRunSmokeMode(elements, logger);
}

function queryElements(root: ParentNode): DemoElements {
  return {
    form: requireElement(root, "#demo-form", HTMLFormElement),
    fileInput: requireElement(root, "#image-input", HTMLInputElement),
    resizeEnabledInput: requireElement(root, "#resize-enabled-input", HTMLInputElement),
    resizeWidthInput: requireElement(root, "#resize-width-input", HTMLInputElement),
    resizeHeightInput: requireElement(root, "#resize-height-input", HTMLInputElement),
    clusterInput: requireElement(root, "#clusters-input", HTMLInputElement),
    clusterPrecisionInput: requireElement(root, "#cluster-precision-input", HTMLInputElement),
    randomSeedInput: requireElement(root, "#random-seed-input", HTMLInputElement),
    colorRestrictionsInput: requireElement(root, "#color-restrictions-input", HTMLTextAreaElement),
    cleanupRunsInput: requireElement(root, "#cleanup-runs-input", HTMLInputElement),
    removeFacetsInput: requireElement(root, "#remove-facets-input", HTMLInputElement),
    maximumFacetsInput: requireElement(root, "#maximum-facets-input", HTMLInputElement),
    smoothingInput: requireElement(root, "#smoothing-input", HTMLInputElement),
    sizeMultiplierInput: requireElement(root, "#size-multiplier-input", HTMLInputElement),
    showLabelsInput: requireElement(root, "#show-labels-input", HTMLInputElement),
    fillFacetsInput: requireElement(root, "#fill-facets-input", HTMLInputElement),
    showBordersInput: requireElement(root, "#show-borders-input", HTMLInputElement),
    labelFontSizeInput: requireElement(root, "#label-font-size-input", HTMLInputElement),
    labelFontColorInput: requireElement(root, "#label-font-color-input", HTMLInputElement),
    generateButton: requireElement(root, "#generate-button", HTMLButtonElement),
    downloadSvgButton: requireElement(root, "#download-svg-button", HTMLButtonElement),
    downloadPngButton: requireElement(root, "#download-png-button", HTMLButtonElement),
    status: requireElement(root, "#status", HTMLElement),
    stageTabs: Array.from(root.querySelectorAll<HTMLButtonElement>("[data-stage-tab]")),
    stagePanels: Array.from(root.querySelectorAll<HTMLElement>(".stage-panel")),
    quantizedCanvas: requireElement(root, "#quantized-canvas", HTMLCanvasElement),
    reductionCanvas: requireElement(root, "#reduction-canvas", HTMLCanvasElement),
    borderPathCanvas: requireElement(root, "#border-path-canvas", HTMLCanvasElement),
    borderSegmentationCanvas: requireElement(root, "#border-segmentation-canvas", HTMLCanvasElement),
    labelPlacementCanvas: requireElement(root, "#label-placement-canvas", HTMLCanvasElement),
    quantizedEmpty: requireElement(root, "#quantized-empty", HTMLElement),
    reductionEmpty: requireElement(root, "#reduction-empty", HTMLElement),
    borderPathEmpty: requireElement(root, "#border-path-empty", HTMLElement),
    borderSegmentationEmpty: requireElement(root, "#border-segmentation-empty", HTMLElement),
    labelPlacementEmpty: requireElement(root, "#label-placement-empty", HTMLElement),
    svgPreview: requireElement(root, "#svg-preview", HTMLElement),
    summary: requireElement(root, "#summary", HTMLElement),
    palette: requireElement(root, "#palette", HTMLElement),
    logs: requireElement(root, "#logs", HTMLTextAreaElement),
    exampleButtons: Array.from(root.querySelectorAll<HTMLButtonElement>(".example-button")),
  };
}

async function ensureWasmReady(elements: DemoElements, logger: Logger): Promise<void> {
  setStatus(elements, "Initializing Wasm worker...");
  try {
    await ensureWorkerReady(logger);
    state.wasmReady = true;
    setStatus(elements, "Wasm worker is ready, you can upload an image to start processing.");
  } catch (error) {
    logger.error("Wasm worker 初始化失败", formatUnknownError(error));
    setStatus(elements, "Wasm worker initialization failed. Check the console or logs for details.", true);
    document.body.dataset.smoke = "init-failed";
  }
}

function bindForm(elements: DemoElements, logger: Logger): void {
  elements.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.busy) {
      logger.warn("当前仍有任务在执行，已忽略重复提交");
      return;
    }
    if (!state.wasmReady) {
      logger.warn("Wasm runtime 尚未准备完成");
      setStatus(elements, "Wasm runtime is not ready. Please wait.", true);
      return;
    }

    const file = elements.fileInput.files?.[0];
    if (file) {
      await runInput(elements, logger, file, file.name);
      return;
    }
    if (state.pendingSamplePath) {
      await runSample(elements, logger, state.pendingSamplePath);
      return;
    }

    logger.warn("未选择输入图片");
    setStatus(elements, "Please select an image or use a sample to start.", true);
  });
}

function bindExamples(elements: DemoElements, logger: Logger): void {
  for (const button of elements.exampleButtons) {
    button.addEventListener("click", async () => {
      const sample = button.dataset.sample;
      if (!sample) {
        return;
      }
      state.pendingSamplePath = sample;
      setStatus(elements, `Selected sample: ${sample.split("/").pop() ?? sample}`);
      if (state.wasmReady && !state.busy) {
        await runSample(elements, logger, sample);
      }
    });
  }
}

function bindStageTabs(elements: DemoElements): void {
  for (const tab of elements.stageTabs) {
    tab.addEventListener("click", () => {
      const stage = tab.dataset.stageTab as StageKey | undefined;
      if (stage) {
        selectStage(elements, stage);
        void renderActiveStageIfNeeded(elements);
      }
    });
  }
}

function bindRenderProfilePreview(elements: DemoElements, logger: Logger): void {
  const rerender = () => {
    if (!state.lastResult || !state.lastOptions || !state.lastInputSize) {
      return;
    }

    const renderStart = performance.now();
    const profile = buildRenderProfile(elements);
    state.lastRenderProfile = profile;
    const builtPreview = buildPreviewSvg(state.lastResult, profile);
    const renderDomStart = performance.now();
    renderPreview(elements, builtPreview.svg);
    const renderDomMs = roundMs(performance.now() - renderDomStart);
    const previousTiming = state.lastTimingSummary;
    const timing: PreviewTimingSummary = {
      decodeImageMs: previousTiming?.decodeImageMs ?? 0,
      sdkGenerateMs: previousTiming?.sdkGenerateMs ?? 0,
      processingMs: previousTiming?.processingMs ?? sumStageTimings(state.lastResult.metrics?.stageTimings),
      previewBuildMs: builtPreview.timing.previewBuildMs,
      applyShapeProfileMs: builtPreview.timing.applyShapeProfileMs,
      rebuildLabelsMs: builtPreview.timing.rebuildLabelsMs,
      renderDomMs,
      endToEndMs: roundMs((previousTiming?.decodeImageMs ?? 0) + (previousTiming?.sdkGenerateMs ?? 0) + builtPreview.timing.previewBuildMs + renderDomMs),
      exportSvgMs: previousTiming?.exportSvgMs,
      exportPngRasterizeMs: previousTiming?.exportPngRasterizeMs,
      exportPngEncodeMs: previousTiming?.exportPngEncodeMs,
      exportPngMs: previousTiming?.exportPngMs,
    };

    state.lastPreviewSvg = builtPreview.svg;
    state.lastTimingSummary = timing;
    renderSummary(elements.summary, state.lastResult, state.lastInputSize, state.lastOptions, profile, timing);
    selectStage(elements, "output");
    syncDownloadState(elements);

    logger.info("输出预览 profile 已重新应用", profile as unknown as Record<string, unknown>);
    logger.info("预览 SVG 重建完成", {
      previewBuildMs: timing.previewBuildMs,
      applyShapeProfileMs: timing.applyShapeProfileMs,
      rebuildLabelsMs: timing.rebuildLabelsMs,
      renderDomMs: timing.renderDomMs,
      labelCount: builtPreview.labelCount,
      totalPreviewMs: roundMs(performance.now() - renderStart),
    });
  };

  [
    elements.sizeMultiplierInput,
    elements.showLabelsInput,
    elements.fillFacetsInput,
    elements.showBordersInput,
    elements.labelFontSizeInput,
    elements.labelFontColorInput,
  ].forEach((element) => {
    element.addEventListener("input", rerender);
    element.addEventListener("change", rerender);
  });
}

function bindDownloads(elements: DemoElements, logger: Logger): void {
  elements.downloadSvgButton.addEventListener("click", () => {
    void downloadPreviewSvg(elements, logger);
  });
  elements.downloadPngButton.addEventListener("click", () => {
    void downloadPreviewPng(elements, logger);
  });
}

async function runSample(elements: DemoElements, logger: Logger, sample: string): Promise<void> {
  logger.info("加载示例图片", { sample });
  try {
    const response = await fetch(sample);
    if (!response.ok) {
      const errorMsg = `无法加载示例图片: ${sample} (HTTP ${response.status} ${response.statusText})`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }
    const blob = await response.blob();
    const fileName = sample.split("/").pop() ?? "sample.png";
    const file = new File([blob], fileName, { type: blob.type || "image/png" });
    await runInput(elements, logger, file, fileName);
  } catch (error) {
    if (error instanceof TypeError) {
      // 网络错误（如 CORS、连接失败等）
      const networkError = `网络请求失败: ${sample} - ${error.message}`;
      logger.error(networkError);
      setStatus(elements, `Failed to load sample image: ${sample}`, true);
      throw new Error(networkError);
    }
    throw error;
  }
}
async function runInput(
  elements: DemoElements,
  logger: Logger,
  file: Blob & { name?: string; type?: string },
  inputName: string,
): Promise<void> {
  state.busy = true;
  syncBusyState(elements, true);
  setStatus(elements, "Reading image and calling Wasm SDK...");

  try {
    const options = buildGenerateOptions(elements, logger);
    const renderProfile = buildRenderProfile(elements);
    const decodeStart = performance.now();
    const input = await readImageFile(file, logger, options);
    const decodeImageMs = roundMs(performance.now() - decodeStart);

    state.lastOptions = options;
    state.lastRenderProfile = renderProfile;
    state.lastInputSize = { width: input.width, height: input.height };
    state.lastInputName = inputName;
    logOptionFallbacks(logger, options, renderProfile);
    logger.info("图片解码耗时统计", { decodeImageMs });

    const sdkStart = performance.now();
    const result = await generateInWorker(input, options, logger);
    const sdkGenerateMs = roundMs(performance.now() - sdkStart);
    const processingMs = sumStageTimings(result.metrics?.stageTimings);
    logger.info("SDK 处理耗时统计", { sdkGenerateMs, processingMs });

    state.lastResult = result;
    const renderStart = performance.now();
    const builtPreview = buildPreviewSvg(result, renderProfile);
    const renderDomStart = performance.now();
    renderPreview(elements, builtPreview.svg);
    const renderDomMs = roundMs(performance.now() - renderDomStart);

    const timing: PreviewTimingSummary = {
      decodeImageMs,
      sdkGenerateMs,
      processingMs,
      previewBuildMs: builtPreview.timing.previewBuildMs,
      applyShapeProfileMs: builtPreview.timing.applyShapeProfileMs,
      rebuildLabelsMs: builtPreview.timing.rebuildLabelsMs,
      renderDomMs,
      endToEndMs: roundMs(performance.now() - decodeStart),
    };

    state.lastPreviewSvg = builtPreview.svg;
    state.lastTimingSummary = timing;
    cacheStageImages(result, input.width, input.height);
    renderSummary(elements.summary, result, input, options, renderProfile, timing);
    renderPalette(elements.palette, result);
    selectStage(elements, "output");
    await renderActiveStageIfNeeded(elements);

    logger.info("浏览器演示结果已渲染", {
      paletteSize: result.palette.length,
      facetCount: result.facetCount,
      svgLength: result.svg.length,
      previewBuildMs: timing.previewBuildMs,
      renderDomMs: timing.renderDomMs,
      totalEndToEndMs: timing.endToEndMs,
      labelCount: builtPreview.labelCount,
      totalRenderMs: roundMs(performance.now() - renderStart),
    });

    setStatus(elements, "Processing completed. Results updated.", false);
    document.body.dataset.smoke = "pass";
  } catch (error) {
    state.lastPreviewSvg = null;
    state.lastTimingSummary = null;
    state.stageImages = {};
    state.renderedStages = {};
    logger.error("浏览器演示处理失败", formatUnknownError(error));
    setStatus(elements, "Processing failed. Please check the logs.", true);
    document.body.dataset.smoke = "run-failed";
    throw error;
  } finally {
    state.busy = false;
    syncBusyState(elements, false);
  }
}

async function maybeRunSmokeMode(elements: DemoElements, logger: Logger): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  if (params.get("autorun") !== "1") {
    return;
  }

  const sample = params.get("sample");
  if (!sample) {
    return;
  }
  applyAutorunOverrides(elements, params);

  try {
    await runSample(elements, logger, sample);
  } catch (error) {
    logger.error("浏览器 smoke 自动运行失败", formatUnknownError(error));
    document.body.dataset.smoke = "autorun-failed";
    setStatus(elements, "Smoke run failed. Check log panel.", true);
  }
}

function applyAutorunOverrides(elements: DemoElements, params: URLSearchParams): void {
  const assign = (key: string, target: HTMLInputElement | HTMLTextAreaElement) => {
    const value = params.get(key);
    if (value !== null) {
      target.value = value;
    }
  };

  assign("clusters", elements.clusterInput);
  assign("precision", elements.clusterPrecisionInput);
  assign("seed", elements.randomSeedInput);
  assign("cleanupRuns", elements.cleanupRunsInput);
  assign("removeFacets", elements.removeFacetsInput);
  assign("maxFacets", elements.maximumFacetsInput);
  assign("smoothing", elements.smoothingInput);
  assign("resizeWidth", elements.resizeWidthInput);
  assign("resizeHeight", elements.resizeHeightInput);
  assign("colorRestrictions", elements.colorRestrictionsInput);
  assign("sizeMultiplier", elements.sizeMultiplierInput);
  assign("labelFontSize", elements.labelFontSizeInput);
  assign("labelFontColor", elements.labelFontColorInput);

  const resizeEnabled = params.get("resizeEnabled");
  if (resizeEnabled !== null) {
    elements.resizeEnabledInput.checked = resizeEnabled === "1" || resizeEnabled === "true";
  }
  const showLabels = params.get("showLabels");
  if (showLabels !== null) {
    elements.showLabelsInput.checked = showLabels === "1" || showLabels === "true";
  }
  const fillFacets = params.get("fillFacets");
  if (fillFacets !== null) {
    elements.fillFacetsInput.checked = fillFacets === "1" || fillFacets === "true";
  }
  const showBorders = params.get("showBorders");
  if (showBorders !== null) {
    elements.showBordersInput.checked = showBorders === "1" || showBorders === "true";
  }

  const colorSpace = params.get("colorSpace") as KmeansColorSpace | null;
  if (colorSpace) {
    const target = document.querySelector<HTMLInputElement>(`input[name="kmeans-color-space"][value="${colorSpace}"]`);
    if (target) {
      target.checked = true;
    }
  }

  const removalOrder = params.get("removalOrder");
  if (removalOrder === "small_to_large") {
    const target = document.querySelector<HTMLInputElement>('input[name="facet-removal-order"][value="small_to_large"]');
    if (target) {
      target.checked = true;
    }
  }
}

function buildGenerateOptions(elements: DemoElements, logger: Logger): GenerateOptions {
  return {
    randomSeed: toNonNegativeInteger(elements.randomSeedInput.value, 0),
    kmeansClusters: toPositiveInteger(elements.clusterInput.value, 16),
    kmeansMinDelta: toPositiveNumber(elements.clusterPrecisionInput.value, 1),
    kmeansColorSpace: getCheckedRadioValue("kmeans-color-space", "rgb") as KmeansColorSpace,
    colorRestrictions: parseColorRestrictions(elements.colorRestrictionsInput.value, logger),
    narrowPixelCleanupRuns: toNonNegativeInteger(elements.cleanupRunsInput.value, 3),
    removeFacetsSmallerThan: toPositiveInteger(elements.removeFacetsInput.value, 20),
    removeFacetsFromLargeToSmall: getCheckedRadioValue("facet-removal-order", "large_to_small") === "large_to_small",
    maximumNumberOfFacets: toPositiveInteger(elements.maximumFacetsInput.value, 100000),
    borderSmoothingPasses: toNonNegativeInteger(elements.smoothingInput.value, 2),
    resize: {
      enabled: elements.resizeEnabledInput.checked,
      maxWidth: toPositiveInteger(elements.resizeWidthInput.value, 1024),
      maxHeight: toPositiveInteger(elements.resizeHeightInput.value, 1024),
    },
    logLevel: "info",
    debugFlags: ["web_demo_stage_rgba"],
  };
}

function cacheStageImages(result: ProcessOutput, width: number, height: number): void {
  state.stageImages = {};
  state.renderedStages = {};

  if (result.debug?.quantizedRgba) {
    state.stageImages.quantized = { rgba: result.debug.quantizedRgba, width, height };
  }
  if (result.debug?.reductionRgba) {
    state.stageImages.reduction = { rgba: result.debug.reductionRgba, width, height };
  }
  if (result.debug?.borderPathRgba) {
    state.stageImages.borderPath = { rgba: result.debug.borderPathRgba, width, height };
  }
  if (result.debug?.borderSegmentationRgba) {
    state.stageImages.borderSegmentation = { rgba: result.debug.borderSegmentationRgba, width, height };
  }
  if (result.debug?.labelPlacementRgba) {
    state.stageImages.labelPlacement = { rgba: result.debug.labelPlacementRgba, width, height };
  }
}

async function ensureWorkerReady(logger: Logger): Promise<void> {
  if (!state.worker) {
    state.worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  }
  await callWorkerInit({ type: "init" }, logger);
}

async function generateInWorker(input: RgbaInput, options: GenerateOptions, logger: Logger): Promise<ProcessOutput> {
  return await callWorkerGenerate(
    {
      type: "generate",
      input,
      options,
    },
    logger,
    [input.rgba.buffer],
  );
}

async function callWorkerInit(
  payload: Omit<Extract<WorkerRequest, { type: "init" }>, "id">,
  logger: Logger,
  transfer: Transferable[] = [],
): Promise<void> {
  if (!state.worker) {
    state.worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  }

  const worker = state.worker;
  const id = state.nextRequestId++;

  return await new Promise((resolve, reject) => {
    const handleMessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (!message || message.id !== id) {
        return;
      }

      if (message.type === "log") {
        logger[message.level](message.message, message.context);
        return;
      }
      if (message.type === "progress") {
        logger.info(`worker-progress:${message.stage}`, { label: message.label });
        return;
      }

      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);

      if (message.type === "error") {
        reject(new Error(String(message.error.message ?? message.error.value ?? "Worker 执行失败")));
        return;
      }

      resolve();
    };

    const handleError = (event: ErrorEvent) => {
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
      reject(new Error(event.message || "Worker 运行失败"));
    };

    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleError);
    worker.postMessage({ id, ...payload }, transfer);
  });
}

async function callWorkerGenerate(
  payload: Omit<Extract<WorkerRequest, { type: "generate" }>, "id">,
  logger: Logger,
  transfer: Transferable[] = [],
): Promise<ProcessOutput> {
  if (!state.worker) {
    state.worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  }

  const worker = state.worker;
  const id = state.nextRequestId++;

  return await new Promise((resolve, reject) => {
    const handleMessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (!message || message.id !== id) {
        return;
      }

      if (message.type === "log") {
        logger[message.level](message.message, message.context);
        return;
      }
      if (message.type === "progress") {
        updateProgressUi(message.stage, message.label);
        return;
      }

      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);

      if (message.type === "error") {
        reject(new Error(String(message.error.message ?? message.error.value ?? "Worker 执行失败")));
        return;
      }

      if (message.type !== "generate:ok") {
        reject(new Error(`Worker 返回了意外消息: ${message.type}`));
        return;
      }

      resolve(message.result);
    };

    const handleError = (event: ErrorEvent) => {
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
      reject(new Error(event.message || "Worker 运行失败"));
    };

    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleError);
    worker.postMessage({ id, ...payload }, transfer);
  });
}

function buildRenderProfile(elements: DemoElements): RenderProfile {
  return {
    sizeMultiplier: toPositiveInteger(elements.sizeMultiplierInput.value, 3),
    showLabels: elements.showLabelsInput.checked,
    fillFacets: elements.fillFacetsInput.checked,
    showBorders: elements.showBordersInput.checked,
    labelFontSize: toPositiveInteger(elements.labelFontSizeInput.value, 50),
    labelFontColor: elements.labelFontColorInput.value || "#333333",
  };
}

function logOptionFallbacks(logger: Logger, options: GenerateOptions, renderProfile: RenderProfile): void {
  logger.info("当前表单参数已映射到 SDK options", options as Record<string, unknown>);
  logger.info("当前输出预览 profile 已映射到前端 SVG 预览", renderProfile as unknown as Record<string, unknown>);
  if (options.kmeansColorSpace && options.kmeansColorSpace !== "rgb") {
    logger.warn("当前选择的 clustering color space 尚未在 Rust core 中完整实现，运行时会回退到 RGB", {
      requestedColorSpace: options.kmeansColorSpace,
      effectiveColorSpace: "rgb",
    });
  }
}

function parseColorRestrictions(input: string, logger: Logger): Array<[number, number, number]> {
  const colors: Array<[number, number, number]> = [];
  for (const [index, rawLine] of input.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("//")) {
      continue;
    }
    const parts = line.split(",").map((item) => item.trim());
    if (parts.length !== 3) {
      throw new Error(`颜色限制第 ${index + 1} 行格式无效，应为 r,g,b`);
    }
    const rgb = parts.map((item) => Number.parseInt(item, 10));
    if (rgb.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
      throw new Error(`颜色限制第 ${index + 1} 行必须是 0-255 之间的整数`);
    }
    colors.push([rgb[0]!, rgb[1]!, rgb[2]!]);
  }
  logger.info("颜色限制解析完成", { colorRestrictionCount: colors.length });
  return colors;
}
function buildPreviewSvg(result: ProcessOutput, profile: RenderProfile): BuiltPreview {
  const previewStart = performance.now();
  const parser = new DOMParser();
  const documentNode = parser.parseFromString(result.svg, "image/svg+xml");
  const root = documentNode.documentElement;
  if (root.nodeName.toLowerCase() !== "svg") {
    return {
      svg: result.svg,
      timing: {
        previewBuildMs: 0,
        applyShapeProfileMs: 0,
        rebuildLabelsMs: 0,
      },
      labelCount: 0,
    };
  }

  const shapeStart = performance.now();
  const viewBox = root.getAttribute("viewBox")?.trim().split(/\s+/) ?? [];
  const baseWidth = Number.parseFloat(viewBox[2] ?? root.getAttribute("width") ?? "0");
  const baseHeight = Number.parseFloat(viewBox[3] ?? root.getAttribute("height") ?? "0");
  if (baseWidth > 0 && baseHeight > 0) {
    root.setAttribute("width", String(baseWidth * profile.sizeMultiplier));
    root.setAttribute("height", String(baseHeight * profile.sizeMultiplier));
  }

  const facetPaths = Array.from(root.querySelectorAll<SVGPathElement>("path[data-facet-id]"));
  for (const path of facetPaths) {
    if (!profile.fillFacets) {
      path.setAttribute("fill", "none");
    }
    if (!profile.showBorders) {
      path.setAttribute("stroke", "none");
      path.setAttribute("stroke-width", "0");
    } else {
      path.setAttribute("stroke", "#222");
      path.setAttribute("stroke-width", "0.2");
    }
  }
  const applyShapeProfileMs = roundMs(performance.now() - shapeStart);

  const labelStart = performance.now();
  const labelCount = rebuildPreviewLabels(documentNode, root, result.labelBounds, result.facetsSummary, profile);
  const rebuildLabelsMs = roundMs(performance.now() - labelStart);

  const svg = new XMLSerializer().serializeToString(root);
  const previewBuildMs = roundMs(performance.now() - previewStart);
  return {
    svg,
    timing: {
      previewBuildMs,
      applyShapeProfileMs,
      rebuildLabelsMs,
    },
    labelCount,
  };
}

function rebuildPreviewLabels(
  documentNode: XMLDocument,
  root: Element,
  labelBounds: LabelBounds[],
  facetsSummary: FacetSummary[],
  profile: RenderProfile,
): number {
  root.querySelectorAll("text").forEach((node) => node.remove());
  root.querySelectorAll("g[data-preview-label-root='true']").forEach((node) => node.remove());

  if (!profile.showLabels || labelBounds.length === 0) {
    return 0;
  }

  const labelLayer = documentNode.createElementNS(SVG_NS, "g");
  labelLayer.setAttribute("data-preview-label-root", "true");
  let labelCount = 0;

  for (const [index, bounds] of labelBounds.entries()) {
    if (bounds.width <= 0 || bounds.height <= 0) {
      continue;
    }

    const scaledX = bounds.minX * profile.sizeMultiplier;
    const scaledY = bounds.minY * profile.sizeMultiplier;
    const scaledWidth = bounds.width * profile.sizeMultiplier;
    const scaledHeight = bounds.height * profile.sizeMultiplier;
    const facetSummary = facetsSummary[index];
    const labelValue = String(facetSummary ? facetSummary.colorIndex : index);
    const digitDivisor = Math.max(1, labelValue.length);

    // 这里按旧版 labelBounds 语义重建标签容器，让字和图使用同一套比例基准。
    const wrapper = documentNode.createElementNS(SVG_NS, "svg");
    wrapper.setAttribute("x", String(scaledX));
    wrapper.setAttribute("y", String(scaledY));
    wrapper.setAttribute("width", String(scaledWidth));
    wrapper.setAttribute("height", String(scaledHeight));
    wrapper.setAttribute("overflow", "visible");
    wrapper.setAttribute("viewBox", "-50 -50 100 100");
    wrapper.setAttribute("preserveAspectRatio", "xMidYMid meet");
    wrapper.setAttribute("data-preview-label", labelValue);

    const text = documentNode.createElementNS(SVG_NS, "text");
    text.textContent = labelValue;
    text.setAttribute("x", "0");
    text.setAttribute("y", "0");
    text.setAttribute("font-family", "Tahoma, Segoe UI, sans-serif");
    text.setAttribute("font-size", String(profile.labelFontSize / digitDivisor));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("dominant-baseline", "middle");
    text.setAttribute("fill", profile.labelFontColor);

    wrapper.appendChild(text);
    labelLayer.appendChild(wrapper);
    labelCount += 1;
  }

  root.appendChild(labelLayer);
  return labelCount;
}

function renderPreview(elements: DemoElements, previewSvg: string): void {
  elements.svgPreview.innerHTML = previewSvg;
}

async function renderActiveStageIfNeeded(elements: DemoElements): Promise<void> {
  const stage = state.currentStage;
  if (stage === "output") {
    return;
  }
  if (state.renderedStages[stage]) {
    return;
  }

  const stageEntry = getStageRenderTarget(elements, stage);
  if (!stageEntry) {
    return;
  }

  const image = state.stageImages[stage];
  await nextFrame();
  renderStageCanvas(
    stageEntry.canvas,
    stageEntry.empty,
    image?.rgba,
    image?.width ?? 0,
    image?.height ?? 0,
    `${stageEntry.label} Not Available`,
  );
  state.renderedStages[stage] = true;
}

function renderStageCanvas(
  canvas: HTMLCanvasElement,
  empty: HTMLElement,
  rgba: Uint8Array | undefined,
  width: number,
  height: number,
  emptyMessage: string,
): void {
  if (!rgba || rgba.length !== width * height * 4) {
    canvas.style.display = "none";
    empty.hidden = false;
    empty.textContent = emptyMessage;
    return;
  }

  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    canvas.style.display = "none";
    empty.hidden = false;
    empty.textContent = "无法创建阶段预览画布";
    return;
  }

  context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  canvas.style.display = "block";
  empty.hidden = true;
}

function getStageRenderTarget(elements: DemoElements, stage: Exclude<StageKey, "output">): {
  canvas: HTMLCanvasElement;
  empty: HTMLElement;
  label: string;
} | null {
  switch (stage) {
    case "quantized":
      return { canvas: elements.quantizedCanvas, empty: elements.quantizedEmpty, label: "Quantized image" };
    case "reduction":
      return { canvas: elements.reductionCanvas, empty: elements.reductionEmpty, label: "Facet reduction" };
    case "borderPath":
      return { canvas: elements.borderPathCanvas, empty: elements.borderPathEmpty, label: "Border tracing" };
    case "borderSegmentation":
      return { canvas: elements.borderSegmentationCanvas, empty: elements.borderSegmentationEmpty, label: "Border segmentation" };
    case "labelPlacement":
      return { canvas: elements.labelPlacementCanvas, empty: elements.labelPlacementEmpty, label: "Label placement" };
  }
}

function selectStage(elements: DemoElements, stage: StageKey): void {
  state.currentStage = stage;
  for (const tab of elements.stageTabs) {
    const isActive = tab.dataset.stageTab === stage;
    tab.setAttribute("aria-selected", String(isActive));
  }

  for (const panel of elements.stagePanels) {
    panel.classList.toggle("is-active", panel.id === toStagePanelId(stage));
  }
}

function updateProgressUi(stage: WorkerProgressStage, label: string): void {
  const statusElement = document.querySelector<HTMLElement>("#status");
  if (statusElement) {
    statusElement.textContent = `Processing: ${label}`;
    statusElement.dataset.state = "normal";
  }

  const stageToTab = new Map<WorkerProgressStage, StageKey>([
    ["quantize", "quantized"],
    ["reduction", "reduction"],
    ["contours", "borderPath"],
    ["labels", "labelPlacement"],
    ["render", "output"],
  ]);
  const activeStage = stageToTab.get(stage);
  document.querySelectorAll<HTMLButtonElement>("[data-stage-tab]").forEach((tab) => {
    const base = tab.textContent?.split(" · ")[0] ?? "";
    tab.textContent = base;
    if (activeStage && tab.dataset.stageTab === activeStage && stage !== "done") {
      tab.textContent = `${base} · running`;
    }
    if (stage === "done" && tab.dataset.stageTab === "output") {
      tab.textContent = `${base} · done`;
    }
  });
}

function toStagePanelId(stage: StageKey): string {
  switch (stage) {
    case "quantized":
      return "quantized-panel";
    case "reduction":
      return "reduction-panel";
    case "borderPath":
      return "border-path-panel";
    case "borderSegmentation":
      return "border-segmentation-panel";
    case "labelPlacement":
      return "label-placement-panel";
    case "output":
      return "output-panel";
  }
}

async function downloadPreviewSvg(elements: DemoElements, logger: Logger): Promise<void> {
  if (!state.lastPreviewSvg) {
    logger.warn("当前没有可下载的 SVG 预览结果");
    return;
  }

  const exportStart = performance.now();
  const fileName = `${getDownloadBaseName()}.preview.svg`;
  const blob = new Blob([state.lastPreviewSvg], { type: "image/svg+xml;charset=utf-8" });
  triggerBlobDownload(blob, fileName);
  const exportSvgMs = roundMs(performance.now() - exportStart);
  updateExportTiming(elements, "svg", { exportSvgMs });
  logger.info("SVG 预览下载已触发", { fileName, exportSvgMs });
}

async function downloadPreviewPng(elements: DemoElements, logger: Logger): Promise<void> {
  if (!state.lastPreviewSvg) {
    logger.warn("当前没有可下载的 PNG 预览结果");
    return;
  }

  const parser = new DOMParser();
  const documentNode = parser.parseFromString(state.lastPreviewSvg, "image/svg+xml");
  const root = documentNode.documentElement;
  const width = toPositiveNumber(root.getAttribute("width") ?? "0", 0);
  const height = toPositiveNumber(root.getAttribute("height") ?? "0", 0);
  if (width <= 0 || height <= 0) {
    throw new Error("当前预览 SVG 缺少有效尺寸，无法导出 PNG");
  }

  const rasterizeStart = performance.now();
  const svgBlob = new Blob([state.lastPreviewSvg], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const image = await loadImage(svgUrl);
    const rasterizeMs = roundMs(performance.now() - rasterizeStart);

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width);
    canvas.height = Math.round(height);
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("无法创建 PNG 导出所需的 Canvas 上下文");
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const encodeStart = performance.now();
    const pngBlob = await canvasToBlob(canvas, "image/png");
    const encodeMs = roundMs(performance.now() - encodeStart);
    const exportPngMs = roundMs(rasterizeMs + encodeMs);

    const fileName = `${getDownloadBaseName()}.preview.png`;
    triggerBlobDownload(pngBlob, fileName);
    updateExportTiming(elements, "png", {
      exportPngRasterizeMs: rasterizeMs,
      exportPngEncodeMs: encodeMs,
      exportPngMs,
    });

    logger.info("PNG 预览下载已触发", {
      fileName,
      exportPngRasterizeMs: rasterizeMs,
      exportPngEncodeMs: encodeMs,
      exportPngMs,
      width: canvas.width,
      height: canvas.height,
    });
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

function updateExportTiming(
  elements: DemoElements,
  kind: "svg" | "png",
  patch: Pick<PreviewTimingSummary, "exportSvgMs" | "exportPngRasterizeMs" | "exportPngEncodeMs" | "exportPngMs">,
): void {
  if (!state.lastTimingSummary || !state.lastResult || !state.lastOptions || !state.lastRenderProfile || !state.lastInputSize) {
    return;
  }

  state.lastTimingSummary = {
    ...state.lastTimingSummary,
    ...patch,
  };
  renderSummary(
    elements.summary,
    state.lastResult,
    state.lastInputSize,
    state.lastOptions,
    state.lastRenderProfile,
    state.lastTimingSummary,
  );

  if (kind === "svg") {
    elements.downloadSvgButton.blur();
  } else {
    elements.downloadPngButton.blur();
  }
}

function syncBusyState(elements: DemoElements, busy: boolean): void {
  elements.generateButton.disabled = busy;
  elements.generateButton.textContent = busy ? "Processing..." : "Generate";
  syncDownloadState(elements);
}

function syncDownloadState(elements: DemoElements): void {
  const enabled = Boolean(state.lastPreviewSvg) && !state.busy;
  elements.downloadSvgButton.disabled = !enabled;
  elements.downloadPngButton.disabled = !enabled;
}

function setStatus(elements: DemoElements, message: string, isError = false): void {
  elements.status.textContent = message;
  elements.status.dataset.state = isError ? "error" : "normal";
}

function renderSummary(
  target: HTMLElement,
  result: ProcessOutput,
  input: Pick<RgbaInput, "width" | "height">,
  options: GenerateOptions,
  renderProfile: RenderProfile,
  timing: PreviewTimingSummary,
): void {
  const stageTimings = result.metrics?.stageTimings ?? {};
  const pipelineStats = result.metrics?.pipelineStats ?? {};
  const timingLines = Object.entries(stageTimings).map(([key, value]) => `pipeline.${key}: ${value} ms`);
  const statsLines = Object.entries(pipelineStats).map(([key, value]) => `${key}: ${value}`);
  const optionLines = [
    `resize.enabled: ${String(options.resize?.enabled ?? true)}`,
    `resize.maxWidth: ${String(options.resize?.maxWidth ?? 1024)}`,
    `resize.maxHeight: ${String(options.resize?.maxHeight ?? 1024)}`,
    `kmeansClusters: ${String(options.kmeansClusters ?? 16)}`,
    `kmeansMinDelta: ${String(options.kmeansMinDelta ?? 1)}`,
    `kmeansColorSpace.requested: ${String(options.kmeansColorSpace ?? "rgb")}`,
    `kmeansColorSpace.effective: ${options.kmeansColorSpace === "rgb" || !options.kmeansColorSpace ? "rgb" : "rgb (fallback)"}`,
    `colorRestrictions: ${String(options.colorRestrictions?.length ?? 0)}`,
    `narrowPixelCleanupRuns: ${String(options.narrowPixelCleanupRuns ?? 3)}`,
    `removeFacetsSmallerThan: ${String(options.removeFacetsSmallerThan ?? 20)}`,
    `removeFacetsFromLargeToSmall: ${String(options.removeFacetsFromLargeToSmall ?? true)}`,
    `maximumNumberOfFacets: ${String(options.maximumNumberOfFacets ?? 4294967295)}`,
    `borderSmoothingPasses: ${String(options.borderSmoothingPasses ?? 2)}`,
    `preview.sizeMultiplier: ${String(renderProfile.sizeMultiplier)}`,
    `preview.showLabels: ${String(renderProfile.showLabels)}`,
    `preview.fillFacets: ${String(renderProfile.fillFacets)}`,
    `preview.showBorders: ${String(renderProfile.showBorders)}`,
    `preview.labelFontSize: ${String(renderProfile.labelFontSize)}`,
    `preview.labelFontColor: ${renderProfile.labelFontColor}`,
  ];
  const previewTimingLines = [
    `timing.decodeImageMs: ${timing.decodeImageMs} ms`,
    `timing.sdkGenerateMs: ${timing.sdkGenerateMs} ms`,
    `timing.total.processingMs: ${timing.processingMs} ms`,
    `timing.previewBuildMs: ${timing.previewBuildMs} ms`,
    `timing.preview.applyShapeProfileMs: ${timing.applyShapeProfileMs} ms`,
    `timing.preview.rebuildLabelsMs: ${timing.rebuildLabelsMs} ms`,
    `timing.preview.renderDomMs: ${timing.renderDomMs} ms`,
    `timing.total.previewMs: ${roundMs(timing.previewBuildMs + timing.renderDomMs)} ms`,
    `timing.total.endToEndMs: ${timing.endToEndMs} ms`,
  ];

  if (typeof timing.exportSvgMs === "number") {
    previewTimingLines.push(`timing.exportSvgMs: ${timing.exportSvgMs} ms`);
  }
  if (typeof timing.exportPngRasterizeMs === "number") {
    previewTimingLines.push(`timing.exportPngRasterizeMs: ${timing.exportPngRasterizeMs} ms`);
  }
  if (typeof timing.exportPngEncodeMs === "number") {
    previewTimingLines.push(`timing.exportPngEncodeMs: ${timing.exportPngEncodeMs} ms`);
  }
  if (typeof timing.exportPngMs === "number") {
    previewTimingLines.push(`timing.total.exportPngMs: ${timing.exportPngMs} ms`);
  }

  target.innerHTML = [
    `输入尺寸：${input.width} x ${input.height}`,
    `调色板数量：${result.palette.length}`,
    `Facet 数量：${result.facetCount}`,
    `SVG 大小：${result.svg.length} 字符`,
    ...optionLines,
    ...previewTimingLines,
    ...timingLines,
    ...statsLines,
  ].map((line) => `<li>${escapeHtml(line)}</li>`).join("");
}

function renderPalette(target: HTMLElement, result: ProcessOutput): void {
  target.innerHTML = result.palette.map((entry) => {
    const color = `rgb(${entry.color[0]}, ${entry.color[1]}, ${entry.color[2]})`;
    const alias = entry.colorAlias ? ` / ${escapeHtml(entry.colorAlias)}` : "";
    return `
      <li class="palette-item">
        <span class="swatch" style="background:${escapeHtml(color)}"></span>
        <span>#${entry.index}${alias}</span>
        <span>${entry.frequency} px / ${(entry.areaPercentage * 100).toFixed(2)}%</span>
      </li>
    `;
  }).join("");
}

async function readImageFile(
  file: Blob & { name?: string; size?: number; type?: string },
  logger: Logger,
  options?: Pick<GenerateOptions, "resize">,
): Promise<RgbaInput> {
  logger.info("开始解码浏览器图片输入", {
    name: file.name ?? "blob",
    size: file.size ?? 0,
    type: file.type ?? "application/octet-stream",
  });

  const imageBitmap = await createImageBitmap(file);
  const targetSize = resolveResizeDimensions(
    imageBitmap.width,
    imageBitmap.height,
    options?.resize?.enabled ?? true,
    options?.resize?.maxWidth ?? 1024,
    options?.resize?.maxHeight ?? 1024,
  );
  const canvas = document.createElement("canvas");
  canvas.width = targetSize.width;
  canvas.height = targetSize.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("无法创建 2D Canvas 上下文");
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(imageBitmap, 0, 0, targetSize.width, targetSize.height);
  const imageData = context.getImageData(0, 0, targetSize.width, targetSize.height);
  imageBitmap.close();

  logger.info("浏览器图片解码完成", {
    originalWidth: targetSize.originalWidth,
    originalHeight: targetSize.originalHeight,
    width: imageData.width,
    height: imageData.height,
    resized: targetSize.resized,
    rgbaLength: imageData.data.length,
  });

  return { width: imageData.width, height: imageData.height, rgba: new Uint8Array(imageData.data) };
}

function resolveResizeDimensions(
  width: number,
  height: number,
  enabled: boolean,
  maxWidth: number,
  maxHeight: number,
): {
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  resized: boolean;
} {
  if (!enabled || width <= 0 || height <= 0 || maxWidth <= 0 || maxHeight <= 0) {
    return {
      width,
      height,
      originalWidth: width,
      originalHeight: height,
      resized: false,
    };
  }

  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  const resizedWidth = Math.max(1, Math.round(width * scale));
  const resizedHeight = Math.max(1, Math.round(height * scale));

  return {
    width: resizedWidth,
    height: resizedHeight,
    originalWidth: width,
    originalHeight: height,
    resized: resizedWidth !== width || resizedHeight !== height,
  };
}

function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = "async";
  return await new Promise((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("无法从当前 SVG 预览构建 PNG 图像"));
    image.src = url;
  });
}

async function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Canvas 导出失败，未生成二进制数据"));
      }
    }, type);
  });
}

function getDownloadBaseName(): string {
  const rawName = state.lastInputName ?? "paintbynumbers";
  return rawName.replace(/\.[^.]+$/, "") || "paintbynumbers";
}

function sumStageTimings(stageTimings: Record<string, number> | undefined): number {
  if (!stageTimings) {
    return 0;
  }
  return roundMs(Object.values(stageTimings).reduce((sum, value) => sum + value, 0));
}

function roundMs(value: number): number {
  return Math.round(value * 100) / 100;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function requireElement<T extends Element>(root: ParentNode, selector: string, ctor: { new(): T }): T {
  const element = root.querySelector(selector);
  if (!(element instanceof ctor)) {
    throw new Error(`缺少必需的页面元素: ${selector}`);
  }
  return element;
}

function createUiLogger(logTarget: HTMLTextAreaElement, level: LogLevel): Logger {
  const base = createConsoleLogger(level);
  const append = (levelName: string, message: string, context?: Record<string, unknown>) => {
    const line = context ? `[${levelName}] ${message} ${JSON.stringify(context)}` : `[${levelName}] ${message}`;
    logTarget.value = `${logTarget.value}${line}\n`;
    logTarget.scrollTop = logTarget.scrollHeight;
  };

  return {
    error(message, context) { append("error", message, context); base.error(message, context); },
    warn(message, context) { append("warn", message, context); base.warn(message, context); },
    info(message, context) { append("info", message, context); base.info(message, context); },
    debug(message, context) { append("debug", message, context); base.debug(message, context); },
    trace(message, context) { append("trace", message, context); base.trace(message, context); },
  };
}

function getCheckedRadioValue(name: string, fallback: string): string {
  return document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value ?? fallback;
}

function toPositiveInteger(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toNonNegativeInteger(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function toPositiveNumber(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function formatUnknownError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { value: String(error) };
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => {
    bootstrapWebDemo().catch((error) => {
      console.error("[pbn-web-demo] 启动失败", error);
      document.body.dataset.smoke = "bootstrap-failed";
    });
  });
}
