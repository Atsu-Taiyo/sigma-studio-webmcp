import { validateLatex } from "mathlive";
import { describe, expect, it, vi } from "vitest";

import {
  STUDYAID_MATH_SHORTCUTS,
  getStudyAidMathShortcut,
  handleStudyAidMathShortcut,
  isStudyAidMathModeShortcut,
  isStudyAidReturnToTextShortcut,
} from "@/lib/studyaid-math-shortcuts";

describe("StudyAid math shortcuts", () => {
  it("maps StudyAid key combinations to MathLive templates", () => {
    expect(getStudyAidMathShortcut(eventFor("/"))?.tex).toBe("\\frac{#?}{#?}");
    expect(getStudyAidMathShortcut(eventFor("r", { altKey: true }))?.tex).toBe("\\sqrt[#?]{#?}");
    expect(getStudyAidMathShortcut(eventFor("h", { altKey: true }))?.tex).toBe("\\sin^{#?} #?");
    expect(getStudyAidMathShortcut(eventFor("d"))?.tex).toBe("\\begin{pmatrix}#?&#?\\\\#?&#?\\end{pmatrix}");
    expect(getStudyAidMathShortcut(eventFor("y", { altKey: true }))?.tex).toBe("\\begin{cases}#?\\\\#?\\\\#?\\end{cases}");
    expect(getStudyAidMathShortcut(eventFor("."))?.tex).toBe("\\geqq");
    expect(getStudyAidMathShortcut(eventFor("/", { altKey: true }))?.tex).toBe("\\div");
    expect(getStudyAidMathShortcut(eventFor("2", { altKey: true }))?.tex).toBe("{#?}^{2}");
    expect(getStudyAidMathShortcut(eventFor("2", { altKey: true }))?.wrapsSelection).toBe(true);
  });

  it("uses physical key codes as a fallback for layout differences", () => {
    expect(getStudyAidMathShortcut(eventFor("x", { code: "KeyR" }))?.tex).toBe("\\sqrt{#?}");
    expect(getStudyAidMathShortcut(eventFor("\\", { code: "IntlYen" }))?.tex).toBe("\\left|#?\\right|");
    expect(getStudyAidMathShortcut(eventFor("x", { altKey: true, code: "Digit2" }))?.tex).toBe("{#?}^{2}");
  });

  it("keeps Ctrl+Alt+G available for the future f(x) selection screen", () => {
    expect(getStudyAidMathShortcut(eventFor("g", { altKey: true }))).toBeNull();
  });

  it("requires Ctrl without Meta for StudyAid shortcuts", () => {
    expect(getStudyAidMathShortcut(eventFor("/", { ctrlKey: false }))).toBeNull();
    expect(getStudyAidMathShortcut(eventFor("/", { metaKey: true }))).toBeNull();
    expect(isStudyAidMathModeShortcut(eventFor("m"))).toBe(true);
    expect(isStudyAidMathModeShortcut(eventFor("m", { metaKey: true }))).toBe(false);
    expect(isStudyAidReturnToTextShortcut(eventFor("t"))).toBe(true);
  });

  it("inserts templates into MathLive with placeholder focus", () => {
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const insert = vi.fn(() => true);

    expect(handleStudyAidMathShortcut({ ...eventFor("/"), preventDefault, stopPropagation }, { insert })).toBe(true);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledWith("\\frac{#?}{#?}", {
      focus: true,
      format: "latex",
      mode: "math",
      selectionMode: "placeholder",
    });
  });

  it("keeps every configured template valid for MathLive validation", () => {
    for (const shortcut of STUDYAID_MATH_SHORTCUTS) {
      expect(validateLatex(shortcut.tex), shortcut.id).toEqual([]);
    }
  });
});

function eventFor(key: string, overrides: Partial<Parameters<typeof getStudyAidMathShortcut>[0]> = {}) {
  return {
    altKey: false,
    code: "",
    ctrlKey: true,
    key,
    metaKey: false,
    ...overrides,
  };
}
