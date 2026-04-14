
import {
  createConsoleLogger,
  resolveResizeDimensions,
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
import {
  applyStaticTranslations,
  getLocale,
  setLocale,
  t,
  type I18nKey,
  type Locale,
} from "./i18n";

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
  localeButtons: HTMLButtonElement[];
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
  currentProgressStage: WorkerProgressStage | null;
  statusMessage: { key: I18nKey; params?: Record<string, string | number>; isError: boolean } | null;
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
  currentProgressStage: null,
  statusMessage: null,
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

const STAGE_TIMING_LABELS: Record<string, I18nKey> = {
  quantizeMs: "summary.pipeline.quantize",
  cleanupMs: "summary.pipeline.cleanup",
  regionsMs: "summary.pipeline.regions",
  reductionMs: "summary.pipeline.reduction",
  labelsMs: "summary.pipeline.labels",
  renderMs: "summary.pipeline.render",
  totalMs: "summary.pipeline.total",
};

const PIPELINE_STAT_LABELS: Record<string, I18nKey> = {
  originalUniqueColors: "summary.stat.originalUniqueColors",
  quantizedPaletteSize: "summary.stat.quantizedPaletteSize",
  quantizeIterations: "summary.stat.quantizeIterations",
  quantizeSampleColors: "summary.stat.quantizeSampleColors",
  facetsBeforeReduction: "summary.stat.facetsBeforeReduction",
  facetsAfterReduction: "summary.stat.facetsAfterReduction",
  removedFacets: "summary.stat.removedFacets",
  reductionRounds: "summary.stat.reductionRounds",
  maxFacetsSeenDuringReduction: "summary.stat.maxFacetsSeenDuringReduction",
  reductionFastPathFacets: "summary.stat.reductionFastPathFacets",
  reductionBfsFacets: "summary.stat.reductionBfsFacets",
  narrowCleanupReplacedPixels: "summary.stat.narrowCleanupReplacedPixels",
  contourTracedPathPoints: "summary.stat.contourTracedPathPoints",
  contourRawSegments: "summary.stat.contourRawSegments",
  contourSharedSegments: "summary.stat.contourSharedSegments",
  contourReverseSegments: "summary.stat.contourReverseSegments",
};

export async function bootstrapWebDemo(root: ParentNode = document): Promise<void> {
  const elements = queryElements(root);
  applyStaticTranslations(root);
  const logger = createUiLogger(elements.logs, "info");

  bindLocaleSwitcher(elements);
  bindForm(elements, logger);
  bindExamples(elements, logger);
  bindStageTabs(elements);
  bindRenderProfilePreview(elements, logger);
  bindDownloads(elements, logger);
  refreshLocalizedUi(elements);
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
    localeButtons: Array.from(root.querySelectorAll<HTMLButtonElement>("[data-locale]")),
  };
}

function bindLocaleSwitcher(elements: DemoElements): void {
  for (const button of elements.localeButtons) {
    button.addEventListener("click", () => {
      const locale = button.dataset.locale as Locale | undefined;
      if (!locale || locale === getLocale()) {
        return;
      }
      setLocale(locale);
      refreshLocalizedUi(elements);
    });
  }
}

function refreshLocalizedUi(elements: DemoElements): void {
  applyStaticTranslations(document);
  syncLocaleButtons(elements);
  syncBusyState(elements, state.busy);
  refreshStageTabs(elements);

  if (state.statusMessage) {
    if (state.statusMessage.key === "status.processingStage" && state.currentProgressStage) {
      state.statusMessage.params = { label: getProgressStageLabel(state.currentProgressStage) };
    }
    renderStatusText(elements, t(state.statusMessage.key, state.statusMessage.params), state.statusMessage.isError);
  }

  if (state.lastResult && state.lastOptions && state.lastRenderProfile && state.lastInputSize && state.lastTimingSummary) {
    renderSummary(elements.summary, state.lastResult, state.lastInputSize, state.lastOptions, state.lastRenderProfile, state.lastTimingSummary);
  }

  if (!state.lastPreviewSvg) {
    elements.svgPreview.textContent = t("empty.waitingForInput");
  }

  state.renderedStages = {};
  void renderActiveStageIfNeeded(elements);
}

