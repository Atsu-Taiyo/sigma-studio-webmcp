"use client";

import { useMemo, type CSSProperties } from "react";

import {
  normalizeCodeBlockTheme,
  type CodeBlockNode,
  type DividerNode,
  type InlineNode,
  type MathFractionSizing,
  type QuoteBlockNode,
  type RichBlock,
} from "@/features/document";
import {
  codeHighlightRanges,
  listMarkerTypographyDomSpec,
  normalizeCodeLanguage,
} from "@/features/rendering/adapters";
import {
  boxedInlineRunAlignmentSignature,
  renderInlineContent,
  useBoxedInlineRunAlignment,
} from "@/features/rendering/adapters/react";
import { stripWrappingMarkdownCodeFence } from "@/features/rendering/core";

type TextResolver = (text: string) => string;

/**
 * Class names the host wants on each block element.
 *
 * The print preview needs its `.print-*` family (the viewer, thumbnails and the template gallery
 * style against it); the running region wants none, because it renders inside `.text-flow-editor`
 * and takes the body's own typography. Everything else about the markup is identical — that is the
 * point of this component.
 */
export interface TextFlowStaticBlockClassNames {
  heading?: string;
  list?: string;
  paragraph?: string;
  quote?: string;
  code?: string;
  divider?: string;
}

/**
 * 静的描画が受け付けるブロック。`RichBlock` に引用・コード・区切り線を足しただけで、
 * 問題エリア・段組・囲み枠の中身はすべてこの集合で描ける (ヘッダー/フッターは `RichBlock` のみ)。
 */
export type TextFlowStaticBlockNode = RichBlock | QuoteBlockNode | CodeBlockNode | DividerNode;

interface TextFlowStaticBlockProps {
  block: TextFlowStaticBlockNode;
  classNames?: TextFlowStaticBlockClassNames;
  mathFractionSizing?: MathFractionSizing | null;
  resolveText?: TextResolver;
}

const identityTextResolver: TextResolver = (text) => text;
const NO_CLASS_NAMES: TextFlowStaticBlockClassNames = {};

/**
 * Read-only rendering of one body block.
 *
 * Header/footer content used to be drawn by a second implementation with its own `.print-*` CSS
 * family, so the PDF surface styled running text differently from the body — the values happened to
 * match, and `.text-flow-editor p` (0,1,1) already outranked `.print-paragraph` (0,1,0), so nobody
 * noticed. One renderer, class names chosen by the host.
 *
 * `data-sigma-doc-id` must stay: `page-windows.ts` indexes the paged surface by it, and running
 * region blocks are cloned onto every page.
 */
export function TextFlowStaticBlock({
  block,
  classNames = NO_CLASS_NAMES,
  mathFractionSizing,
  resolveText = identityTextResolver,
}: TextFlowStaticBlockProps) {
  if (block.type === "heading") {
    return (
      <TextFlowStaticHeading
        block={block}
        className={classNames.heading}
        mathFractionSizing={mathFractionSizing}
        resolveText={resolveText}
      />
    );
  }

  if (block.type === "list") {
    return (
      <TextFlowStaticList
        block={block}
        classNames={classNames}
        mathFractionSizing={mathFractionSizing}
        resolveText={resolveText}
      />
    );
  }

  if (block.type === "quote") {
    // 縦棒はこの `blockquote` に 1 本だけ引く。中身が何ブロックでも繋ぎ目は生まれない。
    return (
      <blockquote data-sigma-doc-id={block.id} className={classNames.quote}>
        {block.blocks.map((child) => (
          <TextFlowStaticBlock
            key={child.id}
            block={child}
            classNames={classNames}
            mathFractionSizing={mathFractionSizing}
            resolveText={resolveText}
          />
        ))}
      </blockquote>
    );
  }

  if (block.type === "codeBlock") {
    return <TextFlowStaticCodeBlock block={block} className={classNames.code} resolveText={resolveText} />;
  }

  if (block.type === "divider") {
    return <hr data-sigma-doc-id={block.id} className={classNames.divider} />;
  }

  return (
    <TextFlowStaticParagraph
      block={block}
      className={classNames.paragraph}
      mathFractionSizing={mathFractionSizing}
      resolveText={resolveText}
    />
  );
}

function TextFlowStaticHeading({
  block,
  className,
  mathFractionSizing,
  resolveText,
}: {
  block: Extract<RichBlock, { type: "heading" }>;
  className?: string;
  mathFractionSizing?: MathFractionSizing | null;
  resolveText: TextResolver;
}) {
  const HeadingTag = `h${block.level}` as "h1" | "h2" | "h3";
  const dependencyKey = useInlineAlignmentDependencyKey(block.children);
  const { aligned, alignmentStyles, ref } = useBoxedInlineRunAlignment<HTMLHeadingElement>(dependencyKey);

  return (
    <HeadingTag
      ref={ref}
      data-boxed-run-aligned={aligned ? "true" : undefined}
      data-sigma-doc-id={block.id}
      className={className}
      style={{ textAlign: block.align ?? "left", lineHeight: block.lineHeight }}
    >
      {renderInlineContent(block.children, { alignmentStyles, keyPrefix: block.id, mathFractionSizing, resolveText })}
    </HeadingTag>
  );
}

