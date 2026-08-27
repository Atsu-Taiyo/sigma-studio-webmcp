import { describe, expect, it, vi } from "vitest";

import type { SigmaDocument } from "@/features/document";
import {
  applyMcpEditPreview,
  decideAiApprovedDocument,
  replaceDocumentAfterRequiredBackup,
} from "@/lib/ai-run-applier";
import { createBlankDocument } from "@/lib/blank-document";

describe("decideAiApprovedDocument", () => {
  it("adopts the approved disk document when no typing occurred during approval", () => {
    const base = createDocument();
    const approved = editParagraph(base, "p_1", "AIの変更");

    const decision = decideAiApprovedDocument({
      documentAtApprovalStart: base,
      currentDocument: structuredClone(base),
      diskDocument: approved,
      normalizedApprovedDocument: approved,
    });

    expect(decision).toMatchObject({
      kind: "adopt",
      document: approved,
      adoptedDocumentMatchesDisk: true,
    });
  });

  it("merges typing from a different block into the approved document", () => {
    const base = createDocument();
    const current = {
      ...editParagraph(base, "p_2", "入力中の変更"),
      updatedAt: "2026-07-26T00:00:01.000Z",
    };
    const approved = editParagraph(base, "p_1", "AIの変更");

    const decision = decideAiApprovedDocument({
      documentAtApprovalStart: base,
      currentDocument: current,
      diskDocument: approved,
      normalizedApprovedDocument: approved,
    });

    expect(decision.kind).toBe("merge");
    expect(paragraphText(decision.document, "p_1")).toBe("AIの変更");
    expect(paragraphText(decision.document, "p_2")).toBe("入力中の変更");
    expect(decision.adoptedDocumentMatchesDisk).toBe(false);
  });

  it("keeps the user's current document dirty when both sides changed the same block", () => {
    const base = createDocument();
    const current = {
      ...editParagraph(base, "p_1", "入力中の変更"),
      updatedAt: "2026-07-26T00:00:01.000Z",
    };
    const approved = editParagraph(base, "p_1", "AIの変更");

    const decision = decideAiApprovedDocument({
      documentAtApprovalStart: base,
      currentDocument: current,
      diskDocument: approved,
      normalizedApprovedDocument: approved,
    });

    expect(decision).toMatchObject({
      kind: "stay-dirty",
      document: current,
      adoptedDocumentMatchesDisk: false,
      reason: expect.stringContaining("両方で変更"),
    });
  });

  it("keeps a normalized approval dirty until the normalized form is saved", () => {
    const base = createDocument();
    const diskDocument = editParagraph(base, "p_1", "AIの変更");
    const normalizedApprovedDocument = {
      ...diskDocument,
      metadata: { ...diskDocument.metadata, title: "正規化後" },
    };

    const decision = decideAiApprovedDocument({
      documentAtApprovalStart: base,
      currentDocument: base,
      diskDocument,
      normalizedApprovedDocument,
    });

    expect(decision).toMatchObject({
      kind: "adopt",
      document: normalizedApprovedDocument,
      adoptedDocumentMatchesDisk: false,
    });
  });
});

describe("applyMcpEditPreview", () => {
  it("flushes, awaits an in-flight save, then invokes approval", async () => {
    const order: string[] = [];
    let releaseSave!: () => void;
    const inFlightSave = new Promise<void>((resolve) => {
      releaseSave = () => {
        order.push("save-finished");
        resolve();
      };
    });
    const base = createDocument();
    const approval = applyMcpEditPreview({
      flushOverlayChanges: () => order.push("flushed"),
      inFlightSaveRef: { current: inFlightSave },
      isCurrentDocumentDirty: () => false,
      saveCurrentDocumentRecord: vi.fn(),
      onBeforeSave: vi.fn(),
      getDocumentAtApprovalStart: () => base,
      approve: async () => {
        order.push("approved");
        return { ok: true };
      },
    });

    await Promise.resolve();
    expect(order).toEqual(["flushed"]);
    releaseSave();

    await expect(approval).resolves.toMatchObject({
      ok: true,
      documentAtApprovalStart: base,
      approvalResult: { ok: true },
    });
    expect(order).toEqual(["flushed", "save-finished", "approved"]);
  });
});

describe("replaceDocumentAfterRequiredBackup", () => {
  it("keeps concurrent user input in memory when its backup fails during approval", async () => {
    const currentDocument = editParagraph(createDocument(), "p_1", "承認中の入力");
    const documentRef = { current: currentDocument };
    const approvedDocument = editParagraph(createDocument(), "p_1", "AIの変更");
    const replace = vi.fn(() => {
      documentRef.current = approvedDocument;
    });

    const result = await replaceDocumentAfterRequiredBackup({
      backupRequired: true,
      createBackup: vi.fn().mockRejectedValue(new Error("ディスク容量がありません")),
      replace,
    });

    expect(result).toMatchObject({
      ok: false,
      error: expect.objectContaining({ message: "ディスク容量がありません" }),
    });
    expect(replace).not.toHaveBeenCalled();
    expect(documentRef.current).toBe(currentDocument);
    expect(paragraphText(documentRef.current, "p_1")).toBe("承認中の入力");
  });

  it("keeps recovery active when persistence fails after the backup succeeds", async () => {
    const backup = { fileId: "backup_1" };
    const result = await replaceDocumentAfterRequiredBackup({
      backupRequired: true,
      createBackup: vi.fn().mockResolvedValue(backup),
      replace: vi.fn().mockRejectedValue(new Error("workspace.jsonを保存できません")),
    });

    expect(result).toMatchObject({
      ok: false,
      error: expect.objectContaining({ message: "workspace.jsonを保存できません" }),
    });
  });
});

function createDocument(): SigmaDocument {
  const blank = createBlankDocument("テスト");
  return {
    ...blank,
    updatedAt: "2026-07-26T00:00:00.000Z",
    content: [
      { type: "paragraph", id: "p_1", children: [{ type: "text", text: "本文1" }] },
      { type: "paragraph", id: "p_2", children: [{ type: "text", text: "本文2" }] },
    ],
  };
}

function editParagraph(document: SigmaDocument, id: string, text: string): SigmaDocument {
  return {
    ...document,
    content: document.content.map((block) => (
      block.id === id && block.type === "paragraph"
        ? { ...block, children: [{ type: "text" as const, text }] }
        : block
    )),
  };
}

function paragraphText(document: SigmaDocument, id: string): string | undefined {
  const block = document.content.find((candidate) => candidate.id === id);
  return block?.type === "paragraph" && block.children[0]?.type === "text"
    ? block.children[0].text
    : undefined;
}
