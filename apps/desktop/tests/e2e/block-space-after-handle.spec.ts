import { expect, test, type Page } from "@playwright/test";

import { normalizePageLayout } from "@/lib/page-layout";
import { sampleDocument } from "@/lib/sample-document";
import type { SigmaDocument } from "@/types/sigma-doc";

import { installDesktopRuntimeMock } from "./desktop-runtime-mock";

const DRAG_PX = 30;
/** 紙面の「余白のダブルタップ」判定窓 (`PageCanvasEditor` の PAGE_DOUBLE_TAP_MS) を越える待ち。 */
const PAGE_MARGIN_DOUBLE_TAP_WINDOW_MS = 500;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
});

/**
 * 紙面は zoom の CSS transform 越しに描かれるので、`getBoundingClientRect` は拡大率ぶん
 * 伸びている。レイアウト px との換算率を実測してから比べる。
 */
async function readScale(page: Page, blockId: string): Promise<number> {
  return page.evaluate((id) => {
    const element = document.querySelector<HTMLElement>(`.page-flow [data-sigma-doc-id="${CSS.escape(id)}"]`);
    if (!element || element.offsetWidth === 0) {
      return 1;
    }
    return element.getBoundingClientRect().width / element.offsetWidth;
  }, blockId);
}

async function blockTop(page: Page, blockId: string): Promise<number> {
  return page.evaluate((id) => {
    const element = document.querySelector<HTMLElement>(`.page-flow [data-sigma-doc-id="${CSS.escape(id)}"]`);
    return element ? element.getBoundingClientRect().top : Number.NaN;
  }, blockId);
}

/** ブロックの中央にポインタを置いて、そのブロックのつまみを出す。 */
async function hoverBlock(page: Page, blockId: string) {
  const block = page.locator(`.page-flow [data-sigma-doc-id="${blockId}"]`).first();
  await expect(block).toBeVisible();
  const box = await block.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  return page.locator(`.page-block-space-handle[data-block-id="${blockId}"]`);
}

async function dragHandle(page: Page, handle: ReturnType<Page["locator"]>, deltaScreenPx: number) {
  const box = await handle.boundingBox();
  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + deltaScreenPx, { steps: 6 });
  await page.mouse.up();
}

/**
 * 実ユーザーのように、フレームを跨ぎながら少しずつ引く。離さないまま返るので、掴んだ
 * ままの状態を観測できる。
 */
async function grabAndDrag(
  page: Page,
  handle: ReturnType<Page["locator"]>,
  deltaScreenPx: number,
  steps = 16,
): Promise<{ x: number; y: number }> {
  const box = await handle.boundingBox();
  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(x, y + (deltaScreenPx * step) / steps);
    // 1 フレーム以上空ける。まとめて投げるとブラウザ側で 1 フレームに畳まれ、
    // 「追従しているか」を観測できなくなる (poll と同じ盲点)。
    await page.waitForTimeout(24);
  }
  return { x, y };
}

interface DragSample {
  handleTop: number;
  tops: Record<string, number>;
}

/** サンプリング中だけ紙面側に置く受け皿。 */
type SamplingWindow = Window & {
  __spaceAfterSamples?: DragSample[];
  __spaceAfterSampling?: boolean;
};

/**
 * `action` の間、**毎フレーム** 幾何を記録する。
 *
 * `expect.poll` は 1 フレームの往復も「まとめて瞬間移動」も吸収してしまう (最終位置しか
 * 見えない) ので、この spec の追従・継ぎ目の判定には使わない。
 */
async function sampleFramesDuring(
  page: Page,
  blockIds: readonly string[],
  action: () => Promise<void>,
  settleMs = 0,
): Promise<DragSample[]> {
  await page.evaluate((ids) => {
    const samples: DragSample[] = [];
    const read = (): DragSample => {
      const handle = document.querySelector<HTMLElement>(".page-block-space-handle");
      const tops: Record<string, number> = {};
      for (const id of ids) {
        const element = document.querySelector<HTMLElement>(
          `.page-flow [data-sigma-doc-id="${CSS.escape(id)}"]`,
        );
        tops[id] = element ? element.getBoundingClientRect().top : Number.NaN;
      }
      return {
        handleTop: handle ? handle.getBoundingClientRect().top : Number.NaN,
        tops,
      };
    };
    const window_ = window as SamplingWindow;
    window_.__spaceAfterSamples = samples;
    window_.__spaceAfterSampling = true;
    const step = () => {
      samples.push(read());
      if (window_.__spaceAfterSampling) {
        window.requestAnimationFrame(step);
      }
    };
    window.requestAnimationFrame(step);
  }, blockIds as string[]);

  await action();
  if (settleMs > 0) {
    await page.waitForTimeout(settleMs);
  }

  return page.evaluate(() => {
    const window_ = window as SamplingWindow;
    window_.__spaceAfterSampling = false;
    return window_.__spaceAfterSamples ?? [];
  });
}

/** 記録した系列が「ポインタに連続で追従した」と言える形かどうかを見る。 */
function expectContinuousDescent(series: readonly number[], totalTravelPx: number): void {
  const values = series.filter((value) => Number.isFinite(value));
  expect(values.length).toBeGreaterThan(10);

  // (a) 途中の相異なる値。「まとめて瞬間移動」だと 2〜3 種類しか出ない。
  expect(new Set(values.map((value) => Math.round(value))).size).toBeGreaterThanOrEqual(8);

  // (b) 単調。戻るフレームがあれば継ぎ目のちらつき (プレビューを先に外した形)。
  let maxJump = 0;
  for (let index = 1; index < values.length; index += 1) {
    const delta = values[index] - values[index - 1];
    expect(delta).toBeGreaterThan(-1);
    maxJump = Math.max(maxJump, Math.abs(delta));
  }

  // (c) 1 フレームの跳躍が総移動量の 1/3 未満。追いつかずに飛んでいれば必ずここで落ちる。
  expect(maxJump).toBeLessThan(totalTravelPx / 3);
}

/**
 * 「字体が 1 つ増えて読み込みが終わった」を紙面へ知らせる。
 *
 * 紙面はこれを受けて全体を測り直す予約を出す (`fonts.ready` / `loadingdone` の購読)。
 * ドラッグ中の凍結を **外因で** 試すための、いちばん安い実物の引き金。判定は
 * `${fonts.status}:${fonts.size}` の変化なので、毎回別の family で足す。
 */
