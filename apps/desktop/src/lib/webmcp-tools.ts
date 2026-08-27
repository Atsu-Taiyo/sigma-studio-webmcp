import {
  collectOutline,
  findBlock,
  findContainingProblem,
  insertRichBlockNearSelection,
  updateBlockInDocument,
} from "@/lib/document-tree";
import { resolveDocumentTitle } from "@/lib/document-title";
import { createId } from "@/lib/id";
import { SigmaDocumentSchema } from "@/lib/sigma-doc-schema";
import {
  inlineNodesToPlainText,
  insertTopLevelDocumentBlocks,
  isWhiteboardPageLayout,
  type HeadingNode,
  type InlineNode,
  type ParagraphNode,
  type RichBlock,
  type SigmaDocument,
} from "@/features/document";

export const END_OF_DOCUMENT_TARGET = "END_OF_DOCUMENT";

export interface WebMcpToolAnnotations {
  readOnlyHint: boolean;
  untrustedContentHint: boolean;
}

export interface WebMcpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: WebMcpToolAnnotations;
  execute(input: unknown): Promise<unknown> | unknown;
}

export interface SigmaWebMcpPorts {
  getDocument(): SigmaDocument;
  getSelectedBlockId(): string | null;
  commitDocumentChange(change: (current: SigmaDocument) => SigmaDocument): void;
  selectBlock(blockId: string): void;
}

type InsertableContent =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; text: string; level: 1 | 2 | 3 }
  | { kind: "math"; tex: string };

const READ_ONLY_ANNOTATIONS: WebMcpToolAnnotations = {
  readOnlyHint: true,
  untrustedContentHint: true,
};

const WRITE_ANNOTATIONS: WebMcpToolAnnotations = {
  readOnlyHint: false,
  untrustedContentHint: false,
};

const EMPTY_OBJECT_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

const CONTENT_SCHEMA = {
  oneOf: [
    {
      type: "object",
      properties: {
        kind: { type: "string", const: "paragraph" },
        text: { type: "string", description: "Paragraph text." },
      },
      required: ["kind", "text"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { type: "string", const: "heading" },
        text: { type: "string", description: "Heading text." },
        level: { type: "integer", enum: [1, 2, 3], default: 2 },
      },
      required: ["kind", "text"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { type: "string", const: "math" },
        tex: { type: "string", description: "TeX for one displayed equation." },
      },
      required: ["kind", "tex"],
      additionalProperties: false,
    },
  ],
} as const;

function jsonResult(value: unknown): string {
  return JSON.stringify(value);
}

function objectInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Tool input must be a JSON object.");
  }
  return input as Record<string, unknown>;
}

function nonEmptyString(value: unknown, name: string, maxLength = 10_000): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  if (value.length > maxLength) {
    throw new Error(`${name} must be at most ${maxLength} characters.`);
  }
  return value;
}

function parseInsertableContent(input: unknown): InsertableContent {
  const value = objectInput(input);
  if (value.kind === "paragraph") {
    return { kind: "paragraph", text: nonEmptyString(value.text, "text") };
  }
  if (value.kind === "heading") {
    const level = value.level ?? 2;
    if (level !== 1 && level !== 2 && level !== 3) {
      throw new Error("level must be 1, 2, or 3.");
    }
    return { kind: "heading", text: nonEmptyString(value.text, "text"), level };
  }
  if (value.kind === "math") {
    return { kind: "math", tex: nonEmptyString(value.tex, "tex", 4_000) };
  }
  throw new Error("kind must be paragraph, heading, or math.");
}

function contentToBlock(content: InsertableContent): RichBlock {
  if (content.kind === "heading") {
    return {
      type: "heading",
      id: createId("heading"),
      level: content.level,
      children: [{ type: "text", text: content.text }],
    };
  }
  if (content.kind === "math") {
    return {
      type: "paragraph",
      id: createId("p"),
      align: "center",
      children: [{
        type: "mathInline",
        id: createId("math"),
        tex: content.tex,
        display: "inline",
        semanticRole: "equation",
      }],
    };
  }
  return {
    type: "paragraph",
    id: createId("p"),
    children: [{ type: "text", text: content.text }],
  };
}

