// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { OverlayShape } from "@/features/document";

vi.mock("mathlive", () => ({}));

let OverlayTextShapeEditor: typeof import("./text-shape-editor").OverlayTextShapeEditor;
let container: HTMLDivElement;
let root: Root;

beforeAll(async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  document.open();
  document.write("<!doctype html><html><head></head><body></body></html>");
  document.close();
  OverlayTextShapeEditor = (await import("./text-shape-editor")).OverlayTextShapeEditor;
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("OverlayTextShapeEditor auto-size", () => {
  it("ignores rotated descendant AABBs and saves the local layout height", async () => {
    const localWidth = 200;
    const localHeight = 24;
    const rotatedAabbSize = (localWidth + localHeight) / Math.sqrt(2);
    const rect = {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: rotatedAabbSize,
      bottom: rotatedAabbSize,
      width: rotatedAabbSize,
      height: rotatedAabbSize,
      toJSON: () => ({}),
    };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.closest(".ProseMirror") ? rect : DOMRect.fromRect();
    });
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("ProseMirror") ? localWidth : 0;
    });
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("ProseMirror") ? localHeight : 0;
    });
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("ProseMirror") ? localWidth : 0;
    });
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("ProseMirror") ? localHeight : 0;
    });

    const shape: Extract<OverlayShape, { type: "text" }> = {
      id: "text_rotated",
      type: "text",
      x: 10,
      y: 20,
      rotation: Math.PI / 4,
      props: {
        w: localWidth,
        h: localHeight,
        color: "#111827",
        size: "m",
        fontSize: 18,
        scale: 1,
        autoSize: true,
        richText: {
          blocks: [{ type: "paragraph", children: [{ type: "text", text: "single line" }] }],
        },
      },
    };
    const onAutoSize = vi.fn();

    await act(async () => {
      root.render(
        <OverlayTextShapeEditor
          shape={shape}
          externalRevision={0}
          editing={false}
          onFocus={vi.fn()}
          onCancel={vi.fn()}
          onAutoSize={onAutoSize}
          onChange={vi.fn()}
        />,
      );
      await Promise.resolve();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(container.querySelector(".ProseMirror")).not.toBeNull();
    expect(onAutoSize).toHaveBeenCalled();
    expect(onAutoSize.mock.calls.at(-1)).toEqual([shape.id, localWidth, localHeight]);
    expect(onAutoSize.mock.calls.at(-1)?.[2]).not.toBe(Math.ceil(rotatedAabbSize));
  });
});