async function announceFontLoad(page: Page, family: string): Promise<void> {
  await page.evaluate((name) => {
    // 実体は要らない (読み込みは走らせない)。`fonts.size` が動けば紙面は測り直しにくる。
    document.fonts.add(new FontFace(name, "local('Helvetica')"));
    document.fonts.dispatchEvent(new Event("loadingdone"));
  }, family);
}

async function readPerformanceCounters(page: Page): Promise<Record<string, number>> {
  const counters = await page.evaluate(
    () => window.__SIGMA_STUDIO_PERFORMANCE__?.counters ?? null,
  );
  expect(
    counters,
    "計測が無効なビルドです (window.__SIGMA_STUDIO_PERFORMANCE__ にカウンタがありません)。",
  ).not.toBeNull();
  return counters ?? {};
}

async function openDocument(page: Page, document: SigmaDocument): Promise<void> {
  await installDesktopRuntimeMock(page, document);
  await page.goto("/");
  await page.waitForTimeout(1500);
}

test("the handle appears on hover and drags the space below the block", async ({ page }) => {
  test.setTimeout(60_000);

  await installDesktopRuntimeMock(page, createDocument());
  await page.goto("/");
  await page.waitForTimeout(1500);

  await expect(page.locator('.page-flow [data-sigma-doc-id="p_after"]')).toBeVisible();
  // ホバーする前は出ない (常時表示にしない)。
  await expect(page.locator(".page-block-space-handle")).toHaveCount(0);

  const scale = await readScale(page, "p_spaced");
  const before = await blockTop(page, "p_after");

  const handle = await hoverBlock(page, "p_spaced");
  await expect(handle).toBeVisible();

  await dragHandle(page, handle, DRAG_PX * scale);

  await expect.poll(async () => Math.round((await blockTop(page, "p_after") - before) / scale))
    .toBeGreaterThanOrEqual(DRAG_PX - 2);
  await expect.poll(async () => Math.round((await blockTop(page, "p_after") - before) / scale))
    .toBeLessThanOrEqual(DRAG_PX + 2);

  // 文書へ保存されている。
  await expect.poll(async () => page.evaluate(
    () => window.localStorage.getItem("sigma-studio:e2e-document") ?? "",
  )).toContain("spaceAfterPx");
});

test("dragging up stops at 0 and a double-click resets it", async ({ page }) => {
  test.setTimeout(60_000);

  await installDesktopRuntimeMock(page, createDocument({ spaceAfterPx: 40 }));
  await page.goto("/");
  await page.waitForTimeout(1500);

  await expect(page.locator('.page-flow [data-sigma-doc-id="p_after"]')).toBeVisible();
  const scale = await readScale(page, "p_spaced");
  const withSpace = await blockTop(page, "p_after");

  // 大きく上へ引いても 0 で止まる (負にならない)。
  const handle = await hoverBlock(page, "p_spaced");
  await dragHandle(page, handle, -400 * scale);

  await expect.poll(async () => Math.round((withSpace - await blockTop(page, "p_after")) / scale))
    .toBeGreaterThanOrEqual(38);
  const atZero = await blockTop(page, "p_after");

  // ここから下へ戻して、ダブルクリックで 0 に戻ることを見る。
  const handleAgain = await hoverBlock(page, "p_spaced");
  await dragHandle(page, handleAgain, DRAG_PX * scale);
  await expect.poll(async () => Math.round((await blockTop(page, "p_after") - atZero) / scale))
    .toBeGreaterThanOrEqual(DRAG_PX - 2);

  const handleForReset = await hoverBlock(page, "p_spaced");
  await handleForReset.dblclick();

  await expect.poll(async () => Math.round(Math.abs(await blockTop(page, "p_after") - atZero) / scale))
    .toBeLessThanOrEqual(2);
});

test("a second drag continues from the value the first one saved", async ({ page }) => {
  test.setTimeout(60_000);

  await installDesktopRuntimeMock(page, createDocument());
  await page.goto("/");
  await page.waitForTimeout(1500);

  await expect(page.locator('.page-flow [data-sigma-doc-id="p_after"]')).toBeVisible();
  const scale = await readScale(page, "p_spaced");
  const start = await blockTop(page, "p_after");

  await dragHandle(page, await hoverBlock(page, "p_spaced"), DRAG_PX * scale);
  await expect.poll(async () => Math.round((await blockTop(page, "p_after") - start) / scale))
    .toBeGreaterThanOrEqual(DRAG_PX - 2);

  // 2 回目。ホバーが取り直されていない値から足すと、ここで紙面が 1 回目の分だけ巻き戻る。
  await dragHandle(page, await hoverBlock(page, "p_spaced"), DRAG_PX * scale);

  await expect.poll(async () => Math.round((await blockTop(page, "p_after") - start) / scale))
    .toBeGreaterThanOrEqual(2 * DRAG_PX - 4);
});

test("dragging the handle does not move the caret or the selection", async ({ page }) => {
  test.setTimeout(60_000);

  await installDesktopRuntimeMock(page, createDocument());
  await page.goto("/");
  await page.waitForTimeout(1500);

  // 本文に選択を作ってから、つまみを引く。
  const before = page.locator('.page-flow [data-sigma-doc-id="p_before"]').first();
  await before.click({ clickCount: 3 });
  const selectionBefore = await page.evaluate(() => window.getSelection()?.toString() ?? "");
  expect(selectionBefore.length).toBeGreaterThan(0);

  const scale = await readScale(page, "p_spaced");
  const handle = await hoverBlock(page, "p_spaced");
  await dragHandle(page, handle, DRAG_PX * scale);

  expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe(selectionBefore);
});

