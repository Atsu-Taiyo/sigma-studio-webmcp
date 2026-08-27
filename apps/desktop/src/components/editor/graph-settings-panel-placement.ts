/**
 * グラフ設定パネルの配置計算。
 *
 * パネルはグラフを覆ってはならない（編集結果をリアルタイムに観察できることが目的）。
 * 右 → 左 → 下 の順に「グラフと交差しない置き場所」を探し、どこにも収まらないときだけ
 * viewport 端へ clamp する。DOM に触れない純粋関数にして単体テストで担保する。
 */

export interface GraphSettingsPanelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface GraphSettingsPanelSize {
  width: number;
  height: number;
}

export interface GraphSettingsPanelViewport {
  width: number;
  height: number;
}

export interface GraphSettingsPanelOffset {
  dx: number;
  dy: number;
}

export type GraphSettingsPanelSide = "right" | "left" | "below" | "clamped";

export interface GraphSettingsPanelPlacement {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  side: GraphSettingsPanelSide;
}

/** 幅は固定。`--graph-panel-width` と同じ値を保つこと。 */
export const GRAPH_SETTINGS_PANEL_WIDTH_PX = 300;
export const GRAPH_SETTINGS_PANEL_MARGIN_PX = 8;
export const GRAPH_SETTINGS_PANEL_GAP_PX = 12;

export function getGraphSettingsPanelPlacement(
  graphRect: GraphSettingsPanelRect,
  panelSize: GraphSettingsPanelSize,
  viewport: GraphSettingsPanelViewport,
  manualOffset: GraphSettingsPanelOffset | null,
): GraphSettingsPanelPlacement {
  const margin = GRAPH_SETTINGS_PANEL_MARGIN_PX;
  const gap = GRAPH_SETTINGS_PANEL_GAP_PX;
  const width = Math.min(
    Math.max(1, panelSize.width || GRAPH_SETTINGS_PANEL_WIDTH_PX),
    Math.max(1, viewport.width - margin * 2),
  );
  const maxHeight = Math.max(1, viewport.height - margin * 2);
  const height = Math.min(Math.max(1, panelSize.height), maxHeight);
  const graphRight = graphRect.left + graphRect.width;
  const graphBottom = graphRect.top + graphRect.height;

  const clampLeft = (value: number): number =>
    Math.max(margin, Math.min(value, viewport.width - margin - width));
  const clampTop = (value: number): number =>
    Math.max(margin, Math.min(value, viewport.height - margin - height));

  let side: GraphSettingsPanelSide;
  let left: number;
  let top: number;

  if (graphRight + gap + width <= viewport.width - margin) {
    side = "right";
    left = graphRight + gap;
    top = clampTop(graphRect.top);
  } else if (graphRect.left - gap - width >= margin) {
    side = "left";
    left = graphRect.left - gap - width;
    top = clampTop(graphRect.top);
  } else if (graphBottom + gap + height <= viewport.height - margin) {
    side = "below";
    left = clampLeft(graphRect.left);
    top = graphBottom + gap;
  } else {
    // どの側にも収まらない狭い viewport。グラフに重なるが、画面外へ出すよりはよい。
    side = "clamped";
    left = clampLeft(viewport.width - margin - width);
    top = clampTop(graphRect.top);
  }

  if (manualOffset) {
    // 自動配置を基準に移動量だけ足す。グラフが動いてもユーザーが決めた相対位置が残る。
    left += manualOffset.dx;
    top += manualOffset.dy;
  }

  return {
    left: clampLeft(left),
    top: clampTop(top),
    width,
    maxHeight,
    side,
  };
}
