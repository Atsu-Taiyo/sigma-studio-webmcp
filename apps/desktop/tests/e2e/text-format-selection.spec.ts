import { expect, test, type Page } from "@playwright/test";

import { installDesktopRuntimeMock } from "./desktop-runtime-mock";
import type { InlineNode, ParagraphNode, SigmaBlock, SigmaDocument } from "@/types/sigma-doc";

const MINCHO_FONT_VALUE = '"Hiragino Mincho ProN", "Yu Mincho", YuMincho, serif';

test("keeps the selected text range while applying font size and font family", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await installDesktopRuntimeMock(page, createDocument([
    {
      id: "format_target",
      type: "paragraph",
      children: [
        { type: "text", text: "Alpha " },
        { type: "text", text: "Beta", color: "#dc2626" },
        { type: "text", text: " " },
        { type: "text", text: "Gamma", backgroundColor: "#fff3c2" },
        { type: "text", text: " Delta" },
      ],
    },
  ]));

  await page.goto("/");
  await expect(page.locator('.text-flow-editor [data-sigma-doc-id="format_target"]')).toBeVisible();

  await selectTextRange(page, "format_target", 6, 16);
  await expect.poll(() => selectedText(page)).toBe("Beta Gamma");

  await page.getByLabel("フォントサイズ").click();
  await page.getByRole("menu", { name: "フォントサイズ" }).getByRole("menuitemradio", { name: "15pt", exact: true }).click();
  await expect.poll(() => selectedText(page)).toBe("Beta Gamma");
  await expect.poll(() => textRangeStyleSummary(page)).toMatchObject({
    selectedAllStyled: true,
    prefixStyled: false,
    suffixStyled: false,
  });

  await page.locator(".toolbar-font-select").click();
  await page.getByRole("searchbox", { name: "フォントを検索" }).fill("Hiragino Mincho");
  await page.getByRole("menuitemradio", { name: "Hiragino Mincho ProN", exact: true }).click();
  await expect.poll(() => selectedText(page)).toBe("Beta Gamma");
  await expect.poll(() => textRangeStyleSummary(page)).toMatchObject({
    selectedAllStyled: true,
    selectedAllFontFamily: true,
    prefixStyled: false,
    suffixStyled: false,
  });
});

test("reflects the caret's inline marks on the toolbar buttons", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await installDesktopRuntimeMock(page, createDocument([
    {
      id: "format_target",
      type: "paragraph",
      children: [
        { type: "text", text: "Plain " },
        { type: "text", text: "Strong", marks: ["bold"] },
        { type: "text", text: " tail" },
      ],
    },
  ]));

  await page.goto("/");
  await expect(page.locator('.text-flow-editor [data-sigma-doc-id="format_target"]')).toBeVisible();

  const boldButton = page.getByRole("button", { name: "太字", exact: true });
  const italicButton = page.getByRole("button", { name: "斜体", exact: true });

  await placeCaret(page, "format_target", 3);
  await expect(boldButton).toHaveAttribute("aria-pressed", "false");

  await placeCaret(page, "format_target", 9);
  await expect(boldButton).toHaveAttribute("aria-pressed", "true");
  await expect(boldButton).toHaveClass(/\bactive\b/);
  await expect(italicButton).toHaveAttribute("aria-pressed", "false");

  await placeCaret(page, "format_target", 15);
  await expect(boldButton).toHaveAttribute("aria-pressed", "false");

  // Selecting the bold run and toggling from the toolbar must flip the button back
  // in the same interaction, without waiting for another caret move.
  await selectTextRange(page, "format_target", 6, 12);
  await expect(boldButton).toHaveAttribute("aria-pressed", "true");
  await boldButton.click();
  await expect(boldButton).toHaveAttribute("aria-pressed", "false");
});

