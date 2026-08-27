import { getDesktopRuntime } from "@/lib/runtime";
import { createCurrentLocaleTranslator } from "@/lib/i18n";
import type {
  DocumentFileRecord,
  DocumentLoadResult,
  DocumentMetadata,
  StorageResult,
  WorkspaceInitializationResult,
  WorkspaceState,
} from "@/lib/runtime";
import type { SigmaDocument } from "@/features/document";

const tWorkspace = createCurrentLocaleTranslator("workspace");

export const STORAGE_KEY = "sigma-studio:document";

export type {
  DocumentFileRecord,
  DocumentLoadResult,
  DocumentMetadata,
  StorageResult,
  WorkspaceInitializationResult,
  WorkspaceState,
};

declare const observedDocumentWriteBrand: unique symbol;

/**
 * A document payload and the file revision that the payload was derived from.
 *
 * Saving accepts only this envelope so a later metadata refresh cannot silently
 * lend a stale document a newer expectedRevision. Callers must capture the
 * revision at the same boundary where they adopt/build the document payload.
 */
export type ObservedDocumentWrite = Readonly<{
  fileId: string;
  document: SigmaDocument;
  observedRevision: number;
  [observedDocumentWriteBrand]: true;
}>;

export function createObservedDocumentWrite(input: {
  fileId: string;
  document: SigmaDocument;
  observedRevision: number;
}): ObservedDocumentWrite {
  if (!Number.isInteger(input.observedRevision) || input.observedRevision < 0) {
    throw new Error(tWorkspace("error.invalidRevision"));
  }
  return input as ObservedDocumentWrite;
}

/** 表示直前に解決する。module 直下で解決すると読み込み時の言語で焼き付く。 */
const runtimeUnavailableMessage = (): string => tWorkspace("error.storageRuntimeMissing");

/**
 * @deprecated 標準デスクトップ構成の保存経路は desktop runtime の非同期IPCです。
 */
export function loadSavedDocument(): SigmaDocument | null {
  return null;
}

/**
 * @deprecated 標準デスクトップ構成の保存経路は ObservedDocumentWrite の保存です。
 */
export function saveDocument(document: SigmaDocument): StorageResult {
  void document;
  return unavailableStorageResult();
}

/**
 * @deprecated ブラウザlocalStorageの教材正本はdesktop-first runtimeでは使いません。
 */
export function clearSavedDocument(): void {
}

export async function initializeDocumentWorkspace(): Promise<WorkspaceInitializationResult> {
  const runtime = getRuntime();
  return runtime.library.initializeWorkspace();
}

export async function listSavedDocuments(): Promise<DocumentMetadata[]> {
  return getRuntimeLibrary().listFiles();
}

export async function loadDocumentByFileId(fileId: string): Promise<SigmaDocument | null> {
  return getRuntimeLibrary().loadDocument(fileId);
}

export async function loadDocumentByFileIdWithRecovery(fileId: string): Promise<DocumentLoadResult> {
  return getRuntimeLibrary().loadDocumentWithRecovery(fileId);
}

/**
 * @deprecated Desktop runtime の正本IDは fileId です。新しい呼び出しでは loadDocumentByFileId を使ってください。
 */
export async function loadDocumentById(docId: string): Promise<SigmaDocument | null> {
  return loadDocumentByFileId(docId);
}

export async function saveDocumentRecord(write: ObservedDocumentWrite): Promise<StorageResult> {
  const runtime = getDesktopRuntime();
  if (!runtime) {
    return unavailableStorageResult();
  }

  return runtime.library.saveDocument(write.fileId, write.document, {
    expectedRevision: write.observedRevision,
  });
}

/** D3: 作成時点の UI 言語で題名を焼く (既定値は呼び出しごとに評価される)。 */
export async function createNewDocument(title = tWorkspace("untitledMaterial")): Promise<DocumentFileRecord> {
  const runtime = getRuntime();
  return runtime.library.createDocument({ title });
}

export async function createDocumentFromSigmaDocument(document: SigmaDocument): Promise<DocumentFileRecord> {
  const runtime = getRuntime();
  return runtime.library.createFileFromDocument({ document });
}

export async function duplicateDocument(fileId: string): Promise<DocumentFileRecord> {
  const runtime = getRuntime();
  return runtime.library.duplicateFile(fileId);
}

export async function deleteDocument(fileId: string): Promise<StorageResult> {
  const runtime = getDesktopRuntime();
  if (!runtime) {
    return unavailableStorageResult();
  }

  return runtime.library.deleteFile(fileId);
}

export async function saveWorkspaceState(state: WorkspaceState): Promise<StorageResult> {
  const runtime = getDesktopRuntime();
  if (!runtime) {
    return unavailableStorageResult();
  }

  return runtime.library.saveWorkspace(state);
}

function getRuntimeLibrary() {
  return getRuntime().library;
}

function getRuntime() {
  const runtime = getDesktopRuntime();
  if (!runtime) {
    throw new Error(runtimeUnavailableMessage());
  }

  return runtime;
}

function unavailableStorageResult(): StorageResult {
  return { ok: false, error: runtimeUnavailableMessage() };
}
