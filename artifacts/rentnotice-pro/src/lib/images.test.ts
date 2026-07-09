// Tests for the evidence-photo downscaling utility. Vitest runs in a node
// environment with no real canvas, which is perfect for exercising the
// fail-safe paths; the happy path is exercised with stubbed browser globals.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_PHOTO_EDGE_PX,
  PHOTO_JPEG_QUALITY,
  PHOTO_RECOMPRESS_THRESHOLD_BYTES,
  dataUrlByteSize,
  downscalePhotoDataUrl,
} from "./images";

function jpegDataUrl(payloadBytes: number): string {
  // base64 length for N bytes is ceil(N/3)*4; build a payload of roughly that size.
  const b64len = Math.ceil(payloadBytes / 3) * 4;
  return `data:image/jpeg;base64,${"A".repeat(b64len)}`;
}

type StubShape = { width: number; height: number };

/** Install fake fetch/createImageBitmap/OffscreenCanvas/FileReader globals. */
function stubBrowserImagePipeline(shape: StubShape, recompressedBytes: number) {
  const drawn: Array<{ w: number; h: number }> = [];

  vi.stubGlobal("fetch", vi.fn(async () => ({ blob: async () => ({}) })));
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width: shape.width, height: shape.height, close: vi.fn() })),
  );

  class FakeOffscreenCanvas {
    width: number;
    height: number;
    constructor(w: number, h: number) {
      this.width = w;
      this.height = h;
      drawn.push({ w, h });
    }
    getContext() {
      return { fillRect: vi.fn(), drawImage: vi.fn(), fillStyle: "" };
    }
    async convertToBlob() {
      return { size: recompressedBytes };
    }
  }
  vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);

  class FakeFileReader {
    onload: null | (() => void) = null;
    onerror: null | (() => void) = null;
    result: string | null = null;
    readAsDataURL() {
      this.result = jpegDataUrl(recompressedBytes);
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal("FileReader", FakeFileReader);

  return { drawn };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("dataUrlByteSize", () => {
  it("approximates decoded byte size from base64 length", () => {
    const url = jpegDataUrl(3000);
    expect(dataUrlByteSize(url)).toBeGreaterThanOrEqual(2999);
    expect(dataUrlByteSize(url)).toBeLessThanOrEqual(3001);
  });

  it("returns 0 for strings without a payload", () => {
    expect(dataUrlByteSize("not a data url")).toBe(0);
  });
});

describe("downscalePhotoDataUrl — pass-through and fail-safe", () => {
  it("returns non-image data URLs unchanged", async () => {
    const input = "data:application/pdf;base64,AAAA";
    expect(await downscalePhotoDataUrl(input)).toBe(input);
  });

  it("returns small JPEGs unchanged without decoding", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const input = jpegDataUrl(PHOTO_RECOMPRESS_THRESHOLD_BYTES - 1024);
    expect(await downscalePhotoDataUrl(input)).toBe(input);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns the original when the environment cannot decode images", async () => {
    // Node test env: no fetch-based bitmap pipeline stubbed, no Image, no canvas.
    const input = jpegDataUrl(PHOTO_RECOMPRESS_THRESHOLD_BYTES * 10);
    expect(await downscalePhotoDataUrl(input)).toBe(input);
  });

  it("returns the original when decoding throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ blob: async () => ({}) })));
    vi.stubGlobal("createImageBitmap", vi.fn(async () => {
      throw new Error("corrupt image");
    }));
    const input = jpegDataUrl(PHOTO_RECOMPRESS_THRESHOLD_BYTES * 10);
    expect(await downscalePhotoDataUrl(input)).toBe(input);
  });
});

describe("downscalePhotoDataUrl — recompression", () => {
  it("downscales an oversized photo to the max edge and returns a smaller JPEG", async () => {
    const { drawn } = stubBrowserImagePipeline({ width: 4032, height: 3024 }, 200 * 1024);
    const input = jpegDataUrl(8 * 1024 * 1024); // 8 MB phone photo
    const out = await downscalePhotoDataUrl(input);
    expect(out).not.toBe(input);
    expect(out.startsWith("data:image/jpeg")).toBe(true);
    expect(dataUrlByteSize(out)).toBeLessThan(dataUrlByteSize(input));
    // 4032x3024 scaled so the longest edge is MAX_PHOTO_EDGE_PX.
    expect(drawn[0]).toEqual({ w: MAX_PHOTO_EDGE_PX, h: 1200 });
  });

  it("recompresses an oversized-bytes photo even when already within pixel bounds", async () => {
    const { drawn } = stubBrowserImagePipeline({ width: 1200, height: 900 }, 150 * 1024);
    const input = jpegDataUrl(4 * 1024 * 1024);
    const out = await downscalePhotoDataUrl(input);
    expect(out).not.toBe(input);
    expect(drawn[0]).toEqual({ w: 1200, h: 900 }); // no upscale, same dimensions
  });

  it("converts oversized PNGs to JPEG", async () => {
    stubBrowserImagePipeline({ width: 3000, height: 2000 }, 180 * 1024);
    const png = `data:image/png;base64,${"B".repeat(4 * 1024 * 1024)}`;
    const out = await downscalePhotoDataUrl(png);
    expect(out.startsWith("data:image/jpeg")).toBe(true);
  });

  it("keeps the original when recompression would be larger", async () => {
    // Recompressed output bigger than the input payload.
    stubBrowserImagePipeline({ width: 2000, height: 1500 }, 3 * 1024 * 1024);
    const input = jpegDataUrl(1 * 1024 * 1024);
    expect(await downscalePhotoDataUrl(input)).toBe(input);
  });

  it("honors custom maxEdgePx and quality options", async () => {
    const { drawn } = stubBrowserImagePipeline({ width: 4000, height: 4000 }, 100 * 1024);
    const input = jpegDataUrl(6 * 1024 * 1024);
    await downscalePhotoDataUrl(input, { maxEdgePx: 800, quality: PHOTO_JPEG_QUALITY });
    expect(drawn[0]).toEqual({ w: 800, h: 800 });
  });
});