test("toggles from the caret forward instead of formatting the whole block", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await installDesktopRuntimeMock(page, createDocument([
    {
      id: "format_target",
      type: "paragraph",
      children: [{ type: "text", text: "Alpha" }],
    },
  ]));

  await page.goto("/");
  await expect(page.locator('.text-flow-editor [data-sigma-doc-id="format_target"]')).toBeVisible();

  const boldButton = page.getByRole("button", { name: "太字", exact: true });

  // Caret at the end of the paragraph, nothing selected: bolding must arm the caret,
  // not repaint "Alpha".
  await placeCaret(page, "format_target", 5);
  await boldButton.click();
  await expect(boldButton).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => savedParagraphRuns(page)).toEqual([
    { text: "Alpha", bold: false },
  ]);

  await page.keyboard.type("Beta");
  await expect.poll(() => savedParagraphRuns(page)).toEqual([
    { text: "Alpha", bold: false },
    { text: "Beta", bold: true },
  ]);

  // Turning it back off from the same caret only affects what comes next.
  await boldButton.click();
  await page.keyboard.type("Gamma");
  await expect.poll(() => savedParagraphRuns(page)).toEqual([
    { text: "Alpha", bold: false },
    { text: "Beta", bold: true },
    { text: "Gamma", bold: false },
  ]);
});

test("inherits the previous inline formatting after Enter", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await installDesktopRuntimeMock(page, createDocument([
    {
      id: "format_target",
      type: "paragraph",
      children: [{
        type: "text",
        text: "書式付き本文",
        marks: ["bold"],
        color: "#1d4ed8",
        fontFamily: MINCHO_FONT_VALUE,
        fontSize: 18,
      }],
    },
  ]));

  await page.goto("/");
  await expect(page.locator('.text-flow-editor [data-sigma-doc-id="format_target"]')).toBeVisible();

  await placeCaret(page, "format_target", 6);
  await page.keyboard.press("Enter");
  await page.keyboard.type("継続");

  await expect.poll(() => page.evaluate(() => {
    const raw = window.localStorage.getItem("sigma-studio:e2e-document");
    const saved = raw ? JSON.parse(raw) as SigmaDocument : null;
    const continued = saved?.content
      .filter((block): block is ParagraphNode => block.type === "paragraph")
      .flatMap((block) => block.children)
      .find((node): node is Extract<InlineNode, { type: "text" }> => (
        node.type === "text" && node.text === "継続"
      ));
    return continued ? {
      bold: (continued.marks ?? []).includes("bold"),
      color: continued.color,
      fontFamily: continued.fontFamily,
      fontSize: continued.fontSize,
    } : null;
  })).toEqual({
    bold: true,
    color: "#1d4ed8",
    fontFamily: MINCHO_FONT_VALUE,
    fontSize: 18,
  });
});

test("shows the body menu instead of format controls when right-clicking selected text", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await installDesktopRuntimeMock(page, createDocument([
    {
      id: "format_target",
      type: "paragraph",
      children: [{ type: "text", text: "Alpha Beta Gamma Delta" }],
    },
  ]));

  await page.goto("/");
  const block = page.locator('.text-flow-editor [data-sigma-doc-id="format_target"]');
  await expect(block).toBeVisible();
  await selectTextRange(page, "format_target", 6, 16);

  await page.getByRole("button", { name: /^行間:/ }).click();
  const toolbarMenu = page.getByRole("dialog", { name: "行間" });
  await expect(toolbarMenu.locator(".line-height-stepper")).toHaveCount(0);
  await toolbarMenu.getByRole("button", { name: "数値で指定" }).click();
  await expect(toolbarMenu.locator(".line-height-stepper")).toBeVisible();
  await page.keyboard.press("Escape");

  await selectTextRange(page, "format_target", 6, 16);
  const rect = await block.boundingBox();
  if (!rect) throw new Error("Cannot find selected paragraph bounds");
  await block.dispatchEvent("contextmenu", { clientX: rect.x + 60, clientY: rect.y + 12 });

  const contextMenu = page.getByRole("menu", { name: "本文操作" });
  await expect(page.getByRole("dialog", { name: "選択した文章の書式" })).toHaveCount(0);
  await expect(contextMenu).toBeVisible();
  await expect(contextMenu.getByRole("combobox", { name: "フォント" })).toHaveCount(0);
  await expect(contextMenu.getByRole("combobox", { name: "行間" })).toHaveCount(0);
  await expect.poll(() => selectedText(page)).toBe("Beta Gamma");
});

