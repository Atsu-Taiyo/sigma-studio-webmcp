import { createId } from "@/lib/id";

import type { OverlayAssetId, OverlayGroupId, OverlayRichTextDocument, OverlayShapeId } from "./types";

export function createOverlayShapeId(): OverlayShapeId {
  return createId("overlay_shape");
}

export function createOverlayAssetId(): OverlayAssetId {
  return createId("overlay_asset");
}

export function createOverlayGroupId(): OverlayGroupId {
  return createId("overlay_group");
}

export function toRichText(text: string): OverlayRichTextDocument {
  return {
    blocks: [
      {
        type: "paragraph",
        children: text ? [{ type: "text", text }] : [],
      },
    ],
  };
}
