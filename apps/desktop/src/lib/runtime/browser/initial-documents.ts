import type { SigmaDocument } from "@/features/document";
import { createId } from "@/lib/id";

import mathTestDocument from "./initial-documents/math-test-calculator-questions.sigmadoc.json";
import sigmaStudioBasicsDocument from "./initial-documents/sigma-studio-basics.sigmadoc.json";

const INITIAL_BROWSER_DOCUMENTS = [
  sigmaStudioBasicsDocument,
  mathTestDocument,
] as const;

/**
 * 空のブラウザ保管庫にだけ入れる初回教材。import した JSON を直接返すと編集時に
 * モジュール共有値を汚すため、インストールごとに複製して新しい docId を割り当てる。
 */
export function createInitialBrowserDocuments(now: string): SigmaDocument[] {
  return INITIAL_BROWSER_DOCUMENTS.map((source) => ({
    ...(structuredClone(source) as SigmaDocument),
    docId: createId("doc"),
    updatedAt: now,
  }));
}