function TextFlowStaticParagraph({
  block,
  className,
  mathFractionSizing,
  resolveText,
}: {
  block: Extract<RichBlock, { type: "paragraph" }>;
  className?: string;
  mathFractionSizing?: MathFractionSizing | null;
  resolveText: TextResolver;
}) {
  const dependencyKey = useInlineAlignmentDependencyKey(block.children);
  const { aligned, alignmentStyles, ref } = useBoxedInlineRunAlignment<HTMLParagraphElement>(dependencyKey);

  return (
    <p
      ref={ref}
      data-boxed-run-aligned={aligned ? "true" : undefined}
      data-sigma-doc-id={block.id}
      className={className}
      style={{ textAlign: block.align ?? "left", lineHeight: block.lineHeight }}
    >
      {renderInlineContent(block.children, { alignmentStyles, keyPrefix: block.id, mathFractionSizing, resolveText })}
      {!paragraphHasVisibleContent(block.children) && <br key="trailing-break" />}
    </p>
  );
}

/**
 * コードブロック。`<pre>` 1 つに全行が入るので、行間はこのブロックの line-height だけで決まる
 * — 段落を積んでいたときのように「1 行目だけ余白が違う」ことが起きない。
 *
 * 色分けは編集中の ProseMirror と **同じ `codeHighlightRanges`** から出す。run の書式
 * (フォント・大きさ・色) はその上に重ねるので、明示指定があればトークンの色より勝つ。
 */
function TextFlowStaticCodeBlock({
  block,
  className,
  resolveText,
}: {
  block: CodeBlockNode;
  className?: string;
  resolveText: TextResolver;
}) {
  const language = normalizeCodeLanguage(block.language);
  const theme = normalizeCodeBlockTheme(block.theme) ?? "light";
  const segments = useMemo(
    () => splitCodeIntoHighlightedSegments(block.children, language, resolveText),
    [block.children, language, resolveText],
  );

  return (
    <pre
      data-sigma-doc-id={block.id}
      data-code-language={language}
      data-code-theme={theme}
      className={className}
    >
      {segments.map((segment, index) => (
        <span
          // 分割位置は本文と言語だけで決まるので、index で安定する。
          key={`${block.id}:${index}`}
          className={segment.className}
          style={segment.style}
        >
          {segment.text}
        </span>
      ))}
      {segments.length === 0 && <br key="trailing-break" />}
    </pre>
  );
}

