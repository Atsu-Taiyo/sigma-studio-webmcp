import { expect, test, type Page } from "@playwright/test";

import { sampleDocument } from "../../src/lib/sample-document";
import type { SigmaDocument } from "../../src/types/sigma-doc";
import { installDesktopRuntimeMock } from "./desktop-runtime-mock";

async function openEditor(page: Page, document: SigmaDocument = createTextSelectionDocument()) {
  await installDesktopRuntimeMock(page, document);
  await page.goto("/");
  await expect(page.locator(".text-flow-editor").first()).toBeVisible();
  await page.locator(".startup-splash").waitFor({ state: "hidden", timeout: 10_000 });
}

test("selects body text when dragging from the expanded text gutter", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openEditor(page);

  const editor = page.locator(".page-flow .text-flow-editor").filter({
    has: page.locator("p").filter({ hasText: /\S/ }),
  }).first();
  await expect(editor).toBeVisible();
  const paragraph = editor.locator("p").filter({ hasText: /\S/ }).first();
  await expect(paragraph).toBeVisible();
  const expectedText = (await paragraph.textContent())?.trim().slice(0, 8) ?? "";
  expect(expectedText.length).toBeGreaterThan(0);

  const editorBox = await editor.boundingBox();
  const paragraphBox = await paragraph.boundingBox();
  const gutterBox = await editor.locator("xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' text-flow-shell ')]")
    .locator(".text-flow-side-selection-gutter")
    .boundingBox();
  expect(editorBox).not.toBeNull();
  expect(paragraphBox).not.toBeNull();
  expect(gutterBox).not.toBeNull();

  const startX = gutterBox!.x + gutterBox!.width / 2;
  const y = paragraphBox!.y + paragraphBox!.height / 2;
  const endX = paragraphBox!.x + 260;

  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(endX, y, { steps: 10 });
  await page.mouse.up();

  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? "")).toContain(expectedText);
});

test("anchors gutter drag selection where the pointer enters body text", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openEditor(page);

  const editor = page.locator(".page-flow .text-flow-editor").filter({
    has: page.locator("p").filter({ hasText: "複素数平面" }),
  }).first();
  await expect(editor).toBeVisible();
  const paragraph = editor.locator("p").filter({ hasText: "複素数平面" }).first();
  await expect(paragraph).toBeVisible();

  const dragTarget = await paragraph.evaluate((element) => {
    const editorRect = element.closest(".text-flow-editor")?.getBoundingClientRect();
    const gutterRect = element.closest(".text-flow-shell")
      ?.querySelector(".text-flow-side-selection-gutter")
      ?.getBoundingClientRect();
    if (!editorRect) {
      throw new Error("missing editor rect");
    }
    if (!gutterRect) {
      throw new Error("missing text selection gutter rect");
    }
    const range = document.createRange();
    range.selectNodeContents(element);
    const fragmentRects = Array.from(range.getClientRects())
      .filter((rect) => rect.width > 8 && rect.height > 4)
      .map((rect) => ({
        bottom: rect.bottom,
        centerY: rect.top + rect.height / 2,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        width: rect.width,
      }));
    const lineRects = fragmentRects.reduce<Array<(typeof fragmentRects)[number]>>((lines, rect) => {
      const line = lines.find((candidate) => Math.abs(candidate.centerY - rect.centerY) < 10);
      if (line) {
        line.left = Math.min(line.left, rect.left);
        line.right = Math.max(line.right, rect.right);
        line.top = Math.min(line.top, rect.top);
        line.bottom = Math.max(line.bottom, rect.bottom);
        line.centerY = line.top + (line.bottom - line.top) / 2;
        line.width = line.right - line.left;
        line.height = line.bottom - line.top;
      } else {
        lines.push({ ...rect });
      }
      return lines;
    }, []);
    if (lineRects.length < 2) {
      throw new Error("expected paragraph to wrap to at least two lines");
    }
    const firstLine = lineRects[0];
    const secondLine = lineRects[1];

    return {
      endX: secondLine.left + Math.min(180, secondLine.width * 0.45),
      enterY: secondLine.top + secondLine.height / 2,
      startX: gutterRect.left + gutterRect.width / 2,
      startY: firstLine.top + firstLine.height / 2,
    };
  });

  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.mouse.move(dragTarget.startX, dragTarget.startY);
  await page.mouse.down();
  await page.mouse.move(dragTarget.startX, dragTarget.enterY, { steps: 4 });
  await page.mouse.move(dragTarget.endX, dragTarget.enterY, { steps: 10 });
  await page.mouse.up();

  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? "")).not.toBe("");
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ""))
    .not.toContain("複素数平面");
});

