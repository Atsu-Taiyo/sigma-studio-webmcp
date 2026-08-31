import type { SigmaDocument } from "@/features/document";

export const EDITOR_MATH_IMPORT_AVAILABLE = false;
export const EDITOR_MATH_IMPORT_ACCEPT = "";
export const DEFAULT_EDITOR_MATH_IMPORT_FILENAME = "document.bin";

export class EditorMathPrtPasswordError extends Error {}

export function isEditorMathPrtFilename(_filename: string): boolean {
  return false;
}

export function isEditorMathSprFilename(_filename: string): boolean {
  return false;
}

export async function importEditorMathProtectedBuffer(
  _input: ArrayBuffer,
  _filename: string,
  _password: string,
): Promise<SigmaDocument> {
  throw new Error("このWeb版では、この形式のインポートを利用できません。");
}