test("offers block actions from the body menu for selected text", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await installDesktopRuntimeMock(page, createDocument([
    {
      id: "format_target",
      type: "paragraph",
      children: [{ type: "text", text: "選択範囲を段組にします。" }],
    },
  ]));

  await page.goto("/");
  const block = page.locator('.text-flow-editor [data-sigma-doc-id="format_target"]');
  await expect(block).toBeVisible();
  await selectTextRange(page, "format_target", 0, 8);
  const rect = await block.boundingBox();
  if (!rect) throw new Error("Cannot find selected paragraph bounds");
  await block.dispatchEvent("contextmenu", { clientX: rect.x + 60, clientY: rect.y + 12 });

  const contextMenu = page.getByRole("menu", { name: "本文操作" });
  await expect(contextMenu).toBeVisible();
  await expect(contextMenu.getByRole("menuitem", { name: "ここを段組にする", exact: true })).toBeVisible();
  await expect(contextMenu.getByRole("menuitem", { name: "素材に追加", exact: true })).toBeVisible();
  await contextMenu.getByRole("menuitem", { name: "ここを段組にする", exact: true }).hover();
  await expect(contextMenu.getByRole("menuitem", { name: "2段組", exact: true })).toBeVisible();
  await expect(contextMenu.getByRole("menuitem", { name: "3段組", exact: true })).toBeVisible();
  await expect(contextMenu.getByRole("menuitem", { name: "4段組", exact: true })).toBeVisible();

  await contextMenu.getByRole("menuitem", { name: "4段組", exact: true }).click();
  await expect.poll(async () => page.evaluate(() => {
    const raw = window.localStorage.getItem("sigma-studio:e2e-document");
    const document = raw ? JSON.parse(raw) as SigmaDocument : null;
    const section = document?.content.find((block) => block.type === "layoutSection");
    return section?.type === "layoutSection" ? section.layout.columnCount : null;
  })).toBe(4);
});

test("shows range actions in the body menu after a real multi-block right click", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await installDesktopRuntimeMock(page, createDocument([
    {
      id: "format_first",
      type: "paragraph",
      children: [{ type: "text", text: "最初の選択行です。" }],
    },
    {
      id: "format_second",
      type: "paragraph",
      children: [{ type: "text", text: "次の選択行です。" }],
    },
  ]));

  await page.goto("/");
  const firstBlock = page.locator('.text-flow-editor [data-sigma-doc-id="format_first"]');
  const secondBlock = page.locator('.text-flow-editor [data-sigma-doc-id="format_second"]');
  await expect(firstBlock).toBeVisible();
  await expect(secondBlock).toBeVisible();

  await selectTextAcrossBlocks(page, "format_first", "format_second");
  await expect.poll(() => selectedText(page)).toContain("最初の選択行です。");
  await expect.poll(() => selectedText(page)).toContain("次の選択行です。");
  await secondBlock.click({ button: "right", position: { x: 24, y: 10 } });

  const contextMenu = page.getByRole("menu", { name: "本文操作" });
  await expect(contextMenu).toBeVisible();
  await expect(contextMenu.getByRole("combobox", { name: "フォント" })).toHaveCount(0);
  await expect(contextMenu.getByRole("combobox", { name: "行間" })).toHaveCount(0);
  await expect(contextMenu.getByRole("menuitem", { name: "選択範囲を段組にする", exact: true })).toBeVisible();
  await expect(contextMenu.getByRole("menuitem", { name: "選択範囲を素材に追加", exact: true })).toBeVisible();
  await expect(contextMenu.getByRole("menuitem", { name: "選択範囲を削除", exact: true })).toBeVisible();

  await secondBlock.dispatchEvent("contextmenu", { clientX: 1370, clientY: 880 });
  const menuBounds = await contextMenu.boundingBox();
  if (!menuBounds) throw new Error("Cannot find body context menu bounds");
  expect(menuBounds.x + menuBounds.width).toBeLessThanOrEqual(1400);
  expect(menuBounds.y + menuBounds.height).toBeLessThanOrEqual(900);
});

