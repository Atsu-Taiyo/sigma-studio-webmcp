import { validateLatex } from "mathlive";
import { describe, expect, it, vi } from "vitest";

import {
  EDITOR_MATH_MATH_SHORTCUTS,
  getEditorMathMathShortcut,
  handleEditorMathMathShortcut,
  isEditorMathMathModeShortcut,
  isEditorMathReturnToTextShortcut,
} from "@/lib/math-editor-shortcuts";

describe("EditorMath math shortcuts", () => {
  it("maps EditorMath key combinations to MathLive templates", () => {
    expect(getEditorMathMathShortcut(eventFor("/"))?.tex).toBe("\\frac{#?}{#?}");
    expect(getEditorMathMathShortcut(eventFor("r", { altKey: true }))?.tex).toBe("\\sqrt[#?]{#?}");
    expect(getEditorMathMathShortcut(eventFor("h", { altKey: true }))?.tex).toBe("\\sin^{#?} #?");
    expect(getEditorMathMathShortcut(eventFor("d"))?.tex).toBe("\\begin{pmatrix}#?&#?\\\\#?&#?\\end{pmatrix}");
    expect(getEditorMathMathShortcut(eventFor("y", { altKey: true }))?.tex).toBe("\\begin{cases}#?\\\\#?\\\\#?\\end{cases}");
    expect(getEditorMathMathShortcut(eventFor("."))?.tex).toBe("\\geqq");
    expect(getEditorMathMathShortcut(eventFor("/", { altKey: true }))?.tex).toBe("\\div");
    expect(getEditorMathMathShortcut(eventFor("2", { altKey: true }))?.tex).toBe("{#?}^{2}");
    expect(getEditorMathMathShortcut(eventFor("2", { altKey: true }))?.wrapsSelection).toBe(true);
  });

  it("uses physical key codes as a fallback for layout differences", () => {
    expect(getEditorMathMathShortcut(eventFor("x", { code: "KeyR" }))?.tex).toBe("\\sqrt{#?}");
    expect(getEditorMathMathShortcut(eventFor("\\", { code: "IntlYen" }))?.tex).toBe("\\left|#?\\right|");
    expect(getEditorMathMathShortcut(eventFor("x", { altKey: true, code: "Digit2" }))?.tex).toBe("{#?}^{2}");
  });

  it("keeps Ctrl+Alt+G available for the future f(x) selection screen", () => {
    expect(getEditorMathMathShortcut(eventFor("g", { altKey: true }))).toBeNull();
  });

  it("requires Ctrl without Meta for EditorMath shortcuts", () => {
    expect(getEditorMathMathShortcut(eventFor("/", { ctrlKey: false }))).toBeNull();
    expect(getEditorMathMathShortcut(eventFor("/", { metaKey: true }))).toBeNull();
    expect(isEditorMathMathModeShortcut(eventFor("m"))).toBe(true);
    expect(isEditorMathMathModeShortcut(eventFor("m", { metaKey: true }))).toBe(false);
    expect(isEditorMathReturnToTextShortcut(eventFor("t"))).toBe(true);
  });

  it("inserts templates into MathLive with placeholder focus", () => {
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const insert = vi.fn(() => true);

    expect(handleEditorMathMathShortcut({ ...eventFor("/"), preventDefault, stopPropagation }, { insert })).toBe(true);
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
    for (const shortcut of EDITOR_MATH_MATH_SHORTCUTS) {
      expect(validateLatex(shortcut.tex), shortcut.id).toEqual([]);
    }
  });
});

function eventFor(key: string, overrides: Partial<Parameters<typeof getEditorMathMathShortcut>[0]> = {}) {
  return {
    altKey: false,
    code: "",
    ctrlKey: true,
    key,
    metaKey: false,
    ...overrides,
  };
}
