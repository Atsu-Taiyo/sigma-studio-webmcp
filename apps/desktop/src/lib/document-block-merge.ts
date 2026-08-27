import {
  normalizeOverlaySnapshot,
  type OverlayShape,
  type OverlayShapeId,
  type OverlaySnapshot,
  type PageLayout,
  type SigmaBlock,
  type SigmaDocument,
} from "@/features/document";
import { createTranslator, DEFAULT_LOCALE, type Translate } from "@/lib/i18n";
import { areStructurallyEqual } from "@/lib/structural-equality";

// renderer (EditorShell.tsx) 専用のブロック単位3-wayマージ。electron/mcp 専用の
// sigma-doc-block-hash.ts (node:crypto使用) はブラウザバンドルに入れられないため、ここでは
// オブジェクトのキー順に依存しない構造比較を使う。
//
// 粒度についての判断: 本文ブロックは「document.content 直下のトップレベルブロックID」単位で
// 3-wayマージする。同じトップレベルブロック(例えば1つのproblemブロック)の中で人間とAIが
// 別々のエリア(prompt/solutionなど)を編集した場合でも、このブロックは「両方が変更」した扱いに
// なり conflict (ok:false) に倒れる。1階層深いネスト単位(problemのエリア別、list項目別など)
// までの部分木差し替えは、正しく行うには十分なテストを伴う複雑な木構造編集ロジックが必要になり、
// 今回のスコープでは「誤マージだけは絶対に避ける」という要件に対してリスクに見合わないと判断し、
// あえてトップレベルブロック単位に留めている (設計メモに書かれた例のケースはすべてこの粒度で
// カバーできる)。

export type MergeExternalDocumentChangeResult =
  | { ok: true; merged: SigmaDocument }
  | { ok: false; reason: string };

/**
 * base (rendererが最後にディスクと同期した時点の文書) を基準に、mine (人間の未保存編集を
 * 含む現在のエディタ状態) と theirs (ディスク上の新しい文書、例: AI提案の自動承認で保存された
 * もの) を3-wayマージする。保守的な実装: 同じ対象を両方が変更していたら必ず ok:false を返し、
 * 呼び出し元 (EditorShell) は従来の「別教材へ退避」フローにフォールバックする。
 */
export function mergeExternalDocumentChange(
  base: SigmaDocument,
  mine: SigmaDocument,
  theirs: SigmaDocument,
  t: Translate<"editor"> = createTranslator(DEFAULT_LOCALE, "editor"),
): MergeExternalDocumentChangeResult {
  if (areStructurallyEqual(mine, base)) {
    // 人間の未保存編集が無い (mineはbaseから何も変わっていない) 単純なケース。
    return { ok: true, merged: theirs };
  }
  if (areStructurallyEqual(mine, theirs)) {
    // 人間の編集がたまたま theirs と完全に一致している (defensive: 実際にはほぼ起きない)。
    return { ok: true, merged: theirs };
  }

  const metaResult = mergeDocumentMeta(base, mine, theirs, t);
  if (!metaResult.ok) {
    return metaResult;
  }

  const contentResult = mergeTopLevelBlocks(base.content, mine.content, theirs.content, t);
  if (!contentResult.ok) {
    return contentResult;
  }

  const shapesResult = mergeOverlayShapes(base, mine, theirs, t);
  if (!shapesResult.ok) {
    return shapesResult;
  }

  const mergedPageLayout = applyMergedShapesToPageLayout(metaResult.pageLayout, shapesResult.shapes);

  return {
    ok: true,
    merged: {
      ...metaResult.rest,
      content: contentResult.blocks,
      ...(mergedPageLayout !== undefined ? { pageLayout: mergedPageLayout } : {}),
    },
  };
}

// ----- ドキュメントレベルのメタ (content / overlay図形以外のトップレベルフィールド) -----

type DocumentMetaMergeResult =
  | { ok: true; rest: Omit<SigmaDocument, "content" | "pageLayout">; pageLayout: PageLayout | undefined }
  | { ok: false; reason: string };

