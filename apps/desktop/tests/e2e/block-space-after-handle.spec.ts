import { expect, test, type Page } from "@playwright/test";

import { normalizePageLayout } from "@/lib/page-layout";
import { sampleDocument } from "@/lib/sample-document";
import type { SigmaDocument } from "@/types/sigma-doc";

import { installDesktopRuntimeMock } from "./desktop-runtime-mock";

const DRAG_PX = 30;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
});

/**
 * 紙面は zoom の CSS transform 越しに描かれるので、`getBoundingClientRect` は拡大率ぶん
 * 伸びている。レイアウト px との換算率を実測してから比べる。
 */
async function readScale(page: Page, blockId: string): Promise<number> {
  return page.evaluate((id) => {
    const element = document.querySelector<HTMLElement>(`.page-flow [data-sigma-doc-id="${id}"]`);
    if (!element || element.offsetWidth === 0) {
      return 1;
    }
    return element.getBoundingClientRect().width / element.offsetWidth;
  }, blockId);
}

async function blockTop(page: Page, blockId: string): Promise<number> {
  return page.evaluate((id) => {
    const element = document.querySelector<HTMLElement>(`.page-flow [data-sigma-doc-id="${id}"]`);
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

  // 用紙左端ではなく、その段の左のすぐ外。
  expect(proof.columnLeftDelta).toBeLessThanOrEqual(0);
  expect(proof.columnLeftDelta).toBeGreaterThan(-60);
  expect(Math.abs(proof.bottomDelta)).toBeLessThan(3);
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
  expect(placement.leftDelta).toBeLessThanOrEqual(0);

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

test("a list's live preview does not leak into its own items", async ({ page }) => {
  test.setTimeout(60_000);

  await installDesktopRuntimeMock(page, createListDocument());
  await page.goto("/");
  await page.waitForTimeout(1500);

  const scale = await readScale(page, "list_spaced");
  const handle = await hoverBlock(page, "list_spaced");
  await expect(handle).toBeVisible();

  // ドラッグの途中で測る (ドラフト値が custom property として乗っている状態)。
  const box = await handle.boundingBox();
  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 60 * scale, { steps: 6 });

  const midDrag = await page.evaluate(() => {
    const list = document.querySelector<HTMLElement>('.page-flow [data-sigma-doc-id="list_spaced"]');
    const items = Array.from(list?.querySelectorAll<HTMLElement>("li > p") ?? []);
    return {
      listPaddingBottom: list ? Number.parseFloat(getComputedStyle(list).paddingBottom || "0") : -1,
      itemPaddings: items.map((item) => Number.parseFloat(getComputedStyle(item).paddingBottom || "0")),
    };
  });

  await page.mouse.up();

  expect(midDrag.listPaddingBottom).toBeGreaterThan(50);
  expect(midDrag.itemPaddings.length).toBeGreaterThan(1);
  // custom property は相続するので、断ち切りが無いと項目ごとに同じ余白が付いて紙面が壊れる。
  expect(midDrag.itemPaddings.every((padding) => padding < 0.5)).toBe(true);
});

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
