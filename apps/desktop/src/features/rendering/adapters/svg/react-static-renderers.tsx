import { renderToStaticMarkup } from "react-dom/server";

import {
  type OverlayAsset,
  type OverlayShape,
  type SigmaTableSpec,
  A4_PAGE_PX,
} from "@/features/document";

import {
  DEFAULT_MATH_RENDER_ENVIRONMENT,
  mathRenderEnvironmentCacheKey,
  type MathRenderEnvironment,
} from "@/lib/math-environment";

import { renderMathHtml } from "../math-html";
import { Graph2DPreview, MathEnvironmentValueProvider, OverlayTableStaticView } from "../react";
import {
  serializeOverlayPreviewSvg,
  serializeOverlaySvg,
  type OverlayCanvasSize,
  type OverlayPreviewSource,
  type OverlaySvgExportOptions,
  type OverlaySvgRenderers,
} from "./overlay-svg";

/**
 * Per-(table, geometry) memo for the table markup.
 *
 * Page previews re-serialize every off-screen page's overlay while the author types, and rendering
 * a table now goes through React instead of string concatenation — orders of magnitude more work
 * per call. Table specs are immutable snapshots in the overlay model, so keying on object identity
 * gets a high hit rate with no invalidation logic (same reasoning as `overlay-text-box.ts`).
 */
const tableHtmlCache = new WeakMap<SigmaTableSpec, Map<string, string>>();
/**
 * Resizing a shape keeps the table spec's identity and only changes the geometry, so the inner map
 * would otherwise grow by one multi-KB string per intermediate drag position.
 */
const TABLE_HTML_CACHE_GEOMETRIES = 8;

function renderTableHtmlMemoized(
  table: SigmaTableSpec,
  width: number,
  height: number,
  overflow: number,
  environment: MathRenderEnvironment,
): string {
  let cached = tableHtmlCache.get(table);
  if (!cached) {
    cached = new Map();
    tableHtmlCache.set(table, cached);
  }
  // セル内の数式は描画環境で変わるので、幾何だけでなく環境もキーに含める。
  const key = mathRenderEnvironmentCacheKey(environment, `${width}x${height}x${overflow}`);
  const hit = cached.get(key);
  if (hit !== undefined) {
    return hit;
  }

  const html = toXmlAttributeCasing(renderToStaticMarkup(
    <MathEnvironmentValueProvider environment={environment}>
      <OverlayTableStaticView
        height={height}
        overflow={overflow}
        selfContained
        table={table}
        width={width}
        xmlns="http://www.w3.org/1999/xhtml"
      />
    </MathEnvironmentValueProvider>,
  ));
  if (cached.size >= TABLE_HTML_CACHE_GEOMETRIES) {
    cached.delete(cached.keys().next().value as string);
  }
  cached.set(key, html);
  return html;
}

/**
 * React writes `rowSpan`/`colSpan` with their DOM-property casing, which an HTML parser folds to
 * lowercase — but this markup also travels as XML: `AiEditPanel` turns the exported SVG into an
 * `image/svg+xml` data URI and rasterises it. XML attribute matching is case-sensitive, so the
 * camelCase form is simply ignored there and every merged cell collapses to a single column.
 *
 * The component keeps the React props (spelling them lowercase there makes React log an
 * "Invalid DOM property" warning once the editor mounts it), so the serialized form is fixed up
 * here, where the XML requirement actually comes from.
 */
function toXmlAttributeCasing(html: string): string {
  // Bounded to the `<td>` tag opener: cell text and `data-tex` values travel in the same string.
  return html.replace(/<td\b[^>]*>/g, (tag) => (
    tag.replace(/ (rowSpan|colSpan)=/g, (_, name: string) => ` ${name.toLowerCase()}=`)
  ));
}

/**
 * 書き出し面の追加オプション。`OverlaySvgExportOptions` (シリアライザ側の型) は `@/lib` を
 * import できない headless な層にあるので、描画環境はこの React 束縛側で足す。
 */
export interface OverlaySvgRenderOptions extends OverlaySvgExportOptions {
  /**
   * 図形テキスト・表セル・グラフラベルの数式を描く環境 (前文マクロ + 組版スタイル)。
   * 省略すると既定環境になるので、**文書を書き出す面は必ず渡すこと**
   * (渡さないと印刷/PDF/SVG の数式だけ前文マクロが効かず、組版も本文と食い違う)。
   */
  mathEnvironment?: MathRenderEnvironment;
}

/**
 * 書き出し用のレンダラ束。**描画環境ごとに作る** — モジュール定数のままだと前文マクロも
 * 組版スタイルも既定に固定され、印刷/PDF/SVG の図形テキストだけが本文と違う組版になる。
 */
function createStaticReactRenderers(environment: MathRenderEnvironment): OverlaySvgRenderers {
  return {
    renderGraphHtml: (spec, idSeed) => renderToStaticMarkup(
      <MathEnvironmentValueProvider environment={environment}>
        <Graph2DPreview idSeed={idSeed} spec={spec} staticMode />
      </MathEnvironmentValueProvider>,
    ),
    renderMathHtml: (tex) => renderMathHtml(tex, environment),
    renderTableHtml: (table, width, height, overflow) => (
      renderTableHtmlMemoized(table, width, height, overflow, environment)
    ),
  };
}

export function exportOverlaySvg(
  shapes: OverlayShape[],
  assets: Record<string, OverlayAsset>,
  size: OverlayCanvasSize = A4_PAGE_PX,
  options: OverlaySvgRenderOptions = {},
): string | undefined {
  return serializeOverlaySvg(
    shapes,
    assets,
    size,
    createStaticReactRenderers(options.mathEnvironment ?? DEFAULT_MATH_RENDER_ENVIRONMENT),
    options,
  );
}

export function getOverlayPreviewSvg(
  overlay?: OverlayPreviewSource,
  size: OverlayCanvasSize = A4_PAGE_PX,
  options: OverlaySvgRenderOptions = {},
): string | undefined {
  return serializeOverlayPreviewSvg(
    overlay,
    size,
    createStaticReactRenderers(options.mathEnvironment ?? DEFAULT_MATH_RENDER_ENVIRONMENT),
    options,
  );
}
