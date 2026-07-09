// ---------------------------------------------------------------------------
// Photo downscaling for field evidence.
//
// Evidence photos are stored as base64 data URLs and embedded verbatim into
// PDF packets. Real phone photos can be 5–12 MB JPEGs; ingesting them raw
// bloats the local database, produces enormous notice packets, and stalls the
// main thread during base64 decode. This module recompresses any oversized
// photo down to a bounded size (max edge 1600 px, JPEG quality 0.8) using
// async image decoding (createImageBitmap) so the UI stays responsive.
//
// Fail-safe by design: if the image cannot be decoded or the environment has
// no canvas support, the ORIGINAL data URL is returned unchanged — evidence
// must never be lost to an optimization step.
// ---------------------------------------------------------------------------

/** Longest edge, in pixels, an evidence photo is allowed to keep. */
export const MAX_PHOTO_EDGE_PX = 1600;

/** JPEG quality used when recompressing. */
export const PHOTO_JPEG_QUALITY = 0.8;

/**
 * Photos whose payload is at or below this many bytes AND within the pixel
 * bounds are kept as-is (recompressing them would gain little or nothing).
 */
export const PHOTO_RECOMPRESS_THRESHOLD_BYTES = 700 * 1024;

/** Approximate decoded byte size of a base64 data URL payload. */
export function dataUrlByteSize(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return 0;
  const payload = dataUrl.length - comma - 1;
  return Math.floor((payload * 3) / 4);
}

function isImageDataUrl(dataUrl: string): boolean {
  return /^data:image\//i.test(dataUrl.trim());
}

function isJpegDataUrl(dataUrl: string): boolean {
  return /^data:image\/jpe?g[;,]/i.test(dataUrl.trim());
}

type Decoded = {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
};

async function decodeImage(dataUrl: string): Promise<Decoded> {
  // Preferred path: async decode off the main thread.
  if (typeof createImageBitmap === "function" && typeof fetch === "function") {
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    };
  }
  // Fallback: HTMLImageElement decode.
  if (typeof Image === "undefined") {
    throw new Error("No image decoding support in this environment");
  }
  const img = new Image();
  img.decoding = "async";
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Image failed to decode"));
    img.src = dataUrl;
  });
  if (!img.naturalWidth || !img.naturalHeight) {
    throw new Error("Image decoded to zero dimensions");
  }
  return {
    source: img,
    width: img.naturalWidth,
    height: img.naturalHeight,
    close: () => {},
  };
}

async function renderToJpegDataUrl(
  decoded: Decoded,
  targetW: number,
  targetH: number,
  quality: number,
): Promise<string> {
  // Prefer OffscreenCanvas (no DOM churn); fall back to a detached <canvas>.
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(targetW, targetH);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not acquire 2D canvas context");
    ctx.fillStyle = "#ffffff"; // flatten any transparency onto white
    ctx.fillRect(0, 0, targetW, targetH);
    ctx.drawImage(decoded.source, 0, 0, targetW, targetH);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Failed to read recompressed image"));
      reader.readAsDataURL(blob);
    });
  }
  if (typeof document === "undefined") {
    throw new Error("No canvas support in this environment");
  }
  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not acquire 2D canvas context");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, targetW, targetH);
  ctx.drawImage(decoded.source, 0, 0, targetW, targetH);
  return canvas.toDataURL("image/jpeg", quality);
}

export interface DownscaleOptions {
  /** Longest allowed edge in pixels. Defaults to MAX_PHOTO_EDGE_PX. */
  maxEdgePx?: number;
  /** JPEG quality (0–1). Defaults to PHOTO_JPEG_QUALITY. */
  quality?: number;
  /**
   * Byte threshold under which an already-within-bounds photo is left
   * untouched. Defaults to PHOTO_RECOMPRESS_THRESHOLD_BYTES.
   */
  recompressThresholdBytes?: number;
}

/**
 * Downscale/recompress a photo data URL so it stays within bounded pixel and
 * byte sizes. Returns the original string unchanged when:
 *  - it is not an image data URL,
 *  - it is already a JPEG within the pixel bounds and under the byte
 *    threshold,
 *  - recompression would produce a LARGER payload, or
 *  - anything at all goes wrong (decode failure, no canvas, etc.).
 */
export async function downscalePhotoDataUrl(
  dataUrl: string,
  options?: DownscaleOptions,
): Promise<string> {
  const maxEdge = options?.maxEdgePx ?? MAX_PHOTO_EDGE_PX;
  const quality = options?.quality ?? PHOTO_JPEG_QUALITY;
  const threshold = options?.recompressThresholdBytes ?? PHOTO_RECOMPRESS_THRESHOLD_BYTES;

  try {
    if (!isImageDataUrl(dataUrl)) return dataUrl;

    const bytes = dataUrlByteSize(dataUrl);
    // Cheap short-circuit: small JPEGs are almost certainly within pixel
    // bounds too (a >1600px JPEG under the threshold is fine to keep anyway).
    if (isJpegDataUrl(dataUrl) && bytes <= threshold) return dataUrl;

    const decoded = await decodeImage(dataUrl);
    try {
      const { width, height } = decoded;
      const withinBounds = width <= maxEdge && height <= maxEdge;
      if (withinBounds && bytes <= threshold && isJpegDataUrl(dataUrl)) {
        return dataUrl;
      }
      const scale = withinBounds ? 1 : Math.min(maxEdge / width, maxEdge / height);
      const targetW = Math.max(1, Math.round(width * scale));
      const targetH = Math.max(1, Math.round(height * scale));
      const result = await renderToJpegDataUrl(decoded, targetW, targetH, quality);
      // Never make things worse.
      if (!result.startsWith("data:image/") || dataUrlByteSize(result) >= bytes) {
        return dataUrl;
      }
      return result;
    } finally {
      decoded.close();
    }
  } catch {
    return dataUrl; // fail-safe: keep the original evidence untouched
  }
}
