/** Controls whether inline fractions keep TeX sizing or use display-style fractions. */
export type MathFractionSizing = "uniform" | "texDefault";

export interface SigmaMetadata {
  title: string;
  source?: SigmaDocumentSourceMetadata;
  styleUnits?: SigmaDocumentStyleUnits;
  mathFractionSizing?: MathFractionSizing;
  /** File-scoped TeX macro declarations used by MathLive, KaTeX, and print output. */
  texPreamble?: string;
}

export interface SigmaDocumentSourceMetadata {
  format?: "external-document" | "presentation";
  layoutMode?: "fixedOverlay";
  printFlowContent?: boolean;
  /** Import provenance. Descriptive only - never an input to layout or rendering. */
  originalFileName?: string;
  importedAt?: string;
  slideCount?: number;
  pageSize?: {
    widthPx?: number;
    heightPx?: number;
    widthMm?: number;
    heightMm?: number;
  };
}

export interface SigmaDocumentStyleUnits {
  fontSize?: "pt";
}
