import { describe, expect, it, vi } from "vitest";

import {
  applyAiApprovalAdoptionIfFileActive,
  beginPendingAiApprovalAdoption,
  hasPendingAiApprovalForFile,
  persistWorkspaceBeforeAiApprovalAdoption,
  preventCloseForPendingAiApproval,
  queueLatestDocumentChange,
  recordSuccessfulDocumentSave,
  resolveRevisionedBackup,
  runSingleFlight,
  saveBeforeDocumentReplacement,
  syncDocumentRefWhenStateIsCurrent,
  takeLatestDocumentChange,
} from "./document-state-sync";

describe("syncDocumentRefWhenStateIsCurrent", () => {
  it("does not roll the ref back when an older state renders before a deferred update", () => {
    const staleDocument = { id: "stale" };
    const latestDocument = { id: "latest" };
    const documentRef = { current: latestDocument };

    expect(syncDocumentRefWhenStateIsCurrent(
      documentRef,
      staleDocument,
      0,
      1,
    )).toBe(false);
    expect(documentRef.current).toBe(latestDocument);
  });

  it("syncs the ref after state catches up to the latest revision", () => {
    const previousDocument = { id: "previous" };
    const latestDocument = { id: "latest" };
    const documentRef = { current: previousDocument };

    expect(syncDocumentRefWhenStateIsCurrent(
      documentRef,
      latestDocument,
      1,
      1,
    )).toBe(true);
    expect(documentRef.current).toBe(latestDocument);
  });
});

describe("busy中の外部文書変更", () => {
  it("reject/rebase中の最新イベントをbusy解除後に処理し、次の編集を新revisionで保存できる", () => {
    for (const operation of ["reject", "rebase"]) {
      const pendingRef = {
        current: null as { timestamp: number; revision: number; text: string } | null,
      };
      let busy = true;
      let observedRevision = 4;
      let documentText = "編集前";
      const savedWrites: Array<{ observedRevision: number; text: string }> = [];
      const dispatch = (event: { timestamp: number; revision: number; text: string }) => {
        if (busy) {
          queueLatestDocumentChange(pendingRef, event);
          return;
        }
        observedRevision = event.revision;
        documentText = event.text;
      };

      // reject/rebase自身は正本スナップショットを返さない。その待機中に、別のwriterが
      // revision 5、続けて6を書いた状況を再現する。
      dispatch({ timestamp: 10, revision: 5, text: `${operation}中の外部変更1` });
      dispatch({ timestamp: 12, revision: 6, text: `${operation}中の外部変更2` });
      dispatch({ timestamp: 11, revision: 5, text: "遅れて届いた古い通知" });
      expect(documentText).toBe("編集前");

      busy = false;
      const pending = takeLatestDocumentChange(pendingRef);
      expect(pending).toMatchObject({ timestamp: 12, revision: 6 });
      if (pending) {
        dispatch(pending);
      }

      documentText += " + 後続の入力";
      savedWrites.push({ observedRevision, text: documentText });
      expect(savedWrites).toEqual([{
        observedRevision: 6,
        text: `${operation}中の外部変更2 + 後続の入力`,
      }]);
      expect(pendingRef.current).toBeNull();
    }
  });
});

describe("successful autosave bookkeeping", () => {
  it("records an in-flight save after effect cleanup when typing resumes in the same file", () => {
    const oldDocument = { text: "保存前" };
    const savedDocument = { text: "保存済み" };
    const savedByFileId = new Map();
    const observedRevisionRef = { current: 4 as number | null };
    const lastSavedDocumentRef = { current: oldDocument };
    const lastSavedDirtyRevisionRef = { current: 1 };
    const lastSyncedDocumentRef = { current: oldDocument };

    expect(recordSuccessfulDocumentSave({
      savedByFileId,
      save: { fileId: "file_1", document: savedDocument, revision: 5, dirtyRevision: 2 },
      activeFileId: "file_1",
      observedRevisionRef,
      lastSavedDocumentRef,
      lastSavedDirtyRevisionRef,
      lastSyncedDocumentRef,
    })).toBe(true);
    expect(savedByFileId.get("file_1")).toMatchObject({ revision: 5, dirtyRevision: 2 });
    expect(observedRevisionRef.current).toBe(5);
    expect(lastSavedDocumentRef.current).toBe(savedDocument);
    expect(lastSavedDirtyRevisionRef.current).toBe(2);
    expect(lastSyncedDocumentRef.current).toBe(savedDocument);
  });

  it("records an inactive file save without mutating the active document refs", () => {
    const activeDocument = { text: "別タブ" };
    const savedByFileId = new Map();
    const observedRevisionRef = { current: 9 as number | null };
    const lastSavedDocumentRef = { current: activeDocument };
    const lastSavedDirtyRevisionRef = { current: 7 };
    const lastSyncedDocumentRef = { current: activeDocument };

    expect(recordSuccessfulDocumentSave({
      savedByFileId,
      save: { fileId: "file_old", document: { text: "保存済み" }, revision: 5, dirtyRevision: 2 },
      activeFileId: "file_active",
      observedRevisionRef,
      lastSavedDocumentRef,
      lastSavedDirtyRevisionRef,
      lastSyncedDocumentRef,
    })).toBe(false);
    expect(savedByFileId.get("file_old")).toMatchObject({ revision: 5, dirtyRevision: 2 });
    expect(observedRevisionRef.current).toBe(9);
    expect(lastSavedDocumentRef.current).toBe(activeDocument);
    expect(lastSavedDirtyRevisionRef.current).toBe(7);
    expect(lastSyncedDocumentRef.current).toBe(activeDocument);
  });
});

