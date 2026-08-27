export interface TextRunEditorRangeInput {
  docSize: number;
  unitId: string;
}

export interface TextRunCaretPoint {
  pos: number;
  unitId: string;
}

export interface TextRunEditorRange {
  from: number;
  to: number;
  unitId: string;
}

export interface TextRunEditorRect {
  rect: { bottom: number; left: number; right: number; top: number };
  unitId: string;
}

/**
 * アンカーとヘッドから、連なり内の各エディタが覆う範囲を文書順で返す。
 *
 * 1 ユニットに収まる選択は要素 1 件。跨ぐときは中間ユニットを 0..docSize で埋める。
 */
export function resolveRunSelectionRanges(
  editors: readonly TextRunEditorRangeInput[],
  anchor: TextRunCaretPoint,
  head: TextRunCaretPoint,
): TextRunEditorRange[] {
  const anchorIndex = editors.findIndex((editor) => editor.unitId === anchor.unitId);
  const headIndex = editors.findIndex((editor) => editor.unitId === head.unitId);
  if (anchorIndex < 0 || headIndex < 0) {
    return [];
  }

  const anchorIsEarlier = anchorIndex < headIndex
    || (anchorIndex === headIndex && anchor.pos <= head.pos);
  const earlier = anchorIsEarlier
    ? { index: anchorIndex, pos: clampPos(anchor.pos, editors[anchorIndex].docSize) }
    : { index: headIndex, pos: clampPos(head.pos, editors[headIndex].docSize) };
  const later = anchorIsEarlier
    ? { index: headIndex, pos: clampPos(head.pos, editors[headIndex].docSize) }
    : { index: anchorIndex, pos: clampPos(anchor.pos, editors[anchorIndex].docSize) };

  const ranges: TextRunEditorRange[] = [];
  for (let index = earlier.index; index <= later.index; index += 1) {
    const editor = editors[index];
    const from = index === earlier.index ? earlier.pos : 0;
    const to = index === later.index ? later.pos : editor.docSize;
    if (to > from) {
      ranges.push({ unitId: editor.unitId, from, to });
    }
  }
  return ranges;
}

export function isMultiEditorRunSelection(ranges: readonly TextRunEditorRange[]): boolean {
  return ranges.length > 1;
}

/**
 * ポインタ位置がどのユニットか。矩形の中ならそのユニット、ユニット間の隙間なら近い方、
 * 連なりの外なら端のユニット。
 */
export function resolveRunEditorAtPoint(
  editors: readonly TextRunEditorRect[],
  x: number,
  y: number,
): string | null {
  if (editors.length === 0) {
    return null;
  }

  for (const editor of editors) {
    if (pointInRect(x, y, editor.rect)) {
      return editor.unitId;
    }
  }

  for (let index = 0; index < editors.length - 1; index += 1) {
    const current = editors[index].rect;
    const next = editors[index + 1].rect;
    if (current.bottom <= next.top && y > current.bottom && y < next.top) {
      return y - current.bottom <= next.top - y
        ? editors[index].unitId
        : editors[index + 1].unitId;
    }
    if (next.bottom <= current.top && y > next.bottom && y < current.top) {
      return y - next.bottom <= current.top - y
        ? editors[index + 1].unitId
        : editors[index].unitId;
    }
  }

  if (y < editors[0].rect.top) {
    return editors[0].unitId;
  }
  return editors[editors.length - 1].unitId;
}

function pointInRect(
  x: number,
  y: number,
  rect: TextRunEditorRect["rect"],
): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function clampPos(pos: number, docSize: number): number {
  if (!Number.isFinite(pos) || docSize <= 0) {
    return 0;
  }
  return Math.min(Math.max(pos, 0), docSize);
}
