import type { ResizeSettings } from "./types.js";

export interface ResolvedResizeDimensions {
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  resized: boolean;
}

export function resolveResizeDimensions(
  width: number,
  height: number,
  resize: ResizeSettings = {}
): ResolvedResizeDimensions {
  const enabled = resize.enabled ?? false;
  const maxWidth = resize.maxWidth ?? 1024;
  const maxHeight = resize.maxHeight ?? 1024;

  if (!enabled || width <= 0 || height <= 0 || maxWidth <= 0 || maxHeight <= 0) {
    return {
      width,
      height,
      originalWidth: width,
      originalHeight: height,
      resized: false
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
    resized: resizedWidth !== width || resizedHeight !== height
  };
}
