/**
 * ブロック最終行の下に足す余白 (`spaceAfterPx`)。
 *
 * 値は **CSS px** (ズーム非依存の論理 px)。`padding-bottom` として描くので
 * `getBoundingClientRect().height` に含まれ、1 段組のページ割りも段組フローも実測をそのまま
 * 使うだけで余白を勘定できる (`margin-bottom` だと `column-layout.ts` の `cursorY += height` が
 * 取りこぼし、チャンク境界のマージン相殺が `applied-gaps.ts` の marginTop 読みとずれる)。
 */

export const MAX_BLOCK_SPACE_AFTER_PX = 400;

/** 描画側・計測側が同じ値を読む唯一の custom property。 */
export const BLOCK_SPACE_AFTER_CSS_VARIABLE = "--sigma-doc-space-after";

/**
 * ドラッグ中のライブプレビューが node decoration で被せる値。**永続値と別名にする**理由:
 * prosemirror-view は decoration の style を外すとき `prev.style` を舐めて
 * `dom.style.removeProperty(prop)` するので、同名だとドラッグ終了の瞬間にノード自身の
 * 永続値まで消える。CSS 側は `var(-draft, var(-永続, 0px))` の 2 段で読む。
 */
export const BLOCK_SPACE_AFTER_DRAFT_CSS_VARIABLE = "--sigma-doc-space-after-draft";

/**
 * 下余白を **描く** ブロック種別。
 *
 * 枠や背景を持つ引用・コード・囲み枠は `padding-bottom` が枠の内側に入ってしまい
 * 「ブロックの下に余白」ではなく「枠が下に伸びる」になるので、いまは描かない
 * (枠の外へ出すには計測可能な外箱を用意する設計変更が要る)。
 * データとしては全ブロック型が持てる ＝ 後から描画対象を増やしても移行は要らない。
 */
const SPACE_AFTER_RENDERED_TYPES = new Set(["divider", "heading", "list", "paragraph", "section"]);

/**
 * 保存・描画に使える値へ正規化する。0 は `undefined` に落とす — 「0 を保存しない」ことで、
 * リセットした結果が「一度も触っていないブロック」と同じ JSON になる。
 */
export function normalizeBlockSpaceAfterPx(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const px = Math.min(MAX_BLOCK_SPACE_AFTER_PX, Math.max(0, Math.round(value)));
  return px > 0 ? px : undefined;
}

/** その種別が下余白を描くか。描かない種別は計測側でも余白を勘定しない (実測に入らないため)。 */
export function rendersBlockSpaceAfter(type: string | undefined): boolean {
  return type !== undefined && SPACE_AFTER_RENDERED_TYPES.has(type);
}

/**
 * 描画側が読む唯一の入口。値が無い / その種別では描かないときは `undefined` を返し、
 * style 属性そのものを出さない (未指定の文書の DOM を 1 文字も変えない)。
 */
export function blockSpaceAfterStyleVars(
  block: { spaceAfterPx?: number; type?: string },
): Record<`--${string}`, string> | undefined {
  const px = blockSpaceAfterPx(block);
  return px > 0 ? { [BLOCK_SPACE_AFTER_CSS_VARIABLE]: `${px}px` } : undefined;
}

/**
 * 実際に描かれる下余白 (px)。描かない種別は 0。
 *
 * ページ割りが「収まり判定から除く末尾余白」として使う値でもあるので、**描画と同じ判定**で
 * なければならない — 描いていない余白を高さから引くと、そのブロックが早すぎるページに残る。
 */
export function blockSpaceAfterPx(block: { spaceAfterPx?: number; type?: string }): number {
  if (!rendersBlockSpaceAfter(block.type)) {
    return 0;
  }
  return normalizeBlockSpaceAfterPx(block.spaceAfterPx) ?? 0;
}

/**
 * Tiptap の `renderHTML` が返す style 断片。未指定なら何も出さない ＝ 触っていない文書の
 * DOM を 1 文字も変えない。**下余白を描く種別のノードからだけ**呼ぶこと (呼び分けは
 * ノード種別が確定している宣言側の責務 — {@link rendersBlockSpaceAfter})。
 */
export function blockSpaceAfterStyleAttr(value: unknown): Record<string, string> {
  const px = normalizeBlockSpaceAfterPx(value);
  return px ? { style: `${BLOCK_SPACE_AFTER_CSS_VARIABLE}: ${px}px` } : {};
}

/** Tiptap の `parseHTML` 側。HTML 貼り付けで運ばれてきたインライン style から読み戻す。 */
export function blockSpaceAfterFromStyleValue(value: string | null | undefined): number | null {
  return normalizeBlockSpaceAfterPx(Number.parseFloat(value ?? "")) ?? null;
}
