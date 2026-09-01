"use client";

import { Bot, CircleAlert, CircleCheck, CircleHelp, FileText, LoaderCircle } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { WEBMCP_STATUS_EVENT, type WebMcpUiStatus } from "@/components/editor/webmcp/WebMcpBridge";
import { getWebMcpAgentInstructionsStorageKey } from "@/lib/webmcp-tools";
import { useT } from "@/lib/i18n/react";

const EMPTY_STATUS: WebMcpUiStatus = { state: "loading", registeredToolCount: 0, failedToolNames: [], operationCount: 0, changedIds: [] };

export function AiEditWebPlaceholder({ instructionScopeId }: { instructionScopeId: string }) {
  const t = useT("ai");
  const instructionsId = useId();
  const storageKey = getWebMcpAgentInstructionsStorageKey(instructionScopeId);
  const [instructions, setInstructions] = useState(() => typeof window === "undefined" ? "" : window.localStorage.getItem(storageKey) ?? "");
  const [status, setStatus] = useState<WebMcpUiStatus>(() => typeof window === "undefined" ? EMPTY_STATUS : (window as typeof window & { __sigmaWebMcpStatus?: WebMcpUiStatus }).__sigmaWebMcpStatus ?? EMPTY_STATUS);

  useEffect(() => {
    const receiveStatus = (event: Event) => setStatus((event as CustomEvent<WebMcpUiStatus>).detail);
    window.addEventListener(WEBMCP_STATUS_EVENT, receiveStatus);
    return () => window.removeEventListener(WEBMCP_STATUS_EVENT, receiveStatus);
  }, []);
  const saveInstructions = (value: string) => {
    setInstructions(value);
    window.localStorage.setItem(storageKey, value);
  };

  const connectionStatus = (() => {
    switch (status.state) {
      case "loading": return { icon: <LoaderCircle size={16} aria-hidden="true" />, text: t("webPlaceholder.loading") };
      case "connected": return { icon: <CircleCheck size={16} aria-hidden="true" />, text: t("webPlaceholder.connected", { tools: status.registeredToolCount }) };
      case "partial": return { icon: <CircleAlert size={16} aria-hidden="true" />, text: t("webPlaceholder.partial", { tools: status.registeredToolCount, failedTools: status.failedToolNames.join(", ") }) };
      case "failed": return { icon: <CircleAlert size={16} aria-hidden="true" />, text: t("webPlaceholder.failed", { failedTools: status.failedToolNames.join(", ") }) };
      case "unavailable": return { icon: <CircleHelp size={16} aria-hidden="true" />, text: t("webPlaceholder.unavailable") };
    }
  })();

  return (
    <div className="ai-edit-panel">
      <div className="ai-web-placeholder">
        <div className="ai-web-placeholder-headline">
          <span className="ai-web-placeholder-badge"><Bot size={14} aria-hidden="true" /><span>{t("webPlaceholder.badge")}</span></span>
          <h3>{t("webPlaceholder.title")}</h3>
          <p>{t("webPlaceholder.description")}</p>
        </div>
        <section className="ai-web-placeholder-vendors" aria-labelledby={`${instructionsId}-status`}>
          <h4 id={`${instructionsId}-status`} className="ai-web-placeholder-vendors-title">{t("webPlaceholder.connectionTitle")}</h4>
          <p className="ai-web-placeholder-footnote" role="status">
            {connectionStatus.icon}
            {connectionStatus.text}
          </p>
          {status.state === "unavailable" && <p className="ai-web-placeholder-footnote">{t("webPlaceholder.enableSteps")}</p>}
        </section>
        <section className="ai-web-placeholder-vendors" aria-labelledby={`${instructionsId}-instructions`}>
          <h4 id={`${instructionsId}-instructions`} className="ai-web-placeholder-vendors-title"><FileText size={15} aria-hidden="true" />{t("webPlaceholder.instructionsTitle")}</h4>
          <label htmlFor={instructionsId} className="ai-web-placeholder-footnote">{t("webPlaceholder.instructionsDescription")}</label>
          <textarea id={instructionsId} className="ai-web-instructions-input" value={instructions} onChange={(event) => saveInstructions(event.target.value)} placeholder={t("webPlaceholder.instructionsPlaceholder")} rows={9} />
          <p className="ai-web-placeholder-footnote">{t("webPlaceholder.savedLocally")}</p>
        </section>
      </div>
    </div>
  );
}