test("the handle follows the column a block sits in", async ({ page }) => {
  test.setTimeout(60_000);

  await installDesktopRuntimeMock(page, createTwoColumnDocument());
  await page.goto("/");
  await page.waitForTimeout(1500);

  await expect.poll(async () => page.locator(".page-column-guides span").count()).toBeGreaterThan(0);

  const secondColumnId = await page.evaluate(() => {
    const blocks = Array.from(document.querySelectorAll<HTMLElement>(".page-flow [data-sigma-doc-id^=\"p_col_\"]"));
    const lefts = blocks.map((block) => block.getBoundingClientRect().left);
    const firstLeft = Math.min(...lefts);
    const inSecond = blocks.find((block) => block.getBoundingClientRect().left > firstLeft + 50);
    return inSecond?.getAttribute("data-sigma-doc-id") ?? null;
  });
  expect(secondColumnId).not.toBeNull();

  const handle = await hoverBlock(page, secondColumnId!);
  await expect(handle).toBeVisible();

  const proof = await page.evaluate((id) => {
    const block = document.querySelector<HTMLElement>(`.page-flow [data-sigma-doc-id="${id}"]`);
    const handleElement = document.querySelector<HTMLElement>(`.page-block-space-handle[data-block-id="${id}"]`);
    const blockRect = block!.getBoundingClientRect();
    const handleRect = handleElement!.getBoundingClientRect();
    return {
      // ハンドルは段の左端の外側 (ガター) に、段の左に揃えて出る。
      columnLeftDelta: handleRect.right - blockRect.left,
      bottomDelta: handleRect.top + handleRect.height / 2 - blockRect.bottom,
    };
  }, secondColumnId);

  // 用紙左端ではなく、その段の左のすぐ外 (右端の透明な当たり判定は本文左端に密着する)。
  expect(proof.columnLeftDelta).toBeLessThanOrEqual(0.5);
  expect(proof.columnLeftDelta).toBeGreaterThan(-60);
  expect(Math.abs(proof.bottomDelta)).toBeLessThan(3);
});

