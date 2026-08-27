import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(fileName: string): string {
  return readFileSync(new URL(fileName, import.meta.url), "utf8");
}

function importSpecifiers(code: string): string[] {
  return [...code.matchAll(
    /(?:\bfrom\s+|\bimport\s*(?:\(\s*)?)["']([^"']+)["']/g,
  )].map((match) => match[1]);
}

describe("text-flow module boundaries", () => {
  it("keeps legacy pure-module paths as logic-free feature facades", () => {
    const facades = [
      "./block-model.ts",
      "./block-sync.ts",
      "./manual-page-break.ts",
      "./normalization.ts",
    ];

    for (const fileName of facades) {
      const code = source(fileName);
      expect(importSpecifiers(code)).toEqual(["@/features/text-editing"]);
      expect(code).not.toMatch(/\bfunction\b|\bconst\b|\bclass\b/);
    }
  });

  it("keeps the Tiptap adapter independent from React and editor controllers", () => {
    const imports = importSpecifiers(source("./tiptap-document-adapter.ts"));

    expect(imports.filter((specifier) => (
      specifier === "react"
      || specifier.startsWith("react/")
      || specifier.includes("/features/ai-edit")
      || specifier.includes("/lib/ai/")
      || specifier.includes("TextFlowEditor")
    ))).toEqual([]);
  });
});
