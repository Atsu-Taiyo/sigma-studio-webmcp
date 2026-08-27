import { describe, expect, it } from "vitest";

import {
  migrateLegacyOverlayRichTextDocument,
  migrateLegacyOverlaySnapshotRichText,
} from "./overlay-migrations";
import { isOverlayRichTextDocument } from "./overlay-validation";

describe("legacy overlay rich-text migration", () => {
  it("moves known root inlines into the preceding block and creates a leading paragraph", () => {
    const legacy = {
      type: "doc",
      futureDocumentAttr: "preserved",
      content: [
        { type: "text", text: "先頭" },
        { type: "hardBreak" },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "見出し" }] },
        { type: "mathInline", attrs: { id: "math_legacy", tex: "x^2" } },
      ],
    };

    const migrated = migrateLegacyOverlayRichTextDocument(legacy);

    expect(migrated).toEqual({
      blocks: [
        { type: "paragraph", children: [{ type: "text", text: "先頭\n" }] },
        {
          type: "heading",
          level: 2,
          children: [
            { type: "text", text: "見出し" },
            {
              type: "mathInline",
              id: "math_legacy",
              tex: "x^2",
              display: "inline",
              semanticRole: "expression",
            },
          ],
        },
      ],
    });
    expect(isOverlayRichTextDocument(migrated)).toBe(true);
    expect(JSON.stringify(migrated)).not.toMatch(/"type":"doc"|"hardBreak"|"styledText"/);
  });

  it("does not hide unknown root nodes from strict validation", () => {
    const unknown = {
      type: "doc",
      content: [{ type: "bulletList", content: [] }, { type: "mathInline", attrs: { tex: "x" } }],
    };

    expect(migrateLegacyOverlayRichTextDocument(unknown)).toBe(unknown);
    expect(isOverlayRichTextDocument(unknown)).toBe(false);
  });

  it("preserves canonical documents by reference and only copies migrated rich-text shapes", () => {
    const canonical = { blocks: [{ type: "paragraph", children: [] }] };
    expect(migrateLegacyOverlayRichTextDocument(canonical)).toBe(canonical);

    const snapshot = {
      version: 1,
      shapes: [
        { id: "geo", type: "geo", props: {} },
        {
          id: "text",
          type: "text",
          props: { richText: { type: "doc", content: [{ type: "mathInline", attrs: { tex: "y" } }] } },
        },
        {
          id: "callout",
          type: "callout",
          props: { richText: { type: "doc", content: [{ type: "text", text: "説明" }] } },
        },
      ],
      assets: {},
    };
    const migrated = migrateLegacyOverlaySnapshotRichText(snapshot) as typeof snapshot;
    expect(migrated).not.toBe(snapshot);
    expect(migrated.shapes[0]).toBe(snapshot.shapes[0]);
    expect(migrated.shapes[1]).not.toBe(snapshot.shapes[1]);
    expect((migrated.shapes[1]?.props.richText as { blocks?: unknown[] })?.blocks).toEqual([
      {
        type: "paragraph",
        children: [{
          type: "mathInline",
          id: "m_inline_0",
          tex: "y",
          display: "inline",
          semanticRole: "expression",
        }],
      },
    ]);
    expect((migrated.shapes[2]?.props.richText as { blocks?: unknown[] })?.blocks).toEqual([
      { type: "paragraph", children: [{ type: "text", text: "説明" }] },
    ]);
  });
});
