import type { InlineNode } from "./rich-text";

export interface SigmaCommentThread {
  id: string;
  anchor: SigmaCommentAnchor;
  messages: SigmaCommentMessage[];
  /** Thread-level reactions are displayed on the first message. */
  reactions?: SigmaCommentReaction[];
  resolved?: boolean;
  color?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface SigmaCommentMessage {
  id: string;
  authorName?: string;
  body: InlineNode[];
  reactions?: SigmaCommentReaction[];
  createdAt: string;
  updatedAt?: string;
}

export interface SigmaCommentReaction {
  id: string;
  emoji: string;
  authorName?: string;
  createdAt: string;
}

export type SigmaCommentAnchor =
  | SigmaTextRangeCommentAnchor
  | SigmaInlineMathCommentAnchor
  | SigmaBlockCommentAnchor
  | SigmaOverlayShapeCommentAnchor
  | SigmaOverlayMathCommentAnchor;

export interface SigmaTextRangeCommentAnchor {
  type: "textRange";
  start: SigmaCommentTextPosition;
  end: SigmaCommentTextPosition;
  quote: string;
  mathInlineIds?: string[];
  mathTex?: string[];
}

export interface SigmaCommentTextPosition {
  blockId: string;
  offset: number;
}

export interface SigmaInlineMathCommentAnchor {
  type: "inlineMath";
  blockId: string;
  mathInlineId: string;
  quote?: string;
  tex?: string;
}

export interface SigmaBlockCommentAnchor {
  type: "block";
  blockId: string;
  quote?: string;
}

export interface SigmaOverlayShapeCommentAnchor {
  type: "overlayShape";
  shapeIds: string[];
  quote?: string;
}

export interface SigmaOverlayMathCommentAnchor {
  type: "overlayMath";
  shapeId?: string;
  mathInlineId?: string;
  quote?: string;
  tex?: string;
}

/**
 * コメントアンカーの値キー。**同じ位置・同じ引用なら同じ文字列**になる (アンカーはこの
 * アプリが組み立てるオブジェクトで、キーの順序は生成コードで固定されている)。
 */
export function getCommentAnchorKey(anchor: SigmaCommentAnchor | null | undefined): string {
  return anchor ? JSON.stringify(anchor) : "null";
}

/**
 * 候補アンカーの同値判定キー。**`block` のときだけ引用文を落とす**。
 *
 * `block` の引用はその段落の本文まるごとなので、1 文字打つだけで変わる。これを同値判定に
 * 入れると「同じ段落を指したまま」でも候補が作り直されたと判定され、画面全体が再描画される。
 * 落とした引用はコメントを作る瞬間に取り直す (`openCommentComposer`)。
 *
 * 他の種別 (テキスト選択・インライン数式・図形) の引用は選択範囲のスナップショットで、
 * 打鍵では作り直されない。ここで手を抜くと引用だけ古いコメントが保存されるので、完全一致で比べる。
 */
export function getCommentAnchorCandidateKey(anchor: SigmaCommentAnchor | null | undefined): string {
  if (anchor?.type === "block") {
    return JSON.stringify(["block", anchor.blockId]);
  }
  return getCommentAnchorKey(anchor);
}
