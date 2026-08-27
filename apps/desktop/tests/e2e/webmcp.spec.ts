import { expect, test } from "@playwright/test";

import { sampleDocument } from "@/lib/sample-document";

import { installDesktopRuntimeMock } from "./desktop-runtime-mock";

test("WebMCP tools register in the page and edit the live SigmaDoc", async ({ page }) => {
  await page.addInitScript(() => {
    type RegisteredTool = {
      name: string;
      execute(input: unknown): Promise<unknown> | unknown;
    };
    const tools = new Map<string, RegisteredTool>();
    Object.defineProperty(window, "__sigmaWebMcpTools", { value: tools });
    Object.defineProperty(Document.prototype, "modelContext", {
      configurable: true,
      get: () => ({
        registerTool: async (tool: RegisteredTool, options?: { signal?: AbortSignal }) => {
          tools.set(tool.name, tool);
          options?.signal?.addEventListener("abort", () => {
            if (tools.get(tool.name) === tool) {
              tools.delete(tool.name);
            }
          }, { once: true });
        },
      }),
    });
  });
  await installDesktopRuntimeMock(page, sampleDocument);
  await page.goto("/");
  await expect(page.locator(".startup-splash")).toBeHidden();

  await expect.poll(() => page.evaluate(() => (
    (window as unknown as { __sigmaWebMcpTools: Map<string, unknown> })
      .__sigmaWebMcpTools.size
  ))).toBe(5);

  const result = await page.evaluate(async () => {
    const tools = (window as unknown as {
      __sigmaWebMcpTools: Map<string, { execute(input: unknown): Promise<unknown> | unknown }>;
    }).__sigmaWebMcpTools;
    return tools.get("insert_content")!.execute({
      target_id: "END_OF_DOCUMENT",
      blocks: [
        { kind: "heading", text: "WebMCP collaboration", level: 2 },
        { kind: "math", tex: "x^2+y^2=1" },
      ],
    });
  });

  expect(JSON.parse(result as string)).toMatchObject({ ok: true });
  await expect(page.locator(".text-flow-editor").filter({ hasText: "WebMCP collaboration" })).toBeVisible();
  await expect(page.locator('.inline-math-node[data-tex="x^2+y^2=1"]')).toBeVisible();
});