test("wraps both selected paragraphs in a three-column layout section", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await installDesktopRuntimeMock(page, createDocument([
    { id: "wrap_first", type: "paragraph", children: [{ type: "text", text: "段組の先頭です。" }] },
    { id: "wrap_second", type: "paragraph", children: [{ type: "text", text: "段組の末尾です。" }] },
  ]));

  await page.goto("/");
  const secondBlock = page.locator('.text-flow-editor [data-sigma-doc-id="wrap_second"]');
  await expect(secondBlock).toBeVisible();
  await selectTextAcrossBlocks(page, "wrap_first", "wrap_second");
  await secondBlock.click({ button: "right", position: { x: 24, y: 10 } });

  const menu = page.getByRole("menu", { name: "本文操作" });
  await menu.getByRole("menuitem", { name: "選択範囲を段組にする", exact: true }).hover();
  await menu.getByRole("menuitem", { name: "3段組", exact: true }).click();

  await expect.poll(async () => page.evaluate(() => {
    const raw = window.localStorage.getItem("sigma-studio:e2e-document");
    const document = raw ? JSON.parse(raw) as SigmaDocument : null;
    const section = document?.content.find((block) => block.type === "layoutSection");
    return section?.type === "layoutSection"
      ? { columnCount: section.layout.columnCount, childIds: section.children.map((child) => child.id) }
      : null;
  })).toEqual({ columnCount: 3, childIds: ["wrap_first", "wrap_second"] });
});

test("deletes both paragraphs in the selected range", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await installDesktopRuntimeMock(page, createDocument([
    { id: "delete_first", type: "paragraph", children: [{ type: "text", text: "削除する先頭です。" }] },
    { id: "delete_second", type: "paragraph", children: [{ type: "text", text: "削除する末尾です。" }] },
    { id: "delete_keep", type: "paragraph", children: [{ type: "text", text: "残す段落です。" }] },
  ]));

  await page.goto("/");
  const secondBlock = page.locator('.text-flow-editor [data-sigma-doc-id="delete_second"]');
  await expect(secondBlock).toBeVisible();
  await selectTextAcrossBlocks(page, "delete_first", "delete_second");
  await secondBlock.click({ button: "right", position: { x: 24, y: 10 } });
  await page.getByRole("menu", { name: "本文操作" })
    .getByRole("menuitem", { name: "選択範囲を削除", exact: true })
    .click();

  await expect.poll(async () => page.evaluate(() => {
    const raw = window.localStorage.getItem("sigma-studio:e2e-document");
    const document = raw ? JSON.parse(raw) as SigmaDocument : null;
    return document?.content.map((block) => block.id) ?? [];
  })).toEqual(["delete_keep"]);
});

