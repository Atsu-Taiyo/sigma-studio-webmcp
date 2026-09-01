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
import {
  hydrateGraphSpecWithOwnedLabelTexts,
  type OverlayShape,
  type SigmaDocument,
} from "@/features/document";

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

function createHarness(initial = baseDocument(), catalog: "public" | "implementation" = "implementation") {
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
  const tools = createSigmaWebMcpTools(ports, { catalog });
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
  expect(result).toEqual(expect.any(Object));
  return result as Record<string, unknown>;
}

function currentShape(document: SigmaDocument, id: string): OverlayShape {
  const shape = document.pageLayout?.overlay?.overlaySnapshot?.shapes.find((candidate) => candidate.id === id);
  if (!shape) throw new Error(`Missing shape: ${id}`);
  return shape;
}

describe("Sigma WebMCP desktop-parity tools", () => {
  it("publishes the documented open-document tool set with safety annotations", () => {
    const { tools } = createHarness(baseDocument(), "public");
    expect(tools.map((tool) => tool.name)).toEqual(SIGMA_WEB_MCP_TOOL_NAMES);
    expect(tools.find((tool) => tool.name === "get_agent_instructions")?.annotations.readOnlyHint).toBe(true);
    expect(tools.find((tool) => tool.name === "get_agent_instructions")?.annotations.untrustedContentHint).toBe(true);
    expect(tools.find((tool) => tool.name === "insert_markdown")?.annotations.readOnlyHint).toBe(false);
    expect(tools.find((tool) => tool.name === "insert_markdown")?.description).toContain("get_agent_instructions");
  });

  it("keeps the public catalog compact and task-oriented while preserving all major editing domains", () => {
    const { tools } = createHarness(baseDocument(), "public");
    expect(tools).toHaveLength(22);
    expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      "inspect_document", "insert_markdown", "edit_text", "edit_problem", "organize_blocks",
      "update_layout", "create_overlay", "update_overlay", "arrange_overlay", "delete_overlay",
      "insert_table", "update_table", "insert_graph", "update_graph",
      "insert_graph3d", "update_graph3d",
    ]));
    expect(tools.map((tool) => tool.name)).not.toEqual(expect.arrayContaining([
      "get_block", "get_blocks", "insert_shape", "update_shape",
    ]));
  });

  it("routes public inspection and Markdown insertion through the established proposal engine", async () => {
    const harness = createHarness(baseDocument(), "public");
    const context = parseResult(await harness.tool("inspect_document").execute({ targetId: "p_existing" }));
    expect(context).toMatchObject({ revision: 0, target: { id: "p_existing", type: "paragraph" } });
    expect(parseResult(await harness.tool("read_blocks").execute({ blockIds: ["p_existing", "p_second"] }))).toMatchObject({
      blocks: [{ id: "p_existing" }, { id: "p_second" }],
    });

    const result = parseResult(await harness.tool("insert_markdown").execute({
      expectedRevision: 0,
      targetId: "p_existing",
      markdown: "## 例題\n\n式 $x^2=4$ を解く。",
    }));
    expect(result).toMatchObject({ status: "pending_approval", operationCount: 2 });
    harness.apply();
    expect(harness.getDocument().content.slice(1, 3)).toMatchObject([
      { type: "heading", children: [{ type: "text", text: "例題" }] },
      { type: "paragraph" },
    ]);
    const insertedParagraph = harness.getDocument().content[2];
    if (insertedParagraph?.type !== "paragraph") return;
    expect(insertedParagraph.children.find((node) => node.type === "mathInline")).toMatchObject({ tex: "x^2=4" });
  });

  it("routes public overlay creation and updates by canonical object type", async () => {
    const harness = createHarness(baseDocument(), "public");
    await harness.tool("create_overlay").execute({
      expectedRevision: 0,
      targetId: "p_existing",
      kind: "rectangle",
      x: 40,
      y: 80,
      color: "#111827",
    });
    harness.apply();
    const created = harness.getDocument().pageLayout?.overlay?.overlaySnapshot?.shapes.find((shape) => shape.type === "geo");
    expect(created).toMatchObject({ type: "geo", x: 40, y: 80, props: { color: "#111827" } });
    if (!created) return;

    await harness.tool("update_overlay").execute({
      expectedRevision: 1,
      shapeId: created.id,
      expectedShape: created,
      color: "#dc2626",
    });
    harness.apply();
    expect(currentShape(harness.getDocument(), created.id)).toMatchObject({ props: { color: "#dc2626" } });
  });

  it("materializes every WebMCP graph label with recoverable ownership", async () => {
    const harness = createHarness(baseDocument(), "public");
    await harness.tool("insert_graph").execute({
      expectedRevision: 0,
      targetId: "p_existing",
      id: "graph_with_labels",
      kind: "cartesian",
      axes: { xLabel: "X軸", yLabel: "Y軸", originLabel: "O", grid: true },
      curves: [{ id: "curve_webmcp", expr: "x^2", label: "f" }],
      points: [{ id: "point_webmcp", x: "1", y: "1", label: "P" }],
      annotations: [{ id: "annotation_webmcp", x: "2", y: "2", text: "注記" }],
      showFormulaLabels: true,
    });
    harness.apply();

    const document = harness.getDocument();
    const graph = currentShape(document, "graph_with_labels");
    expect(graph.type).toBe("graph2dShape");
    if (graph.type !== "graph2dShape") return;
    const overlayShapes = document.pageLayout?.overlay?.overlaySnapshot?.shapes ?? [];
    expect(graph.props.axisLabelTextShapeIds).toEqual({
      x: expect.any(String),
      y: expect.any(String),
      origin: expect.any(String),
    });
    expect(graph.props.pointLabelTextShapeIdsByPointId).toEqual({ point_webmcp: expect.any(String) });
    expect(graph.props.annotationTextShapeIdsByAnnotationId).toEqual({ annotation_webmcp: expect.any(String) });
    expect(graph.props.labelTextShapeIdsByCurveId).toEqual({ curve_webmcp: expect.any(String) });
    expect(hydrateGraphSpecWithOwnedLabelTexts(graph, overlayShapes)).toMatchObject({
      axes: { xLabel: "X軸", yLabel: "Y軸", originLabel: "O" },
      curves: [{ id: "curve_webmcp", label: "f" }],
      points: [{ id: "point_webmcp", label: "P" }],
      annotations: [{ id: "annotation_webmcp", text: "注記" }],
    });
  });

  it("converts Markdown independently inside semantic problem areas", async () => {
    const harness = createHarness(baseDocument(), "public");
    await harness.tool("edit_problem").execute({
      expectedRevision: 0,
      action: "create",
      targetId: "p_second",
      prompt: "方程式 $x^2-4=0$ を解け。",
      answerTex: String.raw`x=\pm2`,
      solution: "## 解法\n\n平方差を使う。",
      hints: "- 左辺を因数分解する\n- 零積の法則を使う",
    });
    harness.apply();
    const problem = harness.getDocument().content.find((block) => block.type === "problem");
    expect(problem).toMatchObject({
      type: "problem",
      prompt: [expect.objectContaining({ type: "paragraph" })],
      answer: { type: "math", expected: String.raw`x=\pm2` },
      solution: [expect.objectContaining({ type: "heading", level: 2 }), expect.objectContaining({ type: "paragraph" })],
      hints: [expect.objectContaining({ type: "list" })],
    });
    if (problem?.type !== "problem") return;
    const prompt = problem.prompt[0];
    if (prompt?.type !== "paragraph") return;
    expect(prompt.children.find((node) => node.type === "mathInline")).toMatchObject({ tex: "x^2-4=0" });
  });

  it("returns integrated edit context and user instructions with the Web revision", async () => {
    const harness = createHarness();
    expect(parseResult(await harness.tool("get_agent_instructions").execute({}))).toMatchObject({ ok: true, userInstructions: "Keep explanations concise." });
    const context = parseResult(await harness.tool("get_edit_context").execute({ targetId: "p_existing" }));
    expect(context).toMatchObject({ revision: 0, target: { id: "p_existing", type: "paragraph" } });
    expect(context.outline).toEqual(expect.arrayContaining([expect.objectContaining({ id: "p_second" })]));
  });

  it("inserts a 3D figure and updates it in place through the shared draft layer", async () => {
    const harness = createHarness();

    const inserted = parseResult(await harness.tool("insert_graph3d").execute({
      expectedRevision: 0,
      targetId: "p_existing",
      id: "graph3d_web",
      preset: "revolution",
    }));
    expect(inserted).toMatchObject({ status: "pending_approval", proposalId: WEB_MCP_PROPOSAL_ID });
    harness.apply();
    const shape = currentShape(harness.getDocument(), "graph3d_web") as OverlayShape & {
      props: { previewAssetId?: string; spec: { camera: { position: { x: number; y: number; z: number } } } };
    };
    expect(shape.type).toBe("graph3dShape");
    // ブラウザにラスタライザは無い。絵はアプリのWebGLキャプチャに任せ、嘘のハッシュを残さない。
    expect(shape.props.previewAssetId).toBeUndefined();

    const updated = parseResult(await harness.tool("update_graph3d").execute({
      expectedRevision: 1,
      shapeId: "graph3d_web",
      expectedShape: shape,
      camera: { position: { x: 4, y: -4, z: 3 } },
    }));
    expect(updated).toMatchObject({ status: "pending_approval" });
    harness.apply();
    const after = currentShape(harness.getDocument(), "graph3d_web") as typeof shape;
    expect(after.x).toBe(shape.x);
    expect(after.y).toBe(shape.y);
    expect(after.props.spec.camera.position).toEqual({ x: 4, y: -4, z: 3 });
  });

  it("refuses update_graph3d on a shape that is not a 3D figure", async () => {
    const harness = createHarness();
    const inserted = parseResult(await harness.tool("insert_graph").execute({
      expectedRevision: 0,
      targetId: "p_existing",
      id: "graph2d_web",
      curves: [{ id: "curve_web", expr: "x^2" }],
    }));
    expect(inserted).toMatchObject({ status: "pending_approval" });
    harness.apply();
    const shape = currentShape(harness.getDocument(), "graph2d_web");

    await expect(async () => harness.tool("update_graph3d").execute({
      expectedRevision: 1,
      shapeId: "graph2d_web",
      expectedShape: shape,
      camera: { position: { x: 1, y: 1, z: 1 } },
    })).rejects.toThrow("graph3dShape");
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

  it("inserts Markdown with headings, math, escaped dollars, lists, emphasis, and fenced code", async () => {
    const harness = createHarness();
    const result = parseResult(await harness.tool("insert_body_content").execute({
      expectedRevision: 0,
      targetId: "p_existing",
      markdown: [
        "## 二次方程式",
        "",
        String.raw`式 $x^2-4=0$ と $$x=\pm2$$ を使う。価格は \$5。`,
        "",
        "- **解**を確認する",
        "- *代入*する",
        "",
        "```typescript",
        'const price = "$5";',
        "```",
      ].join("\n"),
    }));

    expect(result).toMatchObject({
      status: "pending_approval",
      proposalId: WEB_MCP_PROPOSAL_ID,
      operationCount: 4,
    });
    expect(harness.getProposal()?.previewDraft.operations).toHaveLength(4);
    harness.apply();

    expect(harness.getDocument().content.slice(1, 5)).toMatchObject([
      { type: "heading", level: 2, children: [{ type: "text", text: "二次方程式" }] },
      {
        type: "paragraph",
        children: [
          { type: "text", text: "式 " },
          { type: "mathInline", tex: "x^2-4=0" },
          { type: "text", text: " と " },
          { type: "mathInline", tex: String.raw`x=\pm2` },
          { type: "text", text: " を使う。価格は $5。" },
        ],
      },
      {
        type: "list",
        items: [
          { children: [{ type: "text", text: "解", marks: ["bold"] }, { type: "text", text: "を確認する" }] },
          { children: [{ type: "text", text: "代入", marks: ["italic"] }, { type: "text", text: "する" }] },
        ],
      },
      {
        type: "codeBlock",
        language: "typescript",
        children: [{ type: "text", text: 'const price = "$5";' }],
      },
    ]);
  });

  it("accepts ordinary blank-line-separated prose through markdown and rejects ambiguous payloads", async () => {
    const harness = createHarness();
    await harness.tool("insert_body_content").execute({
      expectedRevision: 0,
      targetId: "p_existing",
      markdown: "第一段落。\n\n第二段落。",
    });
    harness.apply();
    expect(harness.getDocument().content.slice(1, 3)).toMatchObject([
      { type: "paragraph", children: [{ type: "text", text: "第一段落。" }] },
      { type: "paragraph", children: [{ type: "text", text: "第二段落。" }] },
    ]);

    expect(() => harness.tool("insert_body_content").execute({
      expectedRevision: 1,
      markdown: "$x$",
      blocks: ["x"],
    })).toThrow("Pass exactly one of markdown or blocks.");
    expect(() => harness.tool("insert_body_content").execute({ expectedRevision: 1 })).toThrow(
      "Pass exactly one of markdown or blocks.",
    );
  });

  it.each([
    "a",
    "x^2+y^2=1",
    String.raw`\frac{a+b}{c}`,
    String.raw`\sqrt{x+1}`,
    String.raw`\sum_{k=1}^{n} k`,
    String.raw`\prod_{i=1}^{m} a_i`,
    String.raw`\int_0^1 x^2\,dx`,
    String.raw`\lim_{x\to0}\frac{\sin x}{x}`,
    String.raw`a\leqq b`,
    String.raw`x\in\mathbb{R}`,
    String.raw`\mathrm{O}`,
    String.raw`\vec{AB}`,
    String.raw`\overline{AB}`,
    String.raw`\left(1-\frac{2a}{3R}\right)`,
    String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`,
    String.raw`f'(x)=2x`,
    String.raw`x=\pm2`,
    String.raw`\theta=\frac{\pi}{3}`,
    String.raw`\Phi_a=\pi B_0a^2`,
    String.raw`\text{価格は\$5}`,
  ])("round-trips common TeX exactly through the Markdown MCP path: %s", async (tex) => {
    const harness = createHarness();
    await harness.tool("insert_body_content").execute({
      expectedRevision: 0,
      targetId: "p_existing",
      markdown: `式 $${tex}$。`,
    });
    harness.apply();
    const inserted = harness.getDocument().content[1];
    expect(inserted).toMatchObject({ type: "paragraph" });
    if (inserted?.type !== "paragraph") return;
    expect(inserted.children.find((node) => node.type === "mathInline")).toMatchObject({ tex });
  });

  it("keeps unmatched dollars as text and rejects unsupported TeX before publishing a proposal", async () => {
    const unmatched = createHarness();
    await unmatched.tool("insert_body_content").execute({
      expectedRevision: 0,
      targetId: "p_existing",
      markdown: "未完の式 $x+1 は文字のまま。",
    });
    unmatched.apply();
    expect(unmatched.getDocument().content[1]).toMatchObject({
      type: "paragraph",
      children: [{ type: "text", text: "未完の式 $x+1 は文字のまま。" }],
    });

    const invalid = createHarness();
    expect(() => invalid.tool("insert_body_content").execute({
      expectedRevision: 0,
      targetId: "p_existing",
      markdown: String.raw`式 $\notacommand{x}$。`,
    })).toThrow();
    expect(invalid.getProposal()).toBeNull();
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
      "MISSING_EXPECTED_SHAPE: Pass the exact shape object returned by inspect_document (overlayShapes) as expectedShape.",
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
