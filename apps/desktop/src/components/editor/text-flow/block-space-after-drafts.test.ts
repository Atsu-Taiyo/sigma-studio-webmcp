import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearBlockSpaceAfterDrafts,
  getBlockSpaceAfterDrafts,
  setBlockSpaceAfterDraft,
  subscribeBlockSpaceAfterDrafts,
} from "./block-space-after-drafts";

afterEach(() => {
  clearBlockSpaceAfterDrafts();
});

describe("block space-after drafts", () => {
  it("starts empty", () => {
    expect(getBlockSpaceAfterDrafts()).toEqual({});
  });

  it("holds the block being dragged", () => {
    setBlockSpaceAfterDraft("p1", 24);

    expect(getBlockSpaceAfterDrafts()).toEqual({ p1: 24 });
  });

  it("holds only one block at a time (one pointer, one handle)", () => {
    setBlockSpaceAfterDraft("p1", 24);
    setBlockSpaceAfterDraft("p2", 8);

    expect(getBlockSpaceAfterDrafts()).toEqual({ p2: 8 });
  });

  it("notifies subscribers when the value moves", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeBlockSpaceAfterDrafts(listener);

    setBlockSpaceAfterDraft("p1", 24);
    setBlockSpaceAfterDraft("p1", 25);

    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("does not notify when the value is unchanged", () => {
    setBlockSpaceAfterDraft("p1", 24);
    const listener = vi.fn();
    const unsubscribe = subscribeBlockSpaceAfterDrafts(listener);

    setBlockSpaceAfterDraft("p1", 24);

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("notifies once on release and stays quiet afterwards", () => {
    setBlockSpaceAfterDraft("p1", 24);
    const listener = vi.fn();
    const unsubscribe = subscribeBlockSpaceAfterDrafts(listener);

    clearBlockSpaceAfterDrafts();
    clearBlockSpaceAfterDrafts();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getBlockSpaceAfterDrafts()).toEqual({});
    unsubscribe();
  });

  it("stops notifying an unsubscribed listener", () => {
    const listener = vi.fn();
    subscribeBlockSpaceAfterDrafts(listener)();

    setBlockSpaceAfterDraft("p1", 24);

    expect(listener).not.toHaveBeenCalled();
  });
});
