import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, expectTypeOf, it } from "vitest";

import {
  convertBlockStyle as publicConvertBlockStyle,
  resolveTextFlowBoundaryDelete as publicResolveTextFlowBoundaryDelete,
  type BlockStyleTarget,
} from ".";
import {
  convertBlockStyle as legacyConvertBlockStyle,
} from "@/components/editor/editor-shell/block-style";
import {
  resolveTextFlowBoundaryDelete as legacyResolveTextFlowBoundaryDelete,
} from "@/components/editor/page-canvas/text-flow-boundary";

function productionSourceFiles(directory: URL): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryUrl = new URL(entry.name, directory);
    if (entry.isDirectory()) {
      return productionSourceFiles(new URL(`${entry.name}/`, directory));
    }
    return entry.isFile() && /\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")
      ? [fileURLToPath(entryUrl)]
      : [];
  });
}

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/(?:\bfrom\s+|\bimport\s*(?:\(\s*)?)["']([^"']+)["']/g)]
    .map((match) => match[1]);
}

describe("text-editing feature dependency boundary", () => {
  it("keeps its headless model independent from editor and framework adapters", () => {
    const invalidImports = productionSourceFiles(new URL("./", import.meta.url)).flatMap((file) => (
      importSpecifiers(readFileSync(file, "utf8"))
        .filter((specifier) => (
          specifier.startsWith("@/components/") ||
          specifier === "@/types/sigma-doc" ||
          specifier.startsWith("@/features/ai-edit") ||
          specifier.startsWith("@/lib/ai") ||
          specifier.startsWith("@tiptap/") ||
          specifier === "react" ||
          specifier.startsWith("react/")
        ))
        .map((specifier) => ({ file, specifier }))
    ));

    expect(invalidImports).toEqual([]);
  });

  it("uses canonical document comment types", () => {
    const model = readFileSync(fileURLToPath(new URL(
      "./external-text-range-highlight.ts",
      import.meta.url,
    )), "utf8");

    expect(model).toContain('from "@/features/document"');
    expect(model).not.toContain("@/types/sigma-doc");
  });

  it("keeps body block operations in the pure model and on canonical document types", () => {
    for (const fileName of [
      "./model/body-block-model.ts",
      "./model/block-model.ts",
      "./model/block-sync.ts",
      "./model/caret-address.ts",
      "./model/text-flow-types.ts",
    ]) {
      const model = readFileSync(fileURLToPath(new URL(
        fileName,
        import.meta.url,
      )), "utf8");

      expect(model).toContain('from "@/features/document"');
      expect(model).not.toContain("@/types/sigma-doc");
      expect(model).not.toContain("@/components/");
      expect(model).not.toContain("@/lib/");
      expect(model).not.toContain("react");
      expect(model).not.toContain("@tiptap/");
    }
  });

  it("owns block style conversion in the canonical headless model", () => {
    const model = readFileSync(fileURLToPath(new URL(
      "./model/block-style.ts",
      import.meta.url,
    )), "utf8");
    const legacyFacade = readFileSync(fileURLToPath(new URL(
      "../../components/editor/editor-shell/block-style.ts",
      import.meta.url,
    )), "utf8");
    const editorShell = readFileSync(fileURLToPath(new URL(
      "../../components/editor/EditorShell.tsx",
      import.meta.url,
    )), "utf8");

    expect(importSpecifiers(model)).toEqual(["@/features/document"]);
    expect(model).not.toContain("@/lib/document-tree");
    expect(model).not.toContain("@/types/sigma-doc");
    expect(model).not.toContain("@/components/");
    expect(model).not.toContain("react");
    expect(importSpecifiers(legacyFacade)).toEqual(["@/features/text-editing"]);
    expect(legacyFacade).not.toMatch(/\b(?:function|const|let|class)\b/);
    expect(legacyConvertBlockStyle).toBe(publicConvertBlockStyle);
    expectTypeOf(publicConvertBlockStyle)
      .parameter(0)
      .toEqualTypeOf<BlockStyleTarget>();
    expectTypeOf(publicConvertBlockStyle)
      .returns
      .toEqualTypeOf<BlockStyleTarget>();
    expect(editorShell).toContain("convertBlockStyle,");
    expect(editorShell).not.toContain(
      "@/components/editor/editor-shell/block-style",
    );
  });

  it("owns document text-flow reconciliation behind the public feature boundary", () => {
    const application = readFileSync(fileURLToPath(new URL(
      "./application/document-text-flow.ts",
      import.meta.url,
    )), "utf8");
    const legacyHelpers = readFileSync(fileURLToPath(new URL(
      "../../components/editor/editor-shell/document-helpers.ts",
      import.meta.url,
    )), "utf8");
    const editorShell = readFileSync(fileURLToPath(new URL(
      "../../components/editor/EditorShell.tsx",
      import.meta.url,
    )), "utf8");

    expect(application).toContain('from "@/features/document"');
    expect(application).not.toContain("@/types/sigma-doc");
    expect(application).not.toContain("@/components/");
    expect(application).not.toContain("@/lib/id");
    expect(legacyHelpers).not.toContain("@/components/editor/TextFlowEditor");
    expect(legacyHelpers).not.toMatch(/\bfunction\s+insertTopLevelTextFlowBlocks\b/);
    expect(legacyHelpers).not.toMatch(/\bfunction\s+isClipboardTextFlowBlock\b/);
    expect(legacyHelpers).not.toMatch(/\bfunction\s+replaceTopLevelTextFlowBlocks\b/);
    expect(editorShell).toContain('from "@/features/text-editing"');
    expect(editorShell).not.toContain('from "@/components/editor/TextFlowEditor"');
  });

  it("owns document search and text mutations behind the public feature boundary", () => {
    const searchModel = readFileSync(fileURLToPath(new URL(
      "./model/document-search.ts",
      import.meta.url,
    )), "utf8");
    const mutationApplication = readFileSync(fileURLToPath(new URL(
      "./application/document-text-mutations.ts",
      import.meta.url,
    )), "utf8");
    const legacyFacade = readFileSync(fileURLToPath(new URL(
      "../../components/editor/editor-shell/search.ts",
      import.meta.url,
    )), "utf8");
    const editorShell = readFileSync(fileURLToPath(new URL(
      "../../components/editor/EditorShell.tsx",
      import.meta.url,
    )), "utf8");

    for (const source of [searchModel, mutationApplication]) {
      expect(source).toContain('from "@/features/document"');
      expect(source).not.toContain("@/types/sigma-doc");
      expect(source).not.toContain("@/components/");
      expect(source).not.toContain("@/lib/");
      expect(source).not.toContain("@tiptap/");
      expect(source).not.toContain("react");
    }
    expect(importSpecifiers(legacyFacade)).toEqual(["@/features/text-editing"]);
    expect(legacyFacade).not.toMatch(/\b(?:function|const|let|class)\b/);
    expect(editorShell).toContain('from "@/features/text-editing"');
    expect(editorShell).not.toContain("@/components/editor/editor-shell/search");
  });

  it("keeps PageCanvas as a consumer of the public text-editing feature", () => {
    const pageCanvas = readFileSync(fileURLToPath(new URL(
      "../../components/editor/PageCanvasEditor.tsx",
      import.meta.url,
    )), "utf8");

    expect(pageCanvas).toContain('from "@/features/text-editing"');
    expect(pageCanvas).not.toContain('from "./text-flow/block-model"');
    expect(pageCanvas).not.toContain('from "./text-flow/types"');
    expect(pageCanvas).not.toMatch(/\bfunction\s+bodyTextFlowBlockContainsId\b/);
    expect(pageCanvas).not.toMatch(/\bfunction\s+getPageBreakBeforeIds\b/);
    expect(pageCanvas).not.toMatch(/\bfunction\s+getProblemNumberFontSize\b/);
    expect(pageCanvas).not.toMatch(/\bfunction\s+isBodyContextMenuBlock\b/);
    expect(pageCanvas).not.toMatch(/\bfunction\s+isColumnWrapTargetBlock\b/);
    expect(pageCanvas).not.toMatch(/\bfunction\s+isProblemAreaKind\b/);
    expect(pageCanvas).not.toMatch(/\bfunction\s+setLayoutSectionColumnCount\b/);
    expect(pageCanvas).not.toMatch(/\bfunction\s+setBlockBreakBefore\b/);
    expect(pageCanvas).not.toMatch(/\bfunction\s+findTopLevelBlock\b/);
    expect(pageCanvas).not.toMatch(/\bfunction\s+collectBoxBlocksById\b/);
    expect(pageCanvas).not.toMatch(/\bfunction\s+getNextTopLevelTextFlowBlockId\b/);
    expect(pageCanvas).not.toContain('from "./page-canvas/text-flow-boundary"');
    expect(pageCanvas).not.toMatch(/\bfunction\s+resolveTextFlowBoundaryDelete\b/);
  });

  it("keeps the legacy page-canvas boundary path as an identity-preserving facade", () => {
    const facade = readFileSync(fileURLToPath(new URL(
      "../../components/editor/page-canvas/text-flow-boundary.ts",
      import.meta.url,
    )), "utf8");

    expect(importSpecifiers(facade)).toEqual(["@/features/text-editing"]);
    expect(facade).not.toMatch(/\b(?:function|const|let|class)\b/);
    expect(legacyResolveTextFlowBoundaryDelete).toBe(
      publicResolveTextFlowBoundaryDelete,
    );
  });

  it("keeps the Tiptap extension as an adapter over the public feature", () => {
    const adapter = readFileSync(fileURLToPath(new URL(
      "../../components/tiptap/external-text-range-highlight-extension.ts",
      import.meta.url,
    )), "utf8");

    expect(adapter).toContain('from "@/features/text-editing"');
    expect(adapter).not.toMatch(/\bfunction\s+getTextRangeForBlock\b/);
    expect(adapter).not.toMatch(/\bfunction\s+getOrderedTextRange\b/);
  });

  it("keeps TextFlowEditor and its Tiptap adapter on the public feature API", () => {
    const editor = readFileSync(fileURLToPath(new URL(
      "../../components/editor/TextFlowEditor.tsx",
      import.meta.url,
    )), "utf8");
    const adapter = readFileSync(fileURLToPath(new URL(
      "../../components/editor/text-flow/tiptap-document-adapter.ts",
      import.meta.url,
    )), "utf8");

    expect(editor).toContain('from "@/features/text-editing"');
    expect(editor).not.toContain('from "./text-flow/block-model"');
    expect(editor).not.toContain('from "./text-flow/block-sync"');
    expect(editor).not.toContain('from "./text-flow/manual-page-break"');
    expect(editor).not.toContain('from "./text-flow/normalization"');
    expect(adapter).toContain('from "@/features/text-editing"');
    expect(adapter).not.toContain('from "./block-model"');
    expect(adapter).not.toContain('from "./normalization"');
  });

  it("owns command querying and editor synchronization keys in the headless model", () => {
    const commandQuery = readFileSync(fileURLToPath(new URL(
      "./model/command-query.ts",
      import.meta.url,
    )), "utf8");
    const blockSync = readFileSync(fileURLToPath(new URL(
      "./model/block-sync.ts",
      import.meta.url,
    )), "utf8");
    const editor = readFileSync(fileURLToPath(new URL(
      "../../components/editor/TextFlowEditor.tsx",
      import.meta.url,
    )), "utf8");

    expect(importSpecifiers(commandQuery)).toEqual([]);
    expect(commandQuery).not.toContain("BUILTIN_BOX_STYLES");
    expect(commandQuery).not.toContain("MaterialItem");
    expect(commandQuery).not.toContain("@tiptap/");
    expect(commandQuery).not.toContain("react");
    expect(blockSync).toMatch(/\bexport function areTextFlowBlockIdSequencesEqual\b/);
    expect(blockSync).toMatch(/\bexport function getTextFlowBreakGapSyncKey\b/);
    expect(blockSync).toMatch(/\bexport function getTextFlowColumnLayoutsSyncKey\b/);
    expect(blockSync).toMatch(/\bexport function getTextFlowFragmentLayoutsSyncKey\b/);

    // 箱コマンドの一覧は `t` で解決するので module 直下の定数ではなく関数で作る
    // (module 直下だと起動時の言語で焼き付く)。ここが見たいのは「本文編集面が
    // headless のフィルタを使っていること」なので、その呼び出しだけを固定する。
    expect(editor).toContain("filterTextFlowCommandDefinitions(buildBoxCommandDefinitions(t)");
    expect(editor).toContain("parseTextFlowCommandTrigger(beforeCursor)");
    expect(editor).toContain("areTextFlowBlockIdSequencesEqual(");
    expect(editor).toContain("getTextFlowBreakGapSyncKey(");
    expect(editor).toContain("getTextFlowColumnLayoutsSyncKey(");
    expect(editor).toContain("getTextFlowFragmentLayoutsSyncKey(");
    expect(editor).not.toMatch(/\bfunction\s+getSlashCommandTriggerQueryFromText\b/);
    expect(editor).not.toMatch(/\bfunction\s+filterBoxCommandCandidates\b/);
    expect(editor).not.toMatch(/\bfunction\s+sameStringArray\b/);
    expect(editor).not.toMatch(/\bfunction\s+numberRecordSyncKey\b/);
    expect(editor).not.toMatch(/\bfunction\s+columnFlowBlockLayoutsSyncKey\b/);
    expect(editor).not.toMatch(/\bfunction\s+boxFragmentSourceLayoutsSyncKey\b/);
  });
});
