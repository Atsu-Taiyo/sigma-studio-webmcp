import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { RichTextBoxDecoration } from "@/features/rendering/core";

import {
  boxedSelfContainedStyle,
  MATH_FRAME_SELF_CONTAINED_STYLE,
  OVERLAY_BLOCK_SELF_CONTAINED_STYLE,
  underlineRunStyle,
  type RichTextDomStyle,
} from "./rich-text-dom";

/**
 * The exported SVG carries no stylesheet, so `rich-text-dom.ts` writes the document-surface
 * styling out as inline declarations. That output is *also* injected straight back into the app
 * (PrintPreview, running regions, the page canvas, the material preview), where inline styles beat
 * the stylesheet — so a value that drifts from the CSS does not merely look wrong in a standalone
 * file, it makes the SVG-rendered figure differ from the natively rendered one.
 *
 * A comment saying "keep these in sync" is exactly the failure mode this session is removing, so
 * the CSS is parsed here and compared declaration by declaration. Deliberate differences are
 * registered below with a reason and checked for staleness.
 */

const cssPath = path.resolve(import.meta.dirname, "../../../app/document-surface.css");
const documentSurfaceCss = readFileSync(cssPath, "utf8");

/**
 * Differences between a self-contained style and the CSS branch it mirrors. Every entry has to be
 * a real difference (see the staleness test) — an unexplained one is drift.
 */
const INTENTIONAL_DIVERGENCES: Record<string, string> = {
  "block.margin":
    "SVG のブロックリセット。`.overlay-text-shape .ProseMirror p` は margin:0 だが見出しには対応する規則が無く、"
    + "エクスポート済み図版のレイアウトを黙って変えないため 0 のまま据え置いている",
};

/**
 * The boxed frame reads its custom properties with a fallback instead of re-declaring them.
 * Re-declaring `--boxed-text-border-width` inline would beat `[data-sigma-doc-boxed-variant=…]`
 * and freeze every box at the default frame. `.boxed-run-frame` uses the same form in the CSS.
 */
function applyCustomPropertyFallbacks(declarations: RichTextDomStyle): RichTextDomStyle {
  const defaults = ruleDeclarations(documentSurfaceCss, ".boxed-text");
  const withFallbacks: RichTextDomStyle = {};
  for (const [property, value] of Object.entries(declarations)) {
    if (property.startsWith("--")) {
      continue;
    }
    withFallbacks[property] = value.replace(/var\((--[a-z0-9-]+)\)/g, (match, name: string) => {
      const fallback = defaults[name];
      return fallback === undefined ? match : `var(${name}, ${fallback})`;
    });
  }
  return withFallbacks;
}

/** Declarations of the top-level rule whose selector list contains `selector`, in source order. */
function ruleDeclarations(css: string, selector: string): RichTextDomStyle {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let index = 0;
  while (index < withoutComments.length) {
    const open = withoutComments.indexOf("{", index);
    if (open < 0) {
      break;
    }
    const close = findBlockEnd(withoutComments, open);
    const prelude = withoutComments.slice(index, open).trim();
    const selectors = prelude.split(",").map((entry) => entry.trim().replace(/\s+/g, " "));
    if (!prelude.startsWith("@") && selectors.includes(selector)) {
      return parseDeclarations(withoutComments.slice(open + 1, close));
    }
    index = close + 1;
  }
  throw new Error(`no rule for "${selector}"`);
}

function findBlockEnd(css: string, open: number): number {
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === "{") {
      depth += 1;
    } else if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return css.length;
}

function parseDeclarations(body: string): RichTextDomStyle {
  const declarations: RichTextDomStyle = {};
  let depth = 0;
  let buffer = "";
  const flush = () => {
    const separator = buffer.indexOf(":");
    if (separator > 0) {
      const property = buffer.slice(0, separator).trim();
      const value = buffer.slice(separator + 1).trim().replace(/\s+/g, " ");
      if (property && !property.startsWith("/")) {
        declarations[property] = value;
      }
    }
    buffer = "";
  };
  for (const character of body) {
    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
    }
    if (character === ";" && depth === 0) {
      flush();
      continue;
    }
    buffer += character;
  }
  flush();
  return declarations;
}

/** Merges CSS rules in source order, the way the cascade would for a single element. */
function mergedRules(css: string, ...selectors: string[]): RichTextDomStyle {
  return applyCustomPropertyFallbacks(
    selectors.reduce<RichTextDomStyle>(
      (merged, selector) => Object.assign(merged, ruleDeclarations(css, selector)),
      {},
    ),
  );
}

const boxed = (overrides: Partial<RichTextBoxDecoration> = {}): RichTextBoxDecoration => ({
  type: "box",
  math: false,
  ...overrides,
});

const runSegment = {
  connectLeft: false,
  connectRight: false,
  runId: "run",
  segmentCount: 1,
  segmentId: "segment",
  segmentIndex: 0,
  styleKey: "key",
};

