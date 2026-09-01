import { createCurrentLocaleTranslator } from "@/lib/i18n";
import { createId } from "@/lib/id";
import {
  applyDocumentSave,
  buildWorkspaceOverview,
  createFolderRow,
  createWorkspaceRow,
  deleteFolderRow,
  deleteWorkspaceRow,
  findVisibleFile,
  listFileMetadata,
  moveFileToFolderRow,
  moveFileToWorkspaceRow,
  normalizeFolderName,
  normalizeWorkspaceName,
  renameWorkspaceRow,
  resolveWorkspace,
  resolveWorkspaceState,
  softDeleteFileRow,
  updateFolderRow,
  visibleFiles,
  type LedgerOutcome,
  type LibraryRecord,
} from "@/lib/library-ledger";
import {
  normalizeMaterialMetadata,
  normalizeMaterialName,
  parseMaterialContent,
} from "@/lib/materials";
import { normalizeTemplateName, parseTemplateDocument } from "@/lib/templates";
import { resolveDocumentTitle } from "@/lib/document-title";
import { ensurePageLayout } from "@/features/document";
import type { MaterialContent, MaterialItem } from "@/types/material";
import type { TemplateItem } from "@/types/template";

import type {
  AppRuntime,
  DocumentLibraryRepository,
  DocumentLoadResult,
  LocalWorkspaceRepository,
  MaterialRepository,
  RuntimeCapabilities,
  StorageResult,
  TemplateRepository,
  WorkspaceOverviewResult,
  WorkspaceState,
} from "../types";
import {
  BrowserLedgerSchemaError,
  blankDocumentWithTitle,
  createFileFromDocument,
  createInitialDocument,
  describeLedgerFailure,
  describeStorageError,
  duplicateTitle,
  loadStoredDocument,
  readLibrary,
  repairLibrary,
  writeLibrary,
  writeWorkspaceState,
  WORKSPACE_STATE_KEY,
  type StoredDocumentRecord,
} from "./browser-library";
import type { StorageChangeChannel } from "./change-channel";
import { createStorageChangeChannel } from "./change-channel";
import { createIndexedDbStoreBackend, isIndexedDbAvailable } from "./idb-backend";
import { createMemoryStoreBackend } from "./memory-backend";
import type { BrowserStoreBackend, BrowserStoreTransaction } from "./store-backend";

const tWorkspace = createCurrentLocaleTranslator("workspace");

export interface BrowserRuntimeOptions {
  backend: BrowserStoreBackend;
  channel: StorageChangeChannel;
  /** IndexedDB に届いているか。false ならこのタブを閉じた時点で内容が消える。 */
  persistent: boolean;
}

/**
 * ブラウザ版の保存先。
 *
 * デスクトップ版との違いは保管層だけで、台帳の意味論 (`library-ledger.ts`)、
 * revision の楽観ロック、読み込み時の復旧はすべて共通のモジュールを使う。
 */