test("preserves the text selection after closing the body menu before changing line height", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await installDesktopRuntimeMock(page, createDocument([
    {
      id: "format_target",
      type: "paragraph",
      children: [{ type: "text", text: "Alpha Beta Gamma Delta" }],
    },
  ]));

  await page.goto("/");
  const block = page.locator('.text-flow-editor [data-sigma-doc-id="format_target"]');
  await expect(block).toBeVisible();
  await selectTextRange(page, "format_target", 6, 16);
  await block.click({ button: "right", position: { x: 60, y: 12 } });
  await expect(page.getByRole("menu", { name: "本文操作" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect.poll(() => selectedText(page)).toBe("Beta Gamma");

  await page.getByRole("button", { name: /^行間:/ }).click();
  await page.getByRole("dialog", { name: "行間" }).getByRole("button", { name: "2行", exact: true }).click();
  await expect.poll(() => paragraphFormatSummary(page)).toEqual({
    lineHeight: "2",
    selectedAllFontFamily: false,
  });
});

/**
 * The 太字/斜体/下線 buttons used to be rendered without an `active` prop at all, so the toolbar
 * looked identical whether or not the selection already carried the mark — you could not tell
 * bold text from plain text, and clicking the button was the only way to find out. The state now
 * rides on TEXT_FORMAT_STATE_EVENT alongside the boxed/font state that already worked.
 */
test("reflects the selected range's inline marks and colour in the toolbar", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await installDesktopRuntimeMock(page, createDocument([
    {
      id: "format_target",
      type: "paragraph",
      children: [
        { type: "text", text: "Plain " },
        { type: "text", text: "Strong", marks: ["bold"] },
        { type: "text", text: " " },
        { type: "text", text: "Slanted", marks: ["italic"] },
        { type: "text", text: " " },
        { type: "text", text: "Ruled", marks: ["underline"] },
        { type: "text", text: " " },
        { type: "text", text: "Crimson", color: "#dc2626" },
      ],
    },
  ]));

  await page.goto("/");
  await expect(page.locator('.text-flow-editor [data-sigma-doc-id="format_target"]')).toBeVisible();

  const bold = page.getByRole("button", { name: "太字" });
  const italic = page.getByRole("button", { name: "斜体" });
  const underline = page.getByRole("button", { name: "下線" });

  await selectTextRange(page, "format_target", 0, 5); // "Plain"
  await expect.poll(() => selectedText(page)).toBe("Plain");
  await expect(bold).toHaveAttribute("aria-pressed", "false");
  await expect(italic).toHaveAttribute("aria-pressed", "false");
  await expect(underline).toHaveAttribute("aria-pressed", "false");

  await selectTextRange(page, "format_target", 6, 12); // "Strong"
  await expect.poll(() => selectedText(page)).toBe("Strong");
  await expect(bold).toHaveAttribute("aria-pressed", "true");
  await expect(bold).toHaveClass(/active/);
  await expect(italic).toHaveAttribute("aria-pressed", "false");
  await expect(underline).toHaveAttribute("aria-pressed", "false");

  await selectTextRange(page, "format_target", 13, 20); // "Slanted"
  await expect.poll(() => selectedText(page)).toBe("Slanted");
  await expect(italic).toHaveAttribute("aria-pressed", "true");
  await expect(bold).toHaveAttribute("aria-pressed", "false");

  await selectTextRange(page, "format_target", 21, 26); // "Ruled"
  await expect.poll(() => selectedText(page)).toBe("Ruled");
  await expect(underline).toHaveAttribute("aria-pressed", "true");
  await expect(italic).toHaveAttribute("aria-pressed", "false");

  // The 文字色 swatch reads back the selection's colour, then falls back to the default.
  const swatchColor = () => page.locator(".toolbar-icon-color .toolbar-icon-color-stripe")
    .first()
    .evaluate((element) => window.getComputedStyle(element).backgroundColor);
  await selectTextRange(page, "format_target", 27, 34); // "Crimson"
  await expect.poll(() => selectedText(page)).toBe("Crimson");
  await expect.poll(swatchColor).toBe("rgb(220, 38, 38)");

  await selectTextRange(page, "format_target", 0, 5);
  await expect.poll(() => selectedText(page)).toBe("Plain");
  await expect.poll(swatchColor).toBe("rgb(17, 17, 17)");
});

async function placeCaret(page: Page, blockId: string, offset: number): Promise<void> {
  await selectTextRange(page, blockId, offset, offset);
}

async function savedParagraphRuns(page: Page): Promise<Array<{ bold: boolean; text: string }>> {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("sigma-studio:e2e-document");
    const saved = raw ? JSON.parse(raw) as SigmaDocument : null;
    const paragraph = saved?.content.find((block): block is ParagraphNode => (
      block.type === "paragraph" && block.id === "format_target"
    ));
    return (paragraph?.children ?? [])
      .filter((node): node is Extract<InlineNode, { type: "text" }> => node.type === "text")
      .map((node) => ({ bold: (node.marks ?? []).includes("bold"), text: node.text }));
  });
}

