import { afterEach, describe, expect, it, vi } from "vitest";

import { getAppRouteHref } from "@/lib/app-navigation";

describe("app navigation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves editor links to static files when the app runs from file URLs", () => {
    vi.stubGlobal("window", {
      location: {
        href: "file:///Applications/Sigma%20Studio.app/Contents/Resources/app.asar/out/workspace.html",
        protocol: "file:",
      },
    });

    expect(getAppRouteHref("/", { fileId: "file_1" })).toBe("file:///Applications/Sigma%20Studio.app/Contents/Resources/app.asar/out/index.html?fileId=file_1");
  });
});
