import { describe, expect, it } from "vitest";

import { createTableShapeProps } from "@/components/editor/overlay-canvas/shapes/table";
import { blockToReferenceText } from "@/lib/ai/ai-edit-reference";
import { findBlock } from "@/lib/document-tree";
import { sampleDocument } from "@/lib/sample-document";
import {
  createSigmaWebMcpTools,
  getWebMcpAgentInstructionsStorageKey,
  SIGMA_WEB_MCP_TOOL_NAMES,
  WEB_MCP_PROPOSAL_ID,
  type SigmaWebMcpPorts,
  type SigmaWebMcpProposal,
  type WebMcpToolDefinition,
} from "@/lib/webmcp-tools";
import type { OverlayShape, SigmaDocument } from "@/features/document";

function baseDocument(shapes: OverlayShape[] = []): SigmaDocument {
  return {
    ...sampleDocument,
    docId: "doc_webmcp_test",
    metadata: { ...sampleDocument.metadata, title: "WebMCP test" },
    content: [
      { type: "paragraph", id: "p_existing", children: [{ type: "text", text: "Original ", marks: ["bold"] }, { type: "text", text: "text" }] },
      { type: "paragraph", id: "p_second", children: [{ type: "text", text: "Second paragraph" }] },
    ],
    pageLayout: {
      ...sampleDocument.pageLayout!,
      overlay: {
        ...sampleDocument.pageLayout?.overlay,
        overlaySnapshot: { version: 1, shapes, assets: {} },
        updatedAt: "2026-08-30T00:00:00.000Z",
      },
    },
    updatedAt: "2026-08-30T00:00:00.000Z",
  };
}

function createHarness(initial = baseDocument()) {
  let document = initial;
  let revision = 0;
  let proposal: SigmaWebMcpProposal | null = null;
  const proposalUpdates: SigmaWebMcpProposal[] = [];
  const ports: SigmaWebMcpPorts = {
    getDocument: () => document,
    getRevision: () => revision,
    getSelectedBlockId: () => "p_existing",
    getSelection: () => ({ blockId: "p_existing", textRange: null, inlineMath: null, overlayShapes: [] }),
    getAgentInstructions: () => "Keep explanations concise.",
    proposeDocumentChange: (next) => { proposal = next; proposalUpdates.push(next); },
    withdrawDocumentChange: () => { proposal = null; },
  };
  const tools = createSigmaWebMcpTools(ports);
  const tool = (name: string): WebMcpToolDefinition => {
    const found = tools.find((candidate) => candidate.name === name);
    if (!found) throw new Error(`Missing tool: ${name}`);
    return found;
  };
  return {
    tool,
    tools,
    getDocument: () => document,
    getProposal: () => proposal as SigmaWebMcpProposal | null,
    getProposalUpdates: () => proposalUpdates,
    apply: () => {
      if (!proposal) throw new Error("No proposal");
      document = proposal.apply(document).document;
      proposal = null;
      revision += 1;
    },
    humanEdit: (next: SigmaDocument) => { document = next; revision += 1; },
  };
}

function parseResult(result: unknown): Record<string, unknown> {
  expect(typeof result).toBe("string");
  return JSON.parse(result as string) as Record<string, unknown>;
}

function currentShape(document: SigmaDocument, id: string): OverlayShape {
  const shape = document.pageLayout?.overlay?.overlaySnapshot?.shapes.find((candidate) => candidate.id === id);
  if (!shape) throw new Error(`Missing shape: ${id}`);
  return shape;
}