async function selectTextRange(page: Page, blockId: string, startOffset: number, endOffset: number): Promise<void> {
  await page.evaluate(({ targetBlockId, from, to }) => {
    const block = document.querySelector<HTMLElement>(`.text-flow-editor [data-sigma-doc-id="${targetBlockId}"]`);
    const editor = block?.closest<HTMLElement>(".text-flow-editor");
    const selection = window.getSelection();
    if (!block || !editor || !selection) {
      throw new Error(`Cannot select text in ${targetBlockId}`);
    }

    editor.focus({ preventScroll: true });
    selection.removeAllRanges();

    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let current = walker.nextNode();
    while (current) {
      if (current.textContent) {
        textNodes.push(current as Text);
      }
      current = walker.nextNode();
    }

    const positionForOffset = (offset: number) => {
      let cursor = 0;
      for (const node of textNodes) {
        const length = node.textContent?.length ?? 0;
        if (length === 0) {
          continue;
        }
        if (offset >= cursor && offset <= cursor + length) {
          return { node, offset: offset - cursor };
        }
        cursor += length;
      }
      throw new Error(`Offset ${offset} is outside ${targetBlockId}`);
    };

    const start = positionForOffset(from);
    const end = positionForOffset(to);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
  }, { targetBlockId: blockId, from: startOffset, to: endOffset });
}

async function selectTextAcrossBlocks(page: Page, startBlockId: string, endBlockId: string): Promise<void> {
  await page.evaluate(({ firstId, lastId }) => {
    const firstBlock = document.querySelector<HTMLElement>(`.text-flow-editor [data-sigma-doc-id="${firstId}"]`);
    const lastBlock = document.querySelector<HTMLElement>(`.text-flow-editor [data-sigma-doc-id="${lastId}"]`);
    const editor = firstBlock?.closest<HTMLElement>(".text-flow-editor");
    const selection = window.getSelection();
    if (!firstBlock || !lastBlock || !editor || !selection) {
      throw new Error("Cannot select text across blocks");
    }

    const firstText = document.createTreeWalker(firstBlock, NodeFilter.SHOW_TEXT).nextNode();
    const lastWalker = document.createTreeWalker(lastBlock, NodeFilter.SHOW_TEXT);
    let lastText = lastWalker.nextNode();
    while (lastText) {
      const next = lastWalker.nextNode();
      if (!next) break;
      lastText = next;
    }
    if (!(firstText instanceof Text) || !(lastText instanceof Text)) {
      throw new Error("Cannot find selectable text across blocks");
    }

    editor.focus({ preventScroll: true });
    selection.removeAllRanges();
    const range = document.createRange();
    range.setStart(firstText, 0);
    range.setEnd(lastText, lastText.textContent?.length ?? 0);
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
  }, { firstId: startBlockId, lastId: endBlockId });
}

async function selectedText(page: Page): Promise<string> {
  return page.evaluate(() => window.getSelection()?.toString() ?? "");
}

async function textRangeStyleSummary(page: Page): Promise<{
  prefixStyled: boolean;
  selectedAllFontFamily: boolean;
  selectedAllStyled: boolean;
  suffixStyled: boolean;
}> {
  return page.evaluate((fontFamily) => {
    const raw = window.localStorage.getItem("sigma-studio:e2e-document");
    if (!raw) {
      return {
        prefixStyled: false,
        selectedAllFontFamily: false,
        selectedAllStyled: false,
        suffixStyled: false,
      };
    }

    const document = JSON.parse(raw) as SigmaDocument;
    const paragraph = document.content.find((block): block is ParagraphNode => block.type === "paragraph" && block.id === "format_target");
    const chunks: Array<{ end: number; node: Extract<InlineNode, { type: "text" }>; start: number }> = [];
    let offset = 0;
    for (const node of paragraph?.children ?? []) {
      if (node.type !== "text") {
        continue;
      }
      const start = offset;
      const end = start + node.text.length;
      chunks.push({ end, node, start });
      offset = end;
    }

    const selectedChunks = chunks.filter((chunk) => chunk.start < 16 && chunk.end > 6);
    const prefixChunks = chunks.filter((chunk) => chunk.end <= 6);
    const suffixChunks = chunks.filter((chunk) => chunk.start >= 16);
    const hasFontStyle = (node: Extract<InlineNode, { type: "text" }>) => node.fontSize === 15 || node.fontFamily === fontFamily;

    return {
      prefixStyled: prefixChunks.some((chunk) => hasFontStyle(chunk.node)),
      selectedAllFontFamily: selectedChunks.length > 0 && selectedChunks.every((chunk) => chunk.node.fontFamily === fontFamily),
      selectedAllStyled: selectedChunks.length > 0 && selectedChunks.every((chunk) => chunk.node.fontSize === 15),
      suffixStyled: suffixChunks.some((chunk) => hasFontStyle(chunk.node)),
    };
  }, MINCHO_FONT_VALUE);
}

