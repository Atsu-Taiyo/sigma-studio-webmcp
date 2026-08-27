import { describe, expect, it } from "vitest";

import { buildShapeOnlyPreview, buildShapesSvgPreview } from "@/lib/ai/ai-edit-shape-preview";
import type { AiEditDraft } from "@/lib/ai/sigma-doc-edit-schema";
import type { OverlayGeoShape } from "@/features/document";

function rectangle(id: string, x = 0, y = 0): OverlayGeoShape {
  return {
    id,
    type: "geo",
    x,
    y,
    rotation: 0,
    anchor: { type: "block", blockId: "p_1", dy: y, dx: x },
    props: {
      w: 180,
      h: 96,
      geo: "rectangle",
      fill: "none",
      color: "black",
      fillColor: "#ffffff",
      labelColor: "black",
      dash: "solid",
      size: "m",
      label: "補助線",
    },
  };
}

function insertOverlayShape(shape: OverlayGeoShape): AiEditDraft {
  return {
    operation: "insertOverlayShape",
    summary: "図形を挿入しました。",
    targetId: "p_1",
    overlayShape: shape,
    assets: {},
  };
}

describe("buildShapeOnlyPreview", () => {
  it("renders inserted overlay shapes into a cropped self-contained SVG", () => {
    const preview = buildShapeOnlyPreview([insertOverlayShape(rectangle("shape_1"))]);

    expect(preview).not.toBeNull();
    expect(preview).toMatchObject({
      width: 244,
      height: 160,
    });
    expect(preview?.svg).toContain(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-32 -32 244 160" width="244" height="160">',
    );
    expect(preview?.svg).toContain(
      '<rect x="0" y="0" width="180" height="96" fill="transparent" stroke="black" stroke-width="2"',
    );
    expect(preview?.svg).toContain(">補助線</text>");
  });

  it("crops to the union bounds of multiple inserted shapes", () => {
    const single = buildShapeOnlyPreview([insertOverlayShape(rectangle("shape_1"))]);
    const pair = buildShapeOnlyPreview([
      insertOverlayShape(rectangle("shape_1", 0, 0)),
      insertOverlayShape(rectangle("shape_2", 0, 400)),
    ]);

    expect(pair).not.toBeNull();
    // 2つ目の図形がy=400に離れているので、縦方向のクロップは1つだけより大きくなる。
    expect(pair!.height).toBeGreaterThan(single!.height);
  });

  it("returns null when a non-shape operation is mixed in (falls back to page preview)", () => {
    const textEdit: AiEditDraft = {
      operation: "insertAfter",
      summary: "本文を追加しました。",
      targetId: "p_1",
      insertedBlock: { type: "paragraph", id: "added", children: [{ type: "text", text: "追記" }] },
    };

    expect(buildShapeOnlyPreview([insertOverlayShape(rectangle("shape_1")), textEdit])).toBeNull();
  });

  it("returns null for an empty operation list", () => {
    expect(buildShapeOnlyPreview([])).toBeNull();
  });
});

describe("buildShapesSvgPreview", () => {
  it("renders arbitrary shapes into a cropped self-contained SVG", () => {
    const preview = buildShapesSvgPreview([rectangle("shape_1")], {});

    expect(preview).not.toBeNull();
    expect(preview?.svg.startsWith("<svg")).toBe(true);
    expect(preview?.width).toBeGreaterThan(0);
    expect(preview?.height).toBeGreaterThan(0);
  });

  it("crops to the union bounds of multiple shapes", () => {
    const single = buildShapesSvgPreview([rectangle("shape_1")], {});
    const pair = buildShapesSvgPreview([rectangle("shape_1", 0, 0), rectangle("shape_2", 0, 400)], {});

    expect(pair).not.toBeNull();
    expect(pair!.height).toBeGreaterThan(single!.height);
  });

  it("supports a tighter crop for compact chat thumbnails", () => {
    const regular = buildShapesSvgPreview([rectangle("shape_1")], {});
    const compact = buildShapesSvgPreview([rectangle("shape_1")], {}, {
      paddingPx: 10,
      minWidthPx: 48,
      minHeightPx: 48,
    });

    expect(compact!.width).toBeLessThan(regular!.width);
    expect(compact!.height).toBeLessThan(regular!.height);
  });

  it("returns null for an empty shape list", () => {
    expect(buildShapesSvgPreview([], {})).toBeNull();
  });

  it("backs buildShapeOnlyPreview's output exactly (delegation, no drift)", () => {
    const viaDraft = buildShapeOnlyPreview([insertOverlayShape(rectangle("shape_1"))]);
    const viaShapes = buildShapesSvgPreview([rectangle("shape_1")], {});

    expect(viaShapes).toEqual(viaDraft);
  });
});

describe("buildShapesSvgPreview with legacy proposal drafts", () => {
  // 実データ再現: 保存済み提案の72件が旧Tiptap形式のrichTextを持っており、
  // チャットのサムネイル生成 (EditorShellのrender中のuseMemo) がここで例外を投げると
  // アプリ全体が白画面になっていた。
  const legacyTextShape = {
    id: "shape_legacy_text",
    type: "text",
    x: 10,
    y: 20,
    rotation: 0,
    anchor: { type: "block", blockId: "p_1", dy: 20, dx: 10 },
    props: {
      w: 120,
      autoSize: true,
      color: "black",
      size: "m",
      richText: { type: "doc", content: [{ type: "text", text: "頂点" }] },
    },
  } as unknown as OverlayGeoShape;

  it("renders a legacy rich-text shape instead of throwing", () => {
    const preview = buildShapesSvgPreview([legacyTextShape], {});

    expect(preview).not.toBeNull();
    expect(preview?.svg).toContain("頂点");
  });
});

