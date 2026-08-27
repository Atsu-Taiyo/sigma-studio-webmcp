import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  PrintPreview,
  PrintPreviewPageNavigator,
  PrintPreviewThumbnail,
  translateNestedMeasuredBlock,
} from "@/components/print/PrintPreview";
import { renderMathHtml } from "@/features/rendering/adapters";
import { createBoxBlock } from "@/lib/box-blocks";
import { createMathRenderEnvironment } from "@/lib/math-environment";
import type { SigmaBlock, SigmaDocument } from "@/types/sigma-doc";

const document: SigmaDocument = {
  version: "2.0",
  docId: "doc_print_preview_layout",
  metadata: {
    title: "表示モード検証",
  },
  content: [
    {
      type: "paragraph",
      id: "paragraph_print_preview_layout",
      children: [{ type: "text", text: "A4ページの表示モードを確認する。" }],
    },
  ],
  outputProfiles: {
    student: { showSolutions: false, showHints: false, includeAnswers: false },
    teacher: { showSolutions: true, showHints: true, includeAnswers: true },
    answerBook: { onlySolutions: true, showSolutions: true, showHints: false, includeAnswers: true },
  },
};

describe("PrintPreview layout modes", () => {
  // 仕様変更: `mathFractionSizing` は「静的側だけ `\frac` を `\dfrac` へ書き換える」設定ではなく、
  // **文書の組版スタイル** (uniform=displaystyle / texDefault=textstyle) になった。静的側と
  // 編集中の math-field が同じ 1 つの出典から組版を導くので、片方だけ変わることがない。
  it("applies the document typeset style to print output without rewriting the stored TeX", () => {
    const tex = String.raw`\frac{x^{\frac{1}{2}}}{\frac{a}{b}}`;
    const fractionDocument = documentWithColumns(1, [{
      type: "paragraph",
      id: "print_fraction_sizing",
      children: [{
        type: "mathInline",
        id: "print_fraction_sizing_math",
        tex,
        display: "inline",
      }],
    }]);
    const texDefaultDocument: SigmaDocument = {
      ...fractionDocument,
      metadata: { ...fractionDocument.metadata, mathFractionSizing: "texDefault" },
    };

    const uniformHtml = renderToStaticMarkup(<PrintPreview document={fractionDocument} profile="teacher" />);
    const texDefaultHtml = renderToStaticMarkup(<PrintPreview document={texDefaultDocument} profile="teacher" />);

    expect(uniformHtml).toContain(renderMathHtml(tex, createMathRenderEnvironment(undefined, "uniform")));
    expect(texDefaultHtml).toContain(renderMathHtml(tex, createMathRenderEnvironment(undefined, "texDefault")));
    expect(uniformHtml).not.toBe(texDefaultHtml);
    // 保存される TeX はどちらの設定でも書き換わらない。
    expect(uniformHtml).toContain('data-tex="\\frac{x^{\\frac{1}{2}}}{\\frac{a}{b}}"');
    expect(texDefaultHtml).toContain('data-tex="\\frac{x^{\\frac{1}{2}}}{\\frac{a}{b}}"');
  });

  // `packages/viewer` はこのコンポーネントを直接 print surface に使う。Provider が
  // `app/print/page.tsx` 側にしか無かったころは、公開ビューアで前文マクロが一切効かなかった。
  it("expands preamble macros when rendered on its own (the public viewer surface)", () => {
    const preamble = String.raw`\newcommand{\RR}{\mathbb{R}}`;
    const tex = String.raw`\frac{a}{b}\RR`;
    const base = documentWithColumns(1, [{
      type: "paragraph",
      id: "print_preamble_macro",
      children: [{
        type: "mathInline",
        id: "print_preamble_macro_math",
        tex,
        display: "inline",
      }],
    }]);
    const preambleDocument: SigmaDocument = {
      ...base,
      metadata: { ...base.metadata, texPreamble: preamble },
    };

    const html = renderToStaticMarkup(<PrintPreview document={preambleDocument} profile="teacher" />);

    expect(html).toContain(renderMathHtml(tex, createMathRenderEnvironment(preamble)));
    expect(html).not.toContain("data-math-unrendered");
  });

  it("uses the vertical layout by default", () => {
    const html = renderToStaticMarkup(<PrintPreview document={document} profile="teacher" />);

    expect(html).toContain('data-print-preview-layout="vertical"');
    expect(html).toContain("layout-vertical");
  });

  it("applies the requested spread layout", () => {
    const html = renderToStaticMarkup(
      <PrintPreview document={document} profile="teacher" displayMode="spread" />,
    );

    expect(html).toContain('data-print-preview-layout="spread"');
    expect(html).toContain("layout-spread");
  });

  it("uses an expanded Japanese font stack in the print rendering path", () => {
    const fontFamily = '"BIZ UDPMincho", "Yu Mincho", "Hiragino Mincho ProN", serif';
    const html = renderToStaticMarkup(
      <PrintPreview
        document={documentWithColumns(1, [{
          type: "paragraph",
          id: "print_biz_mincho",
          children: [{ type: "text", text: "明朝体の本文", fontFamily }],
        }])}
        profile="teacher"
      />,
    );

    expect(html).toContain("font-family");
    expect(html).toContain("BIZ UDPMincho");
    expect(html).toContain("Hiragino Mincho ProN");
  });

  it("renders rich box titles with text styling and inline math", () => {
    const html = renderToStaticMarkup(
      <PrintPreview
        document={documentWithColumns(1, [{
          type: "boxBlock",
          id: "print_rich_box_title",
          styleId: "itembox",
          title: [
            {
              type: "text",
              text: "重要 ",
              marks: ["bold"],
              color: "#1d4ed8",
              fontSize: 18,
            },
            {
              type: "mathInline",
              id: "print_rich_box_title_math",
              tex: String.raw`x^2+y^2`,
              display: "inline",
              semanticRole: "expression",
            },
          ],
          blocks: [{
            type: "paragraph",
            id: "print_rich_box_body",
            children: [{ type: "text", text: "本文" }],
          }],
        }])}
        profile="teacher"
      />,
    );

    expect(html).toContain('class="print-box-title"');
    expect(html).toContain("重要");
    expect(html).toContain("color:#1d4ed8");
    expect(html).toContain("font-size:18pt");
    expect(html).toContain('data-tex="x^2+y^2"');
  });

  it("does not render a print title element for an empty box title", () => {
    const html = renderToStaticMarkup(
      <PrintPreview
        document={documentWithColumns(1, [{
          type: "boxBlock",
          id: "print_empty_box_title",
          styleId: "itembox",
          title: [],
          blocks: [{
            type: "paragraph",
            id: "print_empty_box_body",
            children: [{ type: "text", text: "本文" }],
          }],
        }])}
        profile="teacher"
      />,
    );

    expect(html).not.toContain('class="print-box-title"');
    expect(html).toContain("本文");
  });

  it("passes a colored itembox background through to the print title plate", () => {
    const html = renderToStaticMarkup(
      <PrintPreview
        document={documentWithColumns(1, [{
          ...createBoxBlock("itembox", "色付き見出し", {
            id: "print_colored_itembox",
            bodyId: "print_colored_itembox_body",
          }),
          frame: {
            ...createBoxBlock("itembox").frame,
            backgroundColor: "#fef3c7",
          },
        }])}
        profile="teacher"
      />,
    );

    expect(html).toContain("box-frame--title-plate");
    expect(html).toContain("--sigma-doc-box-background:#fef3c7");
    expect(html).toContain('class="print-box-title"');
  });

  it("renders nested SigmaDoc lists with inline formatting and math", () => {
    const html = renderToStaticMarkup(
      <PrintPreview
        document={documentWithColumns(1, [
          {
            type: "list",
            id: "print_list_ordered",
            listType: "ordered",
            items: [
              {
                type: "listItem",
                id: "print_li_parent",
                children: [
                  { type: "text", text: "太字", marks: ["bold"] },
                  { type: "mathInline", id: "print_li_math", tex: "x^2", display: "inline" },
                ],
                nested: [
                  {
                    type: "list",
                    id: "print_list_nested",
                    listType: "bullet",
                    items: [
                      {
                        type: "listItem",
                        id: "print_li_child",
                        children: [{ type: "text", text: "下線", marks: ["underline"] }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ])}
        profile="teacher"
      />,
    );

    expect(html).toContain("<ol");
    expect(html).toContain("<ul");
    expect(html).toContain('data-sigma-doc-id="print_li_parent"');
    expect(html).toContain('data-sigma-doc-id="print_li_child"');
    expect(html).toContain("<strong>");
    expect(html).toContain("sigma-underline-run");
    expect(html).toContain("math-preview");
  });

  it("renders printable boxed text and math as one annotated inline run", () => {
    const html = renderToStaticMarkup(
      <PrintPreview
        document={documentWithColumns(1, [
          {
            type: "paragraph",
            id: "print_boxed_inline_run",
            children: [
              { type: "text", text: "辺", marks: ["boxed"], boxedVariant: "double" },
              {
                type: "mathInline",
                id: "print_boxed_inline_math",
                tex: "P(\\alpha)Q(\\beta)",
                display: "inline",
                marks: ["boxed"],
                boxedVariant: "double",
              },
              { type: "text", text: "は", marks: ["boxed"], boxedVariant: "double" },
            ],
          },
        ])}
        profile="teacher"
      />,
    );
    const previewHtml = html.split('<div class="print-measure-layer"')[0] ?? html;

    expect(previewHtml).toContain('data-boxed-run-id="print_boxed_inline_run-boxed-run-0"');
    expect(previewHtml.match(/data-boxed-run-height-target="true"/g)).toHaveLength(3);
    expect(previewHtml.match(/data-boxed-run-connect-right="true"/g)).toHaveLength(2);
    expect(previewHtml.match(/data-boxed-run-connect-left="true"/g)).toHaveLength(2);
    expect(previewHtml).toContain('data-sigma-doc-boxed-variant="double"');
  });

  // The running region uses the body's static renderer (no `.print-*`), while the page body keeps
  // the print family — that split is what proves `PrintableRichBlock` survived as a thin wrapper.
  it("renders running headers with the body renderer and keeps the print family in the page body", () => {
    const html = renderToStaticMarkup(
      <PrintPreview
        document={documentWithColumns(1, [
          paragraph("header_parity_body", "本文"),
        ], {
          preset: "A4",
          orientation: "portrait",
          pageSize: { widthMm: 210, heightMm: 297 },
          marginsMm: { top: 22, right: 17, bottom: 18, left: 17 },
          flow: { type: "columns", columnCount: 1, columnGapMm: 8 },
          header: {
            enabled: true,
            heightMm: 14,
            offsetMm: 4,
            showOnFirstPage: true,
            blocks: [
              {
                type: "paragraph",
                id: "header_paragraph",
                align: "center",
                children: [
                  { type: "text", text: "{title} " },
                  {
                    type: "text",
                    text: "重要",
                    marks: ["boxed"],
                    boxedVariant: "thick",
                    boxedTone: "blue",
                  },
                  { type: "text", text: "\n{page} / {total}", marks: ["bold"] },
                ],
              },
              {
                type: "paragraph",
                id: "header_empty",
                children: [],
              },
              {
                type: "list",
                id: "header_list",
                listType: "bullet",
                items: [{
                  type: "listItem",
                  id: "header_item",
                  children: [
                    { type: "text", text: "式 " },
                    {
                      type: "mathInline",
                      id: "header_math",
                      tex: "x^2",
                      display: "inline",
                      marks: ["boxed"],
                      boxedVariant: "double",
                    },
                  ],
                }],
              },
            ],
          },
        })}
        profile="teacher"
      />,
    );
    const previewHtml = html.split('<div class="print-measure-layer"')[0] ?? html;
    const emptyParagraphStart = previewHtml.indexOf('data-sigma-doc-id="header_empty"');
    const emptyParagraphHtml = previewHtml.slice(emptyParagraphStart, previewHtml.indexOf("</p>", emptyParagraphStart));

    expect(emptyParagraphStart).toBeGreaterThan(-1);
    expect(previewHtml).toContain('class="page-running-region header free"');
    expect(previewHtml).toContain('class="page-running-text-layer text-flow-shell"');
    expect(previewHtml).toContain('class="text-flow-editor"');
    expect(previewHtml).toContain('data-sigma-doc-id="header_paragraph" style="text-align:center"');
    expect(previewHtml).toContain("段組み改ページ検証");
    expect(previewHtml).toContain("1 / 1");
    expect(previewHtml).toContain("<br");
    expect(previewHtml).toContain("<strong>");
    expect(previewHtml).toContain('data-sigma-doc-boxed-variant="thick"');
    expect(previewHtml).toContain('data-sigma-doc-boxed-tone="blue"');
    expect(previewHtml).toContain('data-sigma-doc-id="header_list"');
    // The page body still gets the print family from `PrintableRichBlock`.
    expect(previewHtml).toContain('data-sigma-doc-id="header_parity_body" class="print-paragraph"');
    expect(previewHtml).toContain('data-sigma-doc-id="header_item"');
    expect(previewHtml).toContain('data-sigma-doc-boxed-variant="double"');
    expect(previewHtml).toContain("math-preview-inline");
    expect(emptyParagraphHtml).toContain("<br");
  });

  it("renders notebook box blocks with the shared print frame metadata", () => {
    const note = createBoxBlock("tcolorbox-note", "", {
      id: "print_note_box",
      bodyId: "print_note_body",
    });
    const html = renderToStaticMarkup(
      <PrintPreview document={documentWithColumns(1, [note])} profile="teacher" />,
    );

    expect(html).toContain('class="print-box-block box-frame box-frame--notebook-rules box-frame--title-position-l"');
    expect(html).toContain('data-box-style="tcolorbox-note"');
    expect(html).toContain('data-box-notebook-rules="true"');
    expect(html).toContain("--sigma-doc-box-notebook-frame-left:20px");
    expect(html).toContain("--sigma-doc-box-notebook-frame-height:57.35px");
    expect(html).toContain("--sigma-doc-box-notebook-ring-count:1");
    expect(html).not.toContain("--sigma-doc-box-notebook-line-gap");
  });
});

describe("PrintPreviewThumbnail", () => {
  it("renders only the first printable page with page sizing and math content", () => {
    const html = renderToStaticMarkup(
      <PrintPreviewThumbnail document={thumbnailDocument()} />,
    );
    const previewHtml = html.split('<div class="print-measure-layer"')[0] ?? html;

    expect(html).toContain('data-print-preview-thumbnail="true"');
    expect(html).toContain('data-print-preview-max-pages="1"');
    expect(previewHtml.match(/class="print-a4-page"/g) ?? []).toHaveLength(1);
    expect(previewHtml).toContain('data-sigma-doc-id="thumbnail_heading"');
    expect(previewHtml).toContain("math-preview");
    expect(html).toContain("--print-page-width:182mm");
    expect(html).toContain("--print-page-height:257mm");
  });
});

describe("PrintPreviewPageNavigator", () => {
  it("renders a selectable paper-like page list with the active page marked", () => {
    const html = renderToStaticMarkup(
      <PrintPreviewPageNavigator
        document={documentWithColumns(1, [
          paragraph("nav_page_1", "1ページ目"),
          paragraph("nav_page_2", "2ページ目", { pagination: { break: true } }),
        ])}
        activePageNumber={2}
        onPageSelect={() => undefined}
      />,
    );
    const previewHtml = html.split('<div class="print-measure-layer"')[0] ?? html;

    expect(html).toContain('data-print-page-navigator="true"');
    expect(html).toContain('data-print-preview-page-count="2"');
    expect(previewHtml.match(/class="print-preview-page-nav-item/g) ?? []).toHaveLength(2);
    expect(previewHtml).toContain('aria-label="ページ 2 / 2"');
    expect(previewHtml).toContain('aria-current="page"');
    expect(previewHtml).toContain('class="print-preview-page-nav-paper-selection"');
    expect(previewHtml).toContain('class="print-preview-page-nav-label">-2-</span>');
    expect(previewHtml).not.toContain("print-preview-page-nav-number");
    expect(previewHtml).toContain('data-sigma-doc-id="nav_page_1"');
    expect(previewHtml).toContain('data-sigma-doc-id="nav_page_2"');
  });
});

describe("PrintPreview print pagination", () => {
  it("moves an explicit break to the next column before starting a physical page", () => {
    const html = renderToStaticMarkup(
      <PrintPreview
        document={documentWithColumns(2, [
          paragraph("p_before", "before"),
          paragraph("p_after", "after", { pagination: { break: true } }),
          paragraph("p_tail", "tail"),
        ])}
        profile="teacher"
      />,
    );

    expect(renderedPageColumns(html)).toEqual([
      [["p_before"], ["p_after", "p_tail"]],
    ]);
  });

  it("moves consecutive explicit breaks from the last column to the next physical page", () => {
    const html = renderToStaticMarkup(
      <PrintPreview
        document={documentWithColumns(2, [
          paragraph("p_first", "first"),
          paragraph("p_second", "second", { pagination: { break: true } }),
          paragraph("p_third", "third", { pagination: { break: true } }),
        ])}
        profile="teacher"
      />,
    );

    expect(renderedPageColumns(html)).toEqual([
      [["p_first"], ["p_second"]],
      [["p_third"], []],
    ]);
  });

  it("keeps a block with its next block when the pair fits the next column", () => {
    const filler = Array.from({ length: 5 }, (_, index) => (
      paragraph(`keep_next_filler_${index + 1}`, `前置き ${index + 1}`)
    ));
    const html = renderToStaticMarkup(
      <PrintPreview
        document={documentWithColumns(2, [
          ...filler,
          paragraph("keep_next_heading", "見出し", { pagination: { keepWithNext: true } }),
          paragraph("keep_next_body", "直後の本文"),
        ], shortTwoColumnPageLayout())}
        profile="teacher"
      />,
    );

    expect(renderedPageColumns(html)).toEqual([[
      filler.map((block) => block.id),
      ["keep_next_heading", "keep_next_body"],
    ]]);
  });

  it("flows an oversized unframed problem area from the left into the right column", () => {
    const html = renderToStaticMarkup(
      <PrintPreview
        document={documentWithColumns(2, [
          paragraph("p_before_oversized_solution", "before"),
          {
            type: "problem",
            id: "problem_oversized_solution",
            tags: [],
            numbering: { enabled: false },
            lead: [],
            prompt: [],
            solution: Array.from({ length: 6 }, (_, index) => (
              richParagraph(`solution_oversized_body_${index + 1}`, `解答 ${index + 1}`)
            )),
            hints: [],
          },
        ], {
          preset: "custom",
          orientation: "portrait",
          pageSize: { widthMm: 80, heightMm: 90 },
          marginsMm: { top: 10, right: 10, bottom: 10, left: 10 },
          flow: { type: "columns", columnCount: 2, columnGapMm: 8 },
        })}
        profile="teacher"
      />,
    );

    expect(renderedPageColumns(html)).toEqual([
      [[
        "p_before_oversized_solution",
        "solution_oversized_body_1",
        "solution_oversized_body_2",
        "solution_oversized_body_3",
        "solution_oversized_body_4",
      ], [
        "solution_oversized_body_5",
        "solution_oversized_body_6",
      ]],
    ]);
    expect(html).toContain('data-problem-area-fragment="first"');
    expect(html).toContain('data-problem-area-fragment="last"');
  });

  it("keeps a framed problem prompt and solution together when both fit on the next page", () => {
    const html = renderToStaticMarkup(
      <PrintPreview
        document={documentWithColumns(1, [
          paragraph("p_before_problem", "問題の前にある本文"),
          {
            type: "problem",
            id: "problem_kept_with_solution",
            tags: [],
            numbering: { enabled: false },
            lead: [],
            prompt: [richParagraph("kept_prompt", "問題文")],
            solution: [richParagraph("kept_solution", "解答")],
            hints: [],
            frame: { enabled: true },
            areaLayout: {
              prompt: { minHeightMm: 32 },
              solution: { minHeightMm: 32 },
            },
          },
        ], {
          preset: "custom",
          orientation: "portrait",
          pageSize: { widthMm: 80, heightMm: 90 },
          marginsMm: { top: 10, right: 10, bottom: 10, left: 10 },
          flow: { type: "columns", columnCount: 1, columnGapMm: 0 },
        })}
        profile="teacher"
      />,
    );

    expect(renderedPageColumns(html)).toEqual([
      [["p_before_problem"]],
      [["problem_kept_with_solution", "kept_prompt", "kept_solution"]],
    ]);
  });

  it("still splits a framed problem whose prompt and solution cannot fit on one page", () => {
    const html = renderToStaticMarkup(
      <PrintPreview
        document={documentWithColumns(1, [
          {
            type: "problem",
            id: "problem_taller_than_page",
            tags: [],
            numbering: { enabled: false },
            lead: [],
            prompt: [richParagraph("tall_prompt", "問題文")],
            solution: Array.from({ length: 3 }, (_, index) => (
              richParagraph(`tall_solution_${index + 1}`, `解答 ${index + 1}`)
            )),
            hints: [],
            frame: { enabled: true },
            areaLayout: {
              prompt: { minHeightMm: 45 },
              solution: { minHeightMm: 45 },
            },
          },
        ], {
          preset: "custom",
          orientation: "portrait",
          pageSize: { widthMm: 80, heightMm: 90 },
          marginsMm: { top: 10, right: 10, bottom: 10, left: 10 },
          flow: { type: "columns", columnCount: 1, columnGapMm: 0 },
        })}
        profile="teacher"
      />,
    );

    expect(renderedPageColumns(html)).toEqual([
      [["problem_taller_than_page", "tall_prompt", "tall_solution_1", "tall_solution_2"]],
      [["tall_solution_3"]],
    ]);
  });

  it("uses min-height for problem areas", () => {
    const html = renderToStaticMarkup(
      <PrintPreview
        document={documentWithColumns(1, [
          {
            type: "problem",
            id: "problem_auto_height_columns",
            tags: [],
            numbering: { enabled: false },
            lead: [],
            prompt: [],
            solution: [richParagraph("solution_auto_height_body", "解答")],
            hints: [],
            areaLayout: {
              solution: { minHeightMm: 40 },
            },
          },
        ])}
        profile="teacher"
      />,
    );
    const previewHtml = renderedPreviewHtml(html);

    expect(previewHtml).toContain("min-height:40mm");
    expect(previewHtml).toContain('data-problem-area-fragment="single"');
    expect(html).not.toContain("--print-problem-area-column-height");
    expect(html).not.toContain("--print-problem-area-column-fill");
  });

  it("reserves min-height when a problem area stays in one column", () => {
    const html = renderToStaticMarkup(
      <PrintPreview
        document={documentWithColumns(1, [
          {
            type: "problem",
            id: "problem_reserved_min_height",
            tags: [],
            numbering: { enabled: false },
            lead: [],
            prompt: [],
            solution: [richParagraph("reserved_min_height_solution", "解答欄")],
            hints: [],
            areaLayout: { solution: { minHeightMm: 60 } },
          },
          paragraph("after_reserved_min_height", "解答欄の後"),
        ], {
          ...shortTwoColumnPageLayout(),
          flow: { type: "columns", columnCount: 1, columnGapMm: 0 },
        })}
        profile="teacher"
      />,
    );

    expect(renderedPageColumns(html)).toEqual([
      [["reserved_min_height_solution"]],
      [["after_reserved_min_height"]],
    ]);
  });

  it("honors page breaks on rich children inside a flowable problem area", () => {
    const html = renderToStaticMarkup(
      <PrintPreview
        document={documentWithColumns(2, [
          {
            type: "problem",
            id: "problem_child_page_break",
            tags: [],
            numbering: { enabled: false },
            lead: [],
            prompt: [],
            solution: [
              richParagraph("child_break_before_advance", "改段前"),
              {
                ...richParagraph("child_break_after_advance", "改段後"),
                pagination: { break: true },
              },
            ],
            hints: [],
          },
        ])}
        profile="teacher"
      />,
    );

    expect(renderedPageColumns(html)).toEqual([[
      ["child_break_before_advance"],
      ["child_break_after_advance"],
    ]]);
  });

  it("places problem-internal layout sections as their own atomic fragments", () => {
    const html = renderToStaticMarkup(
      <PrintPreview
        document={documentWithColumns(2, [
          {
            type: "problem",
            id: "problem_layout_section_fragment",
            tags: [],
            numbering: { enabled: false },
            lead: [],
            prompt: [],
            solution: [
              richParagraph("before_problem_layout_section", "段組み前"),
              {
                type: "layoutSection",
                id: "problem_layout_section",
                layout: { columnCount: 2, columnGapMm: 6 },
                children: [
                  richParagraph("problem_layout_section_left", "左段"),
                  richParagraph("problem_layout_section_right", "右段"),
                ],
              },
              richParagraph("after_problem_layout_section", "段組み後"),
            ],
            hints: [],
          },
        ])}
        profile="teacher"
      />,
    );
    const previewHtml = renderedPreviewHtml(html);

    expect(previewHtml.match(/data-problem-area-fragment="/g) ?? []).toHaveLength(3);
    expect(previewHtml).toContain('data-problem-area-fragment="first"');
    expect(previewHtml).toContain('data-problem-area-fragment="middle"');
    expect(previewHtml).toContain('data-problem-area-fragment="last"');
    expect(previewHtml).toContain('data-sigma-doc-id="problem_layout_section"');
  });

  it("flows numbered unframed problem blocks through both columns with one anchor and number", () => {
    const html = renderToStaticMarkup(
      <PrintPreview
        document={documentWithColumns(2, [
          {
            type: "problem",
            id: "problem_two_column_flow",
            tags: [],
            numbering: { enabled: true },
            lead: [richParagraph("numbered_flow_lead", "問題本文")],
            prompt: [],
            solution: Array.from({ length: 6 }, (_, index) => (
              richParagraph(`numbered_flow_solution_${index + 1}`, `解答 ${index + 1}`)
            )),
            hints: [],
          },
        ], shortTwoColumnPageLayout())}
        profile="teacher"
      />,
    );
    const previewHtml = renderedPreviewHtml(html);

    expect(renderedPageColumns(html)).toEqual([[
      [
        "problem_two_column_flow",
        "numbered_flow_lead",
        "numbered_flow_solution_1",
        "numbered_flow_solution_2",
        "numbered_flow_solution_3",
        "numbered_flow_solution_4",
      ],
      ["numbered_flow_solution_5", "numbered_flow_solution_6"],
    ]]);
    expect(previewHtml.match(/data-problem-area-fragment="/g) ?? []).toHaveLength(3);
    expect(previewHtml).toContain('data-problem-area-fragment="single"');
    expect(previewHtml).toContain('data-problem-area-fragment="first"');
    expect(previewHtml).toContain('data-problem-area-fragment="last"');
    expect(previewHtml.match(/class="print-problem-number"/g) ?? []).toHaveLength(1);
    expect(previewHtml.match(/data-sigma-doc-id="problem_two_column_flow"/g) ?? []).toHaveLength(1);
  });

  it("does not restart fragment roles after pixel-sliced problem content", () => {
    const html = renderToStaticMarkup(
      <PrintPreview
        document={documentWithColumns(2, [
          {
            type: "problem",
            id: "problem_over_tall_numbered_lead",
            tags: [],
            numbering: { enabled: true },
            lead: [
              richParagraph("over_tall_numbered_lead", "長".repeat(500)),
              richParagraph("after_over_tall_numbered_lead", "長いブロックの続き"),
            ],
            prompt: [],
            solution: [],
            hints: [],
          },
        ], shortTwoColumnPageLayout())}
        profile="teacher"
      />,
    );
    const previewHtml = renderedPreviewHtml(html);

    expect(previewHtml).toContain('data-block-source-id="over_tall_numbered_lead"');
    expect(previewHtml).toContain('data-problem-area-fragment="last"');
    expect(previewHtml).not.toContain('data-problem-area-fragment="first"');
    expect(previewHtml).not.toContain('data-problem-area-fragment="single"');
    expect(previewHtml).not.toContain('class="print-problem-number"');
  });

  it("rebases nested block and line left coordinates from a fragment origin", () => {
    const translated = translateNestedMeasuredBlock(
      {
        id: "nested_fragment_block",
        top: 12,
        left: 44,
        width: 120,
        height: 30,
        lines: [
          { index: 0, top: 14, left: 50, width: 80, height: 12 },
          { index: 1, top: 28, width: 70, height: 12 },
        ],
      },
      100,
      200,
      40,
    );

    expect(translated).toMatchObject({ top: 112, left: 204 });
    expect(translated.lines?.[0]).toMatchObject({ top: 114, left: 210 });
    expect(translated.lines?.[1]).toMatchObject({ top: 128 });
    expect(translated.lines?.[1]?.left).toBeUndefined();
  });

  it("keeps framed problem areas atomic", () => {
    const html = renderToStaticMarkup(
      <PrintPreview
        document={documentWithColumns(2, [
          {
            type: "problem",
            id: "problem_framed_atomic",
            tags: [],
            numbering: { enabled: false },
            lead: [],
            prompt: Array.from({ length: 3 }, (_, index) => (
              richParagraph(`framed_prompt_${index + 1}`, `枠付き問題文 ${index + 1}`)
            )),
            solution: [],
            hints: [],
            frame: { enabled: true },
          },
        ], shortTwoColumnPageLayout())}
        profile="teacher"
      />,
    );
    const previewHtml = renderedPreviewHtml(html);

    expect(previewHtml).toContain('data-sigma-doc-id="problem_framed_atomic"');
    expect(previewHtml).toContain('class="print-problem-area with-frame');
    expect(previewHtml).not.toContain("data-problem-area-fragment");
  });

  it("keeps full-span problem areas atomic", () => {
    const html = renderToStaticMarkup(
      <PrintPreview
        document={documentWithColumns(2, [
          {
            type: "problem",
            id: "problem_full_span_atomic",
            tags: [],
            numbering: { enabled: false },
            lead: [],
            prompt: Array.from({ length: 3 }, (_, index) => (
              richParagraph(`full_span_prompt_${index + 1}`, `全幅問題文 ${index + 1}`)
            )),
            solution: [],
            hints: [],
            areaLayout: { prompt: { columnSpan: "full" } },
          },
        ], shortTwoColumnPageLayout())}
        profile="teacher"
      />,
    );
    const previewHtml = renderedPreviewHtml(html);

    expect(previewHtml).toContain('class="print-page-full-span-block"');
    expect(previewHtml).toContain('data-sigma-doc-id="problem_full_span_atomic"');
    expect(previewHtml).not.toContain("data-problem-area-fragment");
  });

  it("splits a framed problem area at a manual break inside it, with an open frame across the break", () => {
    const html = renderToStaticMarkup(
      <PrintPreview
        document={documentWithColumns(2, [
          {
            type: "problem",
            id: "problem_framed_split",
            tags: [],
            numbering: { enabled: false },
            lead: [],
            prompt: [
              richParagraph("framed_split_prompt_1", "前半"),
              { ...richParagraph("framed_split_prompt_2", "後半"), pagination: { break: true } },
            ],
            solution: [],
            hints: [],
            frame: { enabled: true },
          },
        ], shortTwoColumnPageLayout())}
        profile="teacher"
      />,
    );
    const previewHtml = renderedPreviewHtml(html);

    // The manual break makes the framed area flow into two fragments instead of
    // staying atomic — each still framed, with the border open across the break.
    expect(previewHtml).toContain('data-problem-area-fragment="first"');
    expect(previewHtml).toContain('data-problem-area-fragment="last"');

    const firstTag = sectionTagContaining(previewHtml, 'data-problem-area-fragment="first"');
    const lastTag = sectionTagContaining(previewHtml, 'data-problem-area-fragment="last"');
    expect(firstTag).toContain("with-frame");
    expect(firstTag).toContain("first-frame-area");
    expect(firstTag).not.toContain("last-frame-area");
    expect(lastTag).toContain("with-frame");
    expect(lastTag).toContain("last-frame-area");
    expect(lastTag).not.toContain("first-frame-area");

    // …and the break must actually move content. Two fragments in the same column would
    // draw an open frame around a break that paginated nothing.
    const columns = renderedPageColumns(html)
      .flat()
      .map((column) => column.filter((id) => id.startsWith("framed_split_prompt_")));
    const columnOfFirst = columns.findIndex((ids) => ids.includes("framed_split_prompt_1"));
    const columnOfSecond = columns.findIndex((ids) => ids.includes("framed_split_prompt_2"));
    expect(columnOfFirst).toBeGreaterThanOrEqual(0);
    expect(columnOfSecond).toBeGreaterThan(columnOfFirst);
  });

  it("splits a full-span problem area at a manual break inside it", () => {
    const html = renderToStaticMarkup(
      <PrintPreview
        document={documentWithColumns(2, [
          {
            type: "problem",
            id: "problem_full_span_split",
            tags: [],
            numbering: { enabled: false },
            lead: [],
            prompt: [
              richParagraph("full_span_split_prompt_1", "前半"),
              { ...richParagraph("full_span_split_prompt_2", "後半"), pagination: { break: true } },
            ],
            solution: [],
            hints: [],
            areaLayout: { prompt: { columnSpan: "full" } },
          },
        ], shortTwoColumnPageLayout())}
        profile="teacher"
      />,
    );
    const previewHtml = renderedPreviewHtml(html);

    // The manual break makes the full-span area flow instead of staying atomic;
    // each fragment still renders as a full-span block (outside the columns).
    expect(previewHtml).toContain('data-problem-area-fragment="first"');
    expect(previewHtml).toContain('data-problem-area-fragment="last"');
    const fullSpanBlockCount = previewHtml.split('class="print-page-full-span-block"').length - 1;
    expect(fullSpanBlockCount).toBeGreaterThanOrEqual(2);
  });

  it("does not apply min-height CSS to split problem-area fragments", () => {
    const html = renderToStaticMarkup(
      <PrintPreview
        document={documentWithColumns(2, [
          {
            type: "problem",
            id: "problem_split_min_height",
            tags: [],
            numbering: { enabled: false },
            lead: [],
            prompt: [],
            solution: Array.from({ length: 6 }, (_, index) => (
              richParagraph(`split_min_height_${index + 1}`, `解答欄 ${index + 1}`)
            )),
            hints: [],
            areaLayout: { solution: { minHeightMm: 80 } },
          },
        ], shortTwoColumnPageLayout())}
        profile="teacher"
      />,
    );
    const previewHtml = renderedPreviewHtml(html);

    expect(previewHtml).toContain('data-problem-area-fragment="first"');
    expect(previewHtml).toContain('data-problem-area-fragment="last"');
    expect(previewHtml).not.toContain("min-height:80mm");
    expect(html).toContain("min-height:80mm");
  });

  it("flows a tall unframed problem area across one-column page boundaries", () => {
    const html = renderToStaticMarkup(
      <PrintPreview
        document={documentWithColumns(1, [
          paragraph("before_one_column_problem", "問題前の本文"),
          {
            type: "problem",
            id: "problem_one_column_flow",
            tags: [],
            numbering: { enabled: false },
            lead: [],
            prompt: [],
            solution: Array.from({ length: 5 }, (_, index) => (
              richParagraph(`one_column_solution_${index + 1}`, `解答 ${index + 1}`)
            )),
            hints: [],
          },
        ], {
          ...shortTwoColumnPageLayout(),
          flow: { type: "columns", columnCount: 1, columnGapMm: 0 },
        })}
        profile="teacher"
      />,
    );

    expect(renderedPageColumns(html)).toEqual([
      [[
        "before_one_column_problem",
        "one_column_solution_1",
        "one_column_solution_2",
        "one_column_solution_3",
        "one_column_solution_4",
      ]],
      [["one_column_solution_5"]],
    ]);
  });

  it("renders full-span problem prompts above n-column solution content", () => {
    const html = renderToStaticMarkup(
      <PrintPreview
        document={documentWithColumns(2, [
          {
            type: "problem",
            id: "problem_full_prompt",
            tags: [],
            lead: [],
            prompt: [richParagraph("prompt_body", "問題文")],
            solution: [richParagraph("solution_body", "解答")],
            hints: [],
            areaLayout: {
              prompt: { columnSpan: "full" },
            },
          },
          paragraph("p_tail", "tail"),
        ])}
        profile="teacher"
      />,
    );

    const previewHtml = html.split('<div class="print-measure-layer"')[0] ?? html;
    const fullSpanIndex = previewHtml.indexOf('class="print-page-full-span-block"');
    const columnsIndex = previewHtml.indexOf('class="print-page-columns"', fullSpanIndex);

    expect(fullSpanIndex).toBeGreaterThanOrEqual(0);
    expect(columnsIndex).toBeGreaterThan(fullSpanIndex);
    expect(previewHtml.indexOf('data-sigma-doc-id="prompt_body"')).toBeGreaterThan(fullSpanIndex);
    expect(previewHtml.indexOf('data-sigma-doc-id="prompt_body"')).toBeLessThan(columnsIndex);
    expect(previewHtml.indexOf('data-sigma-doc-id="solution_body"')).toBeGreaterThan(columnsIndex);
    expect(previewHtml.indexOf('data-sigma-doc-id="p_tail"')).toBeGreaterThan(columnsIndex);
  });

  it("splits oversized box blocks into print fragments across pages", () => {
    const note = createBoxBlock("tcolorbox-note", "", {
      id: "split_note_box",
      bodyId: "split_note_body_1",
    });
    note.blocks = Array.from({ length: 18 }, (_, index) => (
      richParagraph(`split_note_body_${index + 1}`, `ノート本文 ${index + 1}`)
    ));

    const html = renderToStaticMarkup(
      <PrintPreview
        document={documentWithColumns(1, [note], {
          preset: "custom",
          orientation: "portrait",
          pageSize: { widthMm: 96, heightMm: 72 },
          marginsMm: { top: 8, right: 8, bottom: 8, left: 8 },
          flow: { type: "columns", columnCount: 1, columnGapMm: 0 },
        })}
        profile="teacher"
      />,
    );
    const previewHtml = html.split('<div class="print-measure-layer"')[0] ?? html;
    const pageColumns = renderedPageColumns(html);
    const renderedNoteBodyIds = pageColumns.flat(2).filter((id) => id.startsWith("split_note_body_"));

    expect(pageColumns.length).toBeGreaterThan(1);
    expect(previewHtml).toContain('data-box-fragment="first"');
    expect(previewHtml).toContain('data-box-fragment="last"');
    expect(renderedNoteBodyIds).toContain("split_note_body_1");
    expect(renderedNoteBodyIds).toContain("split_note_body_18");
  });

  it("renders a manual column break inside a multi-column layout in a box without forcing a box fragment", () => {
    const note = createBoxBlock("tcolorbox-note", "", {
      id: "box_manual_break_note",
      bodyId: "box_manual_break_body_1",
    });
    note.blocks = [{
      type: "layoutSection",
      id: "box_manual_break_columns",
      layout: { columnCount: 2, columnGapMm: 4 },
      children: [
        richParagraph("box_manual_break_body_1", "改段の前"),
        {
          ...richParagraph("box_manual_break_body_2", "改段の後"),
          pagination: { break: true as const },
        },
      ],
    }];

    const html = renderToStaticMarkup(
      <PrintPreview
        document={documentWithColumns(1, [note], {
          preset: "custom",
          orientation: "portrait",
          pageSize: { widthMm: 96, heightMm: 140 },
          marginsMm: { top: 8, right: 8, bottom: 8, left: 8 },
          flow: { type: "columns", columnCount: 1, columnGapMm: 0 },
        })}
        profile="teacher"
      />,
    );
    const previewHtml = renderedPreviewHtml(html);

    expect(previewHtml).toContain("print-column-break-before");
    expect(previewHtml).not.toContain("data-box-fragment=");
    expect(previewHtml).toContain('data-sigma-doc-id="box_manual_break_body_1"');
    expect(previewHtml).toContain('data-sigma-doc-id="box_manual_break_body_2"');
  });

  it("keeps a box whole when it fits the available page height", () => {
    const note = createBoxBlock("tcolorbox-note", "", {
      id: "box_no_break_note",
      bodyId: "box_no_break_body_1",
    });
    note.blocks = [
      richParagraph("box_no_break_body_1", "本文 1"),
      richParagraph("box_no_break_body_2", "本文 2"),
    ];

    const html = renderToStaticMarkup(
      <PrintPreview
        document={documentWithColumns(1, [note], {
          preset: "custom",
          orientation: "portrait",
          pageSize: { widthMm: 96, heightMm: 140 },
          marginsMm: { top: 8, right: 8, bottom: 8, left: 8 },
          flow: { type: "columns", columnCount: 1, columnGapMm: 0 },
        })}
        profile="teacher"
      />,
    );
    const previewHtml = renderedPreviewHtml(html);

    expect(previewHtml).not.toContain("data-box-fragment=");
  });

  it("moves a keepTogether box instead of splitting it across pages", () => {
    const note = createBoxBlock("tcolorbox-note", "", {
      id: "keep_together_note",
      bodyId: "keep_together_body_1",
    });
    note.pagination = { keepTogether: true };
    note.blocks = [
      richParagraph("keep_together_body_1", "本文 1"),
      richParagraph("keep_together_body_2", "本文 2"),
    ];
    const filler = Array.from({ length: 4 }, (_, index) => (
      paragraph(`keep_together_filler_${index + 1}`, `前置き ${index + 1}`)
    ));

    const html = renderToStaticMarkup(
      <PrintPreview
        document={documentWithColumns(1, [...filler, note], {
          ...shortTwoColumnPageLayout(),
          flow: { type: "columns", columnCount: 1, columnGapMm: 0 },
        })}
        profile="teacher"
      />,
    );
    const previewHtml = renderedPreviewHtml(html);

    expect(renderedPageColumns(html)).toEqual([
      [filler.map((block) => block.id)],
      [["keep_together_note", "keep_together_body_1", "keep_together_body_2"]],
    ]);
    expect(previewHtml).not.toContain("data-box-fragment=");
  });

  it("pixel-slices a standalone block taller than a whole page across pages", () => {
    const html = renderToStaticMarkup(
      <PrintPreview
        document={documentWithColumns(1, [
          richParagraph("tall_para_intro", "導入"),
          richParagraph("tall_para", `非常に長い段落。${"ページの高さを超える本文がここに続きます。".repeat(60)}`),
        ], {
          preset: "custom",
          orientation: "portrait",
          pageSize: { widthMm: 96, heightMm: 72 },
          marginsMm: { top: 8, right: 8, bottom: 8, left: 8 },
          flow: { type: "columns", columnCount: 1, columnGapMm: 0 },
        })}
        profile="teacher"
      />,
    );
    const previewHtml = html.split('<div class="print-measure-layer"')[0] ?? html;
    const pageColumns = renderedPageColumns(html);
    const sliceRoles = [...previewHtml.matchAll(/data-block-slice="([^"]+)"/g)].map((m) => m[1]);

    expect(pageColumns.length).toBeGreaterThan(1);
    expect(sliceRoles).toContain("first");
    expect(sliceRoles).toContain("last");
    expect(previewHtml).toContain('data-block-source-id="tall_para"');
  });

  it("pixel-slices a box whose single child is taller than a column", () => {
    const note = createBoxBlock("tcolorbox-note", "", {
      id: "giant_child_box",
      bodyId: "giant_child_body",
    });
    note.blocks = [
      richParagraph("giant_child_body", `巨大な単一の子。${"区切れない長い本文が延々と続きます。".repeat(60)}`),
    ];

    const html = renderToStaticMarkup(
      <PrintPreview
        document={documentWithColumns(1, [note], {
          preset: "custom",
          orientation: "portrait",
          pageSize: { widthMm: 96, heightMm: 72 },
          marginsMm: { top: 8, right: 8, bottom: 8, left: 8 },
          flow: { type: "columns", columnCount: 1, columnGapMm: 0 },
        })}
        profile="teacher"
      />,
    );
    const previewHtml = html.split('<div class="print-measure-layer"')[0] ?? html;
    const pageColumns = renderedPageColumns(html);
    const sliceRoles = [...previewHtml.matchAll(/data-block-slice="([^"]+)"/g)].map((m) => m[1]);

    expect(pageColumns.length).toBeGreaterThan(1);
    expect(sliceRoles).toContain("first");
    expect(sliceRoles).toContain("last");
    expect(previewHtml).toContain('data-block-source-id="giant_child_box"');
  });

  it("honors a manual break on a layout section child that would otherwise fit one column", () => {
    // The section fits a column and holds no box, so print used to keep it atomic and
    // drop the child's break — while the editor always flows a section that carries a
    // manual break (hasManualColumnBreak). Print must follow the editor.
    const html = renderToStaticMarkup(
      <PrintPreview
        document={documentWithColumns(2, [
          {
            type: "layoutSection",
            id: "layout_section_manual_break",
            layout: { columnCount: 2, columnGapMm: 6 },
            children: [
              richParagraph("layout_manual_break_first", "改段の前"),
              {
                ...richParagraph("layout_manual_break_second", "改段の後"),
                pagination: { break: true },
              },
            ],
          },
        ], shortTwoColumnPageLayout())}
        profile="teacher"
      />,
    );
    const previewHtml = renderedPreviewHtml(html);

    // Going through the breakable path at all is what makes the child break reachable:
    // atomic placement renders the section as CSS multicol, where break is inert.
    expect(previewHtml).toContain("print-layout-section-fragment");

    // Inside the section, the break moves the child to the section's next column.
    const sectionColumns = previewHtml
      .split('<div class="print-layout-section-column"')
      .slice(1)
      .map((chunk) => chunk.slice(0, chunk.indexOf("</div>")));
    const columnOfFirst = sectionColumns.findIndex((chunk) => chunk.includes("layout_manual_break_first"));
    const columnOfSecond = sectionColumns.findIndex((chunk) => chunk.includes("layout_manual_break_second"));
    expect(columnOfFirst).toBeGreaterThanOrEqual(0);
    expect(columnOfSecond).toBeGreaterThan(columnOfFirst);
  });

  it("reserves frame chrome height when fitting a split framed problem area", () => {
    // A framed fragment draws its own border+padding, so its box is taller than the sum
    // of its blocks. If pagination ignored that, the blocks below a manual break would be
    // packed into a column that cannot actually hold them once the frame is drawn.
    const html = renderToStaticMarkup(
      <PrintPreview
        document={documentWithColumns(2, [
          {
            type: "problem",
            id: "problem_framed_chrome",
            tags: [],
            numbering: { enabled: false },
            lead: [],
            prompt: [
              richParagraph("framed_chrome_1", "枠内 1"),
              { ...richParagraph("framed_chrome_2", "枠内 2"), pagination: { break: true } },
              richParagraph("framed_chrome_3", "枠内 3"),
            ],
            solution: [],
            hints: [],
            frame: { enabled: true, styleId: "cornerbox" },
          },
        ], shortTwoColumnPageLayout())}
        profile="teacher"
      />,
    );
    const previewHtml = renderedPreviewHtml(html);
    const columns = renderedPageColumns(html)
      .flat()
      .map((column) => column.filter((id) => id.startsWith("framed_chrome_")));

    // cornerbox has the largest padding (6.4mm top+bottom), so its chrome is what most
    // easily pushes a fragment past a column bottom.
    expect(previewHtml).toContain('data-problem-frame-style="cornerbox"');
    const columnOfFirst = columns.findIndex((ids) => ids.includes("framed_chrome_1"));
    const columnOfSecond = columns.findIndex((ids) => ids.includes("framed_chrome_2"));
    expect(columnOfFirst).toBeGreaterThanOrEqual(0);
    expect(columnOfSecond).toBeGreaterThan(columnOfFirst);
    // Every block still renders — reserving chrome must not drop content.
    expect(columns.flat()).toEqual(
      expect.arrayContaining(["framed_chrome_1", "framed_chrome_2", "framed_chrome_3"]),
    );
  });

  it("splits oversized box blocks inside layout sections into print fragments", () => {
    const note = createBoxBlock("tcolorbox-note", "", {
      id: "layout_split_note_box",
      bodyId: "layout_split_note_body_1",
    });
    note.blocks = Array.from({ length: 18 }, (_, index) => (
      richParagraph(`layout_split_note_body_${index + 1}`, `段組みノート本文 ${index + 1}`)
    ));

    const html = renderToStaticMarkup(
      <PrintPreview
        document={documentWithColumns(1, [
          {
            type: "layoutSection",
            id: "layout_section_with_split_box",
            layout: { columnCount: 2, columnGapMm: 6 },
            children: [
              richParagraph("layout_split_intro", "段組み内の導入文"),
              note,
            ],
          },
        ], {
          preset: "custom",
          orientation: "portrait",
          pageSize: { widthMm: 96, heightMm: 72 },
          marginsMm: { top: 8, right: 8, bottom: 8, left: 8 },
          flow: { type: "columns", columnCount: 1, columnGapMm: 0 },
        })}
        profile="teacher"
      />,
    );
    const previewHtml = html.split('<div class="print-measure-layer"')[0] ?? html;
    const pageColumns = renderedPageColumns(html);
    const renderedNoteBodyIds = pageColumns.flat(2).filter((id) => id.startsWith("layout_split_note_body_"));

    expect(pageColumns.length).toBeGreaterThan(1);
    expect(previewHtml).toContain('data-layout-section-fragment="first"');
    expect(previewHtml).toContain('data-layout-section-fragment="last"');
    expect(previewHtml).toContain('data-box-source-id="layout_split_note_box"');
    expect(previewHtml).toContain('data-box-fragment="first"');
    expect(previewHtml).toContain('data-box-fragment="last"');
    expect(renderedNoteBodyIds).toContain("layout_split_note_body_1");
    expect(renderedNoteBodyIds).toContain("layout_split_note_body_18");
  });
});

function thumbnailDocument(): SigmaDocument {
  return documentWithColumns(1, [
    {
      type: "heading",
      id: "thumbnail_heading",
      level: 2,
      children: [
        { type: "text", text: "二次関数の確認" },
        { type: "mathInline", id: "thumbnail_math", tex: "y=ax^2", display: "inline" },
      ],
    },
    paragraph("thumbnail_body", "グラフの形と係数の関係を確認する。"),
    ...Array.from({ length: 80 }, (_, index) => (
      paragraph(`thumbnail_tail_${index}`, `追加問題 ${index + 1}`)
    )),
  ], {
    preset: "B5",
    orientation: "portrait",
    pageSize: { widthMm: 182, heightMm: 257 },
    marginsMm: { top: 18, right: 16, bottom: 18, left: 16 },
    flow: { type: "columns", columnCount: 1, columnGapMm: 0 },
  });
}

function documentWithColumns(
  columnCount: number,
  content: SigmaBlock[],
  pageLayout?: SigmaDocument["pageLayout"],
): SigmaDocument {
  return {
    ...document,
    docId: `doc_print_preview_columns_${columnCount}`,
    metadata: {
      title: "段組み改ページ検証",
    },
    content,
    pageLayout: pageLayout ?? {
      preset: "A4",
      orientation: "portrait",
      pageSize: { widthMm: 210, heightMm: 297 },
      marginsMm: { top: 18, right: 17, bottom: 18, left: 17 },
      flow: { type: "columns", columnCount, columnGapMm: 8 },
    },
  };
}

function shortTwoColumnPageLayout(): NonNullable<SigmaDocument["pageLayout"]> {
  return {
    preset: "custom",
    orientation: "portrait",
    pageSize: { widthMm: 80, heightMm: 90 },
    marginsMm: { top: 10, right: 10, bottom: 10, left: 10 },
    flow: { type: "columns", columnCount: 2, columnGapMm: 8 },
  };
}

function paragraph(
  id: string,
  text: string,
  options: Pick<SigmaBlock, "pagination"> = {},
): SigmaBlock {
  return {
    type: "paragraph",
    id,
    pagination: options.pagination,
    children: [{ type: "text", text }],
  };
}

function richParagraph(id: string, text: string) {
  return {
    type: "paragraph" as const,
    id,
    children: [{ type: "text" as const, text }],
  };
}

function renderedPageColumns(html: string): string[][][] {
  const previewHtml = renderedPreviewHtml(html);
  const pageChunks = previewHtml.split(/<section class="print-a4-page"[^>]*>/).slice(1);

  return pageChunks.map((pageHtml) => {
    const columnsStart = pageHtml.indexOf('<div class="print-page-columns">');
    if (columnsStart < 0) {
      return [];
    }

    return pageHtml
      .slice(columnsStart)
      .split('<div class="print-page-column">')
      .slice(1)
      .map((columnHtml) => (
        [...columnHtml.matchAll(/data-sigma-doc-id="([^"]+)"/g)].map((idMatch) => idMatch[1])
      ));
  });
}

function renderedPreviewHtml(html: string): string {
  return html.split('<div class="print-measure-layer"')[0] ?? html;
}

/** The opening `<section ...>` tag containing the given marker attribute, so a
 * test can assert on that one fragment's classes without matching a sibling's. */
function sectionTagContaining(html: string, marker: string): string {
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) {
    return "";
  }
  const start = html.lastIndexOf("<section", markerIndex);
  const end = html.indexOf(">", markerIndex);
  return html.slice(start, end + 1);
}