describe("document replacement save gate", () => {
  it("keeps the current tab open and starts conflict recovery on a CAS mismatch", async () => {
    let activeFileId = "file_current";
    let conflictRecoveryRequested = false;
    const canSwitch = await saveBeforeDocumentReplacement({
      save: async () => ({ ok: false, code: "revision-mismatch", error: "revision mismatch" }),
      onFailure: (result) => {
        conflictRecoveryRequested = result.code === "revision-mismatch";
      },
    });
    if (canSwitch) {
      activeFileId = "file_next";
    }

    expect(canSwitch).toBe(false);
    expect(activeFileId).toBe("file_current");
    expect(conflictRecoveryRequested).toBe(true);
  });
});

describe("pending AI approval adoption", () => {
  it("enables the beforeunload guard before the first backup resolves and keeps it while the user types", () => {
    const pendingRef = { current: null as { fileId: string; userDocument: { text: string } } | null };
    let guardEnabled = false;
    const pending = { fileId: "file_1", userDocument: { text: "承認開始時" } };
    beginPendingAiApprovalAdoption(pendingRef, pending, (value) => { guardEnabled = value; });

    const currentUserDocument = { text: "バックアップ待機中の追加入力" };
    const preventDefault = vi.fn();
    const event = { preventDefault, returnValue: undefined as unknown };
    if (guardEnabled) {
      preventCloseForPendingAiApproval(event as Pick<BeforeUnloadEvent, "preventDefault" | "returnValue">);
    }

    expect(pendingRef.current).toBe(pending);
    expect(currentUserDocument.text).toContain("追加入力");
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(event.returnValue).toBe("");
  });

  it("defers repeated approval watcher events and keeps autosave blocked after backup failure", () => {
    const userDocument = { text: "承認中の入力" };
    const approvedDocument = { text: "AIの変更" };
    const pending = { fileId: "file_1", document: approvedDocument, revision: 5, userDocument };
    let currentDocument = userDocument;
    let observedRevision = 4;

    for (const watcherRevision of [5, 5, 6]) {
      if (!hasPendingAiApprovalForFile(pending, "file_1")) {
        currentDocument = approvedDocument;
        observedRevision = watcherRevision;
      }
    }
    const autosaveAllowed = !hasPendingAiApprovalForFile(pending, "file_1");

    expect(currentDocument).toBe(userDocument);
    expect(observedRevision).toBe(4);
    expect(autosaveAllowed).toBe(false);
    expect(pending.userDocument).toBe(userDocument);
    expect(pending.document).toBe(approvedDocument);
  });

  it("keeps adoption recovery state when workspace persistence fails", async () => {
    let pending = { fileId: "file_1" } as { fileId: string } | null;
    const onPersisted = vi.fn(() => {
      pending = null;
    });

    await expect(persistWorkspaceBeforeAiApprovalAdoption({
      saveWorkspace: async () => ({ ok: false, error: "workspace.jsonを書き込めません" }),
      onPersisted,
    })).resolves.toEqual({ ok: false, error: "workspace.jsonを書き込めません" });

    expect(onPersisted).not.toHaveBeenCalled();
    expect(pending).toEqual({ fileId: "file_1" });
  });

  it("regenerates a stale backup after persistence fails and the user types before retry", async () => {
    let dirtyRevision = 1;
    let cached: { backup: { fileId: string; text: string }; sourceRevision: number } | undefined;
    const createBackup = vi.fn(async () => ({ fileId: `backup_${dirtyRevision}`, text: `input_${dirtyRevision}` }));

    cached = (await resolveRevisionedBackup({
      cached,
      sourceRevision: dirtyRevision,
      createBackup,
    })) ?? undefined;
    await expect(persistWorkspaceBeforeAiApprovalAdoption({
      saveWorkspace: async () => ({ ok: false, error: "workspace persistence failed" }),
      onPersisted: vi.fn(),
    })).resolves.toMatchObject({ ok: false });

    dirtyRevision = 2;
    cached = (await resolveRevisionedBackup({
      cached,
      sourceRevision: dirtyRevision,
      createBackup,
    })) ?? undefined;
    const adopted = vi.fn();
    await expect(persistWorkspaceBeforeAiApprovalAdoption({
      saveWorkspace: async () => ({ ok: true }),
      onPersisted: adopted,
    })).resolves.toEqual({ ok: true });

    expect(createBackup).toHaveBeenCalledTimes(2);
    expect(cached).toEqual({
      backup: { fileId: "backup_2", text: "input_2" },
      sourceRevision: 2,
    });
    expect(adopted).toHaveBeenCalledOnce();
  });

  it("shares one adoption promise and skips reset when the active tab changes before persistence finishes", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const singleFlightRef = { current: null as Promise<string> | null };
    const task = vi.fn(async () => {
      await gate;
      return "done";
    });
    const first = runSingleFlight(singleFlightRef, task);
    const second = runSingleFlight(singleFlightRef, task);
    expect(first).toBe(second);
    await Promise.resolve();
    expect(task).toHaveBeenCalledTimes(1);

    let activeFileId = "file_pending";
    const reset = vi.fn();
    activeFileId = "file_other";
    expect(applyAiApprovalAdoptionIfFileActive({
      fileId: "file_pending",
      getActiveFileId: () => activeFileId,
      apply: reset,
    })).toBe(false);
    expect(reset).not.toHaveBeenCalled();

    release();
    await expect(Promise.all([first, second])).resolves.toEqual(["done", "done"]);
    expect(singleFlightRef.current).toBeNull();
  });
});
