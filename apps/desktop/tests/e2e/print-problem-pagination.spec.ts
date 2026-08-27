import { expect, test } from "@playwright/test";

import type { SigmaDocument } from "@/types/sigma-doc";

import { installDesktopRuntimeMock } from "./desktop-runtime-mock";

const DOCUMENT: SigmaDocument = {
  version: "2.0",
  docId: "doc_print_problem_pagination",
  metadata: { title: "問題と解答の改ページ確認" },
  content: [
    {
      type: "paragraph",
      id: "before_problem",
      children: [{ type: "text", text: "問題の前にある本文" }],
    },
    {
      type: "problem",
      id: "kept_problem",
      tags: [],
      numbering: { enabled: false },
      lead: [],
      prompt: [{
        type: "paragraph",
        id: "kept_prompt",
        children: [{ type: "text", text: "問題文" }],
      }],
      solution: [{
        type: "paragraph",
        id: "kept_solution",
        children: [{ type: "text", text: "解答" }],
      }],
      hints: [],
      frame: { enabled: true },
      areaLayout: {
        prompt: { minHeightMm: 32 },
        solution: { minHeightMm: 32 },
      },
    },
  ],
  outputProfiles: {
    student: { showSolutions: false },
    teacher: { showSolutions: true },
    answerBook: { onlySolutions: true, showSolutions: true },
  },
  pageLayout: {
    preset: "custom",
    orientation: "portrait",
    pageSize: { widthMm: 80, heightMm: 90 },
    marginsMm: { top: 10, right: 10, bottom: 10, left: 10 },
    flow: { type: "columns", columnCount: 1, columnGapMm: 0 },
  },
};

/**
 * かつては `test.fail()` 付きの既知の制限だった。
 *
 * この問題は 90mm のページに 32mm + 32mm を予約するのでページ内容高さより高く、どの紙面にも
 * 丸ごとは収まらない。以前は「収まらない問題には keep-together を適用しない」= その場から
 * 流す規則だったので、次の紙面の頭から始めることができなかった。WI-4 で規則を
 * 「収まらなくても次ページの頭から始め、占有するページ数だけページカーソルを進める」に
 * 一本化した結果 (`page-canvas/pagination-decisions.ts`)、後続を 1 ページ早く送ってしまう
 * 副作用も消え、この期待どおりの配置になった。
 */
test("keeps a framed problem prompt and solution on the same printed page when they fit", async ({ page }) => {
  await installDesktopRuntimeMock(page, DOCUMENT);
  await page.goto("/print?fileId=file_e2e_document&profile=teacher", { waitUntil: "domcontentloaded" });

  const pages = page.locator(".paged-surface-page");
  await expect(pages).toHaveCount(2);
  await expect(pages.nth(0).locator('[data-sigma-doc-id="before_problem"]')).toBeVisible();
  await expect(pages.nth(0).locator('[data-sigma-doc-id="kept_prompt"]')).toHaveCount(0);
  await expect(pages.nth(1).locator('[data-sigma-doc-id="kept_prompt"]')).toBeVisible();
  await expect(pages.nth(1).locator('[data-sigma-doc-id="kept_solution"]')).toBeVisible();
});


/**
 * The keep-together rule itself: a framed problem that fits on a page must not be split
 * across one, and the blank space its areas reserve through `areaLayout.*.minHeightMm`
 * counts towards "fits" even though no block has that height of its own.
 */
const RESERVED_AREA_DOCUMENT: SigmaDocument = {
  version: "2.0",
  docId: "doc_reserved_area_keep_together",
  metadata: { title: "解答欄の確保とページ送り" },
  content: [
    ...Array.from({ length: 6 }, (_, index) => ({
      type: "paragraph" as const,
      id: `filler_${index + 1}`,
      children: [{ type: "text" as const, text: `本文 ${index + 1} 行目のサンプルです` }],
    })),
    {
      type: "problem",
      id: "reserved_problem",
      tags: [],
      numbering: { enabled: false },
      lead: [],
      prompt: [{ type: "paragraph", id: "reserved_prompt", children: [{ type: "text", text: "問題文" }] }],
      solution: [{ type: "paragraph", id: "reserved_solution", children: [{ type: "text", text: "解答" }] }],
      hints: [],
      frame: { enabled: true },
      areaLayout: {
        prompt: { minHeightMm: 22 },
        solution: { minHeightMm: 22 },
      },
    },
  ],
  outputProfiles: {
    student: { showSolutions: false },
    teacher: { showSolutions: true },
    answerBook: { onlySolutions: true, showSolutions: true },
  },
  pageLayout: {
    preset: "custom",
    orientation: "portrait",
    pageSize: { widthMm: 90, heightMm: 110 },
    marginsMm: { top: 10, right: 10, bottom: 10, left: 10 },
    flow: { type: "columns", columnCount: 1, columnGapMm: 0 },
  },
};

test("moves a framed problem whole rather than letting its reserved answer area overflow", async ({ page }) => {
  test.setTimeout(120_000);
  await installDesktopRuntimeMock(page, RESERVED_AREA_DOCUMENT);
  await page.goto("/print?fileId=file_e2e_document&profile=teacher", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".paged-surface[data-paged-surface-state='ready']")).toHaveCount(1);

  const pages = page.locator(".paged-surface-page");
  await expect(pages).toHaveCount(2);
  // Prompt and answer stay together, on the sheet that can hold the whole frame.
  await expect(pages.nth(0).locator('[data-sigma-doc-id="reserved_prompt"]')).toHaveCount(0);
  await expect(pages.nth(1).locator('[data-sigma-doc-id="reserved_prompt"]')).toBeVisible();
  await expect(pages.nth(1).locator('[data-sigma-doc-id="reserved_solution"]')).toBeVisible();

  // And the frame — reserved blank space included — stays inside the printable area.
  const overflow = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLElement>(".paged-surface-stage .page-canvas");
    const frame = canvas?.querySelector<HTMLElement>(".problem-area-flow-unit.with-frame");
    if (!canvas || !frame) {
      return null;
    }
    const stride = Number(canvas.dataset.pageStride ?? "0");
    const pageHeight = Number(canvas.dataset.pageHeight ?? "0");
    const canvasTop = canvas.getBoundingClientRect().top;
    const rect = frame.getBoundingClientRect();
    const top = rect.top - canvasTop;
    const withinPage = top % stride;
    return Math.round((withinPage + rect.height - pageHeight) * 10) / 10;
  });
  expect(overflow).not.toBeNull();
  expect(overflow!).toBeLessThanOrEqual(0);
});