function resolveInsertTarget(ports: SigmaWebMcpPorts, value: unknown): string {
  if (value !== undefined) {
    return nonEmptyString(value, "target_id", 256).trim();
  }
  const selectedId = ports.getSelectedBlockId();
  if (selectedId) {
    return selectedId;
  }
  throw new Error(
    `Select a block first, pass target_id, or use ${END_OF_DOCUMENT_TARGET} to append explicitly.`,
  );
}

function insertBlocksAfterTarget(
  document: SigmaDocument,
  targetId: string,
  blocks: readonly RichBlock[],
): SigmaDocument {
  if (isWhiteboardPageLayout(document.pageLayout)) {
    throw new Error("Body content cannot be inserted into a whiteboard document.");
  }

  let next = document;
  let currentTargetId = targetId;
  for (const block of blocks) {
    if (currentTargetId === END_OF_DOCUMENT_TARGET) {
      next = insertTopLevelDocumentBlocks(next, next.content.at(-1)?.id ?? null, [block], {
        now: () => new Date().toISOString(),
      });
    } else if (next.content.some((candidate) => candidate.id === currentTargetId)) {
      next = insertTopLevelDocumentBlocks(next, currentTargetId, [block], {
        now: () => new Date().toISOString(),
      });
    } else if (findContainingProblem(next, currentTargetId)) {
      const inserted = insertRichBlockNearSelection(next, currentTargetId, block);
      if (!inserted) {
        throw new Error(`Could not insert after block: ${currentTargetId}`);
      }
      next = inserted;
    } else {
      throw new Error(`Target block was not found or is not an insertable location: ${currentTargetId}`);
    }
    currentTargetId = block.id;
  }
  return next;
}

function readableBlockContent(block: ParagraphNode | HeadingNode): string {
  return inlineNodesToPlainText(block.children);
}

function replacementChildren(content: InsertableContent): InlineNode[] {
  if (content.kind === "math") {
    return [{
      type: "mathInline",
      id: createId("math"),
      tex: content.tex,
      display: "inline",
      semanticRole: "equation",
    }];
  }
  return [{ type: "text", text: content.text }];
}

