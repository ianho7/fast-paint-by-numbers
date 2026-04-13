export type Locale = "en" | "zh-CN";

type Params = Record<string, string | number>;
type TranslationValue = string | ((params: Params) => string);

const STORAGE_KEY = "pbn-web-demo.locale";

const en = {
  "page.title": "Fast Paint By Numbers Web Demo",
  "page.heading": "Fast Paint By Numbers",
  "locale.en": "EN",
  "locale.zh-CN": "中文",
  "form.input.title": "Input Image",
  "form.input.help": "Upload a local image to start processing.",
  "form.input.label": "Input Image",
  "form.resize.title": "Resize",
  "form.resize.help": "Scale down images exceeding limits while maintaining aspect ratio.",
  "form.resize.enabled": "Resize image larger than",
  "form.resize.width": "Max Width",
  "form.resize.height": "Max Height",
  "form.kmeans.title": "K-Means",
  "form.kmeans.colors": "Number of colors",
  "form.kmeans.precision": "Cluster precision",
  "form.kmeans.seed": "Random seed",
  "form.colorSpace.title": "Color Space",
  "form.colorRestrictions.title": "Color Restrictions",
  "form.colorRestrictions.help": "Specify which colors should be used, one per line in 'r,g,b' format. Use // as comment. If no colors are specified no restrictions are applied.",
  "form.colorRestrictions.label": "Restrict clustering colors",
  "form.facetReduction.title": "Facet Reduction",
  "form.facetReduction.cleanupRuns": "Narrow pixel cleanup runs",
  "form.facetReduction.removeSmallerThan": "Remove small facets smaller than",
  "form.facetReduction.maximum": "Maximum number of facets",
  "form.facetReduction.order": "Small facet removal order",
  "form.facetReduction.order.largeToSmall": "Largest to smallest",
  "form.facetReduction.order.smallToLarge": "Smallest to largest",
  "form.border.title": "Border",
  "form.border.smoothing": "Amount of times to halve border segment complexity",
  "form.output.title": "Output",
  "form.output.help": "Applies to browser preview only.",
  "form.output.sizeMultiplier": "Size multiplier",
  "form.output.labelFontSize": "Label font size",
  "form.output.labelFontColor": "Label font color",
  "form.output.showLabels": "Show labels",
  "form.output.fillFacets": "Fill facets",
  "form.output.showBorders": "Show borders",
  "action.generate": "Generate",
  "action.processing": "Processing...",
  "action.downloadSvg": "Download SVG",
  "action.downloadPng": "Download PNG",
  "preview.title": "Preview",
  "preview.stageTabsLabel": "Processing stages",
  "summary.title": "Summary",
  "palette.title": "Palette",
  "logs.title": "Logs",
  "empty.waitingForInput": "Waiting for input image",
  "empty.stageUnavailable": ({ stage }: Params) => `${stage} not available`,
  "error.stageCanvasUnavailable": "Unable to create the stage preview canvas",
  "status.initializing": "Initializing Wasm worker...",
  "status.ready": "Wasm worker is ready, you can upload an image to start processing.",
  "status.initFailed": "Wasm worker initialization failed. Check the console or logs for details.",
  "status.runtimeNotReady": "Wasm runtime is not ready. Please wait.",
  "status.selectInput": "Please select an image to start.",
  "status.selectedSample": ({ name }: Params) => `Selected sample: ${name}`,
  "status.readingInput": "Reading image and calling Wasm SDK...",
  "status.processingCompleted": "Processing completed. Results updated.",
  "status.processingFailed": "Processing failed. Please check the logs.",
  "status.smokeFailed": "Smoke run failed. Check log panel.",
  "status.processingStage": ({ label }: Params) => `Processing: ${label}`,
  "status.failedToLoadSample": ({ sample }: Params) => `Failed to load sample image: ${sample}`,
  "stage.tab.quantized": "Quantized image",
  "stage.tab.reduction": "Facet reduction",
  "stage.tab.borderPath": "Border tracing",
  "stage.tab.borderSegmentation": "Border segmentation",
  "stage.tab.labelPlacement": "Label placement",
  "stage.tab.output": "Output",
  "stage.state.running": "running",
  "stage.state.done": "done",
  "stage.progress.init": "Initializing Wasm worker",
  "stage.progress.decode": "Preparing input",
  "stage.progress.quantize": "Quantizing image",
  "stage.progress.reduction": "Reducing facets",
  "stage.progress.contours": "Tracing borders",
  "stage.progress.labels": "Placing labels",
  "stage.progress.render": "Building output",
  "stage.progress.done": "Finishing",
  "summary.inputSize": "Input size",
  "summary.paletteSize": "Palette size",
  "summary.facetCount": "Facet count",
  "summary.svgSize": "SVG size",
  "summary.characters": "characters",
  "summary.option.resizeEnabled": "Resize enabled",
  "summary.option.resizeMaxWidth": "Resize max width",
  "summary.option.resizeMaxHeight": "Resize max height",
  "summary.option.kmeansClusters": "K-Means clusters",
  "summary.option.kmeansMinDelta": "K-Means minimum delta",
  "summary.option.kmeansColorSpaceRequested": "Color space requested",
  "summary.option.kmeansColorSpaceEffective": "Color space effective",
  "summary.option.colorRestrictions": "Color restrictions",
  "summary.option.cleanupRuns": "Narrow pixel cleanup runs",
  "summary.option.removeFacetsSmallerThan": "Remove facets smaller than",
  "summary.option.removeFacetsOrder": "Remove facets from large to small",
  "summary.option.maximumFacets": "Maximum number of facets",
  "summary.option.borderSmoothingPasses": "Border smoothing passes",
  "summary.option.previewSizeMultiplier": "Preview size multiplier",
  "summary.option.previewShowLabels": "Preview show labels",
  "summary.option.previewFillFacets": "Preview fill facets",
  "summary.option.previewShowBorders": "Preview show borders",
  "summary.option.previewLabelFontSize": "Preview label font size",
  "summary.option.previewLabelFontColor": "Preview label font color",
  "summary.timing.decodeImageMs": "Decode image",
  "summary.timing.sdkGenerateMs": "SDK generate",
  "summary.timing.processingMs": "Pipeline processing",
  "summary.timing.previewBuildMs": "Preview build",
  "summary.timing.applyShapeProfileMs": "Preview apply shape profile",
  "summary.timing.rebuildLabelsMs": "Preview rebuild labels",
  "summary.timing.renderDomMs": "Preview render DOM",
  "summary.timing.totalPreviewMs": "Total preview",
  "summary.timing.endToEndMs": "End-to-end",
  "summary.timing.exportSvgMs": "Export SVG",
  "summary.timing.exportPngRasterizeMs": "Export PNG rasterize",
  "summary.timing.exportPngEncodeMs": "Export PNG encode",
  "summary.timing.exportPngMs": "Export PNG total",
  "summary.pipeline.quantize": "Pipeline quantize",
  "summary.pipeline.cleanup": "Pipeline cleanup",
  "summary.pipeline.regions": "Pipeline regions",
  "summary.pipeline.reduction": "Pipeline reduction",
  "summary.pipeline.contours": "Pipeline contours",
  "summary.pipeline.labels": "Pipeline labels",
  "summary.pipeline.render": "Pipeline render",
  "summary.pipeline.total": "Pipeline total",
  "summary.stat.originalUniqueColors": "Original unique colors",
  "summary.stat.quantizedPaletteSize": "Quantized palette size",
  "summary.stat.quantizeIterations": "Quantize iterations",
  "summary.stat.quantizeSampleColors": "Quantize sample colors",
  "summary.stat.facetsBeforeReduction": "Facets before reduction",
  "summary.stat.facetsAfterReduction": "Facets after reduction",
  "summary.stat.removedFacets": "Removed facets",
  "summary.stat.reductionRounds": "Reduction rounds",
  "summary.stat.maxFacetsSeenDuringReduction": "Max facets seen during reduction",
  "summary.stat.reductionFastPathFacets": "Reduction fast-path facets",
  "summary.stat.reductionBfsFacets": "Reduction BFS facets",
  "summary.stat.narrowCleanupReplacedPixels": "Narrow cleanup replaced pixels",
  "summary.stat.contourTracedPathPoints": "Contour traced path points",
  "summary.stat.contourRawSegments": "Contour raw segments",
  "summary.stat.contourSharedSegments": "Contour shared segments",
  "summary.stat.contourReverseSegments": "Contour reverse segments",
  "summary.value.rgb": "RGB",
  "summary.value.rgbFallback": "RGB (fallback)",
  "summary.value.true": "true",
  "summary.value.false": "false",
  "summary.unit.ms": "ms",
  "log.colorRestrictionsInvalidFormat": ({ line }: Params) => `Color restriction line ${line} must be in r,g,b format`,
  "log.colorRestrictionsInvalidRange": ({ line }: Params) => `Color restriction line ${line} must contain integers between 0 and 255`,
  "log.workerFailed": "Worker execution failed",
  "log.workerRuntimeFailed": "Worker runtime failed",
  "log.workerUnexpectedMessage": ({ type }: Params) => `Worker returned an unexpected message: ${type}`,
  "log.noSvgToDownload": "No SVG preview is available to download",
  "log.noPngToDownload": "No PNG preview is available to download",
  "log.invalidSvgSize": "The current preview SVG has no valid size and cannot be exported as PNG",
  "log.pngContextUnavailable": "Unable to create a canvas context for PNG export",
  "log.imageDecodeContextUnavailable": "Unable to create a 2D canvas context",
  "log.previewPngLoadFailed": "Unable to build a PNG image from the current SVG preview",
  "log.canvasExportFailed": "Canvas export failed because no binary data was produced",
  "log.missingElement": ({ selector }: Params) => `Missing required page element: ${selector}`,
  "log.sampleFetchFailed": ({ sample, status, statusText }: Params) => `Failed to load sample image: ${sample} (HTTP ${status} ${statusText})`,
  "log.sampleNetworkFailed": ({ sample, message }: Params) => `Network request failed: ${sample} - ${message}`,
} satisfies Record<string, TranslationValue>;

