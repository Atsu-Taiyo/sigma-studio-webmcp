import type { SelectedOverlayGraph } from "@/components/editor/EditorSettings";
import type { SharedFillState } from "@/components/editor/overlay-canvas/style-patch";
import type { OverlaySelectionSummary } from "@/components/editor/page-overlay-types";
import type { Graph2DSpec } from "@/features/document";
import type { SigmaDocument } from "@/features/document";
import { collectBlocksById } from "@/lib/document-tree";
import type { DocumentMetadata } from "@/lib/runtime/types";

/**
 * 文書を開いた直後に選ぶ、最初の本文編集対象。
 *
 * 問題・段組み・枠はコンテナ自身より先に、その中で実際に書式を変更できる本文を選ぶ。
 * 以前は Tiptap の初回 selection update がこの補正を暗黙に行っていたが、画面外本文を
 * 静的表示する構成では editor がまだ mount されないため、SigmaDoc 側で明示する必要がある。
 */
export function getDefaultDocumentSelectionId(document: SigmaDocument): string | null {
  for (const block of collectBlocksById(document.content).values()) {
    if (
      block.type === "section" ||
      block.type === "paragraph" ||
      block.type === "heading" ||
      block.type === "listItem"
    ) {
      return block.id;
    }
  }
  return document.content[0]?.id ?? null;
}

export function sameOverlaySelectionSummary(a: OverlaySelectionSummary, b: OverlaySelectionSummary): boolean {
  return a.selectedCount === b.selectedCount &&
    a.locked === b.locked &&
    a.hidden === b.hidden &&
    a.grouped === b.grouped &&
    a.canAlign === b.canAlign &&
    a.canDistribute === b.canDistribute &&
    a.canStyleStroke === b.canStyleStroke &&
    a.canStyleFill === b.canStyleFill &&
    a.canStyleLine === b.canStyleLine &&
    a.canStyleLineEndpoints === b.canStyleLineEndpoints &&
    a.arrowheadStart === b.arrowheadStart &&
    a.arrowheadEnd === b.arrowheadEnd &&
    sameSharedFill(a.fill, b.fill) &&
    sameStringItems(a.selectedShapeIds, b.selectedShapeIds) &&
    sameReferenceItems(a.selectedShapes, b.selectedShapes) &&
    sameRecordReferences(a.selectedAssets, b.selectedAssets);
}

/**
 * Compared on value, not identity: `sharedFill` builds a fresh object every time, and the shape
 * identity check below only happens to change alongside a fill edit today. Stating it here keeps
 * the toolbar from going stale if that ever stops being true.
 */
function sameSharedFill(a: SharedFillState, b: SharedFillState): boolean {
  if (a.kind !== b.kind) {
    return false;
  }
  if (a.kind === "solid" && b.kind === "solid") {
    return a.fillColor === b.fillColor && a.fillOpacity === b.fillOpacity;
  }
  return true;
}

function sameStringItems(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function sameReferenceItems<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function sameRecordReferences<T>(a: Record<string, T>, b: Record<string, T>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  return aKeys.length === bKeys.length && aKeys.every((key) => a[key] === b[key]);
}

export function areSelectedOverlayGraphsEqual(a: SelectedOverlayGraph | null, b: SelectedOverlayGraph | null): boolean {
  if (a === b) {
    return true;
  }

  if (!a || !b) {
    return false;
  }

  return (
    a.shapeId === b.shapeId &&
    areGraphSpecsEqual(a.spec, b.spec) &&
    areStringRecordsEqual(a.axisLabelShapeIdsByKey, b.axisLabelShapeIdsByKey) &&
    areStringRecordsEqual(a.axisLabelTextsByKey, b.axisLabelTextsByKey) &&
    areStringArraysEqual(a.formulaLabelShapeIds, b.formulaLabelShapeIds) &&
    areStringRecordsEqual(a.formulaLabelShapeIdsByCurveId, b.formulaLabelShapeIdsByCurveId) &&
    a.pickingOrigin === b.pickingOrigin &&
    a.pickingFill === b.pickingFill
  );
}

function areStringArraysEqual(a: string[], b: string[]): boolean {
  if (a === b) {
    return true;
  }

  if (a.length !== b.length) {
    return false;
  }

  return a.every((value, index) => value === b[index]);
}

function areStringRecordsEqual(a: Record<string, string | undefined>, b: Record<string, string | undefined>): boolean {
  if (a === b) {
    return true;
  }

  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }

  return aKeys.every((key) => a[key] === b[key]);
}

export function areGraphSpecsEqual(a: Graph2DSpec, b: Graph2DSpec): boolean {
  if (a === b) {
    return true;
  }

  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 台帳から読み直した教材一覧が「前と同じ中身か」。
 *
 * 保存のたびに一覧を取り直すので、毎回新しい配列が返る。識別子で state に入れると打鍵ごとに
 * 画面全体が再描画されるが、実際に表示が変わるのはここで比べている値が動いたときだけ。
 *
 * 比較するキーは `DocumentMetadata` の全フィールドから導出する — フィールドが増えたときに
 * ここが**コンパイルエラーになる**ようにしておかないと、「台帳は更新されたのに画面が動かない」
 * という静かな取りこぼしに化ける。
 */
const DOCUMENT_METADATA_COMPARED_KEYS: Record<keyof DocumentMetadata, true> = {
  fileId: true,
  workspaceId: true,
  folderId: true,
  docId: true,
  title: true,
  documentPath: true,
  revision: true,
  createdAt: true,
  updatedAt: true,
};

export function sameDocumentMetadatas(
  a: readonly DocumentMetadata[],
  b: readonly DocumentMetadata[],
): boolean {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  const keys = Object.keys(DOCUMENT_METADATA_COMPARED_KEYS) as Array<keyof DocumentMetadata>;
  return a.every((metadata, index) => {
    const other = b[index];
    return keys.every((key) => metadata[key] === other[key]);
  });
}
