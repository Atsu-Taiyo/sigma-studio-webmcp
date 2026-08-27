import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

function productionSourceFiles(directory: URL): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryUrl = new URL(entry.name, directory);
    if (entry.isDirectory()) {
      return productionSourceFiles(new URL(`${entry.name}/`, directory));
    }
    return entry.isFile()
      && /\.tsx?$/.test(entry.name)
      && !entry.name.includes(".test.")
      && !entry.name.includes(".spec.")
      ? [fileURLToPath(entryUrl)]
      : [];
  });
}

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/(?:\bfrom\s+|\bimport\s*(?:\(\s*)?)["']([^"']+)["']/g)]
    .map((match) => match[1]);
}

function invalidImports(
  files: readonly string[],
  predicate: (specifier: string) => boolean,
): Array<{ file: string; specifier: string }> {
  return files.flatMap((file) => (
    importSpecifiers(readFileSync(file, "utf8"))
      .filter(predicate)
      .map((specifier) => ({ file, specifier }))
  ));
}

describe("headless application dependency boundary", () => {
  it("keeps Electron, MCP, and reusable lib services independent from UI components", () => {
    const files = [
      ...productionSourceFiles(new URL("../../electron/", import.meta.url)),
      ...productionSourceFiles(new URL("../../mcp/", import.meta.url)),
      ...productionSourceFiles(new URL("../lib/", import.meta.url)),
    ];

    expect(invalidImports(
      files,
      (specifier) => (
        specifier.startsWith("@/components/")
        || specifier.startsWith("components/")
        || specifier.includes("/components/")
      ),
    )).toEqual([]);
  });

  it("keeps Electron, MCP, and reusable lib services on the canonical SigmaDoc API", () => {
    const files = [
      ...productionSourceFiles(new URL("../../electron/", import.meta.url)),
      ...productionSourceFiles(new URL("../../mcp/", import.meta.url)),
      ...productionSourceFiles(new URL("../lib/", import.meta.url)),
    ];

    expect(invalidImports(
      files,
      (specifier) => specifier === "@/types/sigma-doc",
    )).toEqual([]);
  });

  it("keeps feature implementations on canonical document and page-layout APIs", () => {
    const files = productionSourceFiles(new URL("./", import.meta.url));

    expect(invalidImports(
      files,
      (specifier) => (
        specifier === "@/types/sigma-doc"
        || specifier === "@/lib/page-layout"
        || specifier === "@/lib/page-running-region-layout"
      ),
    )).toEqual([]);
  });

  it("keeps renderer production on the public document API", () => {
    const compatibilityFacades = new Set([
      fileURLToPath(new URL("../types/sigma-doc.ts", import.meta.url)),
      fileURLToPath(new URL("../lib/page-layout.ts", import.meta.url)),
      fileURLToPath(new URL("../lib/page-running-region-layout.ts", import.meta.url)),
      fileURLToPath(new URL("../lib/line-height.ts", import.meta.url)),
    ]);
    const legacyDocumentImports = new Set([
      "@/types/sigma-doc",
      "@/lib/page-layout",
      "@/lib/page-running-region-layout",
      "@/lib/line-height",
    ]);
    const files = productionSourceFiles(new URL("../", import.meta.url))
      .filter((file) => !compatibilityFacades.has(file));

    expect(invalidImports(
      files,
      (specifier) => legacyDocumentImports.has(specifier),
    )).toEqual([]);
  });
});
