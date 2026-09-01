import type { SigmaDocument } from "@/features/document";
import type { AppLocale } from "@/lib/i18n";

export const POWERPOINT_IMPORT_ACCEPT = "";

export function isPowerPointPptxFilename(_filename: string): boolean { return false; }

export async function importPowerPointPptxBuffer(
  _input: ArrayBuffer,
  _filename: string,
  _options: { locale: AppLocale },
): Promise<SigmaDocument> {
  throw new Error("このWeb版では、この形式のインポートを利用できません。");
}