function syncLocaleButtons(elements: DemoElements): void {
  const locale = getLocale();
  for (const button of elements.localeButtons) {
    button.classList.toggle("is-active", button.dataset.locale === locale);
    button.setAttribute("aria-pressed", String(button.dataset.locale === locale));
  }
}

async function ensureWasmReady(elements: DemoElements, logger: Logger): Promise<void> {
  setStatusKey(elements, "status.initializing");
  try {
    await ensureWorkerReady(logger);
    state.wasmReady = true;
    setStatusKey(elements, "status.ready");
  } catch (error) {
    logger.error("Wasm worker 初始化失败", formatUnknownError(error));
    setStatusKey(elements, "status.initFailed", undefined, true);
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
      setStatusKey(elements, "status.runtimeNotReady", undefined, true);
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
    setStatusKey(elements, "status.selectInput", undefined, true);
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
      setStatusKey(elements, "status.selectedSample", { name: sample.split("/").pop() ?? sample });
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
      const errorMsg = t("log.sampleFetchFailed", {
        sample,
        status: response.status,
        statusText: response.statusText,
      });
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
      const networkError = t("log.sampleNetworkFailed", { sample, message: error.message });
      logger.error(networkError);
      setStatusKey(elements, "status.failedToLoadSample", { sample }, true);
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
  state.currentProgressStage = null;
  syncBusyState(elements, true);
  setStatusKey(elements, "status.readingInput");
  refreshStageTabs(elements);

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

    setStatusKey(elements, "status.processingCompleted");
    document.body.dataset.smoke = "pass";
  } catch (error) {
    state.lastPreviewSvg = null;
    state.lastTimingSummary = null;
    state.stageImages = {};
    state.renderedStages = {};
    state.currentProgressStage = null;
    logger.error("浏览器演示处理失败", formatUnknownError(error));
    setStatusKey(elements, "status.processingFailed", undefined, true);
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
    setStatusKey(elements, "status.smokeFailed", undefined, true);
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
        reject(new Error(String(message.error.message ?? message.error.value ?? t("log.workerFailed"))));
        return;
      }

      resolve();
    };

    const handleError = (event: ErrorEvent) => {
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
      reject(new Error(event.message || t("log.workerRuntimeFailed")));
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
        reject(new Error(String(message.error.message ?? message.error.value ?? t("log.workerFailed"))));
        return;
      }

      if (message.type !== "generate:ok") {
        reject(new Error(t("log.workerUnexpectedMessage", { type: message.type })));
        return;
      }

      resolve(message.result);
    };

    const handleError = (event: ErrorEvent) => {
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
      reject(new Error(event.message || t("log.workerRuntimeFailed")));
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
      throw new Error(t("log.colorRestrictionsInvalidFormat", { line: index + 1 }));
    }
    const rgb = parts.map((item) => Number.parseInt(item, 10));
    if (rgb.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
      throw new Error(t("log.colorRestrictionsInvalidRange", { line: index + 1 }));
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
  const candidates = labelBounds
    .map((bounds, index) => ({ bounds, index, facetSummary: facetsSummary[index] }))
    .filter(({ bounds }) => bounds.width > 0 && bounds.height > 0)
    .sort((left, right) => {
      const pointDelta = (right.facetSummary?.pointCount ?? 0) - (left.facetSummary?.pointCount ?? 0);
      if (pointDelta !== 0) {
        return pointDelta;
      }
      return right.bounds.width * right.bounds.height - left.bounds.width * left.bounds.height;
    });

  const placedLabelRects: Array<{ minX: number; minY: number; maxX: number; maxY: number }> = [];
  let labelCount = 0;

  for (const { bounds, index, facetSummary } of candidates) {
    const scaledX = bounds.minX * profile.sizeMultiplier;
    const scaledY = bounds.minY * profile.sizeMultiplier;
    const scaledWidth = bounds.width * profile.sizeMultiplier;
    const scaledHeight = bounds.height * profile.sizeMultiplier;
    const labelValue = String(facetSummary ? facetSummary.colorIndex : index);
    const fontSize = resolvePreviewLabelFontSize(
      profile.labelFontSize,
      labelValue,
      scaledWidth,
      scaledHeight,
      facetSummary?.pointCount ?? 0,
    );
    if (fontSize <= 0) {
      continue;
    }

    const labelRect = buildPreviewLabelRect(labelValue, scaledX, scaledY, scaledWidth, scaledHeight, fontSize);
    if (hasPreviewLabelCollision(labelRect, placedLabelRects)) {
      continue;
    }

    const text = documentNode.createElementNS(SVG_NS, "text");
    text.textContent = labelValue;
    text.setAttribute("x", String(scaledX + scaledWidth / 2));
    text.setAttribute("y", String(scaledY + scaledHeight / 2));
    text.setAttribute("font-family", "Tahoma, Segoe UI, sans-serif");
    text.setAttribute("font-size", String(roundSvgNumber(fontSize)));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("dominant-baseline", "middle");
    text.setAttribute("fill", profile.labelFontColor);
    text.setAttribute("data-preview-label", labelValue);

    labelLayer.appendChild(text);
    placedLabelRects.push(labelRect);
    labelCount += 1;
  }

  root.appendChild(labelLayer);
  return labelCount;
}

