import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { DecorationSet, EditorView } from "@tiptap/pm/view";

import { createTranslator, getAppLocale, type AppLocale, type Translate } from "@/lib/i18n";

import {
  EDIT_GUARD_MAX_ANIMATED_CHARS,
  collectEditGuardHighlightSpans,
  createEditGuardActionButton,
  createEditGuardDecorations,
  findTouchedGuardedBlockIds,
  handleEditGuardAction,
  refreshEditGuardDecorations,
  type EditGuardActionState,
  type EditGuardHighlightSpans,
  type TextFlowEditGuard,
  type TextFlowEditGuardPresentation,
  type TextFlowEditPolicy,
  type TextFlowGuardHighlightScope,
} from "@/components/tiptap/edit-guard-extension";

export interface AiEditLockInfo {
  blockId: string;
  runId: string;
  sessionLabel: string | null;
  isPrimaryAnchor: boolean;
  pendingProposal?: boolean;
  blockShimmerScopes?: readonly TextFlowGuardHighlightScope[];
}

export type AiEditLockStopButtonState = EditGuardActionState;

/**
 * **呼び出し時点**の表示言語で解決する `t`。
 *
 * ここの文言は「ロックに当たった瞬間」に `setStatusMessage` から出るので、
 * モジュール読み込み時のロケールで焼くと言語切り替え後も古い言語のまま残る。
 * 呼び出し側 (`EditorShell`) は引数を渡さないので、**既定がこれである必要がある**。
 * Node / テストなど `window` の無い環境では `getAppLocale()` が既定ロケールを返す。
 */
const lockTextCache: { locale: AppLocale | null; translate: Translate<"ai"> | null } = {
  locale: null,
  translate: null,
};

function resolveLockTranslate(): Translate<"ai"> {
  const locale = getAppLocale();
  if (lockTextCache.locale !== locale || !lockTextCache.translate) {
    lockTextCache.locale = locale;
    lockTextCache.translate = createTranslator(locale, "ai");
  }
  return lockTextCache.translate;
}

export const AI_EDIT_GUARD_PRESENTATION: TextFlowEditGuardPresentation = {
  highlightedBlockClassName: "ai-edit-locked-block",
  partialBlockClassName: "ai-edit-locked-block-partial",
  readOnlyBlockClassName: "ai-edit-readonly-block",
  characterClassName: "ai-edit-lock-char",
  atomClassName: "ai-edit-lock-atom",
  characterIndexCssProperty: "--ai-edit-lock-char-i",
};

/**
 * ロック中の案内文。**定数ではなく関数**なのは、モジュール読み込み時の言語で焼き付けず、
 * 出す瞬間の表示言語で解決するため (`EditorShell` の `setStatusMessage` から呼ばれる)。
 * 定数のままコンポーネント内の値へ移すと、依存に持つメモ化が軒並み崩れる (WI-5 で実測)。
 */
export function aiActiveRunBlockedMessage(t: Translate<"ai"> = resolveLockTranslate()): string {
  return t("lock.activeRun");
}

export function aiPendingProposalBlockedMessage(t: Translate<"ai"> = resolveLockTranslate()): string {
  return t("lock.pendingProposal");
}

/** The only document-wide lock left: the approval write itself replaces the
 * whole document, so a keystroke landing inside that window would be lost. */
export function aiDocumentWriteInProgressMessage(t: Translate<"ai"> = resolveLockTranslate()): string {
  return t("lock.documentWrite");
}

/** Compatibility name for callers that still describe generic highlights as AI shimmer. */
export const AI_EDIT_LOCK_MAX_ANIMATED_CHARS = EDIT_GUARD_MAX_ANIMATED_CHARS;
export type AiEditLockCharSpan = EditGuardHighlightSpans["charSpans"][number];
export type AiEditLockAtomSpan = EditGuardHighlightSpans["atomSpans"][number];
export type AiEditLockBlockSpans = EditGuardHighlightSpans;

export function collectAiEditLockSpans(
  blockNode: ProseMirrorNode,
  contentFrom: number,
  scopes?: readonly TextFlowGuardHighlightScope[],
): AiEditLockBlockSpans {
  return collectEditGuardHighlightSpans(blockNode, contentFrom, scopes);
}

/** Compatibility name for the editor-owned guarded-block detector. */
export const findTouchedLockedBlockIds = findTouchedGuardedBlockIds;

export function shouldAllowTextFlowTransaction(
  oldDoc: ProseMirrorNode,
  tentativeNewDoc: ProseMirrorNode,
  lockedBlockIds: ReadonlySet<string>,
  options: { isComposing: boolean },
): boolean {
  if (lockedBlockIds.size === 0 || (options.isComposing && oldDoc === tentativeNewDoc)) {
    return true;
  }
  return findTouchedGuardedBlockIds(oldDoc, tentativeNewDoc, lockedBlockIds).length === 0;
}

export function refreshAiEditLockDecorations(view: EditorView | null | undefined): void {
  refreshEditGuardDecorations(view);
}