const zhCN: typeof en = {
  "page.title": "Fast Paint By Numbers 网页版演示",
  "page.heading": "Fast Paint By Numbers",
  "locale.en": "EN",
  "locale.zh-CN": "中文",
  "form.input.title": "上传图片",
  "form.input.help": "请上传一张本地图片以开始制作",
  "form.input.label": "选择图片",
  "form.resize.title": "尺寸调整",
  "form.resize.help": "若图片超过限制，将按原比例自动缩小以保证处理速度",
  "form.resize.enabled": "当图片超过以下尺寸时进行缩放",
  "form.resize.width": "最大宽度",
  "form.resize.height": "Max Height", // 英文原版也是 Height，建议保持
  "form.kmeans.title": "颜色聚类 (K-Means)",
  "form.kmeans.colors": "预设颜色数量",
  "form.kmeans.precision": "聚类精度",
  "form.kmeans.seed": "随机种子",
  "form.colorSpace.title": "色彩空间",
  "form.colorRestrictions.title": "指定调色盘",
  "form.colorRestrictions.help": "每行输入一个颜色（格式为 'r,g,b'），限定程序只使用这些颜色。使用 // 进行注释。留空则自动提取颜色",
  "form.colorRestrictions.label": "限制提取的颜色",
  "form.facetReduction.title": "色块优化",
  "form.facetReduction.cleanupRuns": "边缘杂点清理次数",
  "form.facetReduction.removeSmallerThan": "移除面积过小的色块",
  "form.facetReduction.maximum": "最大色块数量",
  "form.facetReduction.order": "小色块移除顺序",
  "form.facetReduction.order.largeToSmall": "由大到小",
  "form.facetReduction.order.smallToLarge": "由小到大",
  "form.border.title": "线条设置",
  "form.border.smoothing": "线条平滑度 (数值越高线条越简洁)",
  "form.output.title": "输出设置",
  "form.output.help": "仅影响页面内的预览效果",
  "form.output.sizeMultiplier": "缩放倍率",
  "form.output.labelFontSize": "数字标注大小",
  "form.output.labelFontColor": "数字标注颜色",
  "form.output.showLabels": "显示数字标注",
  "form.output.fillFacets": "填充颜色",
  "form.output.showBorders": "显示轮廓",
  "action.generate": "开始生成",
  "action.processing": "正在处理...",
  "action.downloadSvg": "下载 SVG 矢量图",
  "action.downloadPng": "下载 PNG 图片",
  "preview.title": "预览",
  "preview.stageTabsLabel": "处理进度",
  "summary.title": "结果摘要",
  "palette.title": "色板",
  "logs.title": "运行日志",
  "empty.waitingForInput": "请先上传一张图片",
  "empty.stageUnavailable": ({ stage }: Params) => `当前无法查看 ${stage}`,
  "error.stageCanvasUnavailable": "无法创建预览画布",
  "status.initializing": "正在初始化计算引擎...",
  "status.ready": "已就绪，请上传图片开始制作",
  "status.initFailed": "计算引擎初始化失败，请查看控制台或日志",
  "status.runtimeNotReady": "运行时环境准备中，请稍候...",
  "status.selectInput": "请选择图片以开始",
  "status.selectedSample": ({ name }: Params) => `已选择示例：${name}`,
  "status.readingInput": "正在读取图像并分析...",
  "status.processingCompleted": "处理完成！",
  "status.processingFailed": "处理失败，请检查运行日志",
  "status.smokeFailed": "冒烟测试失败，请查看日志面板",
  "status.processingStage": ({ label }: Params) => `正在进行：${label}`,
  "status.failedToLoadSample": ({ sample }: Params) => `无法加载示例图：${sample}`,
  "stage.tab.quantized": "色彩量化",
  "stage.tab.reduction": "色块简化",
  "stage.tab.borderPath": "轮廓提取",
  "stage.tab.borderSegmentation": "线条分割",
  "stage.tab.labelPlacement": "标注生成",
  "stage.tab.output": "最终成品",
  "stage.state.running": "处理中",
  "stage.state.done": "完成",
  "stage.progress.init": "初始化引擎",
  "stage.progress.decode": "图像预处理",
  "stage.progress.quantize": "色彩量化中",
  "stage.progress.reduction": "色块优化中",
  "stage.progress.contours": "提取轮廓中",
  "stage.progress.labels": "生成数字标注",
  "stage.progress.render": "渲染最终效果",
  "stage.progress.done": "制作完成",
  "summary.inputSize": "原图尺寸",
  "summary.paletteSize": "所用颜色数",
  "summary.facetCount": "色块总数",
  "summary.svgSize": "SVG 文件大小",
  "summary.characters": "字符",
  "summary.option.resizeEnabled": "已启用缩放",
  "summary.option.resizeMaxWidth": "最大宽度限制",
  "summary.option.resizeMaxHeight": "最大高度限制",
  "summary.option.kmeansClusters": "K-Means 聚类数",
  "summary.option.kmeansMinDelta": "最小容差",
  "summary.option.kmeansColorSpaceRequested": "请求色彩空间",
  "summary.option.kmeansColorSpaceEffective": "实际色彩空间",
  "summary.option.colorRestrictions": "颜色限定数",
  "summary.option.cleanupRuns": "边缘清理次数",
  "summary.option.removeFacetsSmallerThan": "移除微小色块阈值",
  "summary.option.removeFacetsOrder": "按面积从大到小移除",
  "summary.option.maximumFacets": "色块数量限制",
  "summary.option.borderSmoothingPasses": "线条平滑次数",
  "summary.option.previewSizeMultiplier": "预览倍率",
  "summary.option.previewShowLabels": "显示数字标注",
  "summary.option.previewFillFacets": "填充背景色",
  "summary.option.previewShowBorders": "显示轮廓",
  "summary.option.previewLabelFontSize": "标注字号",
  "summary.option.previewLabelFontColor": "标注颜色",
  "summary.timing.decodeImageMs": "图像解码耗时",
  "summary.timing.sdkGenerateMs": "核心生成耗时",
  "summary.timing.processingMs": "管道处理耗时",
  "summary.timing.previewBuildMs": "构建预览耗时",
  "summary.timing.applyShapeProfileMs": "应用外观配置",
  "summary.timing.rebuildLabelsMs": "标注重新生成",
  "summary.timing.renderDomMs": "DOM 渲染耗时",
  "summary.timing.totalPreviewMs": "预览总耗时",
  "summary.timing.endToEndMs": "总耗时 (端到端)",
  "summary.timing.exportSvgMs": "导出 SVG 耗时",
  "summary.timing.exportPngRasterizeMs": "PNG 栅格化耗时",
  "summary.timing.exportPngEncodeMs": "PNG 编码耗时",
  "summary.timing.exportPngMs": "PNG 导出总耗时",
  "summary.pipeline.quantize": "量化阶段耗时",
  "summary.pipeline.cleanup": "清理阶段耗时",
  "summary.pipeline.regions": "区域构建阶段耗时",
  "summary.pipeline.reduction": "色块优化阶段耗时",
  "summary.pipeline.contours": "轮廓提取阶段耗时",
  "summary.pipeline.labels": "标注生成阶段耗时",
  "summary.pipeline.render": "渲染阶段耗时",
  "summary.pipeline.total": "管道总耗时",
  "summary.stat.originalUniqueColors": "原图唯一颜色数",
  "summary.stat.quantizedPaletteSize": "量化后调色板大小",
  "summary.stat.quantizeIterations": "量化迭代次数",
  "summary.stat.quantizeSampleColors": "量化采样颜色数",
  "summary.stat.facetsBeforeReduction": "优化前色块数",
  "summary.stat.facetsAfterReduction": "优化后色块数",
  "summary.stat.removedFacets": "移除的色块数",
  "summary.stat.reductionRounds": "优化轮次",
  "summary.stat.maxFacetsSeenDuringReduction": "优化过程中的最大色块数",
  "summary.stat.reductionFastPathFacets": "快速路径处理色块数",
  "summary.stat.reductionBfsFacets": "BFS 处理色块数",
  "summary.stat.narrowCleanupReplacedPixels": "窄像素清理替换数",
  "summary.stat.contourTracedPathPoints": "轮廓追踪路径点数",
  "summary.stat.contourRawSegments": "原始轮廓线段数",
  "summary.stat.contourSharedSegments": "共享轮廓线段数",
  "summary.stat.contourReverseSegments": "反向轮廓线段数",
  "summary.value.rgb": "RGB",
  "summary.value.rgbFallback": "RGB（回退）",
  "summary.value.true": "是",
  "summary.value.false": "否",
  "summary.unit.ms": "毫秒",
  "log.colorRestrictionsInvalidFormat": ({ line }: Params) => `颜色限制第 ${line} 行格式错误，应为 r,g,b`,
  "log.colorRestrictionsInvalidRange": ({ line }: Params) => `颜色限制第 ${line} 行数值超出范围 (须为 0-255)`,
  "log.workerFailed": "Worker 任务执行失败",
  "log.workerRuntimeFailed": "运行环境异常",
  "log.workerUnexpectedMessage": ({ type }: Params) => `Worker 异常消息：${type}`,
  "log.noSvgToDownload": "暂无导出的预览结果",
  "log.noPngToDownload": "暂无导出的 PNG 预览",
  "log.invalidSvgSize": "SVG 尺寸异常，无法导出 PNG",
  "log.pngContextUnavailable": "Canvas 环境异常，无法导出 PNG",
  "log.imageDecodeContextUnavailable": "无法获取 2D 画布上下文",
  "log.previewPngLoadFailed": "无法从预览图生成 PNG",
  "log.canvasExportFailed": "导出失败：未捕获到二进制数据",
  "log.missingElement": ({ selector }: Params) => `页面元素缺失：${selector}`,
  "log.sampleFetchFailed": ({ sample, status, statusText }: Params) => `示例图加载失败：${sample} (${status} ${statusText})`,
  "log.sampleNetworkFailed": ({ sample, message }: Params) => `网络请求出错：${sample} - ${message}`,
};

