import { describe, expect, it } from "vitest";

import type { InlineNode, OverlayRichTextDocument } from "@/features/document";
import { getOverlayRichTextLineCount as documentLineCount } from "@/features/document";

import { createOverlayTextLineModel, getOverlayRichTextLineCount } from "./overlay-text-line-model";

const text = (value: string): InlineNode => ({ type: "text", text: value });
const math = (tex: string): InlineNode => ({ type: "mathInline", id: "m", tex, display: "inline" });
const doc = (...blocks: Array<{ children: InlineNode[] }>): OverlayRichTextDocument => (
  { blocks: blocks.map((block) => ({ type: "paragraph", ...block })) } as OverlayRichTextDocument
);

/** `[name, document, expectedLineCount]` — the counts are literals, not derived from the model. */
const CORPUS: Array<[string, OverlayRichTextDocument, number]> = [
  ["no blocks", doc(), 1],
  ["one empty block", doc({ children: [] }), 1],
  ["one line", doc({ children: [text("ab")] }), 1],
  ["two blocks", doc({ children: [text("a")] }, { children: [text("b")] }), 2],
  ["blank block between", doc({ children: [text("a")] }, { children: [] }, { children: [text("b")] }), 3],
  ["hard break", doc({ children: [text("a\nb")] }), 2],
  ["two hard breaks", doc({ children: [text("a\nb\nc")] }), 3],
  ["leading break", doc({ children: [text("\na")] }), 2],
  ["trailing break", doc({ children: [text("a\n")] }), 2],
  ["CRLF", doc({ children: [text("a\r\nb")] }), 2],
  ["math only", doc({ children: [math("x^2")] }), 1],
  ["math plus break", doc({ children: [math("x"), text("\nb")] }), 2],
  ["two runs on one line", doc({ children: [text("a"), text("b")] }), 1],
];

describe("createOverlayTextLineModel", () => {
  it.each(CORPUS)("counts the lines of %s", (_name, document, expected) => {
    expect(getOverlayRichTextLineCount(document)).toBe(expected);
  });

  it.each(CORPUS)("builds one model line per counted line for %s", (_name, document, expected) => {
    // They agree for every case that does not contain a lone `\r`; the estimator's model treats
    // that as a break and the count deliberately does not (see the note on the count).
    expect(createOverlayTextLineModel({ richText: document }).length).toBe(expected);
  });

  /**
   * `features/document` normalizes shape geometry and needs the same count, but it is the layer
   * below this one and cannot import it — so it keeps a private copy. This pins the two together;
   * without it, the copy could drift and change the *stored* size of saved text shapes.
   */
  it.each([...CORPUS, ["lone CR", doc({ children: [text("a\rb")] }), 1] as const])(
    "agrees with the document feature's copy for %s",
    (_name, document, expected) => {
      expect(getOverlayRichTextLineCount(document)).toBe(documentLineCount(document));
      expect(documentLineCount(document)).toBe(expected);
    },
  );

  /**
   * Recorded, not fixed: the estimator's line *model* treats a lone `\r` as a break while the line
   * *count* (and the React renderer, and `features/document`) split on `\n` only. Aligning them
   * would change the stored height of existing shapes, so the difference is pinned here instead.
   */
  it("records that only the measurement model treats a lone CR as a break", () => {
    const document = doc({ children: [text("a\rb")] });

    expect(createOverlayTextLineModel({ richText: document }).length).toBe(2);
    expect(getOverlayRichTextLineCount(document)).toBe(1);
  });

  it("never throws on a document that is not in canonical form", () => {
    for (const broken of [{}, { blocks: null }, { blocks: "doc" }, { blocks: [{ type: "paragraph" }] }]) {
      expect(() => createOverlayTextLineModel({
        richText: broken as unknown as OverlayRichTextDocument,
      })).not.toThrow();
    }
  });

  it("reuses the derived lines for the same document identity", () => {
    const document = doc({ children: [text("memo")] });

    expect(createOverlayTextLineModel({ richText: document }))
      .toBe(createOverlayTextLineModel({ richText: document }));
  });

  it("prefers inline content over rich text, like the estimator's input contract", () => {
    expect(createOverlayTextLineModel({
      inlineContent: [text("ab")],
      richText: doc({ children: [text("a\nb\nc")] }),
    })).toEqual([[{ kind: "text", text: "ab" }]]);
  });
});
