import { describe, expect, it } from "vitest";

import {
  decidePagination,
  detectGapOscillation,
  gapMapSignature,
  occupiedPageCount,
  roundPaginationGap,
  type PaginationItem,
} from "./pagination-decisions";

const ENV = { contentHeightPx: 1000, pageStride: 1100 };

function block(gapKey: string, topNat: number, height: number, extra: Partial<PaginationItem> = {}): PaginationItem {
  return { kind: "block", gapKey, topNat, height, ...extra };
}

function atomicProblem(gapKey: string, topNat: number, height: number): PaginationItem {
  return { kind: "atomicProblem", gapKey, topNat, height };
}

describe("roundPaginationGap", () => {
  it("ignores sub-pixel noise and rounds everything else", () => {
    expect(roundPaginationGap(0.4)).toBe(0);
    expect(roundPaginationGap(-0.5)).toBe(0);
    expect(roundPaginationGap(113.6)).toBe(114);
    expect(roundPaginationGap(-4.2)).toBe(-4);
  });
});

describe("occupiedPageCount", () => {
  it("counts how many page strides an item covers", () => {
    expect(occupiedPageCount(0, 1100)).toBe(1);
    expect(occupiedPageCount(1099, 1100)).toBe(1);
    expect(occupiedPageCount(1100, 1100)).toBe(1);
    expect(occupiedPageCount(1101, 1100)).toBe(2);
    expect(occupiedPageCount(2400, 1100)).toBe(3);
  });
});

describe("decidePagination", () => {
  it("is idempotent for a framed problem taller than a page", () => {
    // 高さは gap-free (エリア内部の spacer を除いた値) で渡す契約なので、
    // 何パス回しても同じ入力 → 同じ gaps でなければならない。
    const items = [
      block("intro", 0, 900),
      atomicProblem("problem_tall", 900, 2400),
      block("after", 3300, 100),
    ];
    const first = decidePagination(items, ENV, {});
    const second = decidePagination(items, ENV, {});
    expect(first.gaps).toEqual(second.gaps);
    expect(first.pageCount).toBe(second.pageCount);
  });

  it("reaches the same decision whether the previous pass applied 0 or 114px of gap", () => {
    // 呼び出し側は測定値から適用済み gap を引いて topNat を作る。つまり前パスの出力は
    // 入力に現れない — これが往復 (114⇔4) を止める本体。
    const gapFree = [atomicProblem("problem_tall", 900, 2400), block("after", 3300, 100)];
    const withApplied = [atomicProblem("problem_tall", 900, 2400), block("after", 3300, 100)];
    expect(decidePagination(gapFree, ENV, {})).toEqual(decidePagination(withApplied, ENV, {}));
  });

  it("keeps an over-tall framed problem whole and starts it on a fresh page", () => {
    const result = decidePagination(
      [block("intro", 0, 900), atomicProblem("problem_tall", 900, 2400)],
      ENV,
      {},
    );
    // 900 から始めると 1 ページ目に収まらないので次ページ頭へ送る。
    expect(result.gaps.problem_tall).toBe(200);
  });

  it("advances the page cursor across every page the over-tall problem covers", () => {
    const result = decidePagination(
      [block("intro", 0, 900), atomicProblem("problem_tall", 900, 2400), block("after", 3300, 100)],
      ENV,
      {},
    );
    // 問題は 3 ページを占有する。後続ブロックはその最後のページの続きに置かれるので、
    // 「まだ 2 ページ目にいる」という前提で押し出されてはいけない。
    expect(result.gaps.after ?? 0).toBe(0);
    expect(result.pageCount).toBe(4);
  });

  it("does not over-advance for a problem that only just exceeds the content area", () => {
    // 高さ 1050 は「コンテンツ高さ (1000) は超えるが、ページの送り幅 (1100) には収まる」。
    // ここでカーソルを 2 ページ進めると、空ページが 1 枚増え、後続が常にページ頭扱いになる。
    const result = decidePagination(
      [atomicProblem("problem_tall", 0, 1050), block("after", 1050, 200)],
      ENV,
      {},
    );
    expect(result.pageCount).toBe(2);
    expect(result.gaps.after).toBe(50);
  });

  it("pushes a block that does not fit the rest of the page", () => {
    const result = decidePagination([block("a", 0, 900), block("b", 900, 200)], ENV, {});
    expect(result.gaps.b).toBe(200);
    expect(result.pageCount).toBe(2);
  });

  it("starts a fragmentable block in the remaining page space", () => {
    const result = decidePagination([
      block("a", 0, 700),
      block("box", 700, 900, { kind: "fragmentableBlock", minStartHeightPx: 80 }),
    ], ENV, {});
    expect(result.gaps.box ?? 0).toBe(0);
  });

  it("moves a fragmentable block only when the remainder cannot hold its first lines", () => {
    const result = decidePagination([
      block("a", 0, 950),
      block("box", 950, 900, { kind: "fragmentableBlock", minStartHeightPx: 80 }),
    ], ENV, {});
    expect(result.gaps.box).toBe(150);
  });

  it("honours a manual break before a block", () => {
    const result = decidePagination(
      [block("a", 0, 100), block("b", 100, 100, { forceBreakBefore: true })],
      ENV,
      {},
    );
    expect(result.gaps.b).toBe(1000);
  });

  it("never pushes the first item on a page", () => {
    const result = decidePagination([block("only", 0, 2400)], ENV, {});
    expect(result.gaps).toEqual({});
  });

  it("handles an empty document", () => {
    expect(decidePagination([], ENV, {})).toEqual({ gaps: {}, pageCount: 1 });
  });

  it("keeps reserve gaps that were seeded before the walk", () => {
    const result = decidePagination([block("a", 0, 100)], ENV, { a: 40 });
    expect(result.gaps.a).toBe(40);
  });

  it("lets the caller move the cursor after fragmenting an item", () => {
    const placements: string[] = [];
    const result = decidePagination(
      [block("tall", 0, 2400), block("after", 2400, 100)],
      ENV,
      {},
      {
        onPlaced: (item, placement) => {
          placements.push(`${item.gapKey}@${placement.pageIndex}`);
          if (item.gapKey !== "tall") {
            return;
          }
          return { pageIndex: 2, pageStartNatural: 2200, pendingGap: 0 };
        },
      },
    );
    expect(placements).toEqual(["tall@0", "after@2"]);
    expect(result.pageCount).toBe(3);
  });
});