function resolvePreviewLabelFontSize(
  requestedFontSize: number,
  labelValue: string,
  boundsWidth: number,
  boundsHeight: number,
  pointCount: number,
): number {
  const minLabelWidth = 10;
  const minLabelHeight = 10;
  if (boundsWidth < minLabelWidth || boundsHeight < minLabelHeight) {
    return 0;
  }

  if (pointCount > 0 && pointCount < 24) {
    return 0;
  }

  const safeWidth = boundsWidth * 0.64;
  const safeHeight = boundsHeight * 0.5;
  if (safeWidth <= 0 || safeHeight <= 0) {
    return 0;
  }

  const estimatedCharWidth = estimatePreviewLabelCharUnits(labelValue);
  const maxFontByWidth = safeWidth / estimatedCharWidth;
  const maxFontByHeight = safeHeight;
  const maxFontByShortSide = Math.min(boundsWidth, boundsHeight) * 0.46;
  const fontSize = Math.min(requestedFontSize, maxFontByWidth, maxFontByHeight, maxFontByShortSide);

  return fontSize >= 5 ? fontSize : 0;
}

function buildPreviewLabelRect(
  labelValue: string,
  scaledX: number,
  scaledY: number,
  scaledWidth: number,
  scaledHeight: number,
  fontSize: number,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const textWidth = fontSize * estimatePreviewLabelCharUnits(labelValue) * 0.72;
  const textHeight = fontSize * 0.95;
  const padding = Math.max(1.5, fontSize * 0.18);
  const centerX = scaledX + scaledWidth / 2;
  const centerY = scaledY + scaledHeight / 2;

  return {
    minX: centerX - textWidth / 2 - padding,
    minY: centerY - textHeight / 2 - padding,
    maxX: centerX + textWidth / 2 + padding,
    maxY: centerY + textHeight / 2 + padding,
  };
}

function hasPreviewLabelCollision(
  candidate: { minX: number; minY: number; maxX: number; maxY: number },
  placed: Array<{ minX: number; minY: number; maxX: number; maxY: number }>,
): boolean {
  for (const existing of placed) {
    const overlaps =
      candidate.minX < existing.maxX &&
      candidate.maxX > existing.minX &&
      candidate.minY < existing.maxY &&
      candidate.maxY > existing.minY;
    if (overlaps) {
      return true;
    }
  }
  return false;
}

function estimatePreviewLabelCharUnits(labelValue: string): number {
  let total = 0;
  for (const char of labelValue) {
    total += /[0-9]/.test(char) ? 0.92 : 1.05;
  }
  return Math.max(1, total);
}