export function createAiEditLockDecorations(
  doc: ProseMirrorNode,
  locks: ReadonlyMap<string, AiEditLockInfo>,
  callbacks: { onRequestStop: (lock: AiEditLockInfo) => Promise<{ ok: boolean }> },
): DecorationSet {
  return createEditGuardDecorations(doc, new Map(
    [...locks].map(([blockId, lock]) => [
      blockId,
      createAiTextFlowEditGuard(lock, callbacks.onRequestStop),
    ]),
  ));
}

export async function handleAiEditLockStopButtonClick<TLock extends { runId: string }>(
  lock: TLock,
  currentState: AiEditLockStopButtonState,
  callbacks: {
    onRequestStop: (lock: TLock) => Promise<{ ok: boolean }>;
    onStopped?: () => void;
  },
): Promise<AiEditLockStopButtonState> {
  return handleEditGuardAction(
    currentState,
    { request: () => callbacks.onRequestStop(lock) },
    { onAccepted: callbacks.onStopped },
  );
}

export function createAiEditLockStopButton(
  lock: AiEditLockInfo,
  callbacks: {
    onRequestStop: (lock: AiEditLockInfo) => Promise<{ ok: boolean }>;
    onStopped?: () => void;
  },
): HTMLButtonElement {
  return createEditGuardActionButton(
    createAiTextFlowEditGuard(lock, callbacks.onRequestStop),
    { onAccepted: callbacks.onStopped },
  );
}

export function createAiTextFlowEditGuard(
  lock: AiEditLockInfo,
  onRequestStop: (lock: AiEditLockInfo) => Promise<{ ok: boolean }>,
  options: { blockedMessage?: string; t?: Translate<"ai"> } = {},
): TextFlowEditGuard {
  const t = options.t ?? resolveLockTranslate();
  const highlight = !lock.pendingProposal
    && (lock.blockShimmerScopes === undefined || lock.blockShimmerScopes.length > 0);
  const label = t("lock.stopAndEdit");
  return {
    blockId: lock.blockId,
    guardId: lock.runId,
    isPrimaryActionTarget: lock.isPrimaryAnchor,
    blockedMessage: options.blockedMessage ?? t("lock.editing"),
    presentation: AI_EDIT_GUARD_PRESENTATION,
    highlight,
    highlightScopes: lock.blockShimmerScopes,
    action: lock.pendingProposal
      ? undefined
      : {
          label,
          busyLabel: t("lock.stopping"),
          failureTitle: t("lock.stopFailed"),
          buttonClassName: "ai-edit-lock-stop-button",
          iconClassName: "ai-edit-lock-stop-icon",
          title: lock.sessionLabel ? `${label}(${lock.sessionLabel})` : label,
          request: () => onRequestStop(lock),
        },
  };
}

export function createAiReadOnlyTextFlowEditGuard(
  blockId: string,
  blockedMessage: string,
): TextFlowEditGuard {
  return {
    blockId,
    guardId: `ai-pending-${blockId}`,
    isPrimaryActionTarget: false,
    blockedMessage,
    presentation: AI_EDIT_GUARD_PRESENTATION,
    highlight: false,
  };
}

export interface AiTextFlowEditPolicyInput {
  liveLocks: readonly AiEditLockInfo[];
  pendingBlockIds: Iterable<string>;
  /** True only while an approval/dismissal IPC is replacing the whole document. */
  documentWriteInProgress?: boolean;
  onRequestStop: (lock: AiEditLockInfo) => Promise<{ ok: boolean }>;
}

/**
 * Projects AI run/proposal ownership onto the generic text-flow edit policy.
 * Exact run targets win over pending-proposal reservations for the same block.
 *
 * Guards are per block by design: a live run or a pending proposal reserves only
 * the blocks it actually owns, and every other block stays editable. `lockAll`
 * is reserved for the apply write window, which really does own the whole
 * document for the moment it takes to swap it.
 */
export function buildAiTextFlowEditPolicy({
  liveLocks,
  pendingBlockIds,
  documentWriteInProgress = false,
  onRequestStop,
}: AiTextFlowEditPolicyInput): TextFlowEditPolicy {
  const guards = new Map<string, TextFlowEditGuard>();
  for (const lock of liveLocks) {
    guards.set(lock.blockId, createAiTextFlowEditGuard(lock, onRequestStop, {
      blockedMessage: aiActiveRunBlockedMessage(),
    }));
  }
  for (const blockId of pendingBlockIds) {
    if (!guards.has(blockId)) {
      guards.set(
        blockId,
        createAiReadOnlyTextFlowEditGuard(blockId, aiPendingProposalBlockedMessage()),
      );
    }
  }

  const lockAll: TextFlowEditPolicy["lockAll"] = documentWriteInProgress
    ? {
        guardId: "ai-document-write-in-progress",
        blockedMessage: aiDocumentWriteInProgressMessage(),
        presentation: AI_EDIT_GUARD_PRESENTATION,
        highlight: false,
      }
    : undefined;

  return lockAll
    ? { guards: [...guards.values()], lockAll }
    : { guards: [...guards.values()] };
}