async function paragraphFormatSummary(page: Page): Promise<{
  lineHeight: string | null;
  selectedAllFontFamily: boolean;
}> {
  return page.evaluate((fontFamily) => {
    const raw = window.localStorage.getItem("sigma-studio:e2e-document");
    const document = raw ? JSON.parse(raw) as SigmaDocument : null;
    const paragraph = document?.content.find((block): block is ParagraphNode => (
      block.type === "paragraph" && block.id === "format_target"
    ));
    const selectedTextNodes = (paragraph?.children ?? []).filter((node) => (
      node.type === "text" && /Beta|Gamma/u.test(node.text)
    ));
    return {
      lineHeight: paragraph?.lineHeight ?? null,
      selectedAllFontFamily: selectedTextNodes.length > 0 && selectedTextNodes.every((node) => (
        node.type === "text" && node.fontFamily === fontFamily
      )),
    };
  }, MINCHO_FONT_VALUE);
}

function createDocument(content: SigmaBlock[]): SigmaDocument {
  return {
    version: "2.0",
    docId: "text_format_selection_e2e_doc",
    metadata: { title: "文字選択書式 E2E" },
    content,
    outputProfiles: {
      answerBook: {},
      student: {},
      teacher: {},
    },
  };
}

/**
 * ツールバーのフォント表示は「その位置で実際に描かれる書体」でなければならない。
 *
 * 直していたのは、選択が空のときに「ユーザーが最後にドロップダウンで選んだ書体 (設定値)」へ
 * フォールバックしていたこと。設定値と実際に描かれる書体は、ユーザーが手で指定していない位置に
 * キャレットが移った瞬間に別物になる。
 */
const TOOLBAR_FONT = ".toolbar-font-select .toolbar-font-select-label";

async function toolbarFontLabel(page: Page): Promise<string> {
  return (await page.locator(TOOLBAR_FONT).first().textContent())?.trim() ?? "";
}

function mixedFontDocument(): SigmaDocument {
  return createDocument([
    {
      id: "font_display_target",
      type: "paragraph",
      children: [
        { type: "text", text: "みんちょう", fontFamily: MINCHO_FONT_VALUE },
        { type: "text", text: "きほん" },
      ],
    },
    {
      id: "font_display_plain",
      type: "paragraph",
      children: [{ type: "text", text: "指定なしの段落" }],
    },
  ]);
}

async function pickMinchoForSelection(page: Page): Promise<void> {
  await page.locator(".toolbar-font-select").click();
  await page.getByRole("searchbox", { name: "フォントを検索" }).fill("Hiragino Mincho");
  await page.getByRole("menuitemradio", { name: "Hiragino Mincho ProN", exact: true }).click();
  await expect.poll(() => toolbarFontLabel(page)).toBe("Hiragino Mincho ProN");
}

