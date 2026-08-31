"use client";

import { Bot, History, MapPin } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import type { SigmaDocument } from "@/features/document";
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
  onPreviewGroupsChange(groups: WebMcpPreviewGroup[]): void;
  sidebarOpen: boolean;
  sidebarTarget: HTMLElement | null;
}
export interface WebMcpBridgeHandle {
  applyProposalIds(proposalIds: string[]): Promise<WebMcpProposalApplyOutcome | null>;
  dismissProposalIds(proposalIds: string[]): boolean;
}
export type WebMcpProposalApplyOutcome = { ok: true } | { ok: false; reason: string };
export interface WebMcpPreviewGroup {
  targetId: string;
  draft: SigmaWebMcpProposal["previewDraft"];
  createdAt: number;
  proposalIds: string[];
  baseRevision: number;
  providers: ["chatgpt"];
  sessionLabel: string;
  lockTargets: false;
}
interface PendingDraft extends SigmaWebMcpProposal { error: string | null; createdAt: number }
interface HistoryEntry { id: string; proposal: SigmaWebMcpProposal; status: "applied" | "rejected" }

function publishStatus(status: WebMcpUiStatus): void {
  (window as typeof window & { __sigmaWebMcpStatus?: WebMcpUiStatus }).__sigmaWebMcpStatus = status;
  window.dispatchEvent(new CustomEvent<WebMcpUiStatus>(WEBMCP_STATUS_EVENT, { detail: status }));
}