export function createSigmaWebMcpTools(ports: SigmaWebMcpPorts): WebMcpToolDefinition[] {
  return [
    {
      name: "inspect_document",
      description: "Inspect the active SigmaDoc title, selection, outline, and document counts before editing.",
      inputSchema: EMPTY_OBJECT_SCHEMA,
      annotations: READ_ONLY_ANNOTATIONS,
      execute: () => {
        const document = ports.getDocument();
        const outline = collectOutline(document, { includeBodyBlocks: true });
        return jsonResult({
          ok: true,
          document: {
            docId: document.docId,
            title: resolveDocumentTitle(document),
            version: document.version,
            updatedAt: document.updatedAt ?? null,
            selectedBlockId: ports.getSelectedBlockId(),
            topLevelBlockCount: document.content.length,
            overlayShapeCount: document.pageLayout?.overlay?.overlaySnapshot?.shapes.length ?? 0,
          },
          outline: outline.slice(0, 80),
          outlineTruncated: outline.length > 80,
        });
      },
    },
    {
      name: "read_block",
      description: "Read one SigmaDoc block by ID, including its exact structured content, before updating it.",
      inputSchema: {
        type: "object",
        properties: {
          block_id: { type: "string", description: "Block ID returned by inspect_document." },
        },
        required: ["block_id"],
        additionalProperties: false,
      },
      annotations: READ_ONLY_ANNOTATIONS,
      execute: (input) => {
        const blockId = nonEmptyString(objectInput(input).block_id, "block_id", 256).trim();
        const block = findBlock(ports.getDocument(), blockId);
        if (!block) {
          throw new Error(`Block not found: ${blockId}`);
        }
        return jsonResult({ ok: true, block });
      },
    },
    {
      name: "validate_document",
      description: "Validate the active SigmaDoc without changing it and return any schema issues.",
      inputSchema: EMPTY_OBJECT_SCHEMA,
      annotations: READ_ONLY_ANNOTATIONS,
      execute: () => {
        const result = SigmaDocumentSchema.safeParse(ports.getDocument());
        return result.success
          ? jsonResult({ ok: true, valid: true })
          : jsonResult({
              ok: false,
              valid: false,
              issues: result.error.issues.slice(0, 12).map((issue) => ({
                path: issue.path.join("."),
                message: issue.message,
              })),
            });
      },
    },
    {
      name: "insert_content",
      description: "Insert paragraphs, headings, or equations after a block, the selection, or the document end.",
      inputSchema: {
        type: "object",
        properties: {
          target_id: {
            type: "string",
            description: `Block ID to insert after. Omit for the selection, or use ${END_OF_DOCUMENT_TARGET}.`,
          },
          blocks: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            items: CONTENT_SCHEMA,
          },
        },
        required: ["blocks"],
        additionalProperties: false,
      },
      annotations: WRITE_ANNOTATIONS,
      execute: (input) => {
        const args = objectInput(input);
        if (!Array.isArray(args.blocks) || args.blocks.length === 0 || args.blocks.length > 8) {
          throw new Error("blocks must contain between 1 and 8 items.");
        }
        const targetId = resolveInsertTarget(ports, args.target_id);
        const blocks = args.blocks.map(parseInsertableContent).map(contentToBlock);
        ports.commitDocumentChange((current) => insertBlocksAfterTarget(current, targetId, blocks));

        const insertedIds = blocks
          .map((block) => block.id)
          .filter((blockId) => Boolean(findBlock(ports.getDocument(), blockId)));
        if (insertedIds.length !== blocks.length) {
          throw new Error("The editor did not apply the requested insertion.");
        }
        const selectedBlockId = insertedIds.at(-1)!;
        ports.selectBlock(selectedBlockId);
        return jsonResult({ ok: true, insertedBlockIds: insertedIds, selectedBlockId });
      },
    },
    {
      name: "replace_block_content",
      description: "Replace all text or math in one paragraph or heading after checking its current content.",
      inputSchema: {
        type: "object",
        properties: {
          block_id: { type: "string", description: "Paragraph or heading ID from read_block." },
          expected_content: {
            type: "string",
            description: "Exact current plain content from read_block; prevents overwriting newer edits.",
          },
          content: CONTENT_SCHEMA,
        },
        required: ["block_id", "expected_content", "content"],
        additionalProperties: false,
      },
      annotations: WRITE_ANNOTATIONS,
      execute: (input) => {
        const args = objectInput(input);
        const blockId = nonEmptyString(args.block_id, "block_id", 256).trim();
        if (typeof args.expected_content !== "string") {
          throw new Error("expected_content must be a string.");
        }
        const content = parseInsertableContent(args.content);
        const currentBlock = findBlock(ports.getDocument(), blockId);
        if (!currentBlock || (currentBlock.type !== "paragraph" && currentBlock.type !== "heading")) {
          throw new Error(`Editable paragraph or heading not found: ${blockId}`);
        }
        const currentContent = readableBlockContent(currentBlock);
        if (currentContent !== args.expected_content) {
          throw new Error("The block changed after it was read. Read it again before replacing its content.");
        }

        const children = replacementChildren(content);
        ports.commitDocumentChange((document) => updateBlockInDocument(document, blockId, (block) => {
          if (block.type !== "paragraph" && block.type !== "heading") {
            return block;
          }
          return { ...block, children };
        }));

        const updated = findBlock(ports.getDocument(), blockId);
        if (!updated || (updated.type !== "paragraph" && updated.type !== "heading")) {
          throw new Error("The editor did not apply the requested replacement.");
        }
        ports.selectBlock(blockId);
        return jsonResult({
          ok: true,
          blockId,
          content: readableBlockContent(updated),
        });
      },
    },
  ];
}