test("shows the font actually drawn at the caret, not the last one picked", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await installDesktopRuntimeMock(page, mixedFontDocument());
  await page.goto("/");
  await expect(page.locator('.text-flow-editor [data-sigma-doc-id="font_display_target"]')).toBeVisible();

  await placeCaret(page, "font_display_plain", 3);
  const documentFontLabel = await toolbarFontLabel(page);
  expect(documentFontLabel).not.toBe("");

  // 一度ドロップダウンから明朝を選ぶ。ここで「最後に選んだ書体」の設定値が既定と食い違う。
  await selectTextRange(page, "font_display_plain", 0, 6);
  await pickMinchoForSelection(page);

  // 明朝のランの中では明朝
  await placeCaret(page, "font_display_target", 2);
  await expect.poll(() => toolbarFontLabel(page)).toBe("Hiragino Mincho ProN");

  // 同じ段落の未指定ラン: 設定値ではなく、その位置で実際に描かれる書体 (文書既定) に戻る
  await placeCaret(page, "font_display_target", 7);
  await expect.poll(() => toolbarFontLabel(page)).toBe(documentFontLabel);
});

test("blanks the toolbar font for a selection that spans two fonts", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await installDesktopRuntimeMock(page, mixedFontDocument());
  await page.goto("/");
  await expect(page.locator('.text-flow-editor [data-sigma-doc-id="font_display_target"]')).toBeVisible();

  await selectTextRange(page, "font_display_target", 0, 5);
  await expect.poll(() => toolbarFontLabel(page)).toBe("Hiragino Mincho ProN");

  // 明朝ランと未指定ランをまたぐ
  await selectTextRange(page, "font_display_target", 0, 8);
  await expect.poll(() => toolbarFontLabel(page)).toBe("");

  // 単一フォントの範囲に戻せば名前が戻る
  await selectTextRange(page, "font_display_target", 1, 4);
  await expect.poll(() => toolbarFontLabel(page)).toBe("Hiragino Mincho ProN");
});

/**
 * 境界そのもの。ProseMirror はキャレットが 2 つのランの継ぎ目にあるとき左のランのマークを継ぐので、
 * 表示も左のランの書体になる ——「表示中の書体で次の文字が入る」を成立させるための挙動。
 */
test("resolves the caret at a font boundary the way the next keystroke will", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await installDesktopRuntimeMock(page, mixedFontDocument());
  await page.goto("/");
  await expect(page.locator('.text-flow-editor [data-sigma-doc-id="font_display_target"]')).toBeVisible();

  // 先にドロップダウンで書体を選び、設定値と実際の描画を食い違わせておく。
  await selectTextRange(page, "font_display_plain", 0, 6);
  await pickMinchoForSelection(page);

  // 明朝ランの内側
  await placeCaret(page, "font_display_target", 4);
  await expect.poll(() => toolbarFontLabel(page)).toBe("Hiragino Mincho ProN");

  // 継ぎ目ちょうど: 左 (明朝) を継ぐ
  await placeCaret(page, "font_display_target", 5);
  await expect.poll(() => toolbarFontLabel(page)).toBe("Hiragino Mincho ProN");

  // 未指定ランの内側では文書既定へ戻る
  await placeCaret(page, "font_display_target", 6);
  await expect.poll(() => toolbarFontLabel(page)).not.toBe("Hiragino Mincho ProN");

  // 段落の末尾
  await placeCaret(page, "font_display_target", 8);
  await expect.poll(() => toolbarFontLabel(page)).not.toBe("Hiragino Mincho ProN");
});

test("keeps the toolbar font correct through a font change and undo", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await installDesktopRuntimeMock(page, mixedFontDocument());
  await page.goto("/");
  await expect(page.locator('.text-flow-editor [data-sigma-doc-id="font_display_plain"]')).toBeVisible();

  await selectTextRange(page, "font_display_plain", 0, 6);
  const documentFontLabel = await toolbarFontLabel(page);

  await page.locator(".toolbar-font-select").click();
  await page.getByRole("searchbox", { name: "フォントを検索" }).fill("Hiragino Mincho");
  await page.getByRole("menuitemradio", { name: "Hiragino Mincho ProN", exact: true }).click();
  await expect.poll(() => toolbarFontLabel(page)).toBe("Hiragino Mincho ProN");

  await page.keyboard.press("ControlOrMeta+Z");
  await expect.poll(() => toolbarFontLabel(page)).toBe(documentFontLabel);
});