test("the handle survives the pointer's approach in every column and zoom", async ({ page }) => {
  test.setTimeout(120_000);

  await installDesktopRuntimeMock(page, createTwoColumnDocument());
  await page.goto("/");
  await page.waitForTimeout(1500);
  await expect.poll(async () => page.locator(".page-column-guides span").count()).toBeGreaterThan(0);

  const pickColumnBlocks = () => page.evaluate(() => {
    const blocks = Array.from(document.querySelectorAll<HTMLElement>('.page-flow [data-sigma-doc-id^="p_col_"]'));
    const lefts = blocks.map((block) => block.getBoundingClientRect().left);
    const firstLeft = Math.min(...lefts);
    return {
      first: blocks.find((block) => Math.abs(block.getBoundingClientRect().left - firstLeft) < 5)
        ?.getAttribute("data-sigma-doc-id") ?? null,
      second: blocks.find((block) => block.getBoundingClientRect().left > firstLeft + 50)
        ?.getAttribute("data-sigma-doc-id") ?? null,
    };
  });

  // ブロック中央からつまみまで、実ユーザーのように少しずつポインタを寄せる。ガターと段間の
  // 救済プローブが「ポインタの居る段」を探らないと、この途中でホバーが隣の段や空振りへ
  // 解決し直され、つまみが unmount されて掴めない (これが直したバグの形)。
  const approach = async (blockId: string) => {
    const block = page.locator(`.page-flow [data-sigma-doc-id="${blockId}"]`).first();
    const box = await block.boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    const handle = page.locator(`.page-block-space-handle[data-block-id="${blockId}"]`);
    await expect(handle).toBeVisible();
    const target = await handle.boundingBox();
    const [sx, sy] = [box!.x + box!.width / 2, box!.y + box!.height / 2];
    const [tx, ty] = [target!.x + target!.width / 2, target!.y + target!.height / 2];
    for (let step = 1; step <= 12; step += 1) {
      await page.mouse.move(sx + ((tx - sx) * step) / 12, sy + ((ty - sy) * step) / 12);
      await expect(handle).toBeVisible();
    }
  };

  const setZoom = async (value: string) => {
    await page.evaluate((zoom) => {
      const select = document.querySelector<HTMLSelectElement>('select[aria-label="ズーム"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      setter?.call(select!, zoom);
      select!.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
    await page.waitForTimeout(800);
  };

  for (const zoom of ["100", "150"]) {
    await setZoom(zoom);
    const picks = await pickColumnBlocks();
    expect(picks.first).not.toBeNull();
    expect(picks.second).not.toBeNull();
    await approach(picks.first!);
    await approach(picks.second!);
  }

  // 寄せた後のつまみはそのまま掴めて、その段のブロックへ効く。
  await setZoom("100");
  const picks = await pickColumnBlocks();
  const handle = await hoverBlock(page, picks.second!);
  await dragHandle(page, handle, DRAG_PX);
  await expect.poll(async () => page.evaluate((id) => {
    const element = document.querySelector<HTMLElement>(`.page-flow [data-sigma-doc-id="${id}"]`);
    return element ? Number.parseFloat(getComputedStyle(element).paddingBottom || "0") : -1;
  }, picks.second)).toBeGreaterThanOrEqual(DRAG_PX - 2);
});

test("partial columns offer the handle for each block inside, per column", async ({ page }) => {
  test.setTimeout(60_000);

  await installDesktopRuntimeMock(page, createPartialColumnsDocument());
  await page.goto("/");
  await page.waitForTimeout(1500);
  await expect(page.locator('.page-flow [data-sigma-doc-id="p_in_1"]')).toBeVisible();

  // 局所段組の中の各ブロックに、そのブロックを対象にしたつまみが出る (入れ物の
  // layoutSection で止まらない)。グリップ (ブロック選択) はセクション単位のまま出続ける。
  for (const id of ["p_in_1", "p_in_3"]) {
    const handle = await hoverBlock(page, id);
    await expect(handle).toBeVisible();
    await expect(page.locator(".page-block-handle")).toBeVisible();
  }

  // 2 段目のブロックを掴んで引くと、そのブロックの下余白として文書に保存される。
  const scale = await readScale(page, "p_in_1");
  const rightColumnId = await page.evaluate(() => {
    const blocks = Array.from(document.querySelectorAll<HTMLElement>('[data-sigma-doc-id^="p_in_"]'));
    const lefts = blocks.map((block) => block.getBoundingClientRect().left);
    const firstLeft = Math.min(...lefts);
    return blocks.find((block) => block.getBoundingClientRect().left > firstLeft + 50)
      ?.getAttribute("data-sigma-doc-id") ?? null;
  });
  expect(rightColumnId).not.toBeNull();

  const handle = await hoverBlock(page, rightColumnId!);
  await dragHandle(page, handle, DRAG_PX * scale);

  await expect.poll(async () => page.evaluate((id) => {
    const element = document.querySelector<HTMLElement>(`.page-flow [data-sigma-doc-id="${id}"]`);
    return element ? Number.parseFloat(getComputedStyle(element).paddingBottom || "0") : -1;
  }, rightColumnId)).toBeGreaterThanOrEqual(DRAG_PX - 2);
  await expect.poll(async () => page.evaluate(
    () => window.localStorage.getItem("sigma-studio:e2e-document") ?? "",
  )).toContain("spaceAfterPx");
});

test("partial columns inside a problem reach both columns, on the right gutter lanes", async ({ page }) => {
  test.setTimeout(60_000);

  await installDesktopRuntimeMock(page, createProblemPartialColumnsDocument());
  await page.goto("/");
  await page.waitForTimeout(1500);
  await expect(page.locator('.page-flow [data-sigma-doc-id="q_1"]')).toBeVisible();

  // 左の段は問題番号・エリア高さハンドルと同居するので 1 レーン外 (problem)。
  const leftHandle = await hoverBlock(page, "q_1");
  await expect(leftHandle).toBeVisible();
  await expect(leftHandle).toHaveAttribute("data-gutter-lane", "problem");

  // 右の段の左に問題 chrome は無い。通常レーンに出て、段間から掴める。
  const rightHandle = await hoverBlock(page, "q_3");
  await expect(rightHandle).toBeVisible();
  await expect(rightHandle).not.toHaveAttribute("data-gutter-lane", "problem");
});

test("the handle lands on the block edge at 150% zoom too", async ({ page }) => {
  test.setTimeout(60_000);

  await installDesktopRuntimeMock(page, createDocument());
  await page.goto("/");
  await page.waitForTimeout(1500);

  await page.evaluate(() => {
    const select = document.querySelector<HTMLSelectElement>('select[aria-label="ズーム"]');
    if (!select) {
      throw new Error("ズームのselectが見つかりません");
    }
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    setter?.call(select, "150");
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(800);

  const scale = await readScale(page, "p_spaced");
  expect(scale).toBeGreaterThan(1.4);

  const handle = await hoverBlock(page, "p_spaced");
  await expect(handle).toBeVisible();

  const placement = await page.evaluate(() => {
    const block = document.querySelector<HTMLElement>('.page-flow [data-sigma-doc-id="p_spaced"]');
    const handleElement = document.querySelector<HTMLElement>('.page-block-space-handle[data-block-id="p_spaced"]');
    const blockRect = block!.getBoundingClientRect();
    const handleRect = handleElement!.getBoundingClientRect();
    return {
      bottomDelta: handleRect.top + handleRect.height / 2 - blockRect.bottom,
      leftDelta: handleRect.right - blockRect.left,
    };
  });

  // つまみは拡大率が変わってもブロックの下端の線に乗る。
  expect(Math.abs(placement.bottomDelta)).toBeLessThan(4);
  // 右端の透明な当たり判定は本文左端に密着する (拡大率ぶんの誤差を許す)。
  expect(placement.leftDelta).toBeLessThanOrEqual(1);

  // 換算も拡大率に追従する: 論理 30px ぶん引いたら 30px ぶん下がる。
  const before = await blockTop(page, "p_after");
  await dragHandle(page, handle, DRAG_PX * scale);
  await expect.poll(async () => Math.round((await blockTop(page, "p_after") - before) / scale))
    .toBeGreaterThanOrEqual(DRAG_PX - 3);
  await expect.poll(async () => Math.round((await blockTop(page, "p_after") - before) / scale))
    .toBeLessThanOrEqual(DRAG_PX + 3);
});

test("the handle reaches blocks inside a problem area without covering its own gutter", async ({ page }) => {
  test.setTimeout(60_000);

  await installDesktopRuntimeMock(page, createProblemDocument());
  await page.goto("/");
  await page.waitForTimeout(1500);

  const handle = await hoverBlock(page, "p_in_prompt");
  await expect(handle).toBeVisible();

  const overlap = await page.evaluate(() => {
    const handleElement = document.querySelector<HTMLElement>(".page-block-space-handle");
    if (!handleElement) {
      return null;
    }
    const handleRect = handleElement.getBoundingClientRect();
    const intersects = (other: Element | null) => {
      if (!other) {
        return false;
      }
      const rect = other.getBoundingClientRect();
      return handleRect.left < rect.right
        && handleRect.right > rect.left
        && handleRect.top < rect.bottom
        && handleRect.bottom > rect.top;
    };
    return {
      lane: handleElement.getAttribute("data-gutter-lane"),
      hitsAreaResize: Array.from(document.querySelectorAll(".problem-area-resize-handle")).some(intersects),
      hitsNumberMarker: Array.from(document.querySelectorAll(".problem-number-marker")).some(intersects),
      hitsSideNote: Array.from(document.querySelectorAll(".problem-area-side-note")).some(intersects),
    };
  });

  expect(overlap).not.toBeNull();
  expect(overlap!.lane).toBe("problem");
  expect(overlap!.hitsAreaResize).toBe(false);
  expect(overlap!.hitsNumberMarker).toBe(false);
  expect(overlap!.hitsSideNote).toBe(false);
});

test("a list's live preview moves what is below it, never its own items", async ({ page }) => {
  test.setTimeout(60_000);

  await openDocument(page, createListDocument());

  const scale = await readScale(page, "list_spaced");
  const handle = await hoverBlock(page, "list_spaced");
  await expect(handle).toBeVisible();

  // ドラッグの途中で測る (プレビューが乗っている状態)。
  await grabAndDrag(page, handle, 60 * scale, 8);

  const midDrag = await page.evaluate(() => {
    /**
     * いま効いている縦の平行移動 (px)。`transform` 文字列を「"none" かどうか」で見ると
     * `translateY(0)` の `matrix(1, 0, 0, 1, 0, 0)` でも通ってしまい、何も証明できない。
     */
    const translateY = (element: HTMLElement | null): number => {
      if (!element) {
        return Number.NaN;
      }
      const transform = window.getComputedStyle(element).transform;
      return !transform || transform === "none" ? 0 : new DOMMatrixReadOnly(transform).f;
    };
    const list = document.querySelector<HTMLElement>('.page-flow [data-sigma-doc-id="list_spaced"]');
    const items = Array.from(list?.querySelectorAll<HTMLElement>("li") ?? []);
    const after = document.querySelector<HTMLElement>('.page-flow [data-sigma-doc-id="p_list_after"]');
    return {
      // 掴んだブロック自身の寸法は 1px も変わらない (padding を伸ばすと再ページ割りが走る)。
      listPaddingBottom: list ? Number.parseFloat(getComputedStyle(list).paddingBottom || "0") : -1,
      listTranslateY: translateY(list),
      itemCount: items.length,
      // 印は class なので相続しない — 項目まで降りる経路が構造的に無い。
      itemsMarked: items.filter((item) => item.classList.contains("sigma-space-after-follower")).length,
      itemTranslateYs: items.map((item) => translateY(item)),
      afterTranslateY: translateY(after),
    };
  });

  await page.mouse.up();

  expect(midDrag.listPaddingBottom).toBeLessThan(0.5);
  expect(midDrag.listTranslateY).toBe(0);
  expect(midDrag.itemCount).toBeGreaterThan(1);
  expect(midDrag.itemsMarked).toBe(0);
  expect(midDrag.itemTranslateYs.every((offset) => offset === 0)).toBe(true);
  // 動くのは下のブロックだけ。しかも「引いた向きに、引いた分だけ」動く
  // (transform 文字列の有無で見ると translateY(0) でも通ってしまい何も証明できない)。
  expect(midDrag.afterTranslateY).toBeGreaterThan(50 * scale);
});

test("a page-crossing block below the drag keeps its continuation still", async ({ page }) => {
  test.setTimeout(90_000);

  await openDocument(page, createSplitBlockDocument());
  await expect(page.locator('.page-flow [data-sigma-doc-id="p_tall"]').first()).toBeVisible();
  // 続きの複製が出るまで待つ (この文書のためのフィクスチャ条件そのもの)。
  await expect(page.locator(".editor-box-fragment-viewport").first()).toBeVisible();

  const scale = await readScale(page, "p_head");
  const handle = await hoverBlock(page, "p_head");
  await expect(handle).toBeVisible();

  const before = await page.evaluate(() => {
    const replica = document.querySelector<HTMLElement>(".editor-box-fragment-viewport .ProseMirror");
    return replica ? replica.getBoundingClientRect().top : Number.NaN;
  });
  await grabAndDrag(page, handle, 60 * scale, 10);

  const midDrag = await page.evaluate(() => {
    const replicaEditor = document.querySelector<HTMLElement>(
      ".editor-box-fragment-viewport .ProseMirror",
    );
    const replicaBlock = replicaEditor?.querySelector<HTMLElement>("[data-sigma-doc-id]") ?? null;
    return {
      // 印はモジュールのストアからブロック id で配られる。複製の面が素通しだと、
      // 掴んだページとは別のページのクリップ窓の中身がドラッグ中に一緒に動く。
      marked: replicaBlock?.classList.contains("sigma-space-after-follower") ?? null,
      top: replicaEditor ? replicaEditor.getBoundingClientRect().top : Number.NaN,
    };
  });

  await page.mouse.up();

  expect(midDrag.marked).toBe(false);
  expect(Math.abs(midDrag.top - before)).toBeLessThan(1);
});

test("the handle and the block below it follow the pointer frame by frame", async ({ page }) => {
  test.setTimeout(90_000);

  await openDocument(page, createDocument());
  await expect(page.locator('.page-flow [data-sigma-doc-id="p_after"]')).toBeVisible();

  const scale = await readScale(page, "p_spaced");
  const before = await blockTop(page, "p_after");
  const handle = await hoverBlock(page, "p_spaced");
  await expect(handle).toBeVisible();
  const travel = 90 * scale;

  // 離すところまで含めてサンプリングする。継ぎ目 (プレビュー → 確定) で 1 フレームでも
  // 元の位置へ戻れば、下の単調性の判定が落ちる。
  const samples = await sampleFramesDuring(page, ["p_after"], async () => {
    await grabAndDrag(page, handle, travel, 20);
    await page.mouse.up();
  }, 700);

  expectContinuousDescent(samples.map((sample) => sample.tops.p_after), travel);
  expectContinuousDescent(samples.map((sample) => sample.handleTop), travel);

  // 最後は引いた分だけ下がって落ち着く。
  const last = samples[samples.length - 1];
  expect(Math.abs(last.tops.p_after - (before + travel))).toBeLessThan(4 * scale);
});

test("the document is untouched until the pointer is released", async ({ page }) => {
  test.setTimeout(60_000);

  await openDocument(page, createDocument());
  const scale = await readScale(page, "p_spaced");
  const handle = await hoverBlock(page, "p_spaced");
  await grabAndDrag(page, handle, DRAG_PX * scale, 10);

  const midDrag = await page.evaluate(() => {
    const block = document.querySelector<HTMLElement>('.page-flow [data-sigma-doc-id="p_spaced"]');
    return {
      // 正本が変わっていれば、その値は必ず padding として描かれる。
      paddingBottom: block ? Number.parseFloat(getComputedStyle(block).paddingBottom || "0") : -1,
      inlineValue: block?.style.getPropertyValue("--sigma-doc-space-after") ?? "?",
      storage: window.localStorage.getItem("sigma-studio:e2e-document") ?? "",
    };
  });

  expect(midDrag.paddingBottom).toBeLessThan(0.5);
  expect(midDrag.inlineValue).toBe("");
  expect(midDrag.storage).not.toContain("spaceAfterPx");

  await page.mouse.up();

  await expect.poll(async () => page.evaluate(() => {
    const block = document.querySelector<HTMLElement>('.page-flow [data-sigma-doc-id="p_spaced"]');
    return block ? Number.parseFloat(getComputedStyle(block).paddingBottom || "0") : -1;
  })).toBeGreaterThanOrEqual(DRAG_PX - 2);
  await expect.poll(async () => page.evaluate(
    () => window.localStorage.getItem("sigma-studio:e2e-document") ?? "",
  )).toContain("spaceAfterPx");
});

test("dragging freezes the page walk instead of re-running it per pointermove", async ({ page }) => {
  test.setTimeout(60_000);

  await openDocument(page, createDocument());
  const scale = await readScale(page, "p_spaced");
  const handle = await hoverBlock(page, "p_spaced");
  await expect(handle).toBeVisible();
  // ホバー解決が予約した再計測を消化してから測り始める。
  await page.waitForTimeout(800);

  // 対照実験: まず掴んでいない状態で外因 (字体の遅延ロード) を起こし、それが本当に
  // 再ページ割りの予約まで届くことを確かめる。これが無いと、下の「増えていない」は
  // 「そもそも何も起きない条件だった」でも通ってしまい、凍結を一切証明できない。
  const idle = await readPerformanceCounters(page);
  await announceFontLoad(page, "SigmaE2EProbeIdle");
  await expect.poll(async () => (
    (await readPerformanceCounters(page))["PageCanvasEditor.deferredRecompute"] ?? 0
  )).toBeGreaterThan(idle["PageCanvasEditor.deferredRecompute"] ?? 0);

  const before = await readPerformanceCounters(page);
  await grabAndDrag(page, handle, DRAG_PX * scale, 14);
  // 同じ外因を、今度は掴んだまま起こす。
  await announceFontLoad(page, "SigmaE2EProbeDragging");
  await page.waitForTimeout(250);
  const during = await readPerformanceCounters(page);
  await page.mouse.up();

  const delta = (name: string) => (during[name] ?? 0) - (before[name] ?? 0);
  // ドラッグ中はページ割りを取り直さない。ここが増えると、答えが途中で差し替わって
  // 後続ブロックが「別のページへ一気に移る」ように見える。
  expect(delta("PageCanvasEditor.deferredRecompute")).toBe(0);
  // 装飾の打ち直しは掴んだ瞬間の 1 本だけ (移動量は custom property が運ぶ)。
  expect(delta("TextFlowEditor.refreshDispatch")).toBeLessThanOrEqual(2);

  // 離したら凍結が解け、握りつぶしていた分を含めて 1 回測り直す。
  await expect.poll(async () => (
    (await readPerformanceCounters(page))["PageCanvasEditor.deferredRecompute"] ?? 0
  )).toBeGreaterThan(during["PageCanvasEditor.deferredRecompute"] ?? 0);
});

test("the whole drag is one undo step", async ({ page }) => {
  test.setTimeout(60_000);

  await openDocument(page, createDocument());
  const scale = await readScale(page, "p_spaced");
  const before = await blockTop(page, "p_after");

  await dragHandle(page, await hoverBlock(page, "p_spaced"), DRAG_PX * scale);
  await expect.poll(async () => Math.round((await blockTop(page, "p_after") - before) / scale))
    .toBeGreaterThanOrEqual(DRAG_PX - 2);

  await page.keyboard.press("ControlOrMeta+Z");

  await expect.poll(async () => Math.round(Math.abs(await blockTop(page, "p_after") - before) / scale))
    .toBeLessThanOrEqual(2);
});

test("Escape throws the drag away and leaves nothing behind", async ({ page }) => {
  test.setTimeout(60_000);

  await openDocument(page, createDocument());
  const scale = await readScale(page, "p_spaced");
  const before = await blockTop(page, "p_after");

  const handle = await hoverBlock(page, "p_spaced");
  await grabAndDrag(page, handle, 60 * scale, 8);
  expect(await blockTop(page, "p_after")).toBeGreaterThan(before + 20 * scale);

  await page.keyboard.press("Escape");
  await page.mouse.up();

  // 表示が元へ戻り、文書にも入っていない。
  await expect.poll(async () => Math.round(Math.abs(await blockTop(page, "p_after") - before)))
    .toBeLessThanOrEqual(2);
  expect(await page.evaluate(
    () => window.localStorage.getItem("sigma-studio:e2e-document") ?? "",
  )).not.toContain("spaceAfterPx");

  // リスナも凍結も残っていない: もう一度掴んで引ける。
  //
  // 同じ画素をすぐもう一度押すと、紙面側の「余白のダブルタップ」(PAGE_DOUBLE_TAP_MS = 450ms /
  // PAGE_DOUBLE_TAP_DISTANCE_PX = 28px) が 2 回目の押下を横取りする。これは本件と無関係の
  // 既存の経路なので、その窓を越えてから掴み直す (人手でも 0.5 秒は空く)。
  await page.waitForTimeout(PAGE_MARGIN_DOUBLE_TAP_WINDOW_MS);
  const again = await hoverBlock(page, "p_spaced");
  await expect(again).toBeVisible();
  await dragHandle(page, again, DRAG_PX * scale);
  await expect.poll(async () => Math.round((await blockTop(page, "p_after") - before) / scale))
    .toBeGreaterThanOrEqual(DRAG_PX - 2);
});

test("a cancelled pointer discards the drag and unfreezes hover resolution", async ({ page }) => {
  test.setTimeout(60_000);

  await openDocument(page, createDocument());
  const scale = await readScale(page, "p_spaced");
  const before = await blockTop(page, "p_after");

  const handle = await hoverBlock(page, "p_spaced");
  await grabAndDrag(page, handle, 60 * scale, 8);

  // タッチのキャンセル / 別ウィンドウへポインタが移ったときに来るイベント。
  await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true })));
  await page.mouse.up();

  await expect.poll(async () => Math.round(Math.abs(await blockTop(page, "p_after") - before)))
    .toBeLessThanOrEqual(2);
  expect(await page.evaluate(
    () => window.localStorage.getItem("sigma-studio:e2e-document") ?? "",
  )).not.toContain("spaceAfterPx");

  // ホバー解決が復活している (凍結が残っていれば別ブロックのつまみは二度と出ない)。
  await expect(await hoverBlock(page, "p_before")).toBeVisible();
});

test("in page columns only the dragged column moves", async ({ page }) => {
  test.setTimeout(90_000);

  await openDocument(page, createTwoColumnDocument());
  await expect.poll(async () => page.locator(".page-column-guides span").count()).toBeGreaterThan(0);

  const picks = await pickColumnNeighbours(page, "p_col_");
  expect(picks.dragged).not.toBeNull();
  expect(picks.sameColumnBelow).not.toBeNull();
  expect(picks.otherColumn).not.toBeNull();

  const handle = await hoverBlock(page, picks.dragged!);
  await expect(handle).toBeVisible();
  const ids = [picks.sameColumnBelow!, picks.otherColumn!];
  const beforeTops = await topsOf(page, ids);

  const samples = await sampleFramesDuring(page, ids, async () => {
    await grabAndDrag(page, handle, 40, 14);
  });
  await page.mouse.up();

  const followerSeries = samples.map((sample) => sample.tops[picks.sameColumnBelow!]);
  expectContinuousDescent(followerSeries, 40);

  const neighbourSeries = samples
    .map((sample) => sample.tops[picks.otherColumn!])
    .filter((value) => Number.isFinite(value));
  // 隣の段は 1px も動かない。
  expect(Math.max(...neighbourSeries) - Math.min(...neighbourSeries)).toBeLessThan(1);
  expect(Math.abs(neighbourSeries[neighbourSeries.length - 1] - beforeTops[picks.otherColumn!]))
    .toBeLessThan(1);
});

test("in a problem's own columns only the dragged column moves", async ({ page }) => {
  test.setTimeout(90_000);

  await openDocument(page, createProblemPartialColumnsDocument());
  await expect(page.locator('.page-flow [data-sigma-doc-id="q_1"]')).toBeVisible();

  const handle = await hoverBlock(page, "q_1");
  await expect(handle).toBeVisible();
  const ids = ["q_2", "q_3"];
  const beforeTops = await topsOf(page, ids);

  const samples = await sampleFramesDuring(page, ids, async () => {
    await grabAndDrag(page, handle, 40, 14);
  });
  await page.mouse.up();

  expectContinuousDescent(samples.map((sample) => sample.tops.q_2), 40);

  const neighbourSeries = samples.map((sample) => sample.tops.q_3).filter((value) => Number.isFinite(value));
  expect(Math.max(...neighbourSeries) - Math.min(...neighbourSeries)).toBeLessThan(1);
  expect(Math.abs(neighbourSeries[neighbourSeries.length - 1] - beforeTops.q_3)).toBeLessThan(1);
});

test("the drag stays continuous at 150% zoom", async ({ page }) => {
  test.setTimeout(90_000);

  await openDocument(page, createDocument());
  await selectUiOptionInPage(page, "ズーム", "150");
  await page.waitForTimeout(800);

  const scale = await readScale(page, "p_spaced");
  expect(scale).toBeGreaterThan(1.4);
  const before = await blockTop(page, "p_after");
  const handle = await hoverBlock(page, "p_spaced");
  const travel = 60 * scale;

  const samples = await sampleFramesDuring(page, ["p_after"], async () => {
    await grabAndDrag(page, handle, travel, 16);
    await page.mouse.up();
  }, 700);

  expectContinuousDescent(samples.map((sample) => sample.tops.p_after), travel);
  // 画面 px で引いた分だけ画面 px で下がる (ズーム換算が両側で一致している)。
  const last = samples[samples.length - 1];
  expect(Math.abs(last.tops.p_after - (before + travel))).toBeLessThan(5 * scale);
});

async function topsOf(page: Page, blockIds: readonly string[]): Promise<Record<string, number>> {
  return page.evaluate((ids) => Object.fromEntries(ids.map((id) => {
    const element = document.querySelector<HTMLElement>(`.page-flow [data-sigma-doc-id="${id}"]`);
    return [id, element ? element.getBoundingClientRect().top : Number.NaN];
  })), blockIds as string[]);
}

/**
 * 段組の中から「掴む段落」「その直下 (同じ段)」「隣の段の段落」を選ぶ。
 * 段の割り当てはブラウザが決めるので、id からは決め打ちできない。
 */
async function pickColumnNeighbours(page: Page, idPrefix: string): Promise<{
  dragged: string | null;
  sameColumnBelow: string | null;
  otherColumn: string | null;
}> {
  return page.evaluate((prefix) => {
    const blocks = Array.from(
      document.querySelectorAll<HTMLElement>(`.page-flow [data-sigma-doc-id^="${prefix}"]`),
    ).map((element) => ({
      id: element.getAttribute("data-sigma-doc-id") ?? "",
      rect: element.getBoundingClientRect(),
    }));
    const firstLeft = Math.min(...blocks.map((block) => block.rect.left));
    const firstColumn = blocks.filter((block) => Math.abs(block.rect.left - firstLeft) < 5);
    const otherColumn = blocks.filter((block) => block.rect.left > firstLeft + 50);
    return {
      dragged: firstColumn[0]?.id ?? null,
      sameColumnBelow: firstColumn[1]?.id ?? null,
      otherColumn: otherColumn[0]?.id ?? null,
    };
  }, idPrefix);
}

test("the handle stays put while dragging, even when the pointer leaves the block", async ({ page }) => {
  test.setTimeout(60_000);

  await installDesktopRuntimeMock(page, createDocument());
  await page.goto("/");
  await page.waitForTimeout(1500);

  const scale = await readScale(page, "p_spaced");
  const before = await blockTop(page, "p_after");
  const handle = await hoverBlock(page, "p_spaced");
  const box = await handle.boundingBox();
  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;

  await page.mouse.move(x, y);
  await page.mouse.down();
  // 掴んだままブロックの外へ大きく出る。ホバー解決を凍結していないと、ここで
  // affordance が空になってつまみごと unmount される。
  await page.mouse.move(5, y + 40 * scale, { steps: 6 });

  await expect(page.locator('.page-block-space-handle[data-block-id="p_spaced"]')).toBeVisible();

  await page.mouse.up();

  await expect.poll(async () => Math.round((await blockTop(page, "p_after") - before) / scale))
    .toBeGreaterThanOrEqual(38);
});

test("the handle never reaches the PDF surface", async ({ page }) => {
  test.setTimeout(60_000);

  await installDesktopRuntimeMock(page, createDocument({ spaceAfterPx: 40 }));
  await page.goto("/print?fileId=file_e2e_document&profile=teacher", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".paged-surface[data-paged-surface-state='ready']")).toHaveCount(1);

  // 紙面の上をひととおりなぞる (編集面ならどこかでつまみが出る動き)。
  const surface = page.locator(".paged-surface").first();
  const box = await surface.boundingBox();
  for (const ratio of [0.2, 0.4, 0.6]) {
    await page.mouse.move(box!.x + box!.width * 0.5, box!.y + box!.height * ratio);
    await page.waitForTimeout(120);
  }

  // 編集専用のアフォーダンスは紙面 (= PDF の元) に一切出ない。
  await expect(page.locator(".page-block-space-handle")).toHaveCount(0);
  await expect(page.locator(".page-block-affordance-layer")).toHaveCount(0);
});

