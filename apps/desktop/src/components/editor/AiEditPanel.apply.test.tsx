import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hookState = vi.hoisted(() => ({
  callIndex: 0,
  values: [] as unknown[],
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useMemo: <Value,>(factory: () => Value) => factory(),
    useState: <Value,>(initialValue: Value) => {
      const index = hookState.callIndex++;
      if (hookState.values[index] === undefined) {
        hookState.values[index] = initialValue;
      }
      const setValue = (next: Value | ((current: Value) => Value)) => {
        const current = hookState.values[index] as Value;
        hookState.values[index] = typeof next === "function"
          ? (next as (value: Value) => Value)(current)
          : next;
      };
      return [hookState.values[index] as Value, setValue] as const;
    },
  };
});

// この spec はコンポーネントを関数として直接呼び、react の hook を差し替えて
// 適用失敗時の描画だけを見る。`useT` は `useSyncExternalStore` を使うので、実物のままだと
// レンダラの外で dispatcher が null になって落ちる。翻訳はこの spec の関心ではない。
vi.mock("@/lib/i18n/react", async () => {
  const { createTranslator } = await vi.importActual<typeof import("@/lib/i18n")>("@/lib/i18n");
  return { useT: (namespace: string) => createTranslator("ja", namespace as "ai") };
});

import {
  AssistantTurnView,
  type AssistantTurn,
} from "./AiEditPanel";
import type { AiEditPreviewState } from "@/components/editor/ai-edit-preview-types";

function findElement(
  node: ReactNode,
  predicate: (element: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>> | null {
  if (!isValidElement<Record<string, unknown>>(node)) {
    return null;
  }
  if (predicate(node)) {
    return node;
  }
  for (const child of Children.toArray(node.props.children as ReactNode)) {
    const found = findElement(child, predicate);
    if (found) {
      return found;
    }
  }
  return null;
}

describe("AssistantTurnView apply failure", () => {
  beforeEach(() => {
    hookState.callIndex = 0;
    hookState.values = [];
  });

  it("renders the failed reason beside the clicked apply action and keeps the proposal pending", async () => {
    const reason = "対象が更新されたため適用できませんでした";
    const turn = {
      id: "turn-1",
      role: "assistant",
      createdAt: 0,
      applied: false,
      dismissed: false,
      restored: false,
      result: {
        draft: {
          summary: "本文を直します",
          plan: [],
          warnings: [],
          operations: [],
        },
        questions: [],
      },
    } as unknown as AssistantTurn;
    const proposal: AiEditPreviewState = {
      targetId: "p1",
      roomId: "room-1",
      turnId: "turn-1",
      proposalIds: ["proposal-1"],
      baseRevision: 1,
      providers: ["chatgpt"],
      createdAt: 0,
      draft: {
        summary: "本文を直します",
        plan: [],
        warnings: [],
        operations: [],
      },
    };
    const onApplyProposal = vi.fn(async () => ({ ok: false as const, reason }));

    const firstRender = AssistantTurnView({
      turn,
      clockNow: 0,
      proposal,
      proposalBusy: false,
      onApplyProposal,
    });
    const applyActions = findElement(
      firstRender,
      (element) => element.props.className === "ai-chat-result-proposal-actions",
    );
    expect(applyActions).not.toBeNull();

    (applyActions?.props.onApply as (() => void) | undefined)?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(onApplyProposal).toHaveBeenCalledWith(["proposal-1"]);
    expect(hookState.values[4]).toBe(reason);

    hookState.callIndex = 0;
    const failedRender = AssistantTurnView({
      turn,
      clockNow: 0,
      proposal,
      proposalBusy: false,
      onApplyProposal,
    });
    const error = findElement(
      failedRender,
      (element) => element.type === "p" && element.props.className === "ai-chat-error",
    );
    expect(error?.props.children).toBe(reason);
    expect(findElement(
      failedRender,
      (element) => element.props.className === "ai-chat-result-proposal",
    )).not.toBeNull();
    expect(findElement(
      failedRender,
      (element) => element.props.className === "ai-chat-result-proposal-actions",
    )).not.toBeNull();
  });
});
