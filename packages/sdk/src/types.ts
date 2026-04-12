export type LogLevel = "error" | "warn" | "info" | "debug" | "trace";
export type KmeansColorSpace = "rgb" | "hsl" | "lab";

export interface ResizeSettings {
  enabled?: boolean;
  maxWidth?: number;
  maxHeight?: number;
}

export interface GenerateOptions {
  randomSeed?: number;
  kmeansClusters?: number;
  kmeansMinDelta?: number;
  kmeansColorSpace?: KmeansColorSpace;
  colorRestrictions?: Array<[number, number, number]>;
  colorAliases?: Record<string, [number, number, number]>;
  narrowPixelCleanupRuns?: number;
  removeFacetsSmallerThan?: number;
  removeFacetsFromLargeToSmall?: boolean;
  maximumNumberOfFacets?: number;
  borderSmoothingPasses?: number;
  showLabels?: boolean;
  showBorders?: boolean;
  fillFacets?: boolean;
  logLevel?: LogLevel;
  debugFlags?: string[];
  resize?: ResizeSettings;
}

export interface RgbaInput {
  width: number;
  height: number;
  rgba: Uint8Array;
}

export interface LabelBounds {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

export interface PaletteEntry {
  index: number;
  color: [number, number, number];
  colorAlias?: string;
  frequency: number;
  areaPercentage: number;
}

export interface FacetSummary {
  id: number;
  colorIndex: number;
  pointCount: number;
  bboxMinX: number;
  bboxMinY: number;
  bboxMaxX: number;
  bboxMaxY: number;
  neighbourFacets: number[];
}

export interface ProcessOutput {
  palette: PaletteEntry[];
  svg: string;
  facetCount: number;
  labelBounds: LabelBounds[];
  facetsSummary: FacetSummary[];
  debug?: {
    quantizedRgba: Uint8Array;
    facetMap: Uint32Array;
    reductionRgba?: Uint8Array;
    borderPathRgba?: Uint8Array;
    borderSegmentationRgba?: Uint8Array;
    labelPlacementRgba?: Uint8Array;
  };
  metrics?: {
    stageTimings?: Record<string, number>;
    pipelineStats?: Record<string, number>;
  };
}

export interface WasmInitOptions {
  /** 可显式传入 wasm URL、ArrayBuffer 或 Response。 */
  source?: URL | RequestInfo | ArrayBuffer | Uint8Array;
  /** 是否显式开启 Wasm 内部日志桥接。 */
  enableWasmLogging?: boolean;
}
