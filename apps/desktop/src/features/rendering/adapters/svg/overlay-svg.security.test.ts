import { describe, expect, it } from "vitest";

import type { OverlayAsset, OverlayShape } from "@/features/document";

import { serializeOverlaySvg, type OverlaySvgRenderers } from ".";

/**
 * Injection is defended in two independent layers, and this file measures the serializer layer.
 * Poisoned values are handed straight to the serializer, so a passing case here is not an
 * observation about `overlay-snapshot.ts` doing its job upstream.
 */
const INJECTED_COLOR =
  "red;position:fixed;top:0;left:0;width:100vw;height:100vh;background:#fff;z-index:2147483647";

const renderers: OverlaySvgRenderers = {
  renderGraphHtml: (_spec, idSeed) => `<svg data-graph="${idSeed}"></svg>`,
  renderMathHtml: (tex) => `<span data-math="${tex}"></span>`,
  renderTableHtml: (_table, width, height) => `<div data-table="${width}x${height}"></div>`,
};

function serialize(shape: OverlayShape): string {
  return serializeOverlaySvg([shape], {}, { width: 400, height: 300 }, renderers) ?? "";
}

/** Every `style="…"` value in the markup, split into its individual declarations. */
function styleDeclarations(svg: string): string[] {
  return [...svg.matchAll(/style="([^"]*)"/g)]
    .flatMap((match) => match[1].split(";"))
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration.length > 0);
}

function textShape(color: string): OverlayShape {
  return {
    id: "shape_text",
    type: "text",
    x: 10,
    y: 20,
    props: {
      w: 120,
      h: 24,
      richText: { blocks: [{ type: "paragraph", children: [{ type: "text", text: "式" }] }] },
      autoSize: false,
      color,
      size: "m",
    },
  };
}

function calloutShape(color: string): OverlayShape {
  return {
    id: "shape_callout",
    type: "callout",
    x: 10,
    y: 20,
    props: {
      w: 120,
      h: 60,
      radius: 8,
      tail: { baseStart: { x: 0, y: 60 }, baseEnd: { x: 20, y: 60 }, tip: { x: 10, y: 90 } },
      richText: { blocks: [{ type: "paragraph", children: [{ type: "text", text: "注" }] }] },
      color,
      size: "m",
      dash: "solid",
      strokeWidth: "m",
    },
  };
}

describe("overlay SVG serializer CSS injection", () => {
  it("does not let a text shape color add declarations", () => {
    const svg = serialize(textShape(INJECTED_COLOR));

    expect(svg).not.toContain("position:fixed");
    expect(svg).not.toContain("z-index:2147483647");
    expect(styleDeclarations(svg).filter((declaration) => declaration.startsWith("position:"))).toEqual([]);
  });

  it("does not let a callout color add declarations", () => {
    const svg = serialize(calloutShape(INJECTED_COLOR));

    expect(svg).not.toContain("position:fixed");
    expect(svg).not.toContain("z-index:2147483647");
    expect(styleDeclarations(svg).filter((declaration) => declaration.startsWith("position:"))).toEqual([]);
  });

  it("emits exactly the same declaration count for a poisoned and a clean color", () => {
    const poisoned = styleDeclarations(serialize(textShape(INJECTED_COLOR)));
    const clean = styleDeclarations(serialize(textShape("#1f2937")));

    expect(poisoned).toHaveLength(clean.length);
  });

  it("keeps a legitimate color verbatim", () => {
    expect(serialize(textShape("#1f2937"))).toContain("color:#1f2937");
    expect(serialize(calloutShape("rgb(255, 0, 0)"))).toContain("color:rgb(255, 0, 0)");
  });

  it("does not let inline rich-text styling add declarations", () => {
    const shape = textShape("#1f2937");
    (shape.props as { richText: unknown }).richText = {
      blocks: [{
        type: "paragraph",
        children: [{
          type: "text",
          text: "式",
          color: INJECTED_COLOR,
          backgroundColor: INJECTED_COLOR,
          fontFamily: "serif;}html{display:none",
        }],
      }],
    };

    const svg = serialize(shape);

    expect(svg).not.toContain("position:fixed");
    expect(svg).not.toContain("display:none");
    expect(styleDeclarations(svg).filter((declaration) => declaration.startsWith("position:"))).toEqual([]);
  });
});

describe("overlay SVG image sources", () => {
  function imageDocument(src: string) {
    return {
      shape: {
        id: "shape_image",
        type: "image" as const,
        x: 0,
        y: 0,
        props: { assetId: "asset_1", w: 100, h: 80 },
      },
      assets: {
        asset_1: {
          id: "asset_1",
          type: "image",
          props: { w: 100, h: 80, name: "x.png", isAnimated: false, mimeType: "image/png", src, fileSize: 10 },
        },
      } as unknown as Record<string, OverlayAsset>,
    };
  }

  it("never writes a local or remote URL into the exported SVG", () => {
    // 書き出した SVG は印刷面と PDF にそのまま入る。ここに `file://` が残ると、被害者の
    // ローカルファイルが PDF へ焼き込まれて外へ出る。
    for (const src of [
      "file:///Users/victim/Desktop/private.png",
      "https://attacker.example/beacon.png",
      // `trim()` は U+FEFF を落とすが URL パーサは落とさない。真偽値だけ見て元の値を書くと、
      // 「検証は data URL・ブラウザには相対 URL」で `file://` を基準に解決されてしまう。
      "\uFEFFdata:image/png,../../../../Users/victim/Desktop/private.png",
    ]) {
      const { shape, assets } = imageDocument(src);
      const svg = serializeOverlaySvg([shape], assets, { width: 400, height: 300 }, renderers) ?? "";

      expect(svg, src).not.toContain(src);
      expect(svg, src).not.toContain("<image");
    }
  });

  it("still writes the data URL the app itself produced", () => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
    const { shape, assets } = imageDocument(dataUrl);

    expect(serializeOverlaySvg([shape], assets, { width: 400, height: 300 }, renderers) ?? "")
      .toContain(dataUrl);
  });
});
