import { expect, test } from "@playwright/test";

import { getDefaultPageLayout } from "@/lib/page-layout";
import type { SigmaDocument } from "@/types/sigma-doc";
import { installDesktopRuntimeMock } from "./desktop-runtime-mock";

function createWhiteboardDocument(): SigmaDocument {
  return {
    version: "2.0",
    docId: "whiteboard_comments_e2e",
    metadata: { title: "ホワイトボードコメントE2E" },
    content: [],
    pageLayout: {
      ...getDefaultPageLayout("whiteboard"),
      overlay: {
        overlaySnapshot: {
          version: 1,
          shapes: [{
            id: "comment_target_shape",
            type: "geo",
            x: 180,
            y: 140,
            rotation: 0,
            props: {
              w: 180,
              h: 100,
              geo: "rectangle",
              fill: "solid",
              color: "#111111",
              fillColor: "#ffffff",
              labelColor: "#111111",
              dash: "solid",
              size: "m",
            },
          }],
          assets: {},
        },
      },
    },
    outputProfiles: { student: {}, teacher: {}, answerBook: {} },
  };
}

test("ホワイトボードの挿入タブから表のサイズ選択ダイアログで表を置ける", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 950 });
  await installDesktopRuntimeMock(page, createWhiteboardDocument());
  await page.goto("/");

  await expect(page.locator(".startup-splash")).toBeHidden();
  await expect(page.locator(".whiteboard-page-canvas")).toBeVisible();

  const tableButton = page.getByRole("button", { name: "表", exact: true }).first();
  await expect(tableButton).toBeVisible();
  await tableButton.click();

  const tablePicker = page.getByRole("dialog", { name: "表を挿入" });
  await expect(tablePicker).toBeVisible();
  const fourByThree = tablePicker.getByRole("button", { name: "4列 3行の表を挿入", exact: true });
  await fourByThree.hover();
  await expect(tablePicker.locator(".table-insert-grid-size")).toHaveText("4 x 3");
  await fourByThree.click();
  await expect(tablePicker).toHaveCount(0);

  const table = page.locator(".overlay-table-shape").first();
  await expect(table).toBeVisible();
  await expect(table.locator("tr")).toHaveCount(3);
  await expect(table.locator("tr").first().locator("td")).toHaveCount(4);
});

test("ホワイトボードで右上アイコンから図形コメントを入力できる", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 950 });
  await installDesktopRuntimeMock(page, createWhiteboardDocument());
  await page.goto("/");

  await expect(page.locator(".startup-splash")).toBeHidden();
  await expect(page.locator(".whiteboard-page-canvas")).toBeVisible();
  const commentToggle = page.locator(".comment-dock-toggle");
  await expect(commentToggle).toBeVisible();
  await expect(commentToggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".comment-dock")).toBeHidden();

  await commentToggle.click();
  const dock = page.locator(".comment-dock");
  await expect(dock).toBeVisible();
  await expect(dock.locator(".comment-dock-header").getByRole("button", { name: "コメントを追加" })).toBeVisible();
  await expect(dock).toContainText("コメントする図形やテキストを選択してください。");
  await expect(dock).toContainText("図形やテキストを選んでから「コメントを追加」を押します。");
  await dock.locator(".comment-dock-header").getByRole("button", { name: "コメントを追加" }).click();
  await expect(dock).toBeVisible();
  await expect(dock.locator(".comment-compose-card.pending")).toHaveCount(0);
  await dock.getByRole("button", { name: "コメントを閉じる" }).click();

  const editorShape = page.locator('.overlay-canvas-editor [data-overlay-shape-id="comment_target_shape"]');
  await editorShape.click();
  await expect(page.locator('.overlay-shape.selected[data-overlay-shape-id="comment_target_shape"]')).toBeVisible();
  await expect(page.locator(".selection-action-popover")).not.toContainText("コメント");
  await page.getByRole("button", { name: "コメントを追加" }).click();

  await expect(commentToggle).toHaveAttribute("aria-expanded", "true");
  await expect(dock).toBeVisible();
  await expect(dock.locator(".comment-compose-card.pending")).toBeVisible();
  await dock.locator(".comment-rich-text-editor").fill("この図形を確認してください");
  await dock.getByRole("button", { name: "追加", exact: true }).click();

  await expect(dock.locator(".comment-thread-card")).toContainText("この図形を確認してください");
  await expect(dock.locator(".comment-anchor-label")).toContainText("図形");
  await expect(page.locator(".comment-dock-badge")).toHaveText("1");
});
