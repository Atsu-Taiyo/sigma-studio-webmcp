import { expect, test } from "@playwright/test";

test("single agent draft reports a stale guard after a human edits the document", async ({ page }) => {
  await page.addInitScript(() => {
    type RegisteredTool = { name: string; execute(input: unknown): Promise<unknown> | unknown };
    const tools = new Map<string, RegisteredTool>();
    Object.defineProperty(window, "__sigmaWebMcpTools", { value: tools });
    Object.defineProperty(Document.prototype, "modelContext", {
      configurable: true,
      get: () => ({ registerTool: async (tool: RegisteredTool) => { tools.set(tool.name, tool); } }),
    });
  });
  await page.goto("/");
  await expect(page.locator(".startup-splash")).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __sigmaWebMcpTools: Map<string, unknown> }).__sigmaWebMcpTools.size)).toBe(28);

  await page.evaluate(async () => {
    const tools = (window as unknown as { __sigmaWebMcpTools: Map<string, { execute(input: unknown): Promise<unknown> | unknown }> }).__sigmaWebMcpTools;
    const context = JSON.parse(await tools.get("get_edit_context")!.execute({}) as string) as { revision: number };
    await tools.get("insert_body_content")!.execute({
      expectedRevision: context.revision,
      targetId: "END_OF_DOCUMENT",
      blocks: [{ type: "paragraph", id: "webmcp_stale_target", text: "基準となる説明です。" }],
    });
  });
  await expect(page.locator(".webmcp-proposal-dock")).toBeVisible();
  await page.locator(".webmcp-proposal-dock").getByRole("button", { name: "変更を適用" }).click();
  const humanTarget = page.locator('[data-sigma-doc-type="paragraph"][data-sigma-doc-id="webmcp_stale_target"]');
  await expect(humanTarget).toContainText("基準となる説明です。");

  const proposalRevision = await page.evaluate(async () => {
    const tools = (window as unknown as { __sigmaWebMcpTools: Map<string, { execute(input: unknown): Promise<unknown> | unknown }> }).__sigmaWebMcpTools;
    const context = JSON.parse(await tools.get("get_edit_context")!.execute({ targetId: "webmcp_stale_target" }) as string) as { revision: number };
    const current = JSON.parse(await tools.get("get_block")!.execute({ blockId: "webmcp_stale_target" }) as string) as { block: { children: Array<{ text?: string }> } };
    const expectedContent = current.block.children.map((child) => child.text ?? "").join("");
    await tools.get("update_rich_content")!.execute({ expectedRevision: context.revision, blockId: "webmcp_stale_target", expectedContent, text: "AIが提案した説明です。" });
    return context.revision;
  });
  await expect(page.locator(".webmcp-proposal-dock")).toBeVisible();

  await humanTarget.click();
  await humanTarget.press("End");
  await humanTarget.pressSequentially(" 人間の追記");
  await expect(humanTarget).toContainText("人間の追記");

  await page.locator(".webmcp-proposal-dock").getByRole("button", { name: "変更を適用" }).click();
  await expect(page.locator(".webmcp-proposal-error")).toHaveText("変更を適用できませんでした。エージェントに現在の内容を読み直してもらい、もう一度依頼してください。");

  const nextWriteError = await page.evaluate(async (expectedRevision) => {
    const tools = (window as unknown as { __sigmaWebMcpTools: Map<string, { execute(input: unknown): Promise<unknown> | unknown }> }).__sigmaWebMcpTools;
    try {
      await tools.get("insert_body_content")!.execute({
        expectedRevision,
        targetId: "END_OF_DOCUMENT",
        blocks: [{ type: "paragraph", id: "must_not_be_inserted", text: "stale write" }],
      });
      return "";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }, proposalRevision);
  expect(nextWriteError).toContain("STALE_DRAFT");
  expect(nextWriteError).toContain("read the current context");
  await expect(page.locator('[data-sigma-doc-id="must_not_be_inserted"]')).toHaveCount(0);
});
