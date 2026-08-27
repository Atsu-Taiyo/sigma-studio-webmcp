"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor as TiptapEditor } from "@tiptap/core";

import { createRichTextEngineExtensions } from "@/components/tiptap/rich-text-engine";
import { dispatchTextFormatState } from "@/components/tiptap/text-format-controller";
import { DEFAULT_BODY_FONT_FAMILY, type OverlayRichTextDocument } from "@/features/document";
import { useMathEnvironment } from "@/features/rendering/adapters/react";
import {
  CALLOUT_TEXT_PADDING,
  getShapeRotation,
  getTextShapeFontSizePt,
  getTextShapeRenderedLineHeightPx,
  MIN_TEXT_SHAPE_WIDTH,
} from "@/features/drawing";
import {
  overlayRichTextToTiptapDoc,
  tiptapDocToOverlayRichText,
  type TiptapDoc,
  type TiptapNode,
} from "@/lib/tiptap-adapter";

import { createTranslator, getAppLocale } from "@/lib/i18n";
import { toRichText } from "./ids";
import type {
  OverlayShape,
  OverlayShapeId,
} from "./types";

/** 空のまま確定したテキスト図形に入る既定文字。**文書に焼き込まれる**ので、
 *  入力した時点の UI 言語で解決する (`chrome.insert.text.label` と同じ語)。 */
const DEFAULT_TEXT_SHAPE_TEXT_KEY = "insert.text.label" as const;
// Mirrors `TEXT_FORMAT_STATE_EVENT` in editor-shell/constants (kept local for the same reason
// `RichTextEditor` does: the overlay canvas must not depend on the shell module).
const TEXT_FORMAT_STATE_EVENT = "sigma-studio:text-format-state";
// Auto-sized figure text/formulas hug their content with zero padding; the
// Math.ceil() in the measure routine already guards against sub-pixel clipping.
const TEXT_SHAPE_MEASURE_PADDING = 0;

