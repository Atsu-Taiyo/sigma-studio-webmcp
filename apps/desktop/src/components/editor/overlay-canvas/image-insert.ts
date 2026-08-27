export interface ImageInsertionSize {
  w: number;
  h: number;
}

export function fitImageSizeWithinArea(
  naturalSize: ImageInsertionSize,
  areaSize: ImageInsertionSize,
): ImageInsertionSize {
  if (naturalSize.w <= 0 || naturalSize.h <= 0) {
    return { ...naturalSize };
  }

  const widthScale = areaSize.w > 0 ? areaSize.w / naturalSize.w : 1;
  const heightScale = areaSize.h > 0 ? areaSize.h / naturalSize.h : 1;
  const scale = Math.min(1, widthScale, heightScale);
  return {
    w: naturalSize.w * scale,
    h: naturalSize.h * scale,
  };
}

export function fitImageRowToWidth(
  sizes: readonly ImageInsertionSize[],
  maxWidth: number,
  gap: number,
): ImageInsertionSize[] {
  const copiedSizes = sizes.map((size) => ({ ...size }));
  if (copiedSizes.length < 2 || maxWidth <= 0) {
    return copiedSizes;
  }

  const totalImageWidth = copiedSizes.reduce((sum, size) => sum + size.w, 0);
  const availableImageWidth = maxWidth - Math.max(0, gap) * (copiedSizes.length - 1);
  if (totalImageWidth <= 0 || availableImageWidth <= 0 || totalImageWidth <= availableImageWidth) {
    return copiedSizes;
  }

  const scale = availableImageWidth / totalImageWidth;
  return copiedSizes.map((size) => ({
    w: size.w * scale,
    h: size.h * scale,
  }));
}
