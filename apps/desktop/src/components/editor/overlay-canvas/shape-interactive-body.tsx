import { useMemo } from "react";
import type { Editor as TiptapEditor } from "@tiptap/core";

import type { OverlayRichTextDocument, SigmaTableSpec } from "@/features/document";

import {
  OverlayTableShapeEditor,
  OverlayTextShapeEditor,
  type TableShapeResizePatch,
} from "./shape-editors";
import type { OverlayShapeEditorRenderers } from "./shape-renderer";
import type { OverlayShapeId } from "./types";

interface OverlayShapeEditorHandlers {
  onTableChange: (shapeId: OverlayShapeId, table: SigmaTableSpec) => void;
  onTableEditorFocus: (editor: TiptapEditor, shapeId: OverlayShapeId) => void;
  onTableResize: (shapeId: OverlayShapeId, patch: TableShapeResizePatch) => void;
  onTextAutoSize: (shapeId: OverlayShapeId, width: number, height: number) => void;
  onTextChange: (shapeId: OverlayShapeId, richText: OverlayRichTextDocument) => void;
  onTextEditorCancel: (shapeId: OverlayShapeId) => void;
  onTextEditorFocus: (editor: TiptapEditor, shapeId: OverlayShapeId) => void;
}

/**
 * The interactive half of the shape renderer: the only place that pulls the Tiptap-backed shape
 * editors into a rendering path.
 *
 * `shape-renderer.tsx` asks for these through `OverlayShapeEditorRenderers` and falls back to the
 * static views when they are absent, which is what keeps every read-only surface — including the
 * print surface that `packages/viewer` bundles — free of the editing runtime
 * (`packages/viewer/src/package-boundary.test.ts`).
 */
export function useOverlayShapeEditorRenderers(
  handlers: OverlayShapeEditorHandlers,
): OverlayShapeEditorRenderers {
  const {
    onTableChange,
    onTableEditorFocus,
    onTableResize,
    onTextAutoSize,
    onTextChange,
    onTextEditorCancel,
    onTextEditorFocus,
  } = handlers;

  // Memoized on the handler identities: a fresh object here would re-render every shape — and with
  // it every formula — on each keystroke.
  return useMemo(() => ({
    renderTableEditor: ({ editing, shape }) => (
      <OverlayTableShapeEditor
        shape={shape}
        editing={editing}
        onFocus={onTableEditorFocus}
        onChange={onTableChange}
        onResize={onTableResize}
      />
    ),
    renderTextEditor: ({ editing, externalRevision, shape }) => (
      <OverlayTextShapeEditor
        shape={shape}
        externalRevision={externalRevision}
        editing={editing}
        onFocus={onTextEditorFocus}
        onCancel={onTextEditorCancel}
        onAutoSize={onTextAutoSize}
        onChange={onTextChange}
      />
    ),
  }), [
    onTableChange,
    onTableEditorFocus,
    onTableResize,
    onTextAutoSize,
    onTextChange,
    onTextEditorCancel,
    onTextEditorFocus,
  ]);
}