function mergeDocumentMeta(
  base: SigmaDocument,
  mine: SigmaDocument,
  theirs: SigmaDocument,
  t: Translate<"editor">,
): DocumentMetaMergeResult {
  const baseMeta = extractMetaForComparison(base);
  const mineMeta = extractMetaForComparison(mine);
  const theirsMeta = extractMetaForComparison(theirs);

  const mineChanged = !areStructurallyEqual(mineMeta, baseMeta);
  const theirsChanged = !areStructurallyEqual(theirsMeta, baseMeta);

  if (mineChanged && theirsChanged && !areStructurallyEqual(mineMeta, theirsMeta)) {
    return { ok: false, reason: t("merge.metadata") };
  }

  // theirsが変更していれば(mineが無変更、または両方が同じ変更なら)theirsを、mineだけが変更して
  // いればmineを、どちらも無変更ならbase(≒どちらとも同じ)を採用する。
  const source = theirsChanged ? theirs : mineChanged ? mine : base;
  const rest = omitContentAndPageLayout(source);
  return { ok: true, rest, pageLayout: source.pageLayout };
}

function omitContentAndPageLayout(document: SigmaDocument): Omit<SigmaDocument, "content" | "pageLayout"> {
  const rest: Partial<SigmaDocument> = { ...document };
  delete rest.content;
  delete rest.pageLayout;
  return rest as Omit<SigmaDocument, "content" | "pageLayout">;
}

function omitShapes(overlaySnapshot: OverlaySnapshot): Omit<OverlaySnapshot, "shapes"> {
  const rest: Partial<OverlaySnapshot> = { ...overlaySnapshot };
  delete rest.shapes;
  return rest as Omit<OverlaySnapshot, "shapes">;
}

function extractMetaForComparison(document: SigmaDocument): unknown {
  const rest = omitContentAndPageLayout(document);
  const pageLayout = document.pageLayout;
  if (!pageLayout) {
    return rest;
  }
  const overlay = pageLayout.overlay;
  if (!overlay?.overlaySnapshot) {
    return { ...rest, pageLayout };
  }
  // overlay図形 (shapes) だけは別軸で3-wayマージするため、メタ比較からは除外する。
  return {
    ...rest,
    pageLayout: {
      ...pageLayout,
      overlay: {
        ...overlay,
        overlaySnapshot: omitShapes(overlay.overlaySnapshot),
      },
    },
  };
}

function applyMergedShapesToPageLayout(pageLayout: PageLayout | undefined, shapes: OverlayShape[]): PageLayout | undefined {
  if (!pageLayout) {
    return pageLayout;
  }
  const overlay = pageLayout.overlay;
  const overlaySnapshot = normalizeOverlaySnapshot(overlay?.overlaySnapshot);
  return {
    ...pageLayout,
    overlay: {
      ...overlay,
      overlaySnapshot: {
        ...overlaySnapshot,
        shapes,
      },
    },
  };
}

// ----- 本文ブロック (document.content 直下) -----

type TopLevelBlocksMergeResult =
  | { ok: true; blocks: SigmaBlock[] }
  | { ok: false; reason: string };

