/**
 * ドラッグ中のブロック下余白 (ライブプレビュー値) を持つだけの小さなストア。
 *
 * **なぜ props ではなくモジュールのストアか**
 *
 * - 下余白を描く面は 1 つではない。本文ユニット・問題エリア・段組の各面に加えて、ページを
 *   またぐブロックの **複製 (box fragment preview)** も同じブロックを描く。props で配ると
 *   「1 箇所に渡し忘れて継ぎ目だけ余白が付かない」が構造的に起こりうるが、ストアなら
 *   すべての `TextFlowEditor` が同じ 1 つの値を読むので取りこぼしが起きない。
 * - ドラッグは 60Hz で値が動く。props にすると毎フレーム紙面全体が React で再レンダリング
 *   される。ストア + 装飾の再描画合図なら、動くのは ProseMirror の decoration だけで済む。
 *
 * 掴めるつまみは同時に 1 つなので、中身は「0 件」か「1 件」しか取らない。
 */

export type BlockSpaceAfterDrafts = Readonly<Record<string, number>>;

const EMPTY_DRAFTS: BlockSpaceAfterDrafts = {};

let drafts: BlockSpaceAfterDrafts = EMPTY_DRAFTS;
const listeners = new Set<() => void>();

export function getBlockSpaceAfterDrafts(): BlockSpaceAfterDrafts {
  return drafts;
}

/** ドラッグ中の値を差し替える。同じ値なら通知しない (無駄な再装飾を打たない)。 */
export function setBlockSpaceAfterDraft(blockId: string, spaceAfterPx: number): void {
  if (drafts[blockId] === spaceAfterPx && Object.keys(drafts).length === 1) {
    return;
  }
  drafts = { [blockId]: spaceAfterPx };
  notify();
}

/** ドラッグ終了。永続値に戻すので、装飾は次の再描画で外れる。 */
export function clearBlockSpaceAfterDrafts(): void {
  if (drafts === EMPTY_DRAFTS) {
    return;
  }
  drafts = EMPTY_DRAFTS;
  notify();
}

export function subscribeBlockSpaceAfterDrafts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}
