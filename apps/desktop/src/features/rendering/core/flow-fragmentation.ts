export interface FlowFragmentStepInput {
  available: number;
  breakOffsets?: number[];
  fullSegmentHeight: number;
  remaining: number;
  sourceOffsetY: number;
}

export interface FlowFragmentStep {
  advanceToNextSegment: boolean;
  height: number;
}

/**
 * Decide one page/column slice without knowing which visual box style produced
 * it. A measured break list is a hard safety contract: a slice ends only between
 * complete visual lines. The editor canvas and print renderer both use this
 * function so their continuation rules cannot drift apart.
 */
export function resolveFlowFragmentStep({
  available,
  breakOffsets,
  fullSegmentHeight,
  remaining,
  sourceOffsetY,
}: FlowFragmentStepInput): FlowFragmentStep {
  const rawHeight = Math.min(Math.max(1, available), remaining);

  if (remaining <= available + 0.5) {
    return { advanceToNextSegment: false, height: remaining };
  }

  // Without measured line boxes there is no trustworthy semantic boundary.
  // Retain the bounded pixel fallback for non-text/temporarily unmeasured DOM.
  if (!breakOffsets || breakOffsets.length === 0) {
    return { advanceToNextSegment: false, height: rawHeight };
  }

  const targetOffset = sourceOffsetY + rawHeight;
  const offsets = normalizeFlowFragmentBreakOffsets(breakOffsets, sourceOffsetY + remaining)
    .filter((offset) => offset > sourceOffsetY + 0.5);
  const fittingOffsets = offsets.filter((offset) => offset <= targetOffset + 0.5);
  let snappedOffset = fittingOffsets.at(-1);

  // Do not create a continuation containing only the closing border/padding.
  // Move the final visual line together with that trailing chrome instead.
  if (snappedOffset !== undefined) {
    const trailingHeight = sourceOffsetY + remaining - snappedOffset;
    const previousOffset = fittingOffsets.at(-2);
    if (trailingHeight > 0.5 && trailingHeight < 24) {
      if (
        previousOffset !== undefined
        && sourceOffsetY + remaining - previousOffset <= fullSegmentHeight + 0.5
      ) {
        snappedOffset = previousOffset;
      } else {
        // If there is no earlier safe line boundary, keep the closing chrome
        // with the intact last line rather than making a chrome-only page.
        return { advanceToNextSegment: false, height: remaining };
      }
    }
  }

  if (snappedOffset !== undefined) {
    return {
      advanceToNextSegment: false,
      height: Math.max(1, snappedOffset - sourceOffsetY),
    };
  }

  const nextSafeOffset = offsets[0];
  if (nextSafeOffset !== undefined) {
    const nextSafeHeight = nextSafeOffset - sourceOffsetY;
    if (available < fullSegmentHeight - 0.5 && nextSafeHeight <= fullSegmentHeight + 0.5) {
      return { advanceToNextSegment: true, height: 0 };
    }
    // A single visual line can itself be taller than a page/column. Keeping it
    // intact may overflow, but is preferable to cutting through the line.
    return { advanceToNextSegment: false, height: Math.max(1, nextSafeHeight) };
  }

  return { advanceToNextSegment: false, height: remaining };
}

function normalizeFlowFragmentBreakOffsets(offsets: number[], totalHeight: number): number[] {
  const normalized = offsets
    .filter((offset) => Number.isFinite(offset) && offset > 0.5 && offset < totalHeight - 0.5)
    .sort((left, right) => left - right);
  normalized.push(totalHeight);
  return Array.from(new Set(normalized.map((offset) => Math.round(offset * 100) / 100)));
}
