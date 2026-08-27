import type { SigmaBlock, ProblemNode } from "@/features/document";

export function shouldShowProblemNumber(problem: ProblemNode): boolean {
  return problem.numbering?.enabled !== false;
}

export function getProblemNumberMap(content: SigmaBlock[]): Map<string, number> {
  const numbers = new Map<string, number>();
  let nextNumber = 1;

  for (const block of content) {
    if (block.type !== "problem" || !shouldShowProblemNumber(block)) {
      continue;
    }

    const problemNumber = getSpecifiedProblemNumber(block) ?? nextNumber;
    numbers.set(block.id, problemNumber);
    nextNumber = problemNumber + 1;
  }

  return numbers;
}

function getSpecifiedProblemNumber(problem: ProblemNode): number | undefined {
  const value = problem.numbering?.value;
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

export function formatProblemNumber(problemNumber: number): string {
  return String(problemNumber);
}
