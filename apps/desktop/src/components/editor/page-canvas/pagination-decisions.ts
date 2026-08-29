/**
 * 1 段組フローのページ割り判定。
 *
 * ここに来る値は **gap-free** であることが契約 — 呼び出し側が測定値から「今そこに描かれている
 * gap」(`applied-gaps.ts`) を引いてから渡す。前パスの出力が次パスの入力に混ざると、判定が
 * 自分の結果に依存する閉ループになり、同じ文書で gap が 114px ⇔ 4px を往復し続ける
 * (実データで観測: 後続 273 ブロックが毎フレーム 110px 上下し、recompute が 60Hz で回り続けた)。
 *
 * DOM に触らないので、往復するかどうかをユニットテストで固定できる。フラグメント分割のように
 * 実測が要る部分は `onPlaced` フックで呼び出し側へ返し、カーソルの移動だけを受け取る。
 */

export type PaginationItemKind = "atomicProblem" | "block" | "fragmentableBlock" | "area";

export interface PaginationItem {
  kind: PaginationItemKind;
  /** gap を積む先のキー。atomicProblem は問題 id、area はユニット id。 */
  gapKey: string;
  /** gap を除いた位置 (コンテンツ領域上端からの px)。 */
  topNat: number;
  /** gap を除いた高さ。ブロック下余白 (`spaceAfterPx`) を含む。 */
  height: number;
  /**
   * `height` のうち末尾のブロック下余白ぶん。**収まり判定からは除き、カーソル前進には含める**。
   * 余白を含めて判定すると「余白を足したらその段落自身が次ページへ飛ぶ」= 下げたかったのは
   * 次の行なのに逆の結果になる。含めないとページ末尾で余白が消える。
   */
  trailingSpacePx?: number;
  /** 手動改ページ。 */
  forceBreakBefore?: boolean;
  /** fragmentableBlock: そのページで開始するのに要る最小の残り高さ。 */
  minStartHeightPx?: number;
  /** area: セクション頭からコンテンツ原点までのオフセット。 */
  contentOffset?: number;
  /** area: 先頭ブロックの高さ。 */
  firstBlockHeight?: number;
}

export interface PaginationEnv {
  contentHeightPx: number;
  pageStride: number;
}

export interface PaginationPlacement {
  /** 直前に適用した gap (丸め済み)。0 なら適用していない。 */
  gap: number;
  pageIndex: number;
  pageStartNatural: number;
  /** ここまでに適用した gap の累計。実描画位置 = marginTop + topNat + cumGapPrev。 */
  cumGapPrev: number;
  /** area 用: ページ内でのコンテンツ開始位置と、そのページに残っている高さ。 */
  relTop: number;
  availableFirst: number;
}

/** フラグメント分割の結果として呼び出し側が返すカーソル移動。 */
export interface PaginationCursorMove {
  pageIndex: number;
  pageStartNatural: number;
  /** 次の項目の前に足す gap (フラグメントがはみ出した分)。 */
  pendingGap?: number;
}

export interface PaginationWalkHooks {
  onPlaced?: (item: PaginationItem, placement: PaginationPlacement) => PaginationCursorMove | void;
}

export interface PaginationResult {
  gaps: Record<string, number>;
  pageCount: number;
}

/** 1px 未満のずれで gap を積むと、丸めの往復そのものが振動源になる。 */
export function roundPaginationGap(gap: number): number {
  return Math.abs(gap) <= 0.5 ? 0 : Math.round(gap);
}

/**
 * 高さが何ページぶんを占めるか (最低 1 ページ)。
 *
 * keep-together の項目は分割されないので、ページ間の余白ごと連続して流れる。したがって
 * 割るのはコンテンツ高さではなく **ページの送り幅** (`pageStride`) — コンテンツ高さで
 * 割ると、1 ページ分をわずかに超えただけの項目でカーソルが 1 ページ余計に進み、空ページと
 * 「後続が常にページ頭扱い」を生む。
 */
export function occupiedPageCount(height: number, pageStride: number): number {
  if (!(pageStride > 0)) {
    return 1;
  }
  return Math.max(1, Math.ceil((height - 0.5) / pageStride));
}

/** 収まり判定に使う高さ。末尾のブロック下余白は「そこで切ってよい」ので除く。 */
function fitHeight(item: PaginationItem): number {
  return Math.max(0, item.height - (item.trailingSpacePx ?? 0));
}