function mergeTopLevelBlocks(
  base: SigmaBlock[],
  mine: SigmaBlock[],
  theirs: SigmaBlock[],
  t: Translate<"editor">,
): TopLevelBlocksMergeResult {
  const baseIds = base.map((block) => block.id);
  const mineIds = mine.map((block) => block.id);
  const theirsIds = theirs.map((block) => block.id);

  const mineStructureChanged = !idArraysEqual(mineIds, baseIds);
  const theirsStructureChanged = !idArraysEqual(theirsIds, baseIds);

  if (mineStructureChanged && theirsStructureChanged && !idArraysEqual(mineIds, theirsIds)) {
    return { ok: false, reason: t("merge.structure") };
  }

  const winningIds = theirsStructureChanged ? theirsIds : mineStructureChanged ? mineIds : baseIds;
  const winningSource: "mine" | "theirs" | "base" = theirsStructureChanged ? "theirs" : mineStructureChanged ? "mine" : "base";

  const baseById = indexById(base);
  const mineById = indexById(mine);
  const theirsById = indexById(theirs);

  const merged: SigmaBlock[] = [];
  for (const id of winningIds) {
    const baseNode = baseById.get(id);
    if (!baseNode) {
      // baseに存在しない = 構造が勝った側 (mineまたはtheirs) が新規追加したブロック。
      const insertedNode = winningSource === "theirs" ? theirsById.get(id) : mineById.get(id);
      if (!insertedNode) {
        // 理論上到達しないはずだが、念のため安全側に倒す。
        return { ok: false, reason: t("merge.blocksUnsafe") };
      }
      merged.push(insertedNode);
      continue;
    }

    const mineNode = mineById.get(id);
    const theirsNode = theirsById.get(id);
    if (!mineNode || !theirsNode) {
      // baseに存在したブロックが、構造無変更のはずの側から消えている(delete-vs-edit的な
      // 想定外ケース)。誤って中身を失わないよう安全側に倒す。
      return { ok: false, reason: t("merge.blocksUnsafe") };
    }

    const mineChanged = !areStructurallyEqual(mineNode, baseNode);
    const theirsChanged = !areStructurallyEqual(theirsNode, baseNode);
    if (mineChanged && theirsChanged) {
      if (areStructurallyEqual(mineNode, theirsNode)) {
        merged.push(mineNode);
        continue;
      }
      return { ok: false, reason: t("merge.blockConflict", { ids: id }) };
    }
    merged.push(mineChanged ? mineNode : theirsChanged ? theirsNode : baseNode);
  }

  // 構造無変更の側が、baseにあった対象ブロックの編集(削除ではなく中身の書き換え)だけを
  // していないか(=勝った側の構造には含まれないが、負けた側で中身が変わっているケース)を
  // 確認する。deleteが絡む「編集 vs 削除」の競合を黙って握りつぶさないための安全策。
  const winningIdSet = new Set(winningIds);
  const losingSideChangedIds = winningSource === "theirs"
    ? findChangedDroppedIds(baseById, mineById, winningIdSet)
    : winningSource === "mine"
      ? findChangedDroppedIds(baseById, theirsById, winningIdSet)
      : [];
  if (losingSideChangedIds.length > 0) {
    return {
      ok: false,
      reason: t("merge.blockDeleted", { ids: losingSideChangedIds.join(", ") }),
    };
  }

  return { ok: true, blocks: merged };
}

/** baseにあった各IDについて、winningIdsに含まれない(=勝った側が削除した)のに、もう片方の側で中身が変わっているものを返す。 */
function findChangedDroppedIds(
  baseById: Map<string, SigmaBlock>,
  otherSideById: Map<string, SigmaBlock>,
  winningIdSet: Set<string>,
): string[] {
  const changed: string[] = [];
  for (const [id, baseNode] of baseById) {
    if (winningIdSet.has(id)) {
      continue;
    }
    const otherNode = otherSideById.get(id);
    if (otherNode && !areStructurallyEqual(otherNode, baseNode)) {
      changed.push(id);
    }
  }
  return changed;
}

function indexById(blocks: SigmaBlock[]): Map<string, SigmaBlock> {
  const map = new Map<string, SigmaBlock>();
  for (const block of blocks) {
    map.set(block.id, block);
  }
  return map;
}

function idArraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((id, index) => id === b[index]);
}

// ----- overlay図形 (表・グラフ・通常図形) -----

type OverlayShapesMergeResult =
  | { ok: true; shapes: OverlayShape[] }
  | { ok: false; reason: string };

