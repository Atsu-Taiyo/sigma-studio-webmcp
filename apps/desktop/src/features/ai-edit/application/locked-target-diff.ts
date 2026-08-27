import type { OverlayShape, SigmaDocument } from "@/features/document";
import { findBlock } from "@/lib/document-tree";

import type { AiLockedTargets } from "./locked-targets";

/**
 * SigmaDoc-level counterpart to the ProseMirror `filterTransaction` guard in
 * edit-guard-extension.ts: given a proposed whole-document replacement, report
 * which AI-locked targets it would alter.
 *
 * This exists so the single mutation choke point (`commitDocumentChange`) can
 * refuse exactly the changes that collide with a live run or a pending
 * proposal, instead of refusing every change while AI is busy. It is the
 * backstop for every surface the PM guard cannot see -- overlay drags/resizes,
 * block moves and deletions, table and graph edits, undo/redo -- so a missing
 * `disabled` prop somewhere can never silently overwrite AI's target.
 *
 * Deliberately NOT flagged as touched:
 * - A locked block that only moved. Approval replays operations by targetId, so
 *   a relocated block with identical content still applies correctly. Reorders
 *   inside the body editor are already refused by the PM guard, which owns the
 *   neighbour comparison for the surface where block dragging happens.
 * - A locked id absent from `before`. There is nothing to protect yet, matching
 *   `findTouchedGuardedBlockIds`'s `if (!oldNode) continue`.
 */
export interface AiLockedTargetsTouched {
  blockIds: string[];
  shapeIds: string[];
}

export const NO_AI_LOCKED_TARGETS_TOUCHED: AiLockedTargetsTouched = { blockIds: [], shapeIds: [] };

export function findAiLockedTargetsTouched(
  before: SigmaDocument,
  after: SigmaDocument,
  locked: AiLockedTargets,
): AiLockedTargetsTouched {
  if (before === after || (locked.blockIds.size === 0 && locked.shapeIds.size === 0)) {
    return NO_AI_LOCKED_TARGETS_TOUCHED;
  }

  const blockIds: string[] = [];
  for (const blockId of locked.blockIds) {
    const previous = findBlock(before, blockId);
    if (!previous) {
      continue;
    }
    if (hasChanged(previous, findBlock(after, blockId))) {
      blockIds.push(blockId);
    }
  }

  const shapeIds: string[] = [];
  if (locked.shapeIds.size > 0) {
    const previousShapes = indexShapesById(before);
    const nextShapes = indexShapesById(after);
    for (const shapeId of locked.shapeIds) {
      const previous = previousShapes.get(shapeId);
      if (!previous) {
        continue;
      }
      if (hasChanged(previous, nextShapes.get(shapeId))) {
        shapeIds.push(shapeId);
      }
    }
  }

  return { blockIds, shapeIds };
}

export function hasAiLockedTargetsTouched(touched: AiLockedTargetsTouched): boolean {
  return touched.blockIds.length > 0 || touched.shapeIds.length > 0;
}

/**
 * Deletion, or a real content difference. The reference check short-circuits the
 * common case: SigmaDoc updates are immutable, so an untouched block or shape is
 * usually still the very same object even when its parent array was rebuilt.
 * Only when references differ do we pay for a structural compare -- and the
 * locked set is a handful of ids, never the whole document.
 */
function hasChanged(previous: unknown, next: unknown): boolean {
  if (next === undefined || next === null) {
    return true;
  }
  return !deepEquals(previous, next);
}

/**
 * Order-insensitive for object keys, order-sensitive for arrays.
 *
 * Key order matters here: a body edit commits blocks that were round-tripped
 * through Tiptap (textFlowToTiptap → tiptapToTextFlow), which rebuilds every
 * block in the edited flow and can emit the same fields in a different order
 * (`{id, type, children}` becoming `{type, id, children}`). A JSON.stringify
 * comparison would read that as a change and refuse an edit to an entirely
 * different block, so the equality must look at structure rather than encoding.
 * Array order, by contrast, is real content -- the sequence of inline children.
 */
function deepEquals(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((item, index) => deepEquals(item, b[index]));
  }
  const previous = a as Record<string, unknown>;
  const next = b as Record<string, unknown>;
  // Ignore keys explicitly set to undefined so an absent field and an
  // undefined field compare equal, the way JSON persistence already treats them.
  const previousKeys = Object.keys(previous).filter((key) => previous[key] !== undefined);
  const nextKeys = Object.keys(next).filter((key) => next[key] !== undefined);
  if (previousKeys.length !== nextKeys.length) {
    return false;
  }
  return previousKeys.every((key) => (
    Object.prototype.hasOwnProperty.call(next, key) && deepEquals(previous[key], next[key])
  ));
}

function indexShapesById(document: SigmaDocument): Map<string, OverlayShape> {
  const shapes = document.pageLayout?.overlay?.overlaySnapshot?.shapes ?? [];
  return new Map(shapes.map((shape) => [shape.id, shape]));
}
