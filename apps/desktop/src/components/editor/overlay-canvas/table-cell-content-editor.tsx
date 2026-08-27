"use client";

import { useEffect, useMemo, useRef } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
} from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor as TiptapEditor } from "@tiptap/core";

import {
  InlineContent,
  OverlayTableTrendCell,
} from "@/features/rendering/adapters/react";
import { pasteAsSingleBlockInlineContent } from "@/components/editor/text-flow/inline-block-paste";
import { createRichTextEngineExtensions } from "@/components/tiptap/rich-text-engine";
import type {
  InlineNode,
  OverlayShapeId,
  SigmaTableCellContent,
} from "@/features/document";
import {
  inlineNodesToTiptapDoc,
  tiptapDocToInlineNodes,
  type TiptapDoc,
} from "@/lib/tiptap-adapter";

import {
  getTableCellNavigationDirection,
  shouldNavigateTableCell,
  type TableCellNavigationDirection,
  type TableEditorViewLike,
} from "./shapes/table-editor-model";

export function OverlayTableCellContentEditor({
  shapeId,
  cellId,
  content,
  editing,
  rowIndex,
  columnIndex,
  colSpan,
  onFocus,
  onChange,
  onNavigate,
  onRegisterEditor,
}: {
  shapeId: OverlayShapeId;
  cellId: string;
  content: SigmaTableCellContent;
  editing: boolean;
  rowIndex: number;
  columnIndex: number;
  /** Only a trend cell reads it: its arrow stretches across the columns the cell spans. */
  colSpan: number;
  onFocus: (editor: TiptapEditor, shapeId: OverlayShapeId) => void;
  onChange: (cellId: string, contentId: string, nextContent: SigmaTableCellContent) => void;
  onNavigate: (rowIndex: number, columnIndex: number, direction: TableCellNavigationDirection) => boolean;
  onRegisterEditor: (cellId: string, contentId: string, editor: TiptapEditor) => () => void;
}) {
  if (content.type === "trend") {
    // A trend cell has nothing to edit, so it is the static rendering — the same component the PDF,
    // the SVG export and the embedded viewer draw. It used to be a KaTeX arrow here instead, which
    // was a different glyph from the exported one and kept a `MathPreview` alive per trend cell.
    return <OverlayTableTrendCell colSpan={colSpan} content={content} />;
  }

  if (!editing) {
    return <OverlayTableParagraphStaticView content={content} />;
  }

  return (
    <OverlayTableParagraphEditor
      shapeId={shapeId}
      cellId={cellId}
      content={content}
      editing={editing}
      rowIndex={rowIndex}
      columnIndex={columnIndex}
      onFocus={onFocus}
      onChange={onChange}
      onNavigate={onNavigate}
      onRegisterEditor={onRegisterEditor}
    />
  );
}

function OverlayTableParagraphStaticView({
  content,
}: {
  content: Extract<SigmaTableCellContent, { type: "paragraph" }>;
}) {
  return (
    <div className="overlay-table-paragraph" style={{ pointerEvents: "none" }}>
      <div className="overlay-table-shape-content ProseMirror">
        {/*
          The Tiptap cell editor is a single `paragraph`, so the alignment sits on a `<p>` there and
          `.overlay-table-shape-content p { flex: 0 0 auto; margin: 0 }` applies to it. Rendering the
          run directly into the flex container instead made the cell's own line box a differently
          sized flex item, so the text moved the moment the cell took focus.
        */}
        <p style={{ textAlign: content.align ?? undefined }}>
          {renderSigmaInlineNodesPreview(content.children)}
        </p>
      </div>
    </div>
  );
}

function OverlayTableParagraphEditor({
  shapeId,
  cellId,
  content,
  editing,
  rowIndex,
  columnIndex,
  onFocus,
  onChange,
  onNavigate,
  onRegisterEditor,
}: {
  shapeId: OverlayShapeId;
  cellId: string;
  content: Extract<SigmaTableCellContent, { type: "paragraph" }>;
  editing: boolean;
  rowIndex: number;
  columnIndex: number;
  onFocus: (editor: TiptapEditor, shapeId: OverlayShapeId) => void;
  onChange: (cellId: string, contentId: string, nextContent: SigmaTableCellContent) => void;
  onNavigate: (rowIndex: number, columnIndex: number, direction: TableCellNavigationDirection) => boolean;
  onRegisterEditor: (cellId: string, contentId: string, editor: TiptapEditor) => () => void;
}) {
  const initialDoc = useMemo(() => inlineNodesToTiptapDoc(content.children, content.align), [content.align, content.children]);
  const contentRef = useRef(initialDoc);
  const editor = useEditor({
    extensions: createRichTextEngineExtensions({
      // Cells fall back to `OverlayTableParagraphStaticView` on blur, which paints per-segment
      // borders. See `BoxedTextRunHeightOptions.drawRunFrames`.
      drawBoxedRunFrames: false,
      enableMathDelimiters: true,
      heading: false,
      placeholder: "",
      textBlockStyle: true,
    }),
    content: initialDoc,
    editable: editing,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "overlay-table-shape-content",
      },
      // 保存できるのは 1 ブロックぶんの inline だけ。段落のまま貼らせると画面には出るのに
      // 保存で 2 行目以降が消えるので、貼るものを畳んでこのブロックの中へ入れる。
      handlePaste: (view, event, slice) => pasteAsSingleBlockInlineContent(view, event, slice),
    },
    onFocus: ({ editor: activeEditor }) => onFocus(activeEditor, shapeId),
    onUpdate: ({ editor: activeEditor }) => {
      const json = activeEditor.getJSON() as TiptapDoc;
      contentRef.current = json;
      onChange(cellId, content.id, {
        ...content,
        children: tiptapDocToInlineNodes(json),
      });
    },
  });

  useEffect(() => {
    editor?.setEditable(editing);
  }, [editing, editor]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    return onRegisterEditor(cellId, content.id, editor);
  }, [cellId, content.id, editor, onRegisterEditor]);

  useEffect(() => {
    if (!editor || editor.isFocused) {
      return;
    }

    const nextContent = inlineNodesToTiptapDoc(content.children, content.align);
    const serializedCurrent = JSON.stringify(contentRef.current);
    const serializedNext = JSON.stringify(nextContent);
    if (serializedCurrent !== serializedNext) {
      contentRef.current = nextContent;
      const timeoutId = window.setTimeout(() => {
        if (!editor.isDestroyed && !editor.isFocused) {
          editor.commands.setContent(nextContent, { emitUpdate: false });
        }
      }, 0);

      return () => window.clearTimeout(timeoutId);
    }
  }, [content.align, content.children, editor]);

  const handleKeyDownCapture = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!editor) {
      return;
    }

    const direction = getTableCellNavigationDirection(event.nativeEvent);
    if (!direction || !shouldNavigateTableCell(editor.view as TableEditorViewLike, direction)) {
      return;
    }

    if (!onNavigate(rowIndex, columnIndex, direction)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div
      className="overlay-table-paragraph"
      style={{ pointerEvents: editing ? "auto" : "none" }}
      onKeyDownCapture={handleKeyDownCapture}
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

function renderSigmaInlineNodesPreview(children: InlineNode[]): ReactNode {
  return <InlineContent nodes={children} keyPrefix="sigma-inline-preview" />;
}
