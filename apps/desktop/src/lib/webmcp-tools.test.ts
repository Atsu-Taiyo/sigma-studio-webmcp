import { describe, expect, it } from "vitest";

import { findBlock } from "@/lib/document-tree";
import { sampleDocument } from "@/lib/sample-document";
import {
  createSigmaWebMcpTools,
  END_OF_DOCUMENT_TARGET,
  type SigmaWebMcpPorts,
  type WebMcpToolDefinition,
} from "@/lib/webmcp-tools";
import type { SigmaDocument } from "@/features/document";

function createDocument(): SigmaDocument {
  return {
    ...sampleDocument,
    docId: "doc_webmcp_test",
    metadata: {
      ...sampleDocument.metadata,
      title: "WebMCP test",
    },
    content: [{
      type: "paragraph",
      id: "p_existing",
      children: [{ type: "text", text: "Original text" }],
    }],
    pageLayout: sampleDocument.pageLayout
      ? { ...sampleDocument.pageLayout, overlay: undefined }
      : undefined,
    updatedAt: "2026-08-28T00:00:00.000Z",
  };
}

function createHarness() {
  let document = createDocument();
  let selectedBlockId: string | null = "p_existing";
  const ports: SigmaWebMcpPorts = {
    getDocument: () => document,
    getSelectedBlockId: () => selectedBlockId,
    commitDocumentChange: (change) => {
      document = change(document);
    },
    selectBlock: (blockId) => {
      selectedBlockId = blockId;
    },
  };
  const tools = createSigmaWebMcpTools(ports);
  const tool = (name: string): WebMcpToolDefinition => {
    const match = tools.find((candidate) => candidate.name === name);
    if (!match) {
      throw new Error(`Missing test tool: ${name}`);
    }
    return match;
  };
  return {
    getDocument: () => document,
    getSelectedBlockId: () => selectedBlockId,
    tool,
    tools,
  };
}

function parseResult(result: unknown): Record<string, unknown> {
  expect(typeof result).toBe("string");
  return JSON.parse(result as string) as Record<string, unknown>;
}

describe("Sigma WebMCP tools", () => {
  it("publishes a small, non-overlapping browser tool set with safety annotations", () => {
    const { tools } = createHarness();

    expect(tools.map((tool) => tool.name)).toEqual([
      "inspect_document",
      "read_block",
      "validate_document",
      "insert_content",
      "replace_block_content",
    ]);
    expect(tools.filter((tool) => tool.annotations.readOnlyHint).map((tool) => tool.name)).toEqual([
      "inspect_document",
      "read_block",
      "validate_document",
    ]);
  });

  it("describes the active document and selection without exposing a second source of truth", async () => {
    const { tool } = createHarness();

    const result = parseResult(await tool("inspect_document").execute({}));

    expect(result.ok).toBe(true);
    expect(result.document).toMatchObject({
      docId: "doc_webmcp_test",
      title: "WebMCP test",
      selectedBlockId: "p_existing",
      topLevelBlockCount: 1,
    });
    expect(result.outline).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "p_existing", excerpt: "Original text" }),
    ]));
  });

  it("inserts mixed content at the explicit document end and selects the last block", async () => {
    const harness = createHarness();

    const result = parseResult(await harness.tool("insert_content").execute({
      target_id: END_OF_DOCUMENT_TARGET,
      blocks: [
        { kind: "heading", text: "Quadratic functions", level: 2 },
        { kind: "math", tex: "y=x^2" },
      ],
    }));

    const insertedBlockIds = result.insertedBlockIds as string[];
    expect(insertedBlockIds).toHaveLength(2);
    expect(harness.getDocument().content.map((block) => block.id)).toEqual([
      "p_existing",
      ...insertedBlockIds,
    ]);
    expect(harness.getSelectedBlockId()).toBe(insertedBlockIds[1]);
    expect(findBlock(harness.getDocument(), insertedBlockIds[1])).toMatchObject({
      type: "paragraph",
      align: "center",
      children: [expect.objectContaining({ type: "mathInline", tex: "y=x^2" })],
    });
  });

  it("requires an explicit destination when the editor has no selection", async () => {
    let document = createDocument();
    const tools = createSigmaWebMcpTools({
      getDocument: () => document,
      getSelectedBlockId: () => null,
      commitDocumentChange: (change) => {
        document = change(document);
      },
      selectBlock: () => undefined,
    });
    const insert = tools.find((tool) => tool.name === "insert_content")!;

    expect(() => insert.execute({
      blocks: [{ kind: "paragraph", text: "New text" }],
    })).toThrow(END_OF_DOCUMENT_TARGET);
  });

  it("replaces a block only when the agent supplies the content it previously read", async () => {
    const harness = createHarness();
    const replace = harness.tool("replace_block_content");

    expect(() => replace.execute({
      block_id: "p_existing",
      expected_content: "Stale text",
      content: { kind: "paragraph", text: "Replacement" },
    })).toThrow("changed after it was read");

    const result = parseResult(await replace.execute({
      block_id: "p_existing",
      expected_content: "Original text",
      content: { kind: "math", tex: "x^2+1" },
    }));
    expect(result).toMatchObject({
      ok: true,
      blockId: "p_existing",
      content: "$x^2+1$",
    });
    expect(findBlock(harness.getDocument(), "p_existing")).toMatchObject({
      id: "p_existing",
      type: "paragraph",
      children: [expect.objectContaining({ type: "mathInline", tex: "x^2+1" })],
    });
  });

  it("validates the live SigmaDoc through the canonical runtime schema", async () => {
    const { tool } = createHarness();

    expect(parseResult(await tool("validate_document").execute({}))).toEqual({
      ok: true,
      valid: true,
    });
  });
});
