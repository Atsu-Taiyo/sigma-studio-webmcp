import { expect, test, type Page } from "@playwright/test";

async function installWebMcpMock(page: Page, rejectedToolName: string | null = null) {
  await page.addInitScript(({ rejectedToolName }) => {
    type RegisteredTool = { name: string; execute(input: unknown): Promise<unknown> | unknown };
    const tools = new Map<string, RegisteredTool>();
    const contexts: Array<{ instructions: string }> = [];
    Object.defineProperty(window, "__sigmaWebMcpTools", { value: tools });
    Object.defineProperty(window, "__sigmaWebMcpContexts", { value: contexts });
    Object.defineProperty(Document.prototype, "modelContext", {
      configurable: true,
      get: () => ({
        registerTool: async (tool: RegisteredTool, options?: { signal?: AbortSignal }) => {
          if (tool.name === rejectedToolName) throw new Error(`Registration rejected for ${tool.name}`);
          tools.set(tool.name, tool);
          options?.signal?.addEventListener("abort", () => tools.delete(tool.name), { once: true });
        },
        provideContext: async (context: { instructions: string }) => { contexts.push(context); },
      }),
    });
  }, { rejectedToolName });
}

test("WebMCP inserts typed inline math, previews it, and applies one draft", async ({ page }) => {
  await installWebMcpMock(page);
  await page.goto("/");
  await expect(page.locator(".startup-splash")).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __sigmaWebMcpTools: Map<string, unknown> }).__sigmaWebMcpTools.size)).toBe(28);

  const result = await page.evaluate(async () => {
    const tools = (window as unknown as { __sigmaWebMcpTools: Map<string, { execute(input: unknown): Promise<unknown> | unknown }> }).__sigmaWebMcpTools;
    const context = JSON.parse(await tools.get("get_edit_context")!.execute({}) as string) as { revision: number };
    return tools.get("insert_body_content")!.execute({
      expectedRevision: context.revision,
      targetId: "END_OF_DOCUMENT",
      blocks: [{ type: "paragraph", id: "webmcp_inline_math", runs: ["式 ", { type: "math", id: "webmcp_math", tex: "x^2+y^2=1" }, " を考える。"] }],
    });
  });
  expect(JSON.parse(result as string)).toMatchObject({ ok: true, status: "pending_approval", operationCount: 1 });
  const preview = page.locator(".ai-inline-preview-dialog").filter({ hasText: "式" });
  const liveBlock = page.locator('[data-sigma-doc-type="paragraph"][data-sigma-doc-id="webmcp_inline_math"]');
  await expect(preview).toBeVisible();
  await expect(liveBlock).toHaveCount(0);
  await preview.getByRole("button", { name: "適用", exact: true }).click();
  await expect(liveBlock).toContainText("式");
  await expect(liveBlock.locator('.inline-math-node[data-tex="x^2+y^2=1"]')).toBeVisible();
});

test("web AI panel stores instructions and the web selection has no AI reference wand", async ({ page }) => {
  await installWebMcpMock(page);
  await page.goto("/");
  await expect(page.locator(".startup-splash")).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __sigmaWebMcpTools: Map<string, unknown> }).__sigmaWebMcpTools.size)).toBe(28);

  await page.evaluate(async () => {
    const tools = (window as unknown as { __sigmaWebMcpTools: Map<string, { execute(input: unknown): Promise<unknown> | unknown }> }).__sigmaWebMcpTools;
    const context = JSON.parse(await tools.get("get_edit_context")!.execute({}) as string) as { revision: number };
    await tools.get("insert_body_content")!.execute({
      expectedRevision: context.revision,
      targetId: "END_OF_DOCUMENT",
      blocks: [{ type: "paragraph", id: "webmcp_reference_source", text: "Web AI panel reference" }],
    });
  });
  await expect(page.locator(".webmcp-proposal-dock")).toBeVisible();
  await page.getByRole("button", { name: /^AI$/ }).first().click();
  await page.getByRole("menuitem", { name: "AIチャットを開く" }).click();
  const panel = page.locator(".ai-web-placeholder");
  await expect(panel).toContainText("WebMCP");
  await expect(page.locator(".webmcp-proposal-dock")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "破棄", exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "変更箇所へ移動", exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "変更を適用" }).click();
  const paragraph = page.locator('[data-sigma-doc-id="webmcp_reference_source"]');
  await expect(paragraph).toContainText("Web AI panel reference");
  await expect(panel.getByText("適用済み", { exact: true })).toBeVisible();
  const instructions = panel.getByLabel("Web版でこの教材を編集するエージェントへ、守ってほしい指示を入力します。");
  await instructions.fill("既存の記号と日本語の文体を保つ。");
  await expect.poll(() => page.evaluate(async () => {
    const tools = (window as unknown as { __sigmaWebMcpTools: Map<string, { execute(input: unknown): Promise<unknown> | unknown }> }).__sigmaWebMcpTools;
    const result = JSON.parse(await tools.get("read_document")!.execute({ detail: "full" }) as string) as { document: { docId: string } };
    return localStorage.getItem(`sigma-studio:webmcp-agent-instructions:v2:${encodeURIComponent(result.document.docId)}`);
  })).toBe("既存の記号と日本語の文体を保つ。");
  const instructionResult = await page.evaluate(async () => {
    const tools = (window as unknown as { __sigmaWebMcpTools: Map<string, { execute(input: unknown): Promise<unknown> | unknown }> }).__sigmaWebMcpTools;
    return tools.get("get_agent_instructions")!.execute({});
  });
  expect(JSON.parse(instructionResult as string)).toMatchObject({ userInstructions: "既存の記号と日本語の文体を保つ。", trust: { userInstructions: "untrusted_user_content" } });
  expect(await page.evaluate(() => (window as unknown as { __sigmaWebMcpContexts: Array<{ instructions: string }> }).__sigmaWebMcpContexts.some((context) => context.instructions.includes("既存の記号")))).toBe(false);

  await paragraph.dblclick();
  await expect(page.getByRole("button", { name: "AIに追加" })).toHaveCount(0);
});

test("web AI panel reports a partially registered tool set", async ({ page }) => {
  await installWebMcpMock(page, "update_graph");
  await page.goto("/");
  await expect(page.locator(".startup-splash")).toBeHidden();
  await page.getByRole("button", { name: /^AI$/ }).first().click();
  await page.getByRole("menuitem", { name: "AIチャットを開く" }).click();
  await expect(page.locator(".ai-web-placeholder")).toContainText("一部の編集ツールを登録できませんでした");
  await expect(page.locator(".ai-web-placeholder")).toContainText("update_graph");
});
