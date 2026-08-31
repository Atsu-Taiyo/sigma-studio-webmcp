import type {
  Graph3DAxisColors,
  Graph3DCamera,
  Graph3DSpec,
} from "@/features/document";

const AXIS_LABEL_DISTANCE = 3.3;

export interface Graph3DDisplayAnnotation {
  id: string;
  position: { x: number; y: number; z: number };
  labelTex: string;
  color?: string;
}

export type ResolvedGraph3DAnnotation =
  | {
      id: string;
      kind: "label";
      position: { x: number; y: number; z: number };
      labelTex: string;
      color?: string;
    }
  | {
      id: string;
      kind: "dimension";
      from: { x: number; y: number; z: number };
      to: { x: number; y: number; z: number };
      labelTex: string;
      color?: string;
    };

/** Builds the common live/static/print label layer from resolved scene annotations. */
export function createGraph3DDisplayAnnotations(
  spec: Pick<Graph3DSpec, "view">,
  annotations: readonly ResolvedGraph3DAnnotation[],
  axisColors: Graph3DAxisColors,
): Graph3DDisplayAnnotation[] {
  const authored = annotations.map((annotation) => ({
    id: annotation.id,
    position: annotation.kind === "label"
      ? annotation.position
      : {
          x: (annotation.from.x + annotation.to.x) / 2,
          y: (annotation.from.y + annotation.to.y) / 2,
          z: (annotation.from.z + annotation.to.z) / 2,
        },
    labelTex: annotation.labelTex,
    ...(annotation.color ? { color: annotation.color } : {}),
  }));
  if (!spec.view.showAxes || spec.view.showAxisLabels === false) return authored;
  return [
    ...authored,
    { id: "axis-x", position: { x: AXIS_LABEL_DISTANCE, y: 0, z: 0 }, labelTex: "x", color: axisColors.x },
    { id: "axis-y", position: { x: 0, y: AXIS_LABEL_DISTANCE, z: 0 }, labelTex: "y", color: axisColors.y },
    { id: "axis-z", position: { x: 0, y: 0, z: AXIS_LABEL_DISTANCE }, labelTex: "z", color: axisColors.z },
  ];
}

/** Projects a mathematical z-up point into the authored 3D viewport. */
export function projectGraph3DLabel(
  point: { x: number; y: number; z: number },
  camera: Graph3DCamera,
  width: number,
  height: number,
): { x: number; y: number } | null {
  const forward = normalize3(subtract3(camera.target, camera.position));
  if (!forward) return null;
  const right = normalize3(cross3(forward, camera.up));
  if (!right) return null;
  const screenUp = normalize3(cross3(right, forward));
  if (!screenUp) return null;
  const relative = subtract3(point, camera.position);
  const depth = dot3(relative, forward);
  if (!(depth > 0.01)) return null;
  const aspect = Math.max(1e-6, width / Math.max(1, height));
  let ndcX: number;
  let ndcY: number;
  if (camera.projection === "orthographic") {
    const halfHeight = 3 / Math.max(1e-6, camera.zoom ?? 1);
    ndcX = dot3(relative, right) / (halfHeight * aspect);
    ndcY = dot3(relative, screenUp) / halfHeight;
  } else {
    const halfHeight = Math.tan(((camera.fov ?? 45) * Math.PI) / 360) * depth;
    ndcX = dot3(relative, right) / (halfHeight * aspect);
    ndcY = dot3(relative, screenUp) / halfHeight;
  }
  if (!Number.isFinite(ndcX) || !Number.isFinite(ndcY)) return null;
  return {
    x: (ndcX * 0.5 + 0.5) * width,
    y: (-ndcY * 0.5 + 0.5) * height,
  };
}

function subtract3(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function normalize3(vector: { x: number; y: number; z: number }) {
  const magnitude = Math.hypot(vector.x, vector.y, vector.z);
  return magnitude > 1e-9
    ? { x: vector.x / magnitude, y: vector.y / magnitude, z: vector.z / magnitude }
    : null;
}
