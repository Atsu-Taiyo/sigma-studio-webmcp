"use client";

import { Download, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

import { AntigravityMark, ClaudeMark, OpenAiMark } from "@/components/branding/provider-logos";
import { useT } from "@/lib/i18n/react";

const DESKTOP_DOWNLOAD_URL = "https://github.com/Atsu-Taiyo/SIGMA-Studio/releases/latest";

interface AiVendorLogo {
  id: string;
  name: string;
  svg: ReactNode;
}

const VENDORS: AiVendorLogo[] = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    svg: <OpenAiMark size={22} />,
  },
  {
    id: "claude",
    name: "Claude",
    svg: <ClaudeMark size={22} />,
  },
  {
    id: "antigravity",
    name: "Antigravity",
    svg: <AntigravityMark size={22} />,
  },
  {
    id: "cursor",
    name: "Cursor",
    svg: (
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path
          fill="#0F0F0F"
          d="M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23"
        />
      </svg>
    ),
  },
];

export function AiEditWebPlaceholder() {
  const t = useT("ai");
  return (
    <div className="ai-edit-panel">
      <div className="ai-web-placeholder">
        <div className="ai-web-placeholder-headline">
          <span className="ai-web-placeholder-badge">
            <Sparkles size={14} />
            <span>{t("webPlaceholder.badge")}</span>
          </span>
          <h3>{t("webPlaceholder.title")}</h3>
          <p>{t("webPlaceholder.description")}</p>
        </div>

        <a
          className="ai-web-placeholder-download"
          href={DESKTOP_DOWNLOAD_URL}
          target="_blank"
          rel="noreferrer noopener"
        >
          <Download size={18} />
          <span>{t("webPlaceholder.download")}</span>
        </a>

        <div className="ai-web-placeholder-vendors">
          <div className="ai-web-placeholder-vendors-title">{t("webPlaceholder.supportedAgents")}</div>
          <ul className="ai-web-placeholder-vendor-list" aria-label={t("webPlaceholder.supportedAgents")}>
            {VENDORS.map((vendor) => (
              <li key={vendor.id} className="ai-web-placeholder-vendor">
                <span className="ai-web-placeholder-vendor-logo" aria-hidden="true">
                  {vendor.svg}
                </span>
                <span className="ai-web-placeholder-vendor-name">{vendor.name}</span>
              </li>
            ))}
          </ul>
          <p className="ai-web-placeholder-footnote">
            {t("webPlaceholder.footnote")}
          </p>
        </div>
      </div>
    </div>
  );
}