function baseDocument(docId: string): SigmaDocument {
  const document = structuredClone(sampleDocument);
  document.docId = docId;
  document.metadata = { title: "下端つまみ e2e" };
  document.comments = [];
  return document;
}

function createDocument(options: { spaceAfterPx?: number } = {}): SigmaDocument {
  const document = baseDocument("doc_e2e_space_after_handle");
  document.content = [
    { type: "paragraph", id: "p_before", children: [{ type: "text", text: "つまみの前の段落" }] },
    {
      type: "paragraph",
      id: "p_spaced",
      children: [{ type: "text", text: "下端を掴む段落" }],
      ...(options.spaceAfterPx ? { spaceAfterPx: options.spaceAfterPx } : {}),
    },
    { type: "paragraph", id: "p_after", children: [{ type: "text", text: "つまみの後の段落" }] },
  ];
  return document;
}

function createTwoColumnDocument(): SigmaDocument {
  const document = baseDocument("doc_e2e_space_after_handle_columns");
  document.content = Array.from({ length: 14 }, (_, index) => ({
    type: "paragraph" as const,
    id: `p_col_${index + 1}`,
    children: [{ type: "text" as const, text: `段組の段落 ${index + 1}` }],
  }));
  document.pageLayout = normalizePageLayout({
    preset: "custom",
    pageSize: { widthMm: 210, heightMm: 90 },
    marginsMm: { top: 10, right: 16, bottom: 10, left: 16 },
    flow: { type: "columns", columnCount: 2, columnGapMm: 8 },
  });
  return document;
}

