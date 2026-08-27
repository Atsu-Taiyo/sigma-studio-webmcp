import type { SigmaDocument } from "@/features/document";
import {
  mergeExternalDocumentChange,
  type MergeExternalDocumentChangeResult,
} from "@/lib/document-block-merge";
import { areStructurallyEqual } from "@/lib/structural-equality";
import { createCurrentLocaleTranslator } from "@/lib/i18n";

const te = createCurrentLocaleTranslator("error");

export type InFlightSavePromiseRef = {
  current: Promise<unknown> | null;
};

export type BackupFirstDocumentReplacementResult<T> =
  | { ok: true; backup: T | null }
  | { ok: false; error: unknown };

/**
 * 未保存内容を別教材へ退避してから正本へ差し替えるための破壊防止ゲート。
 *
 * backupRequired のときは、退避が失敗するか、退避先を作れなかった場合に replace を
 * 絶対に呼ばない。承認済みAI文書への差し替えが、ユーザー入力の唯一のコピーを
 * 先に破棄する順序へ戻らないことをこの境界で保証する。
 */
export async function replaceDocumentAfterRequiredBackup<T>(params: {
  backupRequired: boolean;
  createBackup: () => Promise<T | null>;
  replace: (backup: T | null) => void | Promise<void>;
}): Promise<BackupFirstDocumentReplacementResult<T>> {
  let backup: T | null = null;
  if (params.backupRequired) {
    try {
      backup = await params.createBackup();
    } catch (error) {
      return { ok: false, error };
    }
    if (backup === null) {
      return {
        ok: false,
        error: new Error(te("runtime.unsavedBackupFailed")),
      };
    }
  }

  try {
    await params.replace(backup);
    return { ok: true, backup };
  } catch (error) {
    return { ok: false, error };
  }
}

type SaveResult = {
  ok: boolean;
  error?: string;
  code?: "revision-mismatch";
};

export function trackInFlightSave<T>(
  ref: InFlightSavePromiseRef,
  task: Promise<T>,
): Promise<T> {
  const previous = ref.current;
  const tracked = Promise.allSettled(previous ? [previous, task] : [task]).then(() => undefined);
  ref.current = tracked;
  void tracked.then(() => {
    if (ref.current === tracked) {
      ref.current = null;
    }
  });
  return task;
}

export async function applyMcpEditPreview<T>(params: {
  flushOverlayChanges: () => void;
  inFlightSaveRef: InFlightSavePromiseRef;
  isCurrentDocumentDirty: () => boolean;
  saveCurrentDocumentRecord: () => Promise<SaveResult>;
  onBeforeSave: () => void;
  getDocumentAtApprovalStart: () => SigmaDocument;
  approve: () => Promise<T>;
}): Promise<
  | { ok: true; approvalResult: T; documentAtApprovalStart: SigmaDocument }
  | { ok: false; saveResult: SaveResult }
> {
  params.flushOverlayChanges();

  // 既にIPCへ渡ったautosaveを承認より先に完了させる。renderer側のbusy判定だけでは、
  // mainのrunExclusiveキューに並び済みの保存順序までは変えられないため、ここで待つ。
  await params.inFlightSaveRef.current;

  if (params.isCurrentDocumentDirty()) {
    params.onBeforeSave();
    const saveResult = await params.saveCurrentDocumentRecord();
    if (!saveResult.ok) {
      return { ok: false, saveResult };
    }
  }

  // 直前saveが実際に書いた文書をbaseにする。save中に入った打鍵はこのbaseには含まれず、
  // 承認完了時のcurrentとの差として3-way mergeされるため失われない。
  const documentAtApprovalStart = params.getDocumentAtApprovalStart();
  return {
    ok: true,
    documentAtApprovalStart,
    approvalResult: await params.approve(),
  };
}

export type AiApprovedDocumentDecision =
  | {
      kind: "adopt";
      document: SigmaDocument;
      adoptedDocumentMatchesDisk: boolean;
    }
  | {
      kind: "merge";
      document: SigmaDocument;
      adoptedDocumentMatchesDisk: boolean;
    }
  | {
      kind: "stay-dirty";
      document: SigmaDocument;
      adoptedDocumentMatchesDisk: false;
      reason: string;
    };

export function decideAiApprovedDocument(params: {
  documentAtApprovalStart: SigmaDocument;
  currentDocument: SigmaDocument;
  diskDocument: SigmaDocument;
  normalizedApprovedDocument: SigmaDocument;
  merge?: (
    base: SigmaDocument,
    mine: SigmaDocument,
    theirs: SigmaDocument,
  ) => MergeExternalDocumentChangeResult;
}): AiApprovedDocumentDecision {
  const {
    documentAtApprovalStart,
    currentDocument,
    diskDocument,
    normalizedApprovedDocument,
  } = params;

  if (areStructurallyEqual(currentDocument, documentAtApprovalStart)) {
    return {
      kind: "adopt",
      document: normalizedApprovedDocument,
      adoptedDocumentMatchesDisk: areStructurallyEqual(normalizedApprovedDocument, diskDocument),
    };
  }

  // JSON.stringify前提の3-way mergeは、承認待ち中に実際に人手編集が入った場合だけ使う。
  // 通常承認やnormalize差分の判定には、キー順に依存しない構造比較を使う。
  const merge = params.merge ?? mergeExternalDocumentChange;
  const mergeResult = merge(documentAtApprovalStart, currentDocument, normalizedApprovedDocument);
  if (!mergeResult.ok) {
    return {
      kind: "stay-dirty",
      document: currentDocument,
      adoptedDocumentMatchesDisk: false,
      reason: mergeResult.reason,
    };
  }

  return {
    kind: "merge",
    document: mergeResult.merged,
    adoptedDocumentMatchesDisk: areStructurallyEqual(mergeResult.merged, diskDocument),
  };
}
