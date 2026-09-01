"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";

import type { SigmaDocument } from "@/features/document";
import type { AiProposalApplyOutcome } from "@/features/ai-edit/application/proposal-action-model";
import type { AiEditPreviewState } from "@/features/ai-edit/model/preview";
import { useT } from "@/lib/i18n/react";
import { SigmaDocumentSchema } from "@/lib/sigma-doc-schema";
import {
  createSigmaWebMcpTools,
  getWebMcpAgentInstructionsStorageKey,
  WEBMCP_APPLICATION_GUIDANCE,
  type SigmaWebMcpPorts,
  type SigmaWebMcpProposal,
  type WebMcpToolDefinition,
} from "@/lib/webmcp-tools";

export const WEBMCP_STATUS_EVENT = "sigma-studio:webmcp-status";
export type WebMcpRegistrationState = "loading" | "connected" | "partial" | "failed" | "unavailable";
export interface WebMcpUiStatus {
  state: WebMcpRegistrationState;
  registeredToolCount: number;
  failedToolNames: string[];
  operationCount: number;
  changedIds: string[];
}

interface WebMcpModelContext {
  registerTool(tool: WebMcpToolDefinition, options?: { signal?: AbortSignal }): Promise<void>;
  provideContext?(context: { instructions: string }): Promise<void> | void;
}
type WebMcpDocument = Document & { modelContext?: WebMcpModelContext };

export interface WebMcpBridgeProps {
  enabled: boolean;
  instructionScopeId: string;
  commitDocumentChange(change: (current: SigmaDocument) => SigmaDocument): void;
  getDocument: SigmaWebMcpPorts["getDocument"];
  getRevision: SigmaWebMcpPorts["getRevision"];
  getSelectedBlockId: SigmaWebMcpPorts["getSelectedBlockId"];
  getSelection: NonNullable<SigmaWebMcpPorts["getSelection"]>;
  navigateToTarget(target: { kind: "block" | "shape"; id: string }): void;
  onPreviewGroupsChange(groups: AiEditPreviewState[]): void;
}
export interface WebMcpBridgeHandle {
  applyProposalIds(proposalIds: string[]): Promise<AiProposalApplyOutcome | null>;
  dismissProposalIds(proposalIds: string[]): boolean;
}
interface PendingDraft extends SigmaWebMcpProposal { createdAt: number }

function publishStatus(status: WebMcpUiStatus): void {
  (window as typeof window & { __sigmaWebMcpStatus?: WebMcpUiStatus }).__sigmaWebMcpStatus = status;
  window.dispatchEvent(new CustomEvent<WebMcpUiStatus>(WEBMCP_STATUS_EVENT, { detail: status }));
}