function createPartialColumnsDocument(): SigmaDocument {
  const document = baseDocument("doc_e2e_space_after_partial_columns");
  document.content = [
    { type: "paragraph", id: "p_head", children: [{ type: "text", text: "段組の前の段落" }] },
    {
      type: "layoutSection",
      id: "section_1",
      layout: { columnCount: 2 },
      children: [
        { type: "paragraph", id: "p_in_1", children: [{ type: "text", text: "局所段組の段落 1" }] },
        { type: "paragraph", id: "p_in_2", children: [{ type: "text", text: "局所段組の段落 2" }] },
        { type: "paragraph", id: "p_in_3", children: [{ type: "text", text: "局所段組の段落 3" }] },
        { type: "paragraph", id: "p_in_4", children: [{ type: "text", text: "局所段組の段落 4" }] },
      ],
    },
    { type: "paragraph", id: "p_tail", children: [{ type: "text", text: "段組の後の段落" }] },
  ];
  return document;
}

function createProblemPartialColumnsDocument(): SigmaDocument {
  const document = baseDocument("doc_e2e_space_after_problem_partial_columns");
  document.content = [{
    type: "problem",
    id: "problem_columns",
    tags: [],
    lead: [],
    prompt: [
      { type: "paragraph", id: "p_intro", children: [{ type: "text", text: "問題文の導入" }] },
      {
        type: "layoutSection",
        id: "section_p",
        layout: { columnCount: 2 },
        children: [
          { type: "paragraph", id: "q_1", children: [{ type: "text", text: "(1) 左の設問" }] },
          { type: "paragraph", id: "q_2", children: [{ type: "text", text: "(2) 左の設問の続き" }] },
          { type: "paragraph", id: "q_3", children: [{ type: "text", text: "(3) 右の設問" }] },
          { type: "paragraph", id: "q_4", children: [{ type: "text", text: "(4) 右の設問の続き" }] },
        ],
      },
    ],
    solution: [],
    hints: [],
    numbering: { enabled: true, value: 1 },
  }];
  return document;
}