describe("the self-contained boxed style mirrors document-surface.css", () => {
  it("matches .boxed-text for plain boxed text", () => {
    expect(boxedSelfContainedStyle(boxed()))
      .toEqual(mergedRules(documentSurfaceCss, ".boxed-text"));
  });

  it("matches .boxed-text.boxed-inline-math for boxed math", () => {
    expect(boxedSelfContainedStyle(boxed({ math: true })))
      .toEqual(mergedRules(
        documentSurfaceCss,
        ".boxed-text",
        ".boxed-text.boxed-inline-math",
      ));
  });

  // Every segment of a boxed run carries `data-boxed-run-height-target`, whose rule comes after
  // the math rule in the stylesheet. PR #223 moved this branch to a baseline anchor; an
  // `align-items: center` here would silently put SVG-rendered runs back on the old behaviour.
  it("matches the height-target rule for a boxed run segment", () => {
    expect(boxedSelfContainedStyle(boxed({ run: runSegment })))
      .toEqual(mergedRules(
        documentSurfaceCss,
        ".boxed-text",
        '.boxed-text[data-boxed-run-height-target="true"]',
      ));
  });

  it("lets the height-target rule win over the math rule, as source order does", () => {
    const style = boxedSelfContainedStyle(boxed({ math: true, run: runSegment }));

    expect(style).toEqual(mergedRules(
      documentSurfaceCss,
      ".boxed-text",
      ".boxed-text.boxed-inline-math",
      '.boxed-text[data-boxed-run-height-target="true"]',
    ));
    expect(style["align-items"]).toBe("baseline");
    expect(style["line-height"]).toBe("1");
  });

  it("matches the connect rules for a joined run", () => {
    expect(boxedSelfContainedStyle(boxed({ connectLeft: true, connectRight: true, run: runSegment })))
      .toEqual(mergedRules(
        documentSurfaceCss,
        ".boxed-text",
        '.boxed-text[data-boxed-run-height-target="true"]',
        '.boxed-text[data-boxed-run-connect-right="true"]',
        '.boxed-text[data-boxed-run-connect-left="true"]',
      ));
  });

  it("reads the boxed custom properties with a fallback so variants keep working", () => {
    const style = boxedSelfContainedStyle(boxed());

    expect(style.border).toContain("var(--boxed-text-border-width, 1px)");
    expect(Object.keys(style).some((property) => property.startsWith("--"))).toBe(false);
  });
});

describe("the self-contained underline mirrors document-surface.css", () => {
  it("matches the text-only branch", () => {
    expect(underlineRunStyle(false))
      .toEqual(mergedRules(documentSurfaceCss, ".sigma-underline-run:not(:has(.math-preview))"));
  });

  it("matches the has-math branch", () => {
    expect(underlineRunStyle(true))
      .toEqual(mergedRules(documentSurfaceCss, ".sigma-underline-run:has(.math-preview)"));
  });

  // `.sigma-underline-run:has(.math-preview) * { text-decoration: none }` has no self-contained
  // counterpart because the projection never puts a decoration on a descendant of such a run:
  // the run's wrapper span owns the underline, so no member carries one of its own.
  it("emits no decorated descendant that the has-math branch would have to neutralise", () => {
    const style = underlineRunStyle(true);

    expect(style["text-decoration"]).toBe("none");
    expect(ruleDeclarations(documentSurfaceCss, ".sigma-underline-run:has(.math-preview) *"))
      .toEqual({ "text-decoration": "none" });
  });
});

describe("the self-contained margins mirror the app rules", () => {
  it("zeroes the inline-math margin the way .overlay-text-shape .inline-math-node does", () => {
    // The overlay shape rules moved into the shared file when the running region started drawing
    // React shapes: `packages/viewer` loads only `document-surface.css`.
    expect(MATH_FRAME_SELF_CONTAINED_STYLE)
      .toEqual(ruleDeclarations(documentSurfaceCss, ".overlay-text-shape .inline-math-node"));
  });

  it("keeps the block reset registered as a deliberate difference", () => {
    // Paragraphs match the app rule; headings have none, so the zero margin is a divergence.
    expect(ruleDeclarations(documentSurfaceCss, ".overlay-text-shape .ProseMirror p").margin).toBe("0");
    expect(OVERLAY_BLOCK_SELF_CONTAINED_STYLE).toEqual({ margin: "0" });
    expect(INTENTIONAL_DIVERGENCES["block.margin"]).toBeDefined();
    expect(() => ruleDeclarations(documentSurfaceCss, ".overlay-text-shape h1")).toThrow();
  });

  it("keeps the divergence list free of stale entries", () => {
    expect(Object.keys(INTENTIONAL_DIVERGENCES)).toEqual(["block.margin"]);
  });
});