function roundSvgNumber(value: number): number {
  return Math.round(value * 100) / 100;
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
    t("empty.stageUnavailable", { stage: stageEntry.label }),
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
    empty.textContent = t("error.stageCanvasUnavailable");
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
      return { canvas: elements.quantizedCanvas, empty: elements.quantizedEmpty, label: getStageLabel("quantized") };
    case "reduction":
      return { canvas: elements.reductionCanvas, empty: elements.reductionEmpty, label: getStageLabel("reduction") };
    case "borderPath":
      return { canvas: elements.borderPathCanvas, empty: elements.borderPathEmpty, label: getStageLabel("borderPath") };
    case "borderSegmentation":
      return { canvas: elements.borderSegmentationCanvas, empty: elements.borderSegmentationEmpty, label: getStageLabel("borderSegmentation") };
    case "labelPlacement":
      return { canvas: elements.labelPlacementCanvas, empty: elements.labelPlacementEmpty, label: getStageLabel("labelPlacement") };
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

function getStageLabel(stage: StageKey): string {
  switch (stage) {
    case "quantized":
      return t("stage.tab.quantized");
    case "reduction":
      return t("stage.tab.reduction");
    case "borderPath":
      return t("stage.tab.borderPath");
    case "borderSegmentation":
      return t("stage.tab.borderSegmentation");
    case "labelPlacement":
      return t("stage.tab.labelPlacement");
    case "output":
      return t("stage.tab.output");
  }
}

function getProgressStageLabel(stage: WorkerProgressStage): string {
  switch (stage) {
    case "init":
      return t("stage.progress.init");
    case "decode":
      return t("stage.progress.decode");
    case "quantize":
      return t("stage.progress.quantize");
    case "reduction":
      return t("stage.progress.reduction");
    case "contours":
      return t("stage.progress.contours");
    case "labels":
      return t("stage.progress.labels");
    case "render":
      return t("stage.progress.render");
    case "done":
      return t("stage.progress.done");
  }
}

function getRenderedStageTabLabel(stage: StageKey, progressStage: WorkerProgressStage | null): string {
  const base = getStageLabel(stage);
  const activeStage = getStageKeyForProgressStage(progressStage);
  if (progressStage === "done" && stage === "output") {
    return `${base} · ${t("stage.state.done")}`;
  }
  if (activeStage && progressStage !== "done" && stage === activeStage) {
    return `${base} · ${t("stage.state.running")}`;
  }
  return base;
}

function getStageKeyForProgressStage(stage: WorkerProgressStage | null): StageKey | null {
  switch (stage) {
    case "quantize":
      return "quantized";
    case "reduction":
      return "reduction";
    case "contours":
      return "borderPath";
    case "labels":
      return "labelPlacement";
    case "render":
    case "done":
      return "output";
    default:
      return null;
  }
}

function refreshStageTabs(elements: DemoElements): void {
  for (const tab of elements.stageTabs) {
    const stage = tab.dataset.stageTab as StageKey | undefined;
    if (!stage) {
      continue;
    }
    tab.textContent = getRenderedStageTabLabel(stage, state.currentProgressStage);
  }
}

function updateProgressUi(stage: WorkerProgressStage, _label: string): void {
  state.currentProgressStage = stage;
  state.statusMessage = {
    key: "status.processingStage",
    params: { label: getProgressStageLabel(stage) },
    isError: false,
  };
  const statusElement = document.querySelector<HTMLElement>("#status");
  if (statusElement) {
    statusElement.textContent = t(state.statusMessage.key, state.statusMessage.params);
    statusElement.dataset.state = "normal";
  }

  document.querySelectorAll<HTMLButtonElement>("[data-stage-tab]").forEach((tab) => {
    const tabStage = tab.dataset.stageTab as StageKey | undefined;
    if (!tabStage) {
      return;
    }
    tab.textContent = getRenderedStageTabLabel(tabStage, state.currentProgressStage);
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
    logger.warn(t("log.noSvgToDownload"));
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
    logger.warn(t("log.noPngToDownload"));
    return;
  }

  const parser = new DOMParser();
  const documentNode = parser.parseFromString(state.lastPreviewSvg, "image/svg+xml");
  const root = documentNode.documentElement;
  const width = toPositiveNumber(root.getAttribute("width") ?? "0", 0);
  const height = toPositiveNumber(root.getAttribute("height") ?? "0", 0);
  if (width <= 0 || height <= 0) {
    throw new Error(t("log.invalidSvgSize"));
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
      throw new Error(t("log.pngContextUnavailable"));
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
  elements.generateButton.textContent = busy ? t("action.processing") : t("action.generate");
  syncDownloadState(elements);
}

function syncDownloadState(elements: DemoElements): void {
  const enabled = Boolean(state.lastPreviewSvg) && !state.busy;
  elements.downloadSvgButton.disabled = !enabled;
  elements.downloadPngButton.disabled = !enabled;
}

function setStatusKey(
  elements: DemoElements,
  key: I18nKey,
  params?: Record<string, string | number>,
  isError = false,
): void {
  state.statusMessage = { key, params, isError };
  renderStatusText(elements, t(key, params), isError);
}

function renderStatusText(elements: DemoElements, message: string, isError = false): void {
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
  const timingLines = Object.entries(stageTimings).map(([key, value]) => `${getStageTimingLabel(key)}: ${value} ${t("summary.unit.ms")}`);
  const statsLines = Object.entries(pipelineStats).map(([key, value]) => `${getPipelineStatLabel(key)}: ${value}`);
  const optionLines = [
    `${t("summary.option.resizeEnabled")}: ${formatBooleanValue(options.resize?.enabled ?? false)}`,
    `${t("summary.option.resizeMaxWidth")}: ${String(options.resize?.maxWidth ?? 1024)}`,
    `${t("summary.option.resizeMaxHeight")}: ${String(options.resize?.maxHeight ?? 1024)}`,
    `${t("summary.option.kmeansClusters")}: ${String(options.kmeansClusters ?? 16)}`,
    `${t("summary.option.kmeansMinDelta")}: ${String(options.kmeansMinDelta ?? 1)}`,
    `${t("summary.option.kmeansColorSpaceRequested")}: ${formatColorSpaceValue(options.kmeansColorSpace ?? "rgb")}`,
    `${t("summary.option.kmeansColorSpaceEffective")}: ${options.kmeansColorSpace === "rgb" || !options.kmeansColorSpace ? t("summary.value.rgb") : t("summary.value.rgbFallback")}`,
    `${t("summary.option.colorRestrictions")}: ${String(options.colorRestrictions?.length ?? 0)}`,
    `${t("summary.option.cleanupRuns")}: ${String(options.narrowPixelCleanupRuns ?? 3)}`,
    `${t("summary.option.removeFacetsSmallerThan")}: ${String(options.removeFacetsSmallerThan ?? 20)}`,
    `${t("summary.option.removeFacetsOrder")}: ${formatBooleanValue(options.removeFacetsFromLargeToSmall ?? true)}`,
    `${t("summary.option.maximumFacets")}: ${String(options.maximumNumberOfFacets ?? 4294967295)}`,
    `${t("summary.option.borderSmoothingPasses")}: ${String(options.borderSmoothingPasses ?? 2)}`,
    `${t("summary.option.previewSizeMultiplier")}: ${String(renderProfile.sizeMultiplier)}`,
    `${t("summary.option.previewShowLabels")}: ${formatBooleanValue(renderProfile.showLabels)}`,
    `${t("summary.option.previewFillFacets")}: ${formatBooleanValue(renderProfile.fillFacets)}`,
    `${t("summary.option.previewShowBorders")}: ${formatBooleanValue(renderProfile.showBorders)}`,
    `${t("summary.option.previewLabelFontSize")}: ${String(renderProfile.labelFontSize)}`,
    `${t("summary.option.previewLabelFontColor")}: ${renderProfile.labelFontColor}`,
  ];
  const previewTimingLines = [
    `${t("summary.timing.decodeImageMs")}: ${timing.decodeImageMs} ${t("summary.unit.ms")}`,
    `${t("summary.timing.sdkGenerateMs")}: ${timing.sdkGenerateMs} ${t("summary.unit.ms")}`,
    `${t("summary.timing.processingMs")}: ${timing.processingMs} ${t("summary.unit.ms")}`,
    `${t("summary.timing.previewBuildMs")}: ${timing.previewBuildMs} ${t("summary.unit.ms")}`,
    `${t("summary.timing.applyShapeProfileMs")}: ${timing.applyShapeProfileMs} ${t("summary.unit.ms")}`,
    `${t("summary.timing.rebuildLabelsMs")}: ${timing.rebuildLabelsMs} ${t("summary.unit.ms")}`,
    `${t("summary.timing.renderDomMs")}: ${timing.renderDomMs} ${t("summary.unit.ms")}`,
    `${t("summary.timing.totalPreviewMs")}: ${roundMs(timing.previewBuildMs + timing.renderDomMs)} ${t("summary.unit.ms")}`,
    `${t("summary.timing.endToEndMs")}: ${timing.endToEndMs} ${t("summary.unit.ms")}`,
  ];

  if (typeof timing.exportSvgMs === "number") {
    previewTimingLines.push(`${t("summary.timing.exportSvgMs")}: ${timing.exportSvgMs} ${t("summary.unit.ms")}`);
  }
  if (typeof timing.exportPngRasterizeMs === "number") {
    previewTimingLines.push(`${t("summary.timing.exportPngRasterizeMs")}: ${timing.exportPngRasterizeMs} ${t("summary.unit.ms")}`);
  }
  if (typeof timing.exportPngEncodeMs === "number") {
    previewTimingLines.push(`${t("summary.timing.exportPngEncodeMs")}: ${timing.exportPngEncodeMs} ${t("summary.unit.ms")}`);
  }
  if (typeof timing.exportPngMs === "number") {
    previewTimingLines.push(`${t("summary.timing.exportPngMs")}: ${timing.exportPngMs} ${t("summary.unit.ms")}`);
  }

  target.innerHTML = [
    `${t("summary.inputSize")}: ${input.width} x ${input.height}`,
    `${t("summary.paletteSize")}: ${result.palette.length}`,
    `${t("summary.facetCount")}: ${result.facetCount}`,
    `${t("summary.svgSize")}: ${result.svg.length} ${t("summary.characters")}`,
    ...optionLines,
    ...previewTimingLines,
    ...timingLines,
    ...statsLines,
  ].map((line) => `<li>${escapeHtml(line)}</li>`).join("");
}

function getStageTimingLabel(key: string): string {
  const translationKey = STAGE_TIMING_LABELS[key];
  return translationKey ? t(translationKey) : humanizeMetricKey(key);
}

function getPipelineStatLabel(key: string): string {
  const translationKey = PIPELINE_STAT_LABELS[key];
  return translationKey ? t(translationKey) : humanizeMetricKey(key);
}

function formatBooleanValue(value: boolean): string {
  return value ? t("summary.value.true") : t("summary.value.false");
}

function formatColorSpaceValue(value: KmeansColorSpace): string {
  switch (value) {
    case "rgb":
      return t("summary.value.rgb");
    case "hsl":
      return "HSL";
    case "lab":
      return "Lab";
  }
}

function humanizeMetricKey(key: string): string {
  return key
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll(/[_-]+/g, " ")
    .trim()
    .replace(/^\w/, (char) => char.toUpperCase());
}

function renderPalette(target: HTMLElement, result: ProcessOutput): void {
  target.innerHTML = result.palette.map((entry) => {
    const color = `rgb(${entry.color[0]}, ${entry.color[1]}, ${entry.color[2]})`;
    const alias = entry.colorAlias ? ` / ${escapeHtml(entry.colorAlias)}` : "";
    return `
      <li class="palette-item">
        <span class="swatch" style="background:${escapeHtml(color)}"></span>
        <span>#${entry.index}${alias}</span>
        <span>${entry.frequency} px &nbsp; ${(entry.areaPercentage * 100).toFixed(2)}%</span>
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
  const targetSize = resolveResizeDimensions(imageBitmap.width, imageBitmap.height, options?.resize);
  const canvas = document.createElement("canvas");
  canvas.width = targetSize.width;
  canvas.height = targetSize.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error(t("log.imageDecodeContextUnavailable"));
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
    image.onerror = () => reject(new Error(t("log.previewPngLoadFailed")));
    image.src = url;
  });
}

async function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error(t("log.canvasExportFailed")));
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
    throw new Error(t("log.missingElement", { selector }));
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