test("selects inline math from the right before body text has ever been focused", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  const document = structuredClone(sampleDocument);
  document.content = [{
    id: "p_right_drag_selection",
    type: "paragraph",
    children: [
      { type: "text", text: "before " },
      { id: "m_right_drag_selection", type: "mathInline", tex: "x^2", display: "inline" },
    ],
  }];
  await openEditor(page, document);

  const editor = page.locator(".text-flow-editor").filter({ has: page.locator(".inline-math-node") }).first();
  const inlineMath = editor.locator(".inline-math-node").first();
  await expect(inlineMath).toBeVisible();
  await expect(editor).not.toHaveClass(/ProseMirror-focused/);

  const dragTarget = await inlineMath.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      endX: rect.left - 24,
      startX: rect.right + 32,
      y: rect.top + rect.height / 2,
    };
  });

  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.mouse.move(dragTarget.startX, dragTarget.y);
  await page.mouse.down();
  await page.mouse.move(dragTarget.endX, dragTarget.y, { steps: 10 });
  await page.mouse.up();

  await expect(inlineMath).toHaveClass(/text-selected/);
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? "")).not.toBe("");
});

function createTextSelectionDocument(): SigmaDocument {
  const document = structuredClone(sampleDocument);
  document.docId = "doc_e2e_text_selection";
  document.metadata = {
    ...document.metadata,
    title: "本文選択 E2E",
  };
  return document;
}

test("shows inline math as selected when body text selection includes it", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await openEditor(page);

  const editor = page.locator(".text-flow-editor").first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.type("before ");
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("sigma-studio:insert-inline-math", {
      detail: { edit: false, target: "document", tex: "x^2" },
    }));
  });
  const inlineMath = editor.locator(".inline-math-node").first();
  await expect(inlineMath).toBeVisible();

  // The focus guard must not outrank the editing state: when a selected math
  // node switches to its MathLive editor, the selection background stays off.
  await inlineMath.click();
  await expect(inlineMath).toHaveClass(/editing/);
  const inlineMathField = inlineMath.locator("math-field.inline-math-field");
  await expect(inlineMathField).toBeFocused();
  await expect.poll(() => inlineMath.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe("rgba(0, 0, 0, 0)");
  await page.keyboard.press("Escape");
  await expect(inlineMath).not.toHaveClass(/editing/);

  const dragTarget = await inlineMath.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      endX: rect.right + 32,
      startX: rect.left - 24,
      y: rect.top + rect.height / 2,
    };
  });

  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.mouse.move(dragTarget.startX, dragTarget.y);
  await page.mouse.down();
  await page.mouse.move(dragTarget.endX, dragTarget.y, { steps: 10 });
  await page.mouse.up();

  await expect(inlineMath).toHaveClass(/text-selected/);
  await expect.poll(() => inlineMath.evaluate((element) => getComputedStyle(element).backgroundColor))
    .not.toBe("rgba(0, 0, 0, 0)");
  const selectionColors = await inlineMath.evaluate((element) => {
    const paragraph = element.closest("p");
    if (!paragraph) {
      throw new Error("missing paragraph for selection color comparison");
    }
    const mathStyle = getComputedStyle(element);
    const textSelectionStyle = getComputedStyle(paragraph, "::selection");
    return {
      mathBackground: mathStyle.backgroundColor,
      mathColor: mathStyle.color,
      textBackground: textSelectionStyle.backgroundColor,
      textColor: textSelectionStyle.color,
    };
  });
  expect(selectionColors.textBackground).toBe(selectionColors.mathBackground);
  expect(selectionColors.textColor).toBe(selectionColors.mathColor);

  const paragraph = editor.locator("p").first();
  const paragraphBox = await paragraph.boundingBox();
  expect(paragraphBox).not.toBeNull();
  await page.mouse.click(paragraphBox!.x + 4, paragraphBox!.y + paragraphBox!.height / 2);
  await expect(inlineMath).not.toHaveClass(/text-selected/);
  await expect.poll(() => inlineMath.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe("rgba(0, 0, 0, 0)");

  await page.getByLabel("教材タイトル").focus();
  await expect(editor).not.toHaveClass(/ProseMirror-focused/);
  await page.mouse.move(dragTarget.endX, dragTarget.y);
  await page.mouse.down();
  await page.mouse.move(dragTarget.startX, dragTarget.y, { steps: 10 });
  await page.mouse.up();

  await expect(inlineMath).toHaveClass(/text-selected/);
  await expect.poll(() => inlineMath.evaluate((element) => getComputedStyle(element).backgroundColor))
    .not.toBe("rgba(0, 0, 0, 0)");

  const pageSheet = page.locator(".a4-page-sheet").first();
  const pageSheetBox = await pageSheet.boundingBox();
  expect(pageSheetBox).not.toBeNull();
  await page.mouse.click(pageSheetBox!.x + pageSheetBox!.width - 24, pageSheetBox!.y + pageSheetBox!.height - 24);
  await expect(editor).not.toHaveClass(/ProseMirror-focused/);
  await expect.poll(() => inlineMath.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe("rgba(0, 0, 0, 0)");

});
