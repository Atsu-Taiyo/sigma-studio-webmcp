import { afterEach, describe, expect, it, vi } from "vitest";

import { pickCanvasVideoFormat } from "./canvas-video";

function stubMediaRecorder(supported: readonly string[]): void {
  vi.stubGlobal("MediaRecorder", {
    isTypeSupported: (mimeType: string) => supported.includes(mimeType),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pickCanvasVideoFormat", () => {
  it("prefers MP4/H.264 — the file a teacher can drop straight into slides", () => {
    stubMediaRecorder(["video/mp4;codecs=avc1.42E01E", "video/webm;codecs=vp9"]);

    expect(pickCanvasVideoFormat()).toEqual({
      mimeType: "video/mp4;codecs=avc1.42E01E",
      extension: "mp4",
    });
  });

  it("falls back to WebM, and reports the extension that goes with it", () => {
    stubMediaRecorder(["video/webm;codecs=vp9", "video/webm"]);

    expect(pickCanvasVideoFormat()).toEqual({ mimeType: "video/webm;codecs=vp9", extension: "webm" });
  });

  it("has no format at all when nothing is supported", () => {
    stubMediaRecorder([]);

    expect(pickCanvasVideoFormat()).toBeNull();
  });

  it("has no format outside a browser", () => {
    expect(pickCanvasVideoFormat()).toBeNull();
  });
});