interface CodeSegment {
  text: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * run の境界と色分けトークンの境界の **両方** で切る。
 *
 * 位置合わせは編集面と同じ規約: 数式などのテキストでない run は 1 文字ぶんとして数える
 * (`code-highlight-extension.ts` の `ATOM_CHAR` と同じ)。ここがずれると「編集中と印刷で
 * 色の付く範囲が違う」という、いちばん見つけにくい形の食い違いになる。
 */
function splitCodeIntoHighlightedSegments(
  children: readonly InlineNode[],
  language: string | undefined,
  resolveText: TextResolver,
): CodeSegment[] {
  const resolvedChildren = childrenWithoutWrappingMarkdownFence(children, resolveText);
  const code = resolvedChildren
    .map((child) => (child.type === "text" ? child.text : "￼"))
    .join("");
  const ranges = codeHighlightRanges(code, language);

  const segments: CodeSegment[] = [];
  let offset = 0;
  let rangeIndex = 0;
  for (const child of resolvedChildren) {
    const text = child.type === "text" ? child.text : "￼";
    const style = child.type === "text" ? inlineCodeRunStyle(child) : undefined;
    let cursor = 0;
    while (cursor < text.length) {
      while (rangeIndex < ranges.length && ranges[rangeIndex].to <= offset + cursor) {
        rangeIndex += 1;
      }
      const range = ranges[rangeIndex];
      const inRange = range !== undefined && range.from <= offset + cursor;
      const end = range === undefined
        ? text.length
        : Math.min(text.length, (inRange ? range.to : range.from) - offset);
      segments.push({
        text: text.slice(cursor, Math.max(cursor + 1, end)),
        className: inRange ? range.className : undefined,
        style,
      });
      cursor = Math.max(cursor + 1, end);
    }
    offset += text.length;
  }
  return segments;
}

function childrenWithoutWrappingMarkdownFence(
  children: readonly InlineNode[],
  resolveText: TextResolver,
): InlineNode[] {
  const resolved = children.map((child) => (
    child.type === "text" ? { ...child, text: resolveText(child.text) } : child
  ));
  const joined = resolved
    .map((child) => (child.type === "text" ? child.text : "￼"))
    .join("");
  const stripped = stripWrappingMarkdownCodeFence(joined);
  if (stripped === joined) {
    return resolved;
  }
  return [{ type: "text", text: stripped }];
}

/** コードの run が持つ書式。トークンの色より後に当たるので、明示指定はこちらが勝つ。 */
function inlineCodeRunStyle(child: Extract<InlineNode, { type: "text" }>): CSSProperties | undefined {
  const style: CSSProperties = {};
  if (child.color) {
    style.color = child.color;
  }
  if (child.backgroundColor) {
    style.backgroundColor = child.backgroundColor;
  }
  if (child.fontFamily) {
    style.fontFamily = child.fontFamily;
  }
  if (child.fontSize) {
    style.fontSize = `${child.fontSize}pt`;
  }
  if (child.marks?.includes("bold")) {
    style.fontWeight = "bold";
  }
  if (child.marks?.includes("italic")) {
    style.fontStyle = "italic";
  }
  if (child.marks?.includes("underline")) {
    style.textDecoration = "underline";
  }
  return Object.keys(style).length > 0 ? style : undefined;
}

function TextFlowStaticList({
  block,
  classNames,
  mathFractionSizing,
  resolveText,
}: {
  block: Extract<RichBlock, { type: "list" }>;
  classNames: TextFlowStaticBlockClassNames;
  mathFractionSizing?: MathFractionSizing | null;
  resolveText: TextResolver;
}) {
  const items = block.items.map((item) => {
    // The marker inherits the `li` font, so the typography of the item's first run has to be
    // handed to `::marker` from here — the run's own span is inside the `li` and cannot reach it.
    // Note the asymmetry with the editing surface, where `data-sigma-doc-id` sits on the inner `p`:
    // these must stay on the `li` or the CSS rule never matches.
    const markerTypography = listMarkerTypographyDomSpec(item.children);
    return (
      <li
        key={item.id}
        data-sigma-doc-id={item.id}
        {...markerTypography?.attrs}
        style={markerTypography?.style as CSSProperties | undefined}
      >
        <TextFlowStaticListItemContent item={item} mathFractionSizing={mathFractionSizing} resolveText={resolveText} />
        {(item.continuations ?? []).map((continuation) => (
          <TextFlowStaticBlock
            key={continuation.id}
            block={continuation}
            classNames={classNames}
            mathFractionSizing={mathFractionSizing}
            resolveText={resolveText}
          />
        ))}
        {(item.nested ?? []).map((nested) => (
          <TextFlowStaticList
            key={nested.id}
            block={nested}
            classNames={classNames}
            mathFractionSizing={mathFractionSizing}
            resolveText={resolveText}
          />
        ))}
      </li>
    );
  });

  return block.listType === "ordered"
    ? (
      <ol
        data-sigma-doc-id={block.id}
        // `document-surface.css` swaps the counter style on this attribute, matching what the
        // editor's `orderedList` node renders. No marker style means the UA default decimal.
        data-list-marker={block.markerStyle === "paren" ? "paren" : undefined}
        className={classNames.list}
        start={block.start}
      >
        {items}
      </ol>
    )
    : <ul data-sigma-doc-id={block.id} className={classNames.list}>{items}</ul>;
}

function TextFlowStaticListItemContent({
  item,
  mathFractionSizing,
  resolveText,
}: {
  item: Extract<RichBlock, { type: "list" }>["items"][number];
  mathFractionSizing?: MathFractionSizing | null;
  resolveText: TextResolver;
}) {
  const dependencyKey = useInlineAlignmentDependencyKey(item.children);
  const { aligned, alignmentStyles, ref } = useBoxedInlineRunAlignment<HTMLSpanElement>(dependencyKey);

  return (
    <span
      ref={ref}
      data-boxed-run-aligned={aligned ? "true" : undefined}
      style={{ display: "block", textAlign: item.align ?? "left" }}
    >
      {renderInlineContent(item.children, { alignmentStyles, keyPrefix: item.id, mathFractionSizing, resolveText })}
    </span>
  );
}

/**
 * Empty paragraphs still need one line box, matching the ProseMirror editing surface.
 */
function paragraphHasVisibleContent(children: InlineNode[]): boolean {
  return children.some((child) => (child.type === "text" ? child.text.length > 0 : true));
}

function useInlineAlignmentDependencyKey(children: InlineNode[]): string {
  return useMemo(() => boxedInlineRunAlignmentSignature(children), [children]);
}