export function OverlayTextShapeEditor({
  shape,
  externalRevision,
  editing,
  onFocus,
  onCancel,
  onAutoSize,
  onChange,
}: {
  shape: Extract<OverlayShape, { type: "text" | "callout" }>;
  externalRevision: number;
  editing: boolean;
  onFocus: (editor: TiptapEditor, shapeId: OverlayShapeId) => void;
  onCancel: (shapeId: OverlayShapeId) => void;
  onAutoSize: (shapeId: OverlayShapeId, width: number, height: number) => void;
  onChange: (shapeId: OverlayShapeId, richText: OverlayRichTextDocument) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef(shape.props.richText);
  const previousExternalRevisionRef = useRef(externalRevision);
  const mathEnvironment = useMathEnvironment();
  const editor = useEditor({
    extensions: createRichTextEngineExtensions({
      // The static twin of this editor (`OverlayTextShapeStaticView`) draws per-segment borders,
      // so drawing one rectangle per run here would change the box the moment the shape is
      // focused. See `BoxedTextRunHeightOptions.drawRunFrames`.
      drawBoxedRunFrames: false,
      enableMathDelimiters: true,
      // Static overlay text reads the document environment from MathEnvironmentProvider through
      // MathPreview. Give the editing Tiptap surface the same preamble macros and typeset style so
      // focusing a shape cannot silently fall back to the process-wide defaults.
      mathEnvironment,
      textBlockStyle: true,
    }),
    content: overlayRichTextToTiptapDoc(shape.props.richText),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "overlay-text-shape-content",
      },
      handleKeyDown: (_view, event) => {
        if (event.key !== "Escape") {
          return false;
        }

        event.preventDefault();
        onCancel(shape.id);
        return true;
      },
    },
    // 図中テキストも本文と同じツールバーボタンを使うので、B/I/U の点灯状態を
    // 同じイベントで流す。storedMarks だけが変わる折り返しキャレットの切り替えも
    // onTransaction なら拾える。
    onTransaction: ({ editor: activeEditor }) => {
      if (activeEditor.isFocused) {
        dispatchTextFormatState(
        activeEditor,
        TEXT_FORMAT_STATE_EVENT,
        "overlay",
        undefined,
        // 図中テキストは font-family を自分では指定せず本文と同じ既定を継承する
        // (`document-surface.css` の `.overlay-text-shape` に family 指定は無い)。
        { state: activeEditor.state, documentFontFamily: DEFAULT_BODY_FONT_FAMILY },
      );
      }
    },
    onFocus: ({ editor: activeEditor }) => {
      dispatchTextFormatState(
        activeEditor,
        TEXT_FORMAT_STATE_EVENT,
        "overlay",
        undefined,
        // 図中テキストは font-family を自分では指定せず本文と同じ既定を継承する
        // (`document-surface.css` の `.overlay-text-shape` に family 指定は無い)。
        { state: activeEditor.state, documentFontFamily: DEFAULT_BODY_FONT_FAMILY },
      );
      onFocus(activeEditor, shape.id);
    },
    onBlur: ({ editor: activeEditor }) => {
      const json = activeEditor.getJSON() as TiptapDoc;
      if (!isTiptapDocEmpty(json)) {
        return;
      }

      const fallback = toRichText(createTranslator(getAppLocale(), "chrome")(DEFAULT_TEXT_SHAPE_TEXT_KEY));
      contentRef.current = fallback;
      activeEditor.commands.setContent(overlayRichTextToTiptapDoc(fallback), { emitUpdate: false });
      onChange(shape.id, fallback);
    },
    onUpdate: ({ editor: activeEditor }) => {
      dispatchTextFormatState(
        activeEditor,
        TEXT_FORMAT_STATE_EVENT,
        "overlay",
        undefined,
        // 図中テキストは font-family を自分では指定せず本文と同じ既定を継承する
        // (`document-surface.css` の `.overlay-text-shape` に family 指定は無い)。
        { state: activeEditor.state, documentFontFamily: DEFAULT_BODY_FONT_FAMILY },
      );
      const json = activeEditor.getJSON() as TiptapDoc;
      const richText = tiptapDocToOverlayRichText(json);
      contentRef.current = richText;
      onChange(shape.id, richText);
    },
  });

  useEffect(() => {
    if (!editor) {
      return;
    }

    const isExternalRestore = previousExternalRevisionRef.current !== externalRevision;
    previousExternalRevisionRef.current = externalRevision;
    if (editor.isFocused && !isExternalRestore) {
      return;
    }

    const serializedCurrent = JSON.stringify(contentRef.current);
    const serializedNext = JSON.stringify(shape.props.richText);
    if (serializedCurrent !== serializedNext) {
      contentRef.current = shape.props.richText;
      const nextContent = overlayRichTextToTiptapDoc(shape.props.richText);
      const timeoutId = window.setTimeout(() => {
        if (!editor.isDestroyed && (!editor.isFocused || isExternalRestore)) {
          editor.commands.setContent(nextContent, { emitUpdate: false });
          if (isExternalRestore && editing) {
            editor.commands.focus("end");
          }
        }
      }, 0);

      return () => window.clearTimeout(timeoutId);
    }
  }, [editing, editor, externalRevision, shape.props.richText]);

  useEffect(() => {
    if (editing && editor && !editor.isFocused) {
      window.setTimeout(() => editor.commands.focus("end"), 0);
    }
  }, [editing, editor]);

  const isCallout = shape.type === "callout";
  // Callouts are always DOM-measured for height, independent of the `text`-only `autoSize`
  // prop: `getCalloutBodySize` already renders every callout at
  // `max(props.h, content height + padding*2)`, so a callout can never draw smaller than its
  // content regardless of what's saved -- this measure loop only keeps the *saved* `props.h`
  // in sync with what's already on screen. See `handleTextAutoSize` for the write-back, which
  // is height-only and grow-only (never shrinks, never touches `props.w`) for callouts, so
  // there's no new constraint here and no tug-of-war with `getCalloutBodySize`.
  const autoSize = (shape.type === "text" && shape.props.autoSize) || isCallout;
  const maxWidth = shape.type === "text" ? shape.props.maxWidth : undefined;
  const scale = shape.type === "text" ? shape.props.scale : undefined;
  const lineHeightPx = getTextShapeRenderedLineHeightPx(shape);
  const rotation = getShapeRotation(shape);
  // Callouts never auto-widen (PR #333 fixed callout width at `props.w`; only height is
  // content-derived), so route them through the same fixed-width/height-only measurement
  // path `constrainedAutoSize` already provides for `text` shapes with `maxWidth` set.
  const constrainedAutoSize = isCallout || (autoSize && maxWidth !== undefined);

  useLayoutEffect(() => {
    if (!autoSize) {
      return;
    }

    const measure = () => {
      const content = wrapperRef.current?.querySelector<HTMLElement>(".ProseMirror");
      if (!content) {
        return;
      }

      let measuredWidth: number;
      let measuredContentHeight: number;
      if (rotation === 0) {
        const contentRect = content.getBoundingClientRect();
        // `.page-stack` applies CSS `zoom` (see globals.css), which scales `getBoundingClientRect()`
        // results (here and on every descendant) but leaves `scrollWidth`/`scrollHeight` in local,
        // unzoomed CSS px. Combining the two unit systems with a raw `Math.max` (as this used to)
        // meant editing at e.g. 150% zoom saved a 1.5x-inflated `props.w`/`props.h`. Recover the
        // actual zoom factor from this same element's rect-vs-offset ratio -- the same "derive the
        // ratio from a DOM measurement" approach `pagePointFromClient` uses -- and normalize every
        // rect-derived number back to unzoomed units before mixing it with the zoom-immune
        // scroll{Width,Height} readings.
        const effectiveZoom = content.offsetWidth > 0 ? contentRect.width / content.offsetWidth : 1;
        const descendantRects = Array.from(content.querySelectorAll<HTMLElement>("*"))
          .map((element) => element.getBoundingClientRect())
          .filter((rect) => rect.width > 0 || rect.height > 0);
        const maxRight = Math.max(contentRect.right, ...descendantRects.map((rect) => rect.right));
        const maxBottom = Math.max(contentRect.bottom, ...descendantRects.map((rect) => rect.bottom));
        const unzoomedContentWidth = contentRect.width / effectiveZoom;
        const unzoomedContentHeight = contentRect.height / effectiveZoom;
        const unzoomedRightSpan = (maxRight - contentRect.left) / effectiveZoom;
        const unzoomedBottomSpan = (maxBottom - contentRect.top) / effectiveZoom;

        measuredWidth = constrainedAutoSize
          ? maxWidth ?? shape.props.w
          : Math.ceil(Math.max(
            MIN_TEXT_SHAPE_WIDTH,
            content.scrollWidth,
            unzoomedContentWidth,
            unzoomedRightSpan,
          )) + TEXT_SHAPE_MEASURE_PADDING;
        measuredContentHeight = Math.ceil(Math.max(
          lineHeightPx,
          content.scrollHeight,
          unzoomedContentHeight,
          unzoomedBottomSpan,
        )) + TEXT_SHAPE_MEASURE_PADDING;
      } else {
        // Rotation turns every descendant rect into an AABB and destroys the original corner
        // positions, so the overflow scan cannot be un-rotated. Layout metrics stay local and
        // unzoomed, which makes them the only stable measurement source on this branch.
        measuredWidth = constrainedAutoSize
          ? maxWidth ?? shape.props.w
          : Math.ceil(Math.max(
            MIN_TEXT_SHAPE_WIDTH,
            content.scrollWidth,
            content.offsetWidth,
          )) + TEXT_SHAPE_MEASURE_PADDING;
        measuredContentHeight = Math.ceil(Math.max(
          lineHeightPx,
          content.scrollHeight,
          content.offsetHeight,
        )) + TEXT_SHAPE_MEASURE_PADDING;
      }
      // The callout editor mounts inside `.overlay-callout-text-frame` (`getCalloutTextRect`),
      // which is already the *content* rect -- `CALLOUT_TEXT_PADDING` subtracted on every
      // side. `measuredContentHeight` above is therefore the callout's content height, not its
      // box height; add the padding back so `onAutoSize`'s height argument means "target
      // `props.h`" the same way it already does for `text` shapes.
      const measuredHeight = isCallout
        ? measuredContentHeight + CALLOUT_TEXT_PADDING * 2
        : measuredContentHeight;
      onAutoSize(shape.id, measuredWidth, measuredHeight);
    };

    measure();
    let frameId: number | null = null;
    const scheduleMeasure = () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        measure();
      });
    };
    const content = wrapperRef.current?.querySelector<HTMLElement>(".ProseMirror");
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleMeasure);
    const mutationObserver = typeof MutationObserver === "undefined" ? null : new MutationObserver(scheduleMeasure);
    if (content) {
      resizeObserver?.observe(content);
      mutationObserver?.observe(content, {
        attributes: true,
        attributeFilter: [
          "class",
          "style",
          "data-boxed-run-aligned",
          "data-sigma-doc-boxed-padding-y",
          "data-sigma-doc-boxed-variant",
          "data-sigma-doc-boxed-tone",
          "data-sigma-doc-boxed-math",
        ],
        childList: true,
        subtree: true,
      });
    }
    scheduleMeasure();
    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
    // IMPORTANT: do not add `shape.props.h` (or anything else this effect's own `onAutoSize`
    // call writes back, e.g. `shape.props.w` in the unconstrained-width branch above) to this
    // dependency list. `minHeight` below is derived from `shape.props.h`, and `measure()` reads
    // the rendered box back via `getBoundingClientRect()`/`scrollHeight` -- so a written value
    // would feed back into its own trigger. Today that self-reference is silently broken by `h`
    // being absent here; if it's ever restored, the loop stops only because `onAutoSize`'s
    // 1px-diff guard (see `handleTextAutoSize`) happens to make each re-fire measure the same
    // value it just wrote. That guard living in a different file is exactly what makes this
    // fragile: extract the measured value into a ref instead of re-deriving it from the DOM if
    // you need to react to it here.
  }, [autoSize, constrainedAutoSize, editing, isCallout, lineHeightPx, maxWidth, onAutoSize, rotation, scale, shape.id, shape.props.fontSize, shape.props.richText, shape.props.size, shape.props.w]);

  return (
    <div
      ref={wrapperRef}
      className={`overlay-text-shape ${isCallout ? "embedded-callout" : ""} ${autoSize ? "auto-size" : ""} ${constrainedAutoSize ? "constrained" : ""}`}
      style={{
        width: isCallout ? "100%" : constrainedAutoSize ? maxWidth : autoSize ? "max-content" : shape.props.w,
        minWidth: isCallout ? 0 : MIN_TEXT_SHAPE_WIDTH,
        minHeight: isCallout ? lineHeightPx : Math.max(shape.props.h ?? 0, lineHeightPx),
        color: shape.props.color,
        fontSize: `${getTextShapeFontSizePt(shape)}pt`,
        pointerEvents: editing ? "auto" : "none",
      }}
      onPointerDown={(event) => {
        if (editing) {
          event.stopPropagation();
        }
      }}
    >
      <EditorContent editor={editor} />
    </div>
  );
}
function isTiptapDocEmpty(doc: TiptapDoc): boolean {
  return !(doc.content ?? []).some(hasTiptapNodeContent);
}

function hasTiptapNodeContent(node: TiptapNode): boolean {
  if (node.type === "text") {
    return Boolean(node.text?.trim());
  }

  if (node.type !== "doc" && node.type !== "paragraph" && node.type !== "heading") {
    return true;
  }

  return (node.content ?? []).some(hasTiptapNodeContent);
}
