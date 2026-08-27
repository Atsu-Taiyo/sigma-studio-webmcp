import { describe, expect, it } from "vitest";

import type { OverlayAsset, OverlayShape } from "@/features/document";

import {
  collectSelectedOverlayAssets,
  getOnlySelectedTextShape,
  getTopmostSelectedShapes,
  mergeShapesById,
  sameOverlayShapeIds,
  sameOverlayShapeReferences,
  toggleOverlayShapeSelectionIds,
} from "./selection";

describe("overlay selection model", () => {
  it("merges changed shapes in canvas order and preserves untouched references", () => {
    const first = rectangle("first");
    const second = rectangle("second");
    const changedSecond = { ...second, x: 80 };

    const merged = mergeShapesById([first, second], [changedSecond]);

    expect(merged).toEqual([first, changedSecond]);
    expect(merged[0]).toBe(first);
    expect(merged[1]).toBe(changedSecond);
  });

  it("keeps only top-level transformation units from a nested selection", () => {
    const parent = group("parent");
    const child = rectangle("child", "parent");
    const sibling = rectangle("sibling");

    expect(getTopmostSelectedShapes([parent, child, sibling])).toEqual([parent, sibling]);
  });

  it("resolves exactly one selected text shape and lets active editing take precedence", () => {
    const text = textShape("text");
    const otherText = textShape("other_text");
    const shape = rectangle("shape");
    const shapes = [text, otherText, shape];

    expect(getOnlySelectedTextShape(shapes, ["text"], null)).toBe(text);
    expect(getOnlySelectedTextShape(shapes, ["text", "shape"], null)).toBeNull();
    expect(getOnlySelectedTextShape(shapes, ["shape"], "other_text")).toBe(otherText);
    expect(getOnlySelectedTextShape(shapes, ["shape"], null)).toBeNull();
  });

  it("collects only assets referenced by selected image shapes", () => {
    const first = imageShape("first_image", "asset_1");
    const assets = {
      asset_1: imageAsset("asset_1"),
      asset_2: imageAsset("asset_2"),
    };

    expect(collectSelectedOverlayAssets([first, rectangle("shape")], assets)).toEqual({
      asset_1: assets.asset_1,
    });
  });

  it("compares ordered ids and shape identity without serializing shape data", () => {
    const first = rectangle("first");
    const second = rectangle("second");

    expect(sameOverlayShapeIds(["first", "second"], ["first", "second"])).toBe(true);
    expect(sameOverlayShapeIds(["first", "second"], ["second", "first"])).toBe(false);
    expect(sameOverlayShapeReferences([first, second], [first, second])).toBe(true);
    expect(sameOverlayShapeReferences([first, second], [first, { ...second }])).toBe(false);
  });

  it("preserves all-or-add selection toggling, id order, and empty-target values", () => {
    expect(toggleOverlayShapeSelectionIds(["a"], ["b"])).toEqual(["a", "b"]);
    expect(toggleOverlayShapeSelectionIds(["a", "b", "c"], ["b", "a"])).toEqual(["c"]);
    expect(toggleOverlayShapeSelectionIds(["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"]);
    expect(toggleOverlayShapeSelectionIds(["b", "a"], ["c"])).toEqual(["b", "a", "c"]);
    expect(toggleOverlayShapeSelectionIds(["a"], [])).toEqual(["a"]);
  });
});

function rectangle(id: string, parentId?: string): OverlayShape {
  return {
    id,
    type: "geo",
    x: 0,
    y: 0,
    ...(parentId ? { parentId } : {}),
    props: {
      w: 40,
      h: 30,
      geo: "rectangle",
      fill: "none",
      color: "black",
      labelColor: "black",
      dash: "solid",
      size: "m",
    },
  };
}

function group(id: string): OverlayShape {
  return {
    id,
    type: "group",
    x: 0,
    y: 0,
    props: { w: 40, h: 30 },
  };
}

function textShape(id: string): Extract<OverlayShape, { type: "text" }> {
  return {
    id,
    type: "text",
    x: 0,
    y: 0,
    props: {
      w: 120,
      richText: {
        blocks: [{ type: "paragraph", children: [{ type: "text", text: id }] }],
      },
      autoSize: true,
      color: "black",
      size: "m",
    },
  };
}

function imageShape(
  id: string,
  assetId: string,
): Extract<OverlayShape, { type: "image" }> {
  return {
    id,
    type: "image",
    x: 0,
    y: 0,
    props: { assetId, w: 100, h: 80 },
  };
}

function imageAsset(id: string): OverlayAsset {
  return {
    id,
    type: "image",
    props: {
      w: 100,
      h: 80,
      name: `${id}.png`,
      isAnimated: false,
      mimeType: "image/png",
      src: `data:image/png;base64,${id}`,
      fileSize: 10,
    },
  };
}