export function createBrowserRuntime(options: BrowserRuntimeOptions): AppRuntime {
  const { backend, channel, persistent } = options;

  const capabilities: RuntimeCapabilities = {
    desktopStorage: false,
    browserStorage: persistent,
    localFolders: true,
    localFileWatch: true,
    mcpProposals: false,
    codexAppServerAi: false,
    hostedAiApi: false,
    publicWeb: true,
  };

  const publishLibraryChange = (): void => {
    channel.publish({ type: "library", timestamp: Date.now() });
  };

  const publishDocumentChange = (fileId: string, change: "changed" | "deleted"): void => {
    channel.publish({ type: "document", fileId, change, timestamp: Date.now() });
  };

  /** ワークスペース系の操作は結果が常に overview なので、失敗の畳み方も 1 か所に閉じる。 */
  async function withOverview(
    workspaceId: string | null | undefined,
    apply: (library: LibraryRecord, now: string) => LedgerOutcome<unknown> | null,
  ): Promise<WorkspaceOverviewResult> {
    let mutated = false;
    try {
      const result = await backend.write(["library", "documents", "workspaceState"], async (tx) => {
        const library = await readLibrary(tx);
        const now = new Date().toISOString();
        repairLibrary(library, now);

        const outcome = apply(library, now);
        if (outcome && !outcome.ok) {
          return { state: "error" as const, error: describeLedgerFailure(outcome.reason) };
        }
        mutated = outcome !== null;
        await pruneWorkspaceState(tx, library);

        const workspace = resolveWorkspace(library, workspaceId ?? null);
        const activeWorkspaceId = workspace.ok ? workspace.value.id : library.activeWorkspaceId;
        if (workspace.ok && library.activeWorkspaceId !== activeWorkspaceId) {
          library.activeWorkspaceId = activeWorkspaceId;
        }
        await writeLibrary(tx, library);
        return {
          state: "ready" as const,
          overview: buildWorkspaceOverview(library, library.activeWorkspaceId),
        };
      });
      if (mutated && result.state === "ready") {
        publishLibraryChange();
      }
      return result;
    } catch (error) {
      if (error instanceof BrowserLedgerSchemaError) {
        return { state: "ledger-schema-error", failure: error.failure };
      }
      return { state: "error", error: describeStorageError(error, tWorkspace("error.changeFailed")) };
    }
  }

  /**
   * ワークスペースやフォルダを消すと、開いていたタブが見えない教材を指したまま残る。
   * 台帳を動かした直後に、可視な教材だけへ詰め直す。**`activeWorkspaceId` は動かさない** —
   * ここで動かすと「空のワークスペースへ切り替えたら元へ戻る」になる。
   */
  async function pruneWorkspaceState(tx: BrowserStoreTransaction, record: LibraryRecord): Promise<void> {
    const stored = await tx.get<WorkspaceState>("workspaceState", WORKSPACE_STATE_KEY);
    if (!stored) {
      return;
    }
    const visibleFileIds = new Set(visibleFiles(record).map((file) => file.fileId));
    const stale = !visibleFileIds.has(stored.activeFileId)
      || stored.openFileIds.some((fileId) => !visibleFileIds.has(fileId));
    if (!stale) {
      return;
    }
    const resolved = resolveWorkspaceState(record, stored);
    if (resolved.ok) {
      await tx.put("workspaceState", WORKSPACE_STATE_KEY, resolved.value);
    }
  }

  const library: DocumentLibraryRepository = {
    async initializeWorkspace() {
      try {
        return await backend.write(["library", "documents", "workspaceState"], async (tx) => {
          const record = await readLibrary(tx);
          const now = new Date().toISOString();
          repairLibrary(record, now);

          if (visibleFiles(record).length === 0) {
            const created = await createFileFromDocument(tx, record, {
              document: createInitialDocument(),
              now,
            });
            return {
              ok: true as const,
              state: { openFileIds: [created.fileId], activeFileId: created.fileId },
            };
          }

          const stored = await tx.get<WorkspaceState>("workspaceState", WORKSPACE_STATE_KEY);
          const resolved = resolveWorkspaceState(record, stored ?? null);
          if (!resolved.ok) {
            throw new Error(describeLedgerFailure(resolved.reason));
          }
          await writeLibrary(tx, record);
          await writeWorkspaceState(tx, record, resolved.value);
          return { ok: true as const, state: resolved.value };
        });
      } catch (error) {
        if (error instanceof BrowserLedgerSchemaError) {
          return { ok: false, ledgerError: error.failure };
        }
        throw error;
      }
    },

    async listFiles() {
      return backend.read(["library"], async (tx) => listFileMetadata(await readLibrary(tx)));
    },

    async loadDocument(fileId) {
      const result = await this.loadDocumentWithRecovery(fileId);
      return result.ok ? result.document : null;
    },

    async loadDocumentWithRecovery(fileId): Promise<DocumentLoadResult> {
      try {
        return await backend.read(["library", "documents"], async (tx) => {
          const record = await readLibrary(tx);
          const file = findVisibleFile(record, fileId);
          if (!file) {
            return {
              ok: false as const,
              error: tWorkspace("error.materialMissing"),
              failureKind: "missing" as const,
            };
          }
          const stored = await tx.get<StoredDocumentRecord>("documents", fileId);
          return loadStoredDocument(stored, file.revision, file.title);
        });
      } catch (error) {
        if (error instanceof BrowserLedgerSchemaError) {
          return { ok: false, error: error.message, failureKind: "io" };
        }
        return {
          ok: false,
          error: describeStorageError(error, tWorkspace("error.loadMaterialFailed")),
          failureKind: "io",
        };
      }
    },

    async saveDocument(fileId, document, saveOptions): Promise<StorageResult> {
      let saved = false;
      try {
        const result = await backend.write(["library", "documents"], async (tx) => {
          const record = await readLibrary(tx);
          const now = new Date().toISOString();
          // 自動保存の経路なので zod 検証はしない (エディタが出したSigmaDocが入力で、
          // 読み込み時には recoverSigmaDocument を必ず通す)。作成/取り込み経路だけ検証する。
          const normalized = ensurePageLayout({
            ...document,
            updatedAt: document.updatedAt ?? now,
          });
          const outcome = applyDocumentSave(record, fileId, {
            expectedRevision: saveOptions.expectedRevision,
            docId: normalized.docId,
            title: resolveDocumentTitle(normalized),
            updatedAt: normalized.updatedAt ?? now,
            now,
          });
          if (!outcome.ok) {
            return outcome.reason === "revision-mismatch"
              ? {
                  ok: false as const,
                  code: "revision-mismatch" as const,
                  currentRevision: outcome.currentRevision,
                  error: tWorkspace("error.saveConflict"),
                }
              : { ok: false as const, error: tWorkspace("error.materialMissing") };
          }

          await tx.put("documents", fileId, {
            fileId,
            document: normalized,
            updatedAt: outcome.file.updatedAt,
          } satisfies StoredDocumentRecord);
          await writeLibrary(tx, record);
          return { ok: true as const, revision: outcome.file.revision };
        });
        saved = result.ok;
        return result;
      } catch (error) {
        return { ok: false, error: describeStorageError(error, tWorkspace("error.saveFailed")) };
      } finally {
        if (saved) {
          publishDocumentChange(fileId, "changed");
        }
      }
    },

    async createDocument(input) {
      return this.createFileFromDocument({
        document: blankDocumentWithTitle(input?.title),
        workspaceId: input?.workspaceId,
        folderId: input?.folderId,
      });
    },

    async createFileFromDocument(input) {
      try {
        return await backend.write(["library", "documents", "workspaceState"], async (tx) => {
          const record = await readLibrary(tx);
          const created = await createFileFromDocument(tx, record, {
            document: input.document,
            workspaceId: input.workspaceId,
            folderId: input.folderId,
            now: new Date().toISOString(),
          });
          return {
            fileId: created.fileId,
            document: created.document,
            metadata: created.metadata,
          };
        });
      } finally {
        publishLibraryChange();
      }
    },

    async duplicateFile(fileId) {
      try {
        return await backend.write(["library", "documents", "workspaceState"], async (tx) => {
          const record = await readLibrary(tx);
          const file = findVisibleFile(record, fileId);
          if (!file) {
            throw new Error(tWorkspace("error.materialMissing"));
          }
          const stored = await tx.get<StoredDocumentRecord>("documents", fileId);
          const loaded = loadStoredDocument(stored, file.revision, file.title);
          if (!loaded.ok) {
            throw new Error(loaded.error);
          }

          const now = new Date().toISOString();
          const copy = ensurePageLayout({
            ...loaded.document,
            docId: createId("doc"),
            metadata: { ...loaded.document.metadata, title: duplicateTitle(loaded.document) },
            updatedAt: now,
          });
          const created = await createFileFromDocument(tx, record, {
            document: copy,
            workspaceId: file.workspaceId,
            folderId: file.folderId,
            now,
          });
          return {
            fileId: created.fileId,
            document: created.document,
            metadata: created.metadata,
          };
        });
      } finally {
        publishLibraryChange();
      }
    },

    async deleteFile(fileId) {
      let deleted = false;
      try {
        const result = await backend.write(["library", "documents", "workspaceState"], async (tx) => {
          const record = await readLibrary(tx);
          const now = new Date().toISOString();
          const outcome = softDeleteFileRow(record, fileId, now);
          if (!outcome.ok) {
            return { ok: false as const, error: describeLedgerFailure(outcome.reason) };
          }
          await writeLibrary(tx, record);

          const stored = await tx.get<WorkspaceState>("workspaceState", WORKSPACE_STATE_KEY);
          if (stored && (stored.activeFileId === fileId || stored.openFileIds.includes(fileId))) {
            await writeWorkspaceState(tx, record, {
              openFileIds: stored.openFileIds.filter((id) => id !== fileId),
              activeFileId: stored.activeFileId === fileId ? "" : stored.activeFileId,
            });
          }
          return { ok: true as const };
        });
        deleted = result.ok;
        return result;
      } catch (error) {
        return { ok: false, error: describeStorageError(error, tWorkspace("error.deleteMaterialFailed")) };
      } finally {
        if (deleted) {
          publishDocumentChange(fileId, "deleted");
          publishLibraryChange();
        }
      }
    },

    async saveWorkspace(state) {
      try {
        return await backend.write(["library", "workspaceState"], async (tx) => {
          const record = await readLibrary(tx);
          const written = await writeWorkspaceState(tx, record, state);
          return written
            ? { ok: true }
            : { ok: false, error: tWorkspace("error.noSavedMaterials") };
        });
      } catch (error) {
        return { ok: false, error: describeStorageError(error, tWorkspace("error.changeFailed")) };
      }
    },

    onChange(handler) {
      return channel.subscribe(handler);
    },
  };

  const workspace: LocalWorkspaceRepository = {
    listOverview: (workspaceId) => withOverview(workspaceId, () => null),
    createWorkspace: (name) => withOverview(null, (record, now) => {
      createWorkspaceRow(record, {
        id: createId("workspace"),
        name: normalizeWorkspaceName(name, tWorkspace("newWorkspace")),
        now,
      });
      return { ok: true, value: null };
    }),
    renameWorkspace: (workspaceId, name) => withOverview(workspaceId, (record, now) =>
      renameWorkspaceRow(record, workspaceId, normalizeWorkspaceName(name, tWorkspace("newWorkspace")), now)),
    deleteWorkspace: (workspaceId) => withOverview(null, (record, now) =>
      deleteWorkspaceRow(record, workspaceId, now)),
    createFolder: (workspaceId, name, parentFolderId) => withOverview(workspaceId, (record, now) =>
      createFolderRow(record, {
        id: createId("folder"),
        workspaceId,
        name: normalizeFolderName(name, tWorkspace("newFolder")),
        parentFolderId,
        now,
      })),
    updateFolder: (workspaceId, folderId, patch) => withOverview(workspaceId, (record, now) =>
      updateFolderRow(record, workspaceId, folderId, {
        ...patch,
        ...(patch.name === undefined
          ? {}
          : { name: normalizeFolderName(patch.name, tWorkspace("newFolder")) }),
      }, now)),
    deleteFolder: (workspaceId, folderId) => withOverview(workspaceId, (record, now) =>
      deleteFolderRow(record, workspaceId, folderId, now)),
    moveFileToFolder: (workspaceId, fileId, folderId) => withOverview(workspaceId, (record, now) =>
      moveFileToFolderRow(record, workspaceId, fileId, folderId, now)),
    moveFileToWorkspace: (fileId, targetWorkspaceId, folderId) => withOverview(targetWorkspaceId, (record, now) =>
      moveFileToWorkspaceRow(record, fileId, targetWorkspaceId, folderId, now)),
  };

  const templates: TemplateRepository = {
    async listTemplates(workspaceId) {
      const items = await backend.read(["templates"], (tx) => tx.getAll<TemplateItem>("templates"));
      return items
        .filter((template) => !workspaceId || template.workspaceId === workspaceId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    async createTemplate(input) {
      const document = parseTemplateDocument(input.document);
      if (!document) {
        throw new Error(tWorkspace("error.templateInvalidContent"));
      }
      const now = new Date().toISOString();
      const template: TemplateItem = {
        version: 1,
        id: createId("template"),
        workspaceId: input.workspaceId,
        name: normalizeTemplateName(input.name),
        document,
        createdAt: now,
        updatedAt: now,
      };
      await backend.write(["templates"], (tx) => tx.put("templates", template.id, template));
      return template;
    },

    async renameTemplate(id, name) {
      return backend.write(["templates"], async (tx) => {
        const existing = await tx.get<TemplateItem>("templates", id);
        if (!existing) {
          throw new Error(tWorkspace("error.templateMissing"));
        }
        const next: TemplateItem = {
          ...existing,
          name: normalizeTemplateName(name),
          updatedAt: new Date().toISOString(),
        };
        await tx.put("templates", id, next);
        return next;
      });
    },

    async deleteTemplate(id) {
      return backend.write(["templates"], async (tx) => {
        const existing = await tx.get<TemplateItem>("templates", id);
        if (!existing) {
          return { ok: false, error: tWorkspace("error.templateMissing") };
        }
        await tx.delete("templates", id);
        return { ok: true };
      });
    },
  };

  const materials: MaterialRepository = {
    async listMaterials() {
      const items = await backend.read(["materials"], (tx) => tx.getAll<MaterialItem>("materials"));
      return items
        .map((material) => ({ ...material, source: "user" as const }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    async createMaterial(input) {
      const content = parseMaterialContent(input.content);
      if (!content) {
        throw new Error(tWorkspace("error.assetInvalidContent"));
      }
      const now = new Date().toISOString();
      const material: MaterialItem = {
        version: 1,
        id: createId("material"),
        name: normalizeMaterialName(input.name),
        source: "user",
        ...normalizeMaterialMetadata(input),
        content,
        createdAt: now,
        updatedAt: now,
      };
      await backend.write(["materials"], (tx) => tx.put("materials", material.id, material));
      return material;
    },

    renameMaterial(id, name) {
      return materials.updateMaterialMetadata(id, { name });
    },

    async updateMaterialMetadata(id, input) {
      let content: MaterialContent | undefined;
      if (input.content !== undefined) {
        const parsed = parseMaterialContent(input.content);
        if (!parsed) {
          throw new Error(tWorkspace("error.assetInvalidContent"));
        }
        content = parsed;
      }

      return backend.write(["materials"], async (tx) => {
        const existing = await tx.get<MaterialItem>("materials", id);
        if (!existing) {
          throw new Error(tWorkspace("error.assetMissing"));
        }
        const next: MaterialItem = {
          ...existing,
          ...(input.name === undefined ? {} : { name: normalizeMaterialName(input.name) }),
          ...(content === undefined ? {} : { content }),
          updatedAt: new Date().toISOString(),
        };
        // 指定されたメタデータのキーは一度落としてから入れ直す。部分更新で
        // 「空配列を渡して消す」が効かなくなるのを避ける (デスクトップ版と同じ)。
        for (const key of ["description", "tags", "usage", "visualConcepts", "transformPolicy", "ports"] as const) {
          if (key in input) {
            delete next[key];
          }
        }
        Object.assign(next, normalizeMaterialMetadata(input));
        await tx.put("materials", id, next);
        return next;
      });
    },

    async deleteMaterial(id) {
      return backend.write(["materials"], async (tx) => {
        const existing = await tx.get<MaterialItem>("materials", id);
        if (!existing) {
          return { ok: false, error: tWorkspace("error.assetMissing") };
        }
        await tx.delete("materials", id);
        return { ok: true };
      });
    },
  };

  return { target: "web", capabilities, library, workspace, templates, materials };
}

let sharedRuntime: AppRuntime | null = null;

/** 1 ページに 1 つだけ。変更通知チャネルと IndexedDB 接続を共有する。 */
export function getBrowserRuntime(): AppRuntime {
  if (!sharedRuntime) {
    const persistent = isIndexedDbAvailable();
    sharedRuntime = createBrowserRuntime({
      backend: persistent ? createIndexedDbStoreBackend() : createMemoryStoreBackend(),
      channel: createStorageChangeChannel(),
      persistent,
    });
  }
  return sharedRuntime;
}
