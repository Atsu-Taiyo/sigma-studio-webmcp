import { beforeEach, describe, expect, it } from "vitest";

import { createBlankDocument } from "@/lib/blank-document";
import { sampleDocument } from "@/lib/sample-document";
import type { DesktopStorageChangeEvent } from "@/types/desktop";

import { createBrowserRuntime } from "./browser-runtime";
import { createStorageChangeChannel } from "./change-channel";
import { createMemoryStoreBackend } from "./memory-backend";
import type { BrowserStoreBackend } from "./store-backend";
import type { AppRuntime } from "../types";

function createRuntime(backend: BrowserStoreBackend): AppRuntime {
  return createBrowserRuntime({
    backend,
    channel: createStorageChangeChannel(),
    persistent: true,
  });
}

describe("browser runtime", () => {
  let backend: BrowserStoreBackend;
  let runtime: AppRuntime;

  beforeEach(() => {
    backend = createMemoryStoreBackend();
    runtime = createRuntime(backend);
  });

  it("reports itself as the web target with browser storage", () => {
    expect(runtime.target).toBe("web");
    expect(runtime.capabilities).toMatchObject({
      desktopStorage: false,
      browserStorage: true,
      mcpProposals: false,
    });
  });

  it("creates a default workspace and one document on first start", async () => {
    const initialized = await runtime.library.initializeWorkspace();

    expect(initialized.ok).toBe(true);
    const files = await runtime.library.listFiles();
    expect(files).toHaveLength(1);
    expect(initialized.ok && initialized.state.activeFileId).toBe(files[0].fileId);

    const overview = await runtime.workspace.listOverview();
    expect(overview.state).toBe("ready");
    expect(overview.state === "ready" && overview.overview.workspaces).toHaveLength(1);
  });

  it("does not create a second document when starting again", async () => {
    await runtime.library.initializeWorkspace();
    await runtime.library.initializeWorkspace();

    expect(await runtime.library.listFiles()).toHaveLength(1);
  });

  /** 「再読み込みしても消えない」の最小形。保管層を共有した別ランタイムから読み直す。 */
  it("keeps documents across a fresh runtime over the same store", async () => {
    const initialized = await runtime.library.initializeWorkspace();
    const fileId = initialized.ok ? initialized.state.activeFileId : "";
    const saved = await runtime.library.saveDocument(
      fileId,
      { ...createBlankDocument("保存した教材"), docId: "doc_persisted" },
      { expectedRevision: 1 },
    );
    expect(saved).toMatchObject({ ok: true, revision: 2 });

    const reopened = createRuntime(backend);
    const restored = await reopened.library.initializeWorkspace();

    expect(restored.ok && restored.state.activeFileId).toBe(fileId);
    const loaded = await reopened.library.loadDocumentWithRecovery(fileId);
    expect(loaded.ok && loaded.document.docId).toBe("doc_persisted");
    expect(loaded.ok && loaded.revision).toBe(2);
    expect((await reopened.library.listFiles())[0].title).toBe("保存した教材");
  });

  it("rejects a save that was built from an older revision", async () => {
    const initialized = await runtime.library.initializeWorkspace();
    const fileId = initialized.ok ? initialized.state.activeFileId : "";
    const document = createBlankDocument("最初");
    await runtime.library.saveDocument(fileId, document, { expectedRevision: 1 });

    const stale = await runtime.library.saveDocument(fileId, createBlankDocument("あとから"), {
      expectedRevision: 1,
    });

    expect(stale).toMatchObject({ ok: false, code: "revision-mismatch", currentRevision: 2 });
    expect((await runtime.library.listFiles())[0].title).toBe("最初");
  });

  it("publishes document and library changes to subscribers", async () => {
    const events: DesktopStorageChangeEvent[] = [];
    const unsubscribe = runtime.library.onChange((event) => events.push(event));
    const initialized = await runtime.library.initializeWorkspace();
    const fileId = initialized.ok ? initialized.state.activeFileId : "";

    await runtime.library.saveDocument(fileId, createBlankDocument("変更"), { expectedRevision: 1 });
    await runtime.workspace.createWorkspace("2つ目");
    unsubscribe();
    await runtime.workspace.createWorkspace("購読解除後");

    expect(events.filter((event) => event.type === "document")).toEqual([
      expect.objectContaining({ fileId, change: "changed" }),
    ]);
    expect(events.filter((event) => event.type === "library").length).toBeGreaterThan(0);
    expect(events.some((event) => event.type === "library" && event.timestamp > Date.now())).toBe(false);
  });

  it("moves a document into a folder and reports it in the overview", async () => {
    await runtime.library.initializeWorkspace();
    const overview = await runtime.workspace.listOverview();
    const workspaceId = overview.state === "ready" ? overview.overview.activeWorkspaceId : "";
    const fileId = overview.state === "ready" ? overview.overview.files[0].fileId : "";

    const withFolder = await runtime.workspace.createFolder(workspaceId, "一次関数", null);
    const folderId = withFolder.state === "ready" ? withFolder.overview.folders[0].id : "";
    const moved = await runtime.workspace.moveFileToFolder(workspaceId, fileId, folderId);

    expect(moved.state).toBe("ready");
    expect(moved.state === "ready" && moved.overview.folders[0].fileCount).toBe(1);
    expect(moved.state === "ready" && moved.overview.files[0].folderId).toBe(folderId);
  });

  it("refuses to delete the last workspace", async () => {
    await runtime.library.initializeWorkspace();
    const overview = await runtime.workspace.listOverview();
    const workspaceId = overview.state === "ready" ? overview.overview.activeWorkspaceId : "";

    const result = await runtime.workspace.deleteWorkspace(workspaceId);

    expect(result.state).toBe("error");
  });

  it("hides a deleted document and keeps the remaining one open", async () => {
    await runtime.library.initializeWorkspace();
    const second = await runtime.library.createDocument({ title: "2枚目" });
    const first = (await runtime.library.listFiles()).find((file) => file.fileId !== second.fileId);

    const deleted = await runtime.library.deleteFile(second.fileId);

    expect(deleted.ok).toBe(true);
    const remaining = await runtime.library.listFiles();
    expect(remaining.map((file) => file.fileId)).toEqual([first?.fileId]);
  });

  it("duplicates a document into a new file", async () => {
    const initialized = await runtime.library.initializeWorkspace();
    const fileId = initialized.ok ? initialized.state.activeFileId : "";
    await runtime.library.saveDocument(fileId, createBlankDocument("元の教材"), { expectedRevision: 1 });

    const copy = await runtime.library.duplicateFile(fileId);

    expect(copy.fileId).not.toBe(fileId);
    expect(copy.metadata.title).toContain("元の教材");
    expect(await runtime.library.listFiles()).toHaveLength(2);
  });

  it("stores templates and materials per browser", async () => {
    const template = await runtime.templates.createTemplate({
      workspaceId: "workspace_1",
      name: "小テスト",
      document: sampleDocument,
    });
    const material = await runtime.materials.createMaterial({
      name: "ばね",
      content: { blocks: [], overlaySnapshot: { version: 1, shapes: [], assets: {} } },
      description: undefined,
      tags: undefined,
      usage: undefined,
      visualConcepts: undefined,
      transformPolicy: undefined,
      ports: undefined,
    });

    expect(await runtime.templates.listTemplates("workspace_1")).toEqual([template]);
    expect(await runtime.templates.listTemplates("workspace_other")).toEqual([]);
    expect((await runtime.materials.listMaterials())[0]).toMatchObject({ id: material.id, name: "ばね" });

    await runtime.templates.deleteTemplate(template.id);
    await runtime.materials.deleteMaterial(material.id);
    expect(await runtime.templates.listTemplates()).toEqual([]);
    expect(await runtime.materials.listMaterials()).toEqual([]);
  });
});

describe("browser runtime tab state", () => {
  it("drops tabs pointing at a deleted workspace's documents", async () => {
    const backend = createMemoryStoreBackend();
    const runtime = createRuntime(backend);
    await runtime.library.initializeWorkspace();
    const keeper = (await runtime.library.listFiles())[0];

    const second = await runtime.workspace.createWorkspace("消す方");
    const secondWorkspaceId = second.state === "ready" ? second.overview.activeWorkspaceId : "";
    const doomed = await runtime.library.createDocument({ title: "消える教材" });
    expect(doomed.metadata.workspaceId).toBe(secondWorkspaceId);

    await runtime.workspace.deleteWorkspace(secondWorkspaceId);

    const restored = await createRuntime(backend).library.initializeWorkspace();
    expect(restored.ok && restored.state.openFileIds).toEqual([keeper.fileId]);
    expect(restored.ok && restored.state.activeFileId).toBe(keeper.fileId);
  });
});
