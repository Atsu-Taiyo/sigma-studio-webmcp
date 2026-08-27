export function syncDocumentRefWhenStateIsCurrent<T>(
  documentRef: { current: T },
  document: T,
  documentStateStamp: number,
  latestDocumentRevision: number,
): boolean {
  if (documentStateStamp !== latestDocumentRevision) {
    return false;
  }

  documentRef.current = document;
  return true;
}

export interface TimestampedDocumentChange {
  timestamp: number;
}

export interface DocumentSaveResult {
  ok: boolean;
  error?: string;
  code?: "revision-mismatch";
}

export interface SuccessfulDocumentSave<T> {
  fileId: string;
  document: T;
  revision: number;
  dirtyRevision: number;
}

/**
 * Records every successful per-file save, while updating active-document refs
 * only when that same file is still active.
 */
export function recordSuccessfulDocumentSave<T>(params: {
  savedByFileId: Map<string, SuccessfulDocumentSave<T>>;
  save: SuccessfulDocumentSave<T>;
  activeFileId: string;
  observedRevisionRef: { current: number | null };
  lastSavedDocumentRef: { current: T };
  lastSavedDirtyRevisionRef: { current: number };
  lastSyncedDocumentRef: { current: T };
}): boolean {
  params.savedByFileId.set(params.save.fileId, params.save);
  if (params.save.fileId !== params.activeFileId) {
    return false;
  }

  params.observedRevisionRef.current = params.save.revision;
  params.lastSavedDocumentRef.current = params.save.document;
  params.lastSavedDirtyRevisionRef.current = params.save.dirtyRevision;
  params.lastSyncedDocumentRef.current = params.save.document;
  return true;
}

/** A document replacement may continue only after the current save succeeds. */
export async function saveBeforeDocumentReplacement(params: {
  save: () => Promise<DocumentSaveResult>;
  onFailure: (result: DocumentSaveResult) => void | Promise<void>;
}): Promise<boolean> {
  const result = await params.save();
  if (result.ok) {
    return true;
  }
  await params.onFailure(result);
  return false;
}

/** A pending AI approval owns change adoption for its file until backup succeeds. */
export function hasPendingAiApprovalForFile(
  pending: { fileId: string } | null,
  fileId: string,
): boolean {
  return pending?.fileId === fileId;
}

export function beginPendingAiApprovalAdoption<T>(
  pendingRef: { current: T | null },
  pending: T,
  setPending: (value: boolean) => void,
): void {
  pendingRef.current = pending;
  setPending(true);
}

export function preventCloseForPendingAiApproval(
  event: Pick<BeforeUnloadEvent, "preventDefault" | "returnValue">,
): void {
  event.preventDefault();
  event.returnValue = "";
}

/** Workspace persistence must succeed before backup-backed AI adoption can leave recovery state. */
export async function persistWorkspaceBeforeAiApprovalAdoption(params: {
  saveWorkspace: () => Promise<DocumentSaveResult>;
  onPersisted: () => void;
}): Promise<DocumentSaveResult> {
  const result = await params.saveWorkspace();
  if (!result.ok) {
    return result;
  }
  params.onPersisted();
  return result;
}

export interface RevisionedBackup<T> {
  backup: T;
  sourceRevision: number;
}

/** Reuse a backup only while it still represents the current in-memory input snapshot. */
export async function resolveRevisionedBackup<T>(params: {
  cached?: RevisionedBackup<T>;
  sourceRevision: number;
  createBackup: () => Promise<T | null>;
}): Promise<RevisionedBackup<T> | null> {
  if (params.cached?.sourceRevision === params.sourceRevision) {
    return params.cached;
  }
  const backup = await params.createBackup();
  return backup === null ? null : { backup, sourceRevision: params.sourceRevision };
}

export function applyAiApprovalAdoptionIfFileActive(params: {
  fileId: string;
  getActiveFileId: () => string;
  apply: () => void;
}): boolean {
  if (params.getActiveFileId() !== params.fileId) {
    return false;
  }
  params.apply();
  return true;
}

export function runSingleFlight<T>(
  ref: { current: Promise<T> | null },
  task: () => Promise<T>,
): Promise<T> {
  if (ref.current) {
    return ref.current;
  }
  const taskPromise = Promise.resolve().then(task);
  const tracked = taskPromise.finally(() => {
    if (ref.current === tracked) {
      ref.current = null;
    }
  });
  ref.current = tracked;
  return tracked;
}

/** busy中に届いた文書通知を捨てず、timestampが最新の1件だけを保持する。 */
export function queueLatestDocumentChange<T extends TimestampedDocumentChange>(
  pendingRef: { current: T | null },
  event: T,
): void {
  if (
    pendingRef.current === null
    || event.timestamp >= pendingRef.current.timestamp
  ) {
    pendingRef.current = event;
  }
}

/** busy解除時に保留中の最新通知を一度だけ取り出す。 */
export function takeLatestDocumentChange<T>(
  pendingRef: { current: T | null },
): T | null {
  const pending = pendingRef.current;
  pendingRef.current = null;
  return pending;
}
