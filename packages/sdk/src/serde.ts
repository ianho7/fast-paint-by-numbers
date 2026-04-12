export function snakeToCamelObject<T>(input: unknown): T {
  if (Array.isArray(input)) {
    return input.map((item) => snakeToCamelObject(item)) as T;
  }

  if (input instanceof Uint8Array || input instanceof Uint32Array || input === null || typeof input !== "object") {
    return input as T;
  }

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    const camelKey = key.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
    output[camelKey] = snakeToCamelObject(value);
  }
  return output as T;
}

export function buildRustSettings(options: import("./types.js").GenerateOptions = {}) {
  return {
    random_seed: options.randomSeed ?? 0,
    kmeans_clusters: options.kmeansClusters ?? 16,
    kmeans_min_delta: options.kmeansMinDelta ?? 1,
    kmeans_color_space: options.kmeansColorSpace ?? "rgb",
    color_restrictions: options.colorRestrictions ?? [],
    color_aliases: options.colorAliases ?? {},
    narrow_pixel_cleanup_runs: options.narrowPixelCleanupRuns ?? 3,
    remove_facets_smaller_than: options.removeFacetsSmallerThan ?? 20,
    remove_facets_from_large_to_small: options.removeFacetsFromLargeToSmall ?? true,
    maximum_number_of_facets: options.maximumNumberOfFacets ?? 4294967295,
    border_smoothing_passes: options.borderSmoothingPasses ?? 2,
    resize: {
      enabled: options.resize?.enabled ?? true,
      max_width: options.resize?.maxWidth ?? 1024,
      max_height: options.resize?.maxHeight ?? 1024
    },
    show_labels: options.showLabels ?? false,
    show_borders: options.showBorders ?? false,
    fill_facets: options.fillFacets ?? true,
    log_level: options.logLevel ?? "warn",
    debug_flags: options.debugFlags ?? []
  };
}

function isArrayLike(value: unknown): value is ArrayLike<number> {
  return (
    Array.isArray(value) ||
    value instanceof Uint8Array ||
    value instanceof Uint32Array ||
    (typeof value === "object" && value !== null && "length" in value && typeof (value as any).length === "number")
  );
}

export function normalizeProcessOutput(raw: unknown): import("./types.js").ProcessOutput {
  const output = snakeToCamelObject<import("./types.js").ProcessOutput>(raw);
  if (output.debug) {
    const debug = output.debug;

    // 验证并转换 quantizedRgba
    if (!isArrayLike(debug.quantizedRgba)) {
      throw new Error("Invalid debug.quantizedRgba: expected array-like structure");
    }

    // 验证并转换 facetMap
    if (!isArrayLike(debug.facetMap)) {
      throw new Error("Invalid debug.facetMap: expected array-like structure");
    }

    output.debug = {
      quantizedRgba: new Uint8Array(debug.quantizedRgba as ArrayLike<number>),
      facetMap: new Uint32Array(debug.facetMap as ArrayLike<number>),
      reductionRgba: debug.reductionRgba && isArrayLike(debug.reductionRgba)
        ? new Uint8Array(debug.reductionRgba as ArrayLike<number>)
        : undefined,
      borderPathRgba: debug.borderPathRgba && isArrayLike(debug.borderPathRgba)
        ? new Uint8Array(debug.borderPathRgba as ArrayLike<number>)
        : undefined,
      borderSegmentationRgba: debug.borderSegmentationRgba && isArrayLike(debug.borderSegmentationRgba)
        ? new Uint8Array(debug.borderSegmentationRgba as ArrayLike<number>)
        : undefined,
      labelPlacementRgba: debug.labelPlacementRgba && isArrayLike(debug.labelPlacementRgba)
        ? new Uint8Array(debug.labelPlacementRgba as ArrayLike<number>)
        : undefined
    };
  }
  return output;
}