function createProblemDocument(): SigmaDocument {
  const document = baseDocument("doc_e2e_space_after_handle_problem");
  document.content = [{
    type: "problem",
    id: "problem_handle",
    tags: [],
    lead: [],
    prompt: [
      { type: "paragraph", id: "p_in_prompt", children: [{ type: "text", text: "問題文の段落" }] },
      { type: "paragraph", id: "p_in_prompt_2", children: [{ type: "text", text: "問題文の 2 行目" }] },
    ],
    solution: [],
    hints: [],
    numbering: { enabled: true, value: 1 },
  }];
  return document;
}

/**
 * 掴むブロックの下に「ページを跨いで分割されるブロック」がある紙面。
 *
 * 分割されたブロックは正本のクリップと **続きの複製** の 2 面で描かれ、複製は正本と同じ
 * ブロック id を持つ。追従の印は id で配られるので、面ごとの出し分けが無いと別ページの
 * 複製まで動く。
 */
function createSplitBlockDocument(): SigmaDocument {
  const document = baseDocument("doc_e2e_space_after_split_block");
  document.content = [
    { type: "paragraph", id: "p_head", children: [{ type: "text", text: "つまみを掴む段落" }] },
    {
      type: "quote",
      id: "p_tall",
      blocks: Array.from({ length: 14 }, (_, index) => ({
        type: "paragraph" as const,
        id: `p_tall_line_${index + 1}`,
        children: [{ type: "text" as const, text: `ページを跨ぐ引用の ${index + 1} 行目` }],
      })),
    },
    { type: "paragraph", id: "p_tail", children: [{ type: "text", text: "分割の後の段落" }] },
  ];
  document.pageLayout = normalizePageLayout({
    preset: "custom",
    pageSize: { widthMm: 210, heightMm: 120 },
    marginsMm: { top: 12, right: 16, bottom: 12, left: 16 },
  });
  return document;
}

function createListDocument(): SigmaDocument {
  const document = baseDocument("doc_e2e_space_after_handle_list");
  document.content = [
    {
      type: "list",
      id: "list_spaced",
      listType: "bullet",
      items: [
        { type: "listItem", id: "li_one", children: [{ type: "text", text: "ひとつ" }] },
        { type: "listItem", id: "li_two", children: [{ type: "text", text: "ふたつ" }] },
      ],
    },
    { type: "paragraph", id: "p_list_after", children: [{ type: "text", text: "リストの後" }] },
  ];
  return document;
}