describe("Sigma WebMCP desktop-parity tools", () => {
  it("publishes the documented open-document tool set with safety annotations", () => {
    const { tools } = createHarness();
    expect(tools.map((tool) => tool.name)).toEqual(SIGMA_WEB_MCP_TOOL_NAMES);
    expect(tools.find((tool) => tool.name === "get_agent_instructions")?.annotations.readOnlyHint).toBe(true);
    expect(tools.find((tool) => tool.name === "get_agent_instructions")?.annotations.untrustedContentHint).toBe(true);
    expect(tools.find((tool) => tool.name === "insert_body_content")?.annotations.readOnlyHint).toBe(false);
    expect(tools.find((tool) => tool.name === "insert_body_content")?.description).toContain("get_agent_instructions");
  });

  it("returns integrated edit context and user instructions with the Web revision", async () => {
    const harness = createHarness();
    expect(parseResult(await harness.tool("get_agent_instructions").execute({}))).toMatchObject({ ok: true, userInstructions: "Keep explanations concise." });
    const context = parseResult(await harness.tool("get_edit_context").execute({ targetId: "p_existing" }));
    expect(context).toMatchObject({ revision: 0, target: { id: "p_existing", type: "paragraph" } });
    expect(context.outline).toEqual(expect.arrayContaining([expect.objectContaining({ id: "p_second" })]));
  });

  it("scopes locally stored agent instructions to one document", () => {
    expect(getWebMcpAgentInstructionsStorageKey("doc_a")).not.toBe(getWebMcpAgentInstructionsStorageKey("doc_b"));
    expect(getWebMcpAgentInstructionsStorageKey("folder/doc a")).toContain("folder%2Fdoc%20a");
  });

  it("inserts a paragraph with typed inline-math runs and applies it only after approval", async () => {
    const harness = createHarness();
    const result = parseResult(await harness.tool("insert_body_content").execute({
      expectedRevision: 0,
      targetId: "p_existing",
      blocks: [{ id: "p_formula", type: "paragraph", runs: ["二次式 ", { type: "math", id: "math_formula", tex: "x^2+1" }, " を考える。"] }],
    }));
    expect(result).toMatchObject({ status: "pending_approval", proposalId: WEB_MCP_PROPOSAL_ID, operationCount: 1 });
    expect(findBlock(harness.getDocument(), "p_formula")).toBeNull();
    expect(harness.getProposal()?.previewDraft.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: "insertAfter", insertedBlock: expect.objectContaining({ id: "p_formula", children: expect.arrayContaining([expect.objectContaining({ type: "mathInline", tex: "x^2+1" })]) }) }),
    ]));
    harness.apply();
    expect(findBlock(harness.getDocument(), "p_formula")).toMatchObject({
      type: "paragraph",
      children: [{ type: "text", text: "二次式 " }, { type: "mathInline", tex: "x^2+1" }, { type: "text", text: " を考える。" }],
    });
  });

  it("updates rich content with typed runs including inline math", async () => {
    const harness = createHarness();
    await harness.tool("update_rich_content").execute({ expectedRevision: 0, blockId: "p_existing", expectedContent: "Original text", runs: ["答えは ", { type: "math", id: "math_answer", tex: "x=2" }, " です。"] });
    harness.apply();
    expect(findBlock(harness.getDocument(), "p_existing")).toMatchObject({ id: "p_existing", type: "paragraph", children: [{ text: "答えは " }, { type: "mathInline", tex: "x=2" }, { text: " です。" }] });
  });

  it("creates and then partially updates problem content without replacing untouched areas", async () => {
    const harness = createHarness();
    await harness.tool("create_problem_content").execute({
      expectedRevision: 0, targetId: "p_second", id: "problem_1",
      prompt: { id: "prompt_1", runs: ["方程式 ", { type: "math", tex: "x^2-4=0" }, " を解け。"] },
      answerTex: "x=\\pm2", solution: { id: "solution_1", text: "因数分解する。" }, hints: { id: "hint_1", text: "平方差を使う。" },
    });
    harness.apply();
    const problem = findBlock(harness.getDocument(), "problem_1");
    expect(problem).toMatchObject({ type: "problem", answer: { type: "math", expected: "x=\\pm2" } });
    await harness.tool("update_problem_content").execute({ expectedRevision: 1, targetId: "problem_1", expectedProblem: problem, solution: [{ id: "solution_2", runs: ["よって ", { type: "math", tex: "x=\\pm2" }, "。"] }] });
    harness.apply();
    expect(findBlock(harness.getDocument(), "problem_1")).toMatchObject({
      type: "problem", prompt: [expect.objectContaining({ id: "prompt_1" })], hints: [expect.objectContaining({ id: "hint_1" })],
      solution: [expect.objectContaining({ id: "solution_2", children: expect.arrayContaining([expect.objectContaining({ type: "mathInline" })]) })],
    });
  });

  it("updates one table cell while preserving widths, styles, and every other cell", async () => {
    const props = createTableShapeProps("plain", 320, 140);
    const tableShape: OverlayShape = {
      id: "table_1", type: "tableShape", x: 80, y: 160,
      props: {
        ...props,
        table: {
          ...props.table,
          columns: props.table.columns.map((column, index) => ({ ...column, width: { mode: "fixed", value: index === 0 ? 110 : index === 1 ? 90 : 120 } })),
          cells: props.table.cells.map((cell, index) => index === 0 ? { ...cell, content: [{ type: "paragraph", id: "table_cell_text", children: [{ type: "text", text: "A" }] }] } : cell),
        },
      },
    };
    const harness = createHarness(baseDocument([tableShape]));
    await harness.tool("update_table").execute({ expectedRevision: 0, shapeId: "table_1", expectedShape: tableShape, cellPatches: [{ row: 0, col: 0, content: "B" }] });
    harness.apply();
    const updated = currentShape(harness.getDocument(), "table_1");
    expect(updated.type).toBe("tableShape");
    if (updated.type !== "tableShape" || tableShape.type !== "tableShape") return;
    expect(updated.props.table.columns.map((column) => column.width)).toEqual([
      { mode: "fixed", value: 110 }, { mode: "fixed", value: 90 }, { mode: "fixed", value: 120 },
    ]);
    expect(updated.props.table.grid).toEqual(tableShape.props.table.grid);
    expect(updated.props.table.defaultCellStyle).toEqual(tableShape.props.table.defaultCellStyle);
    expect(updated.props.table.cells[0]?.content).toEqual([expect.objectContaining({ type: "paragraph", children: [{ type: "text", text: "B" }] })]);
    expect(updated.props.table.cells.slice(1)).toEqual(tableShape.props.table.cells.slice(1));
  });

  it("reports a missing expected shape separately from a stale shape", () => {
    const props = createTableShapeProps("plain", 320, 140);
    const tableShape: OverlayShape = { id: "table_1", type: "tableShape", x: 80, y: 160, props };
    const harness = createHarness(baseDocument([tableShape]));
    expect(() => harness.tool("update_table").execute({ expectedRevision: 0, shapeId: "table_1", cellPatches: [{ row: 0, col: 0, content: "B" }] })).toThrow(
      "MISSING_EXPECTED_SHAPE: Pass the exact shape object returned by get_document_outline (overlayShapes) as expectedShape.",
    );
  });

  it("partially updates a shape in place and converts degrees to radians", async () => {
    const shape: OverlayShape = { id: "shape_1", type: "geo", x: 20, y: 30, rotation: 0, props: { w: 120, h: 80, geo: "rectangle", fill: "none", color: "#111827", labelColor: "#111827", dash: "solid", size: "m" } };
    const harness = createHarness(baseDocument([shape]));
    await harness.tool("update_shape").execute({ expectedRevision: 0, shapeId: "shape_1", expectedShape: shape, x: 64, rotationDeg: 90, color: "#dc2626" });
    harness.apply();
    expect(currentShape(harness.getDocument(), "shape_1")).toMatchObject({ id: "shape_1", type: "geo", x: 64, y: 30, rotation: Math.PI / 2, props: { w: 120, h: 80, color: "#dc2626", fill: "none" } });
  });

  it("updates text shapes through the canonical overlay block model", async () => {
    const shape: OverlayShape = {
      id: "text_1",
      type: "text",
      x: 20,
      y: 30,
      props: {
        w: 120,
        h: 24,
        blocks: [{ type: "paragraph", id: "text_p_1", children: [{ type: "text", text: "Before" }] }],
        color: "#111827",
        size: "m",
      },
    };
    const harness = createHarness(baseDocument([shape]));
    await harness.tool("update_shape").execute({
      expectedRevision: 0,
      shapeId: "text_1",
      expectedShape: shape,
      text: "After",
      w: 180,
      fontSize: 18,
    });
    harness.apply();

    const updated = currentShape(harness.getDocument(), "text_1");
    expect(updated.type).toBe("text");
    if (updated.type !== "text") return;
    expect(updated.props.w).toBe(180);
    expect(updated.props.h).toBeGreaterThanOrEqual(24);
    expect(updated.props.blocks).toEqual([
      expect.objectContaining({
        type: "paragraph",
        children: [{ type: "text", text: "After" }],
      }),
    ]);
    expect(updated.props).not.toHaveProperty("richText");
  });

  it("formats canonical overlay blocks without restoring the retired richText document", async () => {
    const shape: OverlayShape = {
      id: "text_1",
      type: "text",
      x: 20,
      y: 30,
      props: {
        w: 120,
        h: 24,
        blocks: [{ type: "paragraph", id: "text_p_1", children: [{ type: "text", text: "Styled" }] }],
        color: "#111827",
        size: "m",
      },
    };
    const harness = createHarness(baseDocument([shape]));
    await harness.tool("apply_edits").execute({
      expectedRevision: 0,
      operations: [{
        op: "format_inline",
        target: { type: "shape", shapeId: "text_1" },
        style: { fontFamily: "serif" },
      }],
    });
    harness.apply();

    const updated = currentShape(harness.getDocument(), "text_1");
    expect(updated.type).toBe("text");
    if (updated.type !== "text") return;
    expect(updated.props.blocks[0]).toMatchObject({
      type: "paragraph",
      children: [{ type: "text", text: "Styled", fontFamily: "serif" }],
    });
    expect(updated.props).not.toHaveProperty("richText");
  });

  it("partially updates page layout and preserves unrelated layout settings", async () => {
    const harness = createHarness(); const before = harness.getDocument().pageLayout!;
    await harness.tool("update_page_layout").execute({ expectedRevision: 0, orientation: "landscape", marginsMm: { left: 18 } });
    harness.apply(); const after = harness.getDocument().pageLayout!;
    expect(after.orientation).toBe("landscape"); expect(after.marginsMm.left).toBe(18); expect(after.flow).toEqual(before.flow);
    expect(after.header?.enabled).toBe(false); expect(after.footer?.enabled).toBe(false);
  });

  it("accumulates two writes into one proposal and withdraws the whole draft", async () => {
    const harness = createHarness();
    parseResult(await harness.tool("insert_body_content").execute({ expectedRevision: 0, targetId: "p_existing", blocks: [{ id: "p_added", text: "Added" }] }));
    const second = parseResult(await harness.tool("update_rich_content").execute({ expectedRevision: 0, blockId: "p_second", expectedContent: "Second paragraph", text: "Updated second" }));
    expect(second).toMatchObject({ proposalId: WEB_MCP_PROPOSAL_ID, operationCount: 2 });
    expect(harness.getProposalUpdates()).toHaveLength(2); expect(harness.getProposal()?.operationCount).toBe(2);
    expect(parseResult(await harness.tool("get_pending_proposal").execute({}))).toMatchObject({ pending: true, operationCount: 2 });
    expect(parseResult(await harness.tool("withdraw_pending_proposal").execute({}))).toMatchObject({ withdrawn: true });
    expect(harness.getProposal()).toBeNull(); expect(findBlock(harness.getDocument(), "p_added")).toBeNull();
  });

  it("rejects stale writes and stale human approval with changed target IDs", async () => {
    const harness = createHarness();
    expect(() => harness.tool("update_rich_content").execute({ expectedRevision: 0, blockId: "p_existing", expectedContent: "stale", text: "No" })).toThrow("STALE_TARGET");
    await harness.tool("update_rich_content").execute({ expectedRevision: 0, blockId: "p_existing", expectedContent: "Original text", text: "Agent edit" });
    const pending = harness.getProposal()!;
    harness.humanEdit({ ...harness.getDocument(), content: [{ type: "paragraph", id: "p_existing", children: [{ type: "text", text: "Human edit" }] }, harness.getDocument().content[1]!] });
    expect(() => pending.apply(harness.getDocument())).toThrow(/STALE_DRAFT.*p_existing/);
    expect(() => harness.tool("insert_body_content").execute({ expectedRevision: 0, targetId: "p_second", blocks: ["Another edit"] })).toThrow(/STALE_DRAFT.*p_existing/);
  });

  it.each([
    ["comments", (document: SigmaDocument) => ({ ...document, comments: [{ id: "comment_1", anchor: { type: "block", blockId: "p_second" }, resolved: false, messages: [], createdAt: "2026-08-30T00:30:00.000Z" }] })],
    ["outputProfiles", (document: SigmaDocument) => ({ ...document, outputProfiles: { ...document.outputProfiles, student: { ...document.outputProfiles.student, showHints: true } } })],
    ["updatedAt", (document: SigmaDocument) => ({ ...document, updatedAt: "2026-08-30T01:00:00.000Z" })],
  ] as const)("rejects approval after a %s-only live document change", async (field, update) => {
    const harness = createHarness();
    await harness.tool("update_rich_content").execute({ expectedRevision: 0, blockId: "p_existing", expectedContent: "Original text", text: "Agent edit" });
    const pending = harness.getProposal()!;
    harness.humanEdit(update(harness.getDocument()) as SigmaDocument);
    expect(() => pending.apply(harness.getDocument())).toThrow(new RegExp(`STALE_DRAFT.*${field}`));
  });

  it("rejects approval whenever the live revision changes even if content is structurally equal", async () => {
    const harness = createHarness();
    await harness.tool("update_rich_content").execute({ expectedRevision: 0, blockId: "p_existing", expectedContent: "Original text", text: "Agent edit" });
    const pending = harness.getProposal()!;
    harness.humanEdit(structuredClone(harness.getDocument()));
    expect(() => pending.apply(harness.getDocument())).toThrow(/STALE_DRAFT.*document/);
  });

  it("rolls back every apply_edits operation when a later operation fails", async () => {
    const harness = createHarness();
    expect(() => harness.tool("apply_edits").execute({
      expectedRevision: 0,
      operations: [
        { op: "replace_text", target: { type: "text", blockId: "p_existing", text: "Original" }, replacement: "Changed" },
        { op: "replace_text", target: { type: "text", blockId: "missing", text: "anything" }, replacement: "No" },
      ],
    })).toThrow("Editable paragraph or heading not found");
    expect(parseResult(await harness.tool("get_pending_proposal").execute({}))).toMatchObject({ pending: false });
    await harness.tool("update_rich_content").execute({ expectedRevision: 0, blockId: "p_existing", expectedContent: "Original text", text: "Clean retry" });
    expect(harness.getProposal()).toMatchObject({ operationCount: 1 });
  });

  it("keeps each published proposal bound to its reviewed immutable document snapshot", async () => {
    const harness = createHarness();
    await harness.tool("update_rich_content").execute({ expectedRevision: 0, blockId: "p_existing", expectedContent: "Original text", text: "First draft" });
    const firstProposal = harness.getProposal()!;
    await harness.tool("update_rich_content").execute({ expectedRevision: 0, blockId: "p_second", expectedContent: "Second paragraph", text: "Second draft" });
    const firstDocument = firstProposal.apply(harness.getDocument()).document;
    expect(blockToReferenceText(findBlock(firstDocument, "p_existing")!)).toBe("First draft");
    expect(blockToReferenceText(findBlock(firstDocument, "p_second")!)).toBe("Second paragraph");
  });
});