const messages = {
  en,
  "zh-CN": zhCN,
};

export type I18nKey = keyof typeof en;

let currentLocale: Locale = detectLocale();

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: Locale): void {
  currentLocale = locale;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, locale);
  }
  syncDocumentLocale();
}

export function t(key: I18nKey, params: Params = {}): string {
  const value = messages[currentLocale][key];
  return typeof value === "function" ? value(params) : value;
}

export function applyStaticTranslations(root: ParentNode = document): void {
  if (typeof document === "undefined") {
    return;
  }
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => {
    const key = element.dataset.i18n as I18nKey | undefined;
    if (!key) {
      return;
    }
    element.textContent = t(key);
  });

  root.querySelectorAll<HTMLElement>("[data-i18n-aria-label]").forEach((element) => {
    const key = element.dataset.i18nAriaLabel as I18nKey | undefined;
    if (!key) {
      return;
    }
    element.setAttribute("aria-label", t(key));
  });

  syncDocumentLocale();
}

function syncDocumentLocale(): void {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.lang = currentLocale;
  document.title = t("page.title");
}

function detectLocale(): Locale {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return "en";
  }
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "en" || stored === "zh-CN") {
    return stored;
  }

  const languages = navigator.languages.length > 0 ? navigator.languages : [navigator.language];
  return languages.some((value) => value.toLowerCase().startsWith("zh")) ? "zh-CN" : "en";
}
