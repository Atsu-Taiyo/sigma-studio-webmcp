import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { SigmaTableCellContent } from "@/features/document";

import { OverlayTableCellContentEditor } from "./table-cell-content-editor";

const callbacks = {
  onFocus: () => undefined,
  onChange: () => undefined,
  onNavigate: () => false,
  onRegisterEditor: () => () => undefined,
};

describe("OverlayTableCellContentEditor", () => {
  it("preserves static paragraph alignment and inline content order", () => {
    const content: SigmaTableCellContent = {
      type: "paragraph",
      id: "paragraph",
      align: "right",
      children: [
        { type: "text", text: "左" },
        {
          type: "mathInline",
          id: "math",
          tex: "x",
          display: "inline",
        },
        { type: "text", text: "右" },
      ],
    };

    const markup = renderToStaticMarkup(
      <OverlayTableCellContentEditor
        {...callbacks}
        shapeId="shape"
        cellId="cell"
        content={content}
        editing={false}
        rowIndex={0}
        columnIndex={0}
        colSpan={1}
      />,
    );

    expect(markup).toContain('class="overlay-table-shape-content ProseMirror"');
    // The cell editor is a one-paragraph Tiptap document, so the alignment belongs on a `<p>` and
    // `.overlay-table-shape-content p { flex: 0 0 auto; margin: 0 }` has to apply to it. Putting the
    // run straight into the flex container instead (and the alignment on the container) made the
    // cell's line box a differently sized flex item, so its text moved when the cell took focus.
    expect(markup).toContain('<div class="overlay-table-shape-content ProseMirror"><p style="text-align:right">');
    expect(markup.indexOf("左")).toBeLessThan(markup.indexOf('data-tex="x"'));
    expect(markup.indexOf('data-tex="x"')).toBeLessThan(markup.indexOf("右"));
  });

  it("leaves the static paragraph unstyled when the cell has no alignment", () => {
    const content: SigmaTableCellContent = {
      type: "paragraph",
      id: "paragraph",
      children: [{ type: "text", text: "既定" }],
    };

    const markup = renderToStaticMarkup(
      <OverlayTableCellContentEditor
        {...callbacks}
        shapeId="shape"
        cellId="cell"
        content={content}
        editing={false}
        rowIndex={0}
        columnIndex={0}
        colSpan={1}
      />,
    );

    // `inlineNodesToTiptapDoc` omits `textAlign` when there is none, so the editor's `<p>` carries
    // no style either.
    expect(markup).toContain('<div class="overlay-table-shape-content ProseMirror"><p>');
    expect(markup).not.toContain("text-align");
  });

  // A trend cell is drawn by `OverlayTableTrendCell` here, the same component the static view, the
  // SVG export and the settings preview mount. It used to be a KaTeX `\nearrow` (`\searrow`,
  // `\rightarrow`) scaled up by `.overlay-table-trend`, which was a different arrow from the one the
  // PDF drew and did not widen across a merged cell. `features/rendering/adapters/table-parity.test.tsx`
  // compares the three outputs; these cases pin what this surface passes in.
  it.each([
    ["up", 18, 6],
    ["down", 6, 18],
    ["flat", 12, 12],
  ] as const)("renders the %s trend arrow and label", (direction, y1, y2) => {
    const content: SigmaTableCellContent = {
      type: "trend",
      id: `trend_${direction}`,
      direction,
      label: [{ type: "text", text: "傾向" }],
    };

    const markup = renderToStaticMarkup(
      <OverlayTableCellContentEditor
        {...callbacks}
        shapeId="shape"
        cellId="cell"
        content={content}
        editing={false}
        rowIndex={0}
        columnIndex={0}
        colSpan={1}
      />,
    );

    expect(markup).toContain('class="overlay-table-trend"');
    expect(markup).toContain(`y1="${y1}"`);
    expect(markup).toContain(`y2="${y2}"`);
    expect(markup).toContain("<polygon");
    expect(markup).toContain("傾向");
    expect(markup).not.toContain("katex");
  });

  it("widens the trend arrow across the columns the cell spans", () => {
    const content: SigmaTableCellContent = {
      type: "trend",
      id: "trend_merged",
      direction: "up",
    };

    const markup = renderToStaticMarkup(
      <OverlayTableCellContentEditor
        {...callbacks}
        shapeId="shape"
        cellId="cell"
        content={content}
        editing={false}
        rowIndex={0}
        columnIndex={0}
        colSpan={2}
      />,
    );

    expect(markup).toContain('width="76"');
    // No label, no `<span>` for one.
    expect(markup).not.toContain("<span");
  });
});
