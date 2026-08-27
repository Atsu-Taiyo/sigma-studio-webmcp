import { describe, expect, it } from "vitest";

import { formatProblemNumber, getProblemNumberMap, shouldShowProblemNumber } from "@/lib/problem-numbering";
import type { SigmaBlock, ProblemNode } from "@/types/sigma-doc";

const problem = (id: string, enabled?: boolean, value?: number): ProblemNode => {
  const numbering: ProblemNode["numbering"] = {};
  if (typeof enabled === "boolean") {
    numbering.enabled = enabled;
  }
  if (typeof value === "number") {
    numbering.value = value;
  }

  return {
    type: "problem",
    id,
    tags: [],
    lead: [],
    prompt: [],
    solution: [],
    hints: [],
    numbering: Object.keys(numbering).length > 0 ? numbering : undefined,
  };
};

describe("problem numbering", () => {
  it("treats omitted numbering as visible", () => {
    expect(shouldShowProblemNumber(problem("p1"))).toBe(true);
  });

  it("assigns consecutive numbers to visible problems", () => {
    const content: SigmaBlock[] = [
      problem("p1"),
      {
        type: "paragraph",
        id: "body",
        children: [{ type: "text", text: "本文" }],
      },
      problem("p2", false),
      problem("p3", true),
    ];

    expect(Array.from(getProblemNumberMap(content).entries())).toEqual([
      ["p1", 1],
      ["p3", 2],
    ]);
  });

  it("continues automatic numbers after a specified number", () => {
    const content: SigmaBlock[] = [
      problem("p1"),
      problem("p2", true, 10),
      problem("p3"),
    ];

    expect(Array.from(getProblemNumberMap(content).entries())).toEqual([
      ["p1", 1],
      ["p2", 10],
      ["p3", 11],
    ]);
  });

  it("formats problem numbers without a trailing dot", () => {
    expect(formatProblemNumber(3)).toBe("3");
  });
});
