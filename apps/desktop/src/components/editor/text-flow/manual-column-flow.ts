export interface ManualColumnFlowItemMeasurement {
  break: boolean;
  outerHeight: number;
}

/**
 * CSS multicol needs a constrained height for column-fill:auto to honor a
 * forced break without re-balancing earlier content into the following column.
 */
export function computeManualColumnFlowHeight(
  items: readonly ManualColumnFlowItemMeasurement[],
  columnCount: number,
): number | null {
  if (!items.some((item) => item.break)) {
    return null;
  }

  const normalizedColumnCount = Math.floor(columnCount);
  if (!Number.isFinite(normalizedColumnCount) || normalizedColumnCount < 1) {
    return null;
  }

  const segments: number[][] = [[]];
  for (const item of items) {
    if (item.break) {
      segments.push([]);
    }
    segments[segments.length - 1].push(Math.max(0, item.outerHeight));
  }
  if (segments.length > normalizedColumnCount) {
    return null;
  }

  const candidateHeights = new Set<number>([0]);
  for (const segment of segments) {
    for (let start = 0; start < segment.length; start += 1) {
      let height = 0;
      for (let end = start; end < segment.length; end += 1) {
        height += segment[end];
        candidateHeights.add(height);
      }
    }
  }

  const sortedCandidates = [...candidateHeights].sort((left, right) => left - right);
  let low = 0;
  let high = sortedCandidates.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (countRequiredColumns(segments, sortedCandidates[middle]) <= normalizedColumnCount) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  return sortedCandidates[low];
}

export function refreshManualColumnFlowHeights(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>(".sigma-doc-layout-section-body").forEach((body) => {
    const children = Array.from(body.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement,
    );
    const items = children.map((child) => {
      const style = getComputedStyle(child);
      return {
        // The marker is a widget sibling before the decorated target, so CSS
        // lays it out in the preceding column before break-before advances.
        break: child.classList.contains("manual-column-break-before"),
        outerHeight:
          child.getBoundingClientRect().height
          + parseCssLength(style.marginTop)
          + parseCssLength(style.marginBottom),
      };
    });
    const columnCount = parseColumnCount(
      getComputedStyle(body).getPropertyValue("--sigma-doc-local-column-count"),
    );
    const height = columnCount === null
      ? null
      : computeManualColumnFlowHeight(items, columnCount);

    if (height === null) {
      body.classList.remove("with-manual-column-flow");
      body.style.removeProperty("--sigma-doc-manual-column-height");
      return;
    }

    const roundedHeight = `${Math.max(1, Math.ceil(height))}px`;
    body.classList.add("with-manual-column-flow");
    if (body.style.getPropertyValue("--sigma-doc-manual-column-height") !== roundedHeight) {
      body.style.setProperty("--sigma-doc-manual-column-height", roundedHeight);
    }
  });
}

function parseCssLength(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseColumnCount(value: string): number | null {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return null;
  }
  return Math.floor(parsed);
}

function countRequiredColumns(segments: readonly (readonly number[])[], height: number): number {
  let columnCount = 0;
  for (const segment of segments) {
    columnCount += 1;
    let usedHeight = 0;
    for (const itemHeight of segment) {
      if (itemHeight > height) {
        return Number.POSITIVE_INFINITY;
      }
      if (usedHeight > 0 && usedHeight + itemHeight > height) {
        columnCount += 1;
        usedHeight = 0;
      }
      usedHeight += itemHeight;
    }
  }
  return columnCount;
}
