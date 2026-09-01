import type { SigmaDocument } from "@/features/document";

export const STUDYAID_IMPORT_AVAILABLE = false;
export const STUDYAID_IMPORT_ACCEPT = "";
export const DEFAULT_STUDYAID_IMPORT_FILENAME = "document.bin";

export class StudyAidPrtPasswordError extends Error {}

export function isStudyAidPrtFilename(_filename: string): boolean { return false; }
export function isStudyAidSprFilename(_filename: string): boolean { return false; }

export async function importStudyAidProtectedBuffer(
  _input: ArrayBuffer,
  _filename: string,
  _password: string,
): Promise<SigmaDocument> {
  throw new Error("このWeb版では、この形式のインポートを利用できません。");
}