export const WebMcpBridge = forwardRef<WebMcpBridgeHandle, WebMcpBridgeProps>(function WebMcpBridge(props, ref) {
  const t = useT("editor");
  const [proposal, setProposal] = useState<PendingDraft | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [registration, setRegistration] = useState<{ state: WebMcpRegistrationState; toolCount: number; failedToolNames: string[] }>({ state: "loading", toolCount: 0, failedToolNames: [] });
  const { enabled, instructionScopeId, commitDocumentChange, getDocument, getRevision, getSelectedBlockId, getSelection, navigateToTarget, onPreviewGroupsChange, sidebarOpen, sidebarTarget } = props;
  const previewGroups = useMemo<WebMcpPreviewGroup[]>(() => proposal ? [{ targetId: proposal.previewDraft.operations[0]?.targetId ?? proposal.targetId, draft: proposal.previewDraft, createdAt: proposal.createdAt, proposalIds: [proposal.id], baseRevision: proposal.baseRevision, providers: ["chatgpt"], sessionLabel: "WebMCP", lockTargets: false }] : [], [proposal]);

  useEffect(() => { onPreviewGroupsChange(previewGroups); return () => onPreviewGroupsChange([]); }, [onPreviewGroupsChange, previewGroups]);
  useEffect(() => { publishStatus({ state: registration.state, registeredToolCount: registration.toolCount, failedToolNames: registration.failedToolNames, operationCount: proposal?.operationCount ?? 0, changedIds: [...(proposal?.targetIds ?? [])] }); }, [proposal, registration]);

  const proposeDocumentChange = useCallback((next: SigmaWebMcpProposal) => {
    setProposal((current) => ({ ...next, error: null, createdAt: current?.createdAt ?? Date.now() }));
    const blockId = next.blockIds[0];
    if (blockId) window.requestAnimationFrame(() => navigateToTarget({ kind: "block", id: blockId }));
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

  const navigateToProposal = useCallback((item: SigmaWebMcpProposal) => {
    if (item.shapeIds[0]) navigateToTarget({ kind: "shape", id: item.shapeIds[0] });
    else if (item.blockIds[0]) navigateToTarget({ kind: "block", id: item.blockIds[0] });
  }, [navigateToTarget]);
  const applyProposalIds = useCallback(async (ids: string[]): Promise<WebMcpProposalApplyOutcome | null> => {
    if (!proposal || !ids.includes(proposal.id)) return null;
    try {
      commitDocumentChange((current) => SigmaDocumentSchema.parse(proposal.apply(current).document));
      setHistory((current) => [{ id: `${proposal.id}:applied:${Date.now()}`, proposal, status: "applied" as const }, ...current].slice(0, 8));
      setProposal(null);
      return { ok: true };
    } catch (error) {
      console.error("WebMCP proposal application failed", error);
      const message = t("webMcpProposal.applyFailed");
      setProposal((current) => current ? { ...current, error: message } : current);
      return { ok: false, reason: message };
    }
  }, [commitDocumentChange, proposal, t]);
  const dismissProposalIds = useCallback((ids: string[]): boolean => {
    if (!proposal || !ids.includes(proposal.id)) return false;
    proposal.dismiss();
    setHistory((current) => [{ id: `${proposal.id}:rejected:${Date.now()}`, proposal, status: "rejected" as const }, ...current].slice(0, 8));
    setProposal(null);
    return true;
  }, [proposal]);
  useImperativeHandle(ref, () => ({ applyProposalIds, dismissProposalIds }), [applyProposalIds, dismissProposalIds]);

  if (!enabled) return null;
  const content = (
    <div className={sidebarOpen ? "webmcp-proposal-panel" : "webmcp-proposal-dock"} role="region" aria-label={t("webMcpProposal.regionLabel")}>
      {!sidebarOpen && (proposal || history.length > 0) && <header className="webmcp-proposal-header">
          <span className="webmcp-proposal-mark" aria-hidden="true"><Bot size={16} /></span>
          <div><h2>{t("webMcpProposal.title")}</h2><p>{t("webMcpProposal.description")}</p></div>
          <span className="webmcp-proposal-count" aria-label={t("webMcpProposal.operationCount", { operations: proposal?.operationCount ?? 0 })}>{proposal?.operationCount ?? 0}</span>
        </header>}
      {proposal?.error && <p className="webmcp-proposal-error" role="alert">{proposal.error}</p>}
      {proposal && (
        <div className="webmcp-proposal-actions">
          <button type="button" className="webmcp-proposal-reject" onClick={() => dismissProposalIds([proposal.id])}>{t("webMcpProposal.reject")}</button>
          <button type="button" className="webmcp-proposal-apply" onClick={() => void applyProposalIds([proposal.id])}>{t("webMcpProposal.apply")}</button>
          <button type="button" onClick={() => navigateToProposal(proposal)}><MapPin size={12} aria-hidden="true" />{t("webMcpProposal.historyNavigate")}</button>
        </div>
      )}
      {history.length > 0 && <section className="webmcp-proposal-history" aria-labelledby="webmcp-history-title"><h3 id="webmcp-history-title"><History size={14} aria-hidden="true" />{t("webMcpProposal.historyTitle")}</h3><ul>{history.map((entry) => <li key={entry.id}><span data-status={entry.status}>{entry.status === "applied" ? t("webMcpProposal.historyApplied") : t("webMcpProposal.historyRejected")}</span><button type="button" onClick={() => navigateToProposal(entry.proposal)}><MapPin size={12} aria-hidden="true" />{t("webMcpProposal.historyNavigate")}</button></li>)}</ul></section>}
      <div className="webmcp-proposal-status" role="status" aria-live="polite">{proposal ? t("webMcpProposal.pendingOperationsAnnouncement", { operations: proposal.operationCount }) : t("webMcpProposal.noPendingAnnouncement")}</div>
    </div>
  );
  if (sidebarOpen) {
    if (!sidebarTarget) return <div className="webmcp-proposal-status" role="status" aria-live="polite" />;
    return createPortal(
      proposal || history.length > 0
        ? content
        : <div className="webmcp-proposal-status" role="status" aria-live="polite" />,
      sidebarTarget,
    );
  }
  return proposal || history.length > 0 ? content : <div className="webmcp-proposal-status" role="status" aria-live="polite" />;
});