export const WebMcpBridge = forwardRef<WebMcpBridgeHandle, WebMcpBridgeProps>(function WebMcpBridge(props, ref) {
  const t = useT("editor");
  const [proposal, setProposal] = useState<PendingDraft | null>(null);
  const [registration, setRegistration] = useState<{ state: WebMcpRegistrationState; toolCount: number; failedToolNames: string[] }>({ state: "loading", toolCount: 0, failedToolNames: [] });
  const { enabled, instructionScopeId, commitDocumentChange, getDocument, getRevision, getSelectedBlockId, getSelection, navigateToTarget, onPreviewGroupsChange } = props;
  const previewGroups = useMemo<AiEditPreviewState[]>(() => proposal ? [{ targetId: proposal.previewDraft.operations[0]?.targetId ?? proposal.targetId, draft: proposal.previewDraft, createdAt: proposal.createdAt, proposalIds: [proposal.id], baseRevision: proposal.baseRevision, providers: ["chatgpt"], sessionLabel: "WebMCP", lockTargets: false }] : [], [proposal]);

  useEffect(() => { onPreviewGroupsChange(previewGroups); return () => onPreviewGroupsChange([]); }, [onPreviewGroupsChange, previewGroups]);
  useEffect(() => { publishStatus({ state: registration.state, registeredToolCount: registration.toolCount, failedToolNames: registration.failedToolNames, operationCount: proposal?.operationCount ?? 0, changedIds: [...(proposal?.targetIds ?? [])] }); }, [proposal, registration]);

  const proposeDocumentChange = useCallback((next: SigmaWebMcpProposal) => {
    setProposal((current) => ({ ...next, createdAt: current?.createdAt ?? Date.now() }));
    const blockId = next.blockIds[0];
    const shapeId = next.shapeIds[0];
    if (blockId) window.requestAnimationFrame(() => navigateToTarget({ kind: "block", id: blockId }));
    else if (shapeId) window.requestAnimationFrame(() => navigateToTarget({ kind: "shape", id: shapeId }));
  }, [navigateToTarget]);
  const withdrawDocumentChange = useCallback(() => setProposal(null), []);

  useEffect(() => {
    if (!enabled) return;
    const modelContext = (window.document as WebMcpDocument).modelContext;
    if (!modelContext) { setRegistration({ state: "unavailable", toolCount: 0, failedToolNames: [] }); return; }
    const controller = new AbortController();
    setRegistration({ state: "loading", toolCount: 0, failedToolNames: [] });
    const storageKey = getWebMcpAgentInstructionsStorageKey(instructionScopeId);
    const getAgentInstructions = () => window.localStorage.getItem(storageKey) ?? "";
    const tools = createSigmaWebMcpTools({ getDocument, getRevision, getSelectedBlockId, getSelection, getAgentInstructions, proposeDocumentChange, withdrawDocumentChange });
    void Promise.allSettled(tools.map(async (tool) => {
      // Keep this explicit: WebMCP clients and challenge review inspect the browser API directly.
      await modelContext.registerTool(tool, { signal: controller.signal });
      return tool.name;
    })).then((results) => {
      if (controller.signal.aborted) return;
      const failedToolNames = results.flatMap((result, index) => result.status === "rejected" ? [tools[index]!.name] : []);
      const toolCount = tools.length - failedToolNames.length;
      if (failedToolNames.length > 0) {
        console.error("WebMCP tool registration failed", results.filter((result) => result.status === "rejected"));
      }
      setRegistration({
        state: failedToolNames.length === 0 ? "connected" : toolCount > 0 ? "partial" : "failed",
        toolCount,
        failedToolNames,
      });
    });
    if (typeof modelContext.provideContext === "function") {
      void Promise.resolve(modelContext.provideContext({ instructions: WEBMCP_APPLICATION_GUIDANCE })).catch((error) => {
        console.error("WebMCP application guidance registration failed", error);
      });
    }
    return () => { controller.abort(); };
  }, [enabled, getDocument, getRevision, getSelectedBlockId, getSelection, instructionScopeId, proposeDocumentChange, withdrawDocumentChange]);

  const applyProposalIds = useCallback(async (ids: string[]): Promise<AiProposalApplyOutcome | null> => {
    if (!proposal || !ids.includes(proposal.id)) return null;
    try {
      commitDocumentChange((current) => SigmaDocumentSchema.parse(proposal.apply(current).document));
      setProposal(null);
      return { ok: true };
    } catch (error) {
      console.error("WebMCP proposal application failed", error);
      const message = t("webMcpProposal.applyFailed");
      return { ok: false, reason: message };
    }
  }, [commitDocumentChange, proposal, t]);
  const dismissProposalIds = useCallback((ids: string[]): boolean => {
    if (!proposal || !ids.includes(proposal.id)) return false;
    proposal.dismiss();
    setProposal(null);
    return true;
  }, [proposal]);
  useImperativeHandle(ref, () => ({ applyProposalIds, dismissProposalIds }), [applyProposalIds, dismissProposalIds]);

  if (!enabled) return null;
  return (
    <div className="webmcp-proposal-status" role="status" aria-live="polite">
      {proposal ? t("webMcpProposal.pendingOperationsAnnouncement", { operations: proposal.operationCount }) : t("webMcpProposal.noPendingAnnouncement")}
    </div>
  );
});