describe("gapMapSignature", () => {
  it("is independent of key order and ignores zero gaps", () => {
    expect(gapMapSignature({ b: 4, a: 114 })).toBe(gapMapSignature({ a: 114, b: 4 }));
    expect(gapMapSignature({ a: 114, zero: 0 })).toBe(gapMapSignature({ a: 114 }));
  });

  it("separates the two sides of a 114 ⇔ 4 flip", () => {
    expect(gapMapSignature({ p: 114 })).not.toBe(gapMapSignature({ p: 4 }));
  });
});

describe("detectGapOscillation", () => {
  it("reports a stable layout", () => {
    expect(detectGapOscillation(["A", "A"], "A")).toBe("stable");
  });

  it("reports an A,B,A,B flip as oscillating", () => {
    expect(detectGapOscillation(["A", "B", "A"], "B")).toBe("oscillating");
  });

  it("does not call a converging sequence oscillating", () => {
    expect(detectGapOscillation(["A", "B", "C"], "C")).toBe("progressing");
    expect(detectGapOscillation([], "A")).toBe("progressing");
    expect(detectGapOscillation(["A"], "B")).toBe("progressing");
  });

  it("does not mistake a three-way cycle for a stable layout", () => {
    expect(detectGapOscillation(["A", "B", "C"], "A")).toBe("progressing");
  });
});

describe("decidePagination with a space below a block", () => {
  /**
   * 「余白を足したらその段落自身が次ページへ飛ぶ」はユーザーの意図と逆 — 下げたいのは
   * **次の行**。なので収まり判定からは末尾余白を除き、カーソルの前進には含める。
   */
  it("keeps the block itself in place when only its trailing space overflows", () => {
    const result = decidePagination(
      [
        block("intro", 0, 900),
        block("spaced", 900, 150, { trailingSpacePx: 100 }),
        block("after", 1050, 100),
      ],
      ENV,
      {},
    );

    // 本文 50px はページに収まる (900 + 50 <= 1000) ので、このブロックは動かない。
    expect(result.gaps.spaced).toBeUndefined();
    // 次のブロックは余白ぶんまで含めて溢れるので次ページ頭へ。
    expect(result.gaps.after).toBe(50);
  });

  it("still moves the block when its own content does not fit", () => {
    const result = decidePagination(
      [block("intro", 0, 900), block("spaced", 900, 250, { trailingSpacePx: 100 })],
      ENV,
      {},
    );

    // 本文 150px がページに収まらない (900 + 150 > 1000) ので、従来どおりブロックごと送る。
    expect(result.gaps.spaced).toBe(200);
  });

  it("treats a missing trailing space as 0 (documents without the field are unchanged)", () => {
    const withoutField = decidePagination(
      [block("intro", 0, 900), block("spaced", 900, 150), block("after", 1050, 100)],
      ENV,
      {},
    );
    const withZero = decidePagination(
      [
        block("intro", 0, 900),
        block("spaced", 900, 150, { trailingSpacePx: 0 }),
        block("after", 1050, 100),
      ],
      ENV,
      {},
    );

    expect(withZero).toEqual(withoutField);
  });

  it("does not let the trailing space start a fragmentable block one page early", () => {
    // 分割可能ブロックは「きれいに始められる残り高さ」で判定する。余白を高さに数えると
    // 本文が始められるのに次ページへ送られる。
    const result = decidePagination(
      [
        block("intro", 0, 900),
        {
          kind: "fragmentableBlock",
          gapKey: "long",
          topNat: 900,
          height: 1200,
          minStartHeightPx: 60,
          trailingSpacePx: 100,
        },
      ],
      ENV,
      {},
    );

    expect(result.gaps.long).toBeUndefined();
  });
});
