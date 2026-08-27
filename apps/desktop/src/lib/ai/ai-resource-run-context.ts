export type AiResourceProvider = "codex" | "claude" | "antigravity";

export interface AiResourceContextItem {
  id: string;
  kind: "instruction" | "skill";
  title: string;
  loadMode: "always" | "auto" | "manual";
  description: string;
  tags: string[];
  content?: string;
}

export interface AiResourceRunContext {
  provider: AiResourceProvider;
  always: AiResourceContextItem[];
  explicit: AiResourceContextItem[];
}