export function decidePagination(
  items: readonly PaginationItem[],
  env: PaginationEnv,
  initialGaps: Readonly<Record<string, number>>,
  hooks: PaginationWalkHooks = {},
): PaginationResult {
  const gaps: Record<string, number> = { ...initialGaps };
  let pageIndex = 0;
  let pageStartNatural = items.length > 0
    ? items[0].topNat - (initialGaps[items[0].gapKey] ?? 0)
    : 0;
  let cumGapPrev = 0;
  let pendingGap = 0;

  const addGap = (gapKey: string, gap: number): number => {
    const rounded = roundPaginationGap(gap);
    if (rounded === 0) {
      return 0;
    }
    gaps[gapKey] = (gaps[gapKey] ?? 0) + rounded;
    cumGapPrev += rounded;
    return rounded;
  };

  const pushToNextPage = (gapKey: string, topNat: number): number => {
    pageIndex += 1;
    const applied = addGap(gapKey, pageIndex * env.pageStride - topNat - cumGapPrev);
    pageStartNatural = topNat;
    return applied;
  };

  for (const item of items) {
    let gap = 0;
    if (pendingGap > 0.5) {
      gap += addGap(item.gapKey, pendingGap);
      pendingGap = 0;
    }

    const isFirstOnPage = item.topNat <= pageStartNatural + 0.5;
    const relTop = item.topNat - pageStartNatural;
    // すでにページ頭にいるなら手動改ページは満たされている (空ページを作らない)。
    const forceBreak = item.forceBreakBefore === true && !isFirstOnPage;

    if (item.kind === "atomicProblem") {
      // keep-together が唯一の規則。ページより高い問題も分割せず、次ページの頭から始める
      // (枠を切らないための規則で、そこが「どのページにも収まらない問題」にできる最善)。
      if (!isFirstOnPage && relTop + item.height > env.contentHeightPx + 0.5) {
        gap += pushToNextPage(item.gapKey, item.topNat);
      }
      // 占有するページ数だけカーソルを進める。これが無いと、後続のブロックが
      // 「まだ問題の始まったページにいる」前提で判定され、毎パス上下する。
      const pages = occupiedPageCount(item.height, env.pageStride);
      if (pages > 1) {
        pageIndex += pages - 1;
        pageStartNatural += (pages - 1) * env.pageStride;
      }
    } else if (item.kind === "fragmentableBlock") {
      // 箱や 1 ページより高いブロックは本文のように流れる: 残りを埋めて
      // 次ページへ続く。ここでは見た目の種類を知らず、分割可能というレイアウト契約だけを扱う。
      const available = env.contentHeightPx - relTop;
      const minStart = item.minStartHeightPx ?? 0;
      const needsPush = forceBreak
        || (!isFirstOnPage && fitHeight(item) > available + 0.5 && available < minStart - 0.5);
      if (needsPush) {
        gap += pushToNextPage(item.gapKey, item.topNat);
      }
    } else if (item.kind === "block") {
      if (forceBreak || (!isFirstOnPage && relTop + fitHeight(item) > env.contentHeightPx + 0.5)) {
        gap += pushToNextPage(item.gapKey, item.topNat);
      }
    }

    let areaRelTop = relTop;
    let availableFirst = env.contentHeightPx - relTop;
    if (item.kind === "area") {
      const contentOffset = item.contentOffset ?? 0;
      areaRelTop = Math.max(0, item.topNat + contentOffset - pageStartNatural);
      availableFirst = env.contentHeightPx - areaRelTop;
      // 先頭ブロックすら置けないなら、エリアごと次ページの頭へ送る (その先で続きは流れる)。
      if (areaRelTop > 0.5 && availableFirst < (item.firstBlockHeight ?? 0) - 0.5) {
        gap += pushToNextPage(item.gapKey, item.topNat);
        areaRelTop = contentOffset;
        availableFirst = env.contentHeightPx - areaRelTop;
      }
    }

    const move = hooks.onPlaced?.(item, {
      gap,
      pageIndex,
      pageStartNatural,
      cumGapPrev,
      relTop: areaRelTop,
      availableFirst,
    });
    if (move) {
      pageIndex = move.pageIndex;
      pageStartNatural = move.pageStartNatural;
      pendingGap += move.pendingGap ?? 0;
    }
  }

  return { gaps, pageCount: pageIndex + 1 };
}

/**
 * gap マップの署名。キー順に依存せず、0 の gap は「無い」と同じに見える必要がある
 * (往復の片側だけ 0 のキーを持つことがあるため)。
 */
export function gapMapSignature(gaps: Readonly<Record<string, number>>): string {
  return Object.keys(gaps)
    .filter((key) => Math.round(gaps[key] ?? 0) !== 0)
    .sort()
    .map((key) => `${key}:${Math.round(gaps[key] ?? 0)}`)
    .join("|");
}

export type GapOscillationVerdict = "stable" | "oscillating" | "progressing";

/**
 * 直近の署名列から、収束したか・往復しているかを見る。
 *
 * `sameGapMap` のような隣接 2 パスの等値では止まらない — 往復は「隣とは必ず違う」ので、
 * 履歴を見ないと A→B→A→B を検出できない。
 */
export function detectGapOscillation(
  history: readonly string[],
  next: string,
): GapOscillationVerdict {
  const window = [...history.slice(-3), next];
  if (window.length >= 2 && window.every((signature) => signature === window[0])) {
    return "stable";
  }
  if (window.length === 4) {
    const [first, second, third, fourth] = window;
    if (first === third && second === fourth && first !== second) {
      return "oscillating";
    }
  }
  return "progressing";
}
