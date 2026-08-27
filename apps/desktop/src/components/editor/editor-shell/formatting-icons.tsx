import { Check } from "lucide-react";
import { useRef } from "react";

import { EditorToolbarMenuButton } from "@/components/editor/EditorToolbar";
import { useT } from "@/lib/i18n/react";
import { ToolbarPopover } from "@/components/editor/ToolbarPopover";
import type { OverlayArrowhead } from "@/components/editor/overlay-canvas/types";
import type { BoxedVariant } from "@/features/document";
import {
  arrowheadPathData,
  getArrowheadMarkerSpec,
  getArrowheadTrimInStrokes,
  scaleArrowheadGeometry,
} from "@/features/rendering/core";
import { LINE_ENDPOINT_OPTIONS, MAX_EXPORT_FILE_STEM_LENGTH } from "./constants";

export function LineEndpointMenuButton({
  endpoint,
  currentValue,
  open,
  disabled = false,
  onToggle,
  onSelect,
}: {
  endpoint: "start" | "end";
  currentValue: OverlayArrowhead | null;
  open: boolean;
  disabled?: boolean;
  onToggle: () => void;
  onSelect: (value: OverlayArrowhead) => void;
}) {
  const t = useT("chrome");
  const previewStart = endpoint === "start" ? (currentValue ?? "none") : "none";
  const previewEnd = endpoint === "end" ? (currentValue ?? "none") : "none";
  const endpointLabel = endpoint === "start" ? t("format.lineEndpoint.start") : t("format.lineEndpoint.end");
  const currentOption = LINE_ENDPOINT_OPTIONS.find((option) => option.value === currentValue);
  const currentLabel = currentOption
    ? t(`format.lineEndpoint.${currentOption.value}`)
    : t("format.mixed");
  const buttonLabel = t("format.currentValue", { label: endpointLabel, value: currentLabel });
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  return (
    <div className="shape-menu-anchor">
      <EditorToolbarMenuButton
        buttonRef={buttonRef}
        variant="lineEndpoint"
        active={open}
        tooltip={{ label: t("format.lineEndpoint.tooltip", { endpoint: endpointLabel, value: currentLabel }) }}
        aria-label={buttonLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={onToggle}
      >
        <LineEndpointPreview start={previewStart} end={previewEnd} focus={endpoint} />
      </EditorToolbarMenuButton>
      <ToolbarPopover
        open={open}
        anchorRef={buttonRef}
        onClose={onToggle}
        className="shape-menu endpoint-menu"
        role="menu"
        ariaLabel={endpointLabel}
      >
        <div className="endpoint-menu-header" aria-hidden="true">{endpointLabel}</div>
        {LINE_ENDPOINT_OPTIONS.map((option) => {
          const optionLabel = t(`format.lineEndpoint.${option.value}`);
          const selected = currentValue === option.value;
          const optionStart = endpoint === "start" ? option.value : "none";
          const optionEnd = endpoint === "end" ? option.value : "none";
          return (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-label={optionLabel}
              aria-checked={selected}
              className={selected ? "selected" : ""}
              onClick={() => onSelect(option.value)}
            >
              <span className="endpoint-menu-check" aria-hidden="true">{selected ? <Check size={14} /> : null}</span>
              <LineEndpointPreview start={optionStart} end={optionEnd} focus={endpoint} size="menu" />
              <span>{optionLabel}</span>
            </button>
          );
        })}
      </ToolbarPopover>
    </div>
  );
}

/** Exported for `arrowhead-parity.test.ts`: the preview is the third drawing of the same table. */
export function LineEndpointPreview({
  start,
  end,
  focus,
  size = "toolbar",
}: {
  start: OverlayArrowhead;
  end: OverlayArrowhead;
  focus?: "start" | "end";
  size?: "toolbar" | "menu";
}) {
  const showStartCue = focus === "start" && start === "none";
  const showEndCue = focus === "end" && end === "none";
  const metrics = size === "menu"
    ? {
        width: 64,
        height: 24,
        startX: 9,
        endX: 55,
        y: 12,
        // Marker units are stroke widths. A faithful ratio against this 2.4px line would put a bar
        // right through the top of the preview, so the heads are scaled down as a set — their
        // proportions to each other stay exactly as they will be on the page.
        markerScale: 1.5,
        cueRadius: 2.5,
      }
    : {
        width: 32,
        height: 16,
        startX: 7,
        endX: 25,
        y: 8,
        markerScale: 0.85,
        cueRadius: 1.7,
      };

  // The page pulls the line back so the head's point can sit on the endpoint; the preview has to do
  // the same or the menu promises a different drawing than the one the canvas produces.
  const startTrim = getArrowheadTrimInStrokes(start) * metrics.markerScale;
  const endTrim = getArrowheadTrimInStrokes(end) * metrics.markerScale;

  return (
    <svg
      className={`line-endpoint-preview line-endpoint-preview-${size}`}
      viewBox={`0 0 ${metrics.width} ${metrics.height}`}
      width={metrics.width}
      height={metrics.height}
      aria-hidden="true"
    >
      <line x1={metrics.startX + startTrim} y1={metrics.y} x2={metrics.endX - endTrim} y2={metrics.y} />
      {showStartCue ? (
        <circle className="endpoint-side-cue" cx={metrics.startX} cy={metrics.y} r={metrics.cueRadius} />
      ) : null}
      {showEndCue ? (
        <circle className="endpoint-side-cue" cx={metrics.endX} cy={metrics.y} r={metrics.cueRadius} />
      ) : null}
      <EndpointMark kind={start} x={metrics.startX} y={metrics.y} direction="start" scale={metrics.markerScale} />
      <EndpointMark kind={end} x={metrics.endX} y={metrics.y} direction="end" scale={metrics.markerScale} />
    </svg>
  );
}

/**
 * One endpoint decoration in the toolbar and in the picker.
 *
 * The outline comes from `ARROWHEAD_MARKER_SPECS` — the table the canvas and the SVG exporter also
 * read — so the preview cannot promise a shape the page will not draw, and
 * `scaleArrowheadGeometry` anchors the head on `tipX` and mirrors a start head the way
 * `orient="auto-start-reverse"` does on a real marker, so the head sits at the end of the preview
 * line the way it sits on a stored endpoint. The size and the line weight stay the preview's own:
 * at this scale a faithful weight would be under a pixel — which also means an open head's miter,
 * and so its very tip, is drawn at the preview's weight rather than the page's. The couple of
 * pixels that costs are why this is a preview and not a measurement.
 */
function EndpointMark({
  kind,
  x,
  y,
  direction,
  scale,
}: {
  kind: OverlayArrowhead;
  x: number;
  y: number;
  direction: "start" | "end";
  scale: number;
}) {
  const spec = getArrowheadMarkerSpec(kind);
  if (!spec) {
    return null;
  }

  const geometry = scaleArrowheadGeometry(spec, scale, direction === "start" && spec.reversibleOrient);
  if (geometry.kind === "circle") {
    return <circle cx={x + geometry.cx} cy={y + geometry.cy} r={geometry.r} />;
  }
  return (
    <path
      className={geometry.filled ? "endpoint-mark-filled" : undefined}
      d={arrowheadPathData({
        ...geometry,
        points: geometry.points.map((point) => ({ x: x + point.x, y: y + point.y })),
      })}
    />
  );
}

export function BoxedTextIcon() {
  return (
    <span className="boxed-text-icon" aria-hidden="true">
      A
    </span>
  );
}

export function BoxedTextStylePreview({ variant }: { variant: BoxedVariant }) {
  return (
    <span className={`boxed-text-style-preview boxed-text-style-preview-${variant}`} aria-hidden="true">
      A
    </span>
  );
}

export function suggestedPdfFileName(title: string): string {
  const stem = title
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, MAX_EXPORT_FILE_STEM_LENGTH)
    .trim() || "lesson";
  return `${stem}.pdf`;
}