function mergeOverlayShapes(
  base: SigmaDocument,
  mine: SigmaDocument,
  theirs: SigmaDocument,
  t: Translate<"editor">,
): OverlayShapesMergeResult {
  const baseShapes = normalizeOverlaySnapshot(base.pageLayout?.overlay?.overlaySnapshot).shapes;
  const mineShapes = normalizeOverlaySnapshot(mine.pageLayout?.overlay?.overlaySnapshot).shapes;
  const theirsShapes = normalizeOverlaySnapshot(theirs.pageLayout?.overlay?.overlaySnapshot).shapes;

  const baseIds = baseShapes.map((shape) => shape.id);
  const mineIds = mineShapes.map((shape) => shape.id);
  const theirsIds = theirsShapes.map((shape) => shape.id);

  // 本文ブロック側 (mergeTopLevelBlocks) と同じく順序込みのID配列で構造比較する。shapes の
  // 配列順は重なり(描画)順に影響しうるため、人間が並び順だけを変えた場合も「構造変更」として
  // 扱わないと、集合比較では winningShapes が base の順序に落ちて並び替えが黙って失われる。
  const mineStructureChanged = !idArraysEqual(mineIds, baseIds);
  const theirsStructureChanged = !idArraysEqual(theirsIds, baseIds);

  if (mineStructureChanged && theirsStructureChanged && !idArraysEqual(mineIds, theirsIds)) {
    return { ok: false, reason: t("merge.shapeStructure") };
  }

  const winningShapes = theirsStructureChanged ? theirsShapes : mineStructureChanged ? mineShapes : baseShapes;
  const winningSource: "mine" | "theirs" | "base" = theirsStructureChanged ? "theirs" : mineStructureChanged ? "mine" : "base";
  const winningIdSet = new Set(theirsStructureChanged ? theirsIds : mineStructureChanged ? mineIds : baseIds);

  const baseById = indexShapesById(baseShapes);
  const mineById = indexShapesById(mineShapes);
  const theirsById = indexShapesById(theirsShapes);

  const merged: OverlayShape[] = [];
  for (const shape of winningShapes) {
    const id = shape.id;
    const baseNode = baseById.get(id);
    if (!baseNode) {
      merged.push(shape);
      continue;
    }
    const mineNode = mineById.get(id);
    const theirsNode = theirsById.get(id);
    if (!mineNode || !theirsNode) {
      return { ok: false, reason: t("merge.shapesUnsafe") };
    }
    const mineChanged = !areStructurallyEqual(mineNode, baseNode);
    const theirsChanged = !areStructurallyEqual(theirsNode, baseNode);
    if (mineChanged && theirsChanged) {
      if (areStructurallyEqual(mineNode, theirsNode)) {
        merged.push(mineNode);
        continue;
      }
      return { ok: false, reason: t("merge.shapeConflict", { ids: id }) };
    }
    merged.push(mineChanged ? mineNode : theirsChanged ? theirsNode : baseNode);
  }

  const losingSideChangedIds = winningSource === "theirs"
    ? findChangedDroppedShapeIds(baseById, mineById, winningIdSet)
    : winningSource === "mine"
      ? findChangedDroppedShapeIds(baseById, theirsById, winningIdSet)
      : [];
  if (losingSideChangedIds.length > 0) {
    return {
      ok: false,
      reason: t("merge.shapeDeleted", { ids: losingSideChangedIds.join(", ") }),
    };
  }

  return { ok: true, shapes: merged };
}

function findChangedDroppedShapeIds(
  baseById: Map<OverlayShapeId, OverlayShape>,
  otherSideById: Map<OverlayShapeId, OverlayShape>,
  winningIdSet: Set<OverlayShapeId>,
): string[] {
  const changed: string[] = [];
  for (const [id, baseNode] of baseById) {
    if (winningIdSet.has(id)) {
      continue;
    }
    const otherNode = otherSideById.get(id);
    if (otherNode && !areStructurallyEqual(otherNode, baseNode)) {
      changed.push(id);
    }
  }
  return changed;
}

function indexShapesById(shapes: OverlayShape[]): Map<OverlayShapeId, OverlayShape> {
  const map = new Map<OverlayShapeId, OverlayShape>();
  for (const shape of shapes) {
    map.set(shape.id, shape);
  }
  return map;
}
