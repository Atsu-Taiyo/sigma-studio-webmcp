import { parseSigmaDocument } from "@/lib/sigma-doc-schema";
import {
  ensurePageLayout,
  type AnswerDefinition,
  type SigmaBlock,
  type SigmaDocument,
  type HeadingNode,
  type InlineNode,
  type ListNode,
  type ParagraphNode,
  type ProblemNode,
  type RichBlock,
  type TextInlineNode,
  type TextMark,
  type TextAlign,
} from "@/features/document";

const MAX_TEX_CHARS = 2 * 1024 * 1024;
const OUTPUT_PROFILES: SigmaDocument["outputProfiles"] = {
  student: { showSolutions: false, showHints: false, includeAnswers: false },
  teacher: { showSolutions: true, showHints: true, includeAnswers: true },
  answerBook: { onlySolutions: true, includeAnswers: true },
};

const TOP_LEVEL_PROBLEM_ENVIRONMENTS = new Set(["problem", "exercise", "question"]);
const SOLUTION_ENVIRONMENTS = new Set(["solution", "solutions", "proof"]);
const HINT_ENVIRONMENTS = new Set(["hint", "hints"]);
const ANSWER_ENVIRONMENTS = new Set(["answer", "answers"]);
const AREA_COMMANDS = new Set(["answer", "solution", "hint"]);
const LIST_ENVIRONMENTS = new Set(["enumerate", "itemize", "description"]);
const TRANSPARENT_TEXT_ENVIRONMENTS = new Set(["quote", "quotation"]);
const DISPLAY_MATH_ENVIRONMENTS = new Set([
  "equation",
  "equation*",
  "align",
  "align*",
  "gather",
  "gather*",
  "multline",
  "multline*",
  "eqnarray",
  "eqnarray*",
]);
const IGNORED_TOP_LEVEL_COMMANDS = new Set([
  "author",
  "columnratio",
  "date",
  "documentclass",
  "everymath",
  "geometry",
  "lfoot",
  "lhead",
  "label",
  "large",
  "maketitle",
  "newcommand",
  "newlength",
  "pagestyle",
  "renewcommand",
  "rfoot",
  "rhead",
  "setlist",
  "title",
  "usetikzlibrary",
  "usepackage",
]);
const MARK_COMMANDS: Partial<Record<string, TextMark>> = {
  anaume: "boxed",
  emph: "italic",
  fbox: "boxed",
  ovalbox: "boxed",
  sanaume: "boxed",
  textbf: "bold",
  textit: "italic",
  underline: "underline",
};
const UNWRAP_TEXT_COMMANDS = new Set([
  "large",
  "mbox",
  "scriptsize",
  "text",
  "textnormal",
  "textrm",
  "textsf",
  "texttt",
]);
const IGNORED_TEXT_COMMANDS = new Set([
  "FloatBarrier",
  "begin",
  "bigskip",
  "centering",
  "clearpage",
  "columnbreak",
  "hfill",
  "hspace",
  "label",
  "large",
  "medskip",
  "newpage",
  "noindent",
  "normalsize",
  "pagebreak",
  "par",
  "phantom",
  "setlength",
  "smallskip",
  "end",
  "vspace",
]);
const TEXT_SYMBOL_COMMANDS: Record<string, string> = {
  LaTeX: "LaTeX",
  TeX: "TeX",
  ldots: "...",
  dots: "...",
};
const TEXT_SPACING_COMMANDS = new Set(["quad", "qquad", "smallskip", "medskip", "bigskip"]);
const SEMANTIC_CUSTOM_COMMANDS = new Set(["anaume", "maru", "rulecenter", "sanaume"]);
const MAX_MACRO_EXPANSION_DEPTH = 8;

interface TexCommand {
  name: string;
  starred: boolean;
  endIndex: number;
}

interface TexGroup {
  value: string;
  endIndex: number;
}

interface TexEnvironmentOpen {
  name: string;
  option?: string;
  contentStartIndex: number;
}

interface TexEnvironment extends TexEnvironmentOpen {
  body: string;
  endIndex: number;
}

interface ProblemAreas {
  promptSource: string;
  solutionSources: string[];
  hintSources: string[];
  answerSources: string[];
}

interface TexMacroDefinition {
  name: string;
  argCount: number;
  defaultArg?: string;
  replacement: string;
}

type TexIdFactory = (prefix: string) => string;

export function isTexFilename(filename: string): boolean {
  return /\.(?:tex|latex)$/i.test(filename);
}

export function importTexDocument(input: string, filename = "lesson.tex"): SigmaDocument {
  const normalizedInput = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (normalizedInput.length > MAX_TEX_CHARS) {
    throw new Error("TeXファイルが大きすぎます。2MB以下のファイルを選んでください。");
  }

  const source = stripTexComments(normalizedInput);
  const macros = collectTexMacroDefinitions(source);
  const body = expandTexMacros(extractDocumentBody(source), macros);
  const createId = createTexIdFactory();
  const content = parseTopLevelTexBlocks(body, createId);

  if (content.length === 0) {
    throw new Error("TeXファイル内に取り込める本文が見つかりませんでした。");
  }

  const title = extractTexTitle(source, createId, macros) ?? titleFromFilename(filename);
  return parseSigmaDocument(ensurePageLayout({
    version: "2.0",
    docId: createId("doc"),
    metadata: { title },
    content,
    outputProfiles: OUTPUT_PROFILES,
    updatedAt: new Date().toISOString(),
  }));
}

function createTexIdFactory(): TexIdFactory {
  const counts = new Map<string, number>();
  return (prefix: string) => {
    const next = (counts.get(prefix) ?? 0) + 1;
    counts.set(prefix, next);
    return `tex_${prefix}_${next}`;
  };
}

function collectTexMacroDefinitions(source: string): Map<string, TexMacroDefinition> {
  const macros = new Map<string, TexMacroDefinition>();
  let index = 0;

  while (index < source.length) {
    const command = readCommandAt(source, index);
    if (!command || (command.name !== "newcommand" && command.name !== "renewcommand")) {
      index += 1;
      continue;
    }

    const definition = readTexMacroDefinition(source, command.endIndex);
    if (!definition) {
      index = command.endIndex;
      continue;
    }

    if (!SEMANTIC_CUSTOM_COMMANDS.has(definition.name)) {
      macros.set(definition.name, definition);
    }
    index = definition.endIndex;
  }

  return macros;
}

function readTexMacroDefinition(
  source: string,
  index: number,
): (TexMacroDefinition & { endIndex: number }) | null {
  const nameResult = readMacroName(source, index);
  if (!nameResult) {
    return null;
  }

  let cursor = nameResult.endIndex;
  const argCountGroup = readBracketGroup(source, cursor);
  const argCount = argCountGroup ? Number.parseInt(argCountGroup.value.trim(), 10) : 0;
  if (argCountGroup) {
    cursor = argCountGroup.endIndex;
  }

  let defaultArg: string | undefined;
  const defaultGroup = readBracketGroup(source, cursor);
  if (defaultGroup && argCount > 0) {
    defaultArg = defaultGroup.value;
    cursor = defaultGroup.endIndex;
  }

  const replacement = readBraceGroup(source, cursor);
  if (!replacement) {
    return null;
  }

  return {
    name: nameResult.name,
    argCount: Number.isFinite(argCount) ? Math.max(0, Math.min(9, argCount)) : 0,
    defaultArg,
    replacement: replacement.value,
    endIndex: replacement.endIndex,
  };
}

function readMacroName(source: string, index: number): { name: string; endIndex: number } | null {
  const group = readBraceGroup(source, index);
  if (group) {
    const commandName = group.value.trim().match(/^\\([A-Za-z]+)\*?$/)?.[1];
    return commandName ? { name: commandName, endIndex: group.endIndex } : null;
  }

  const command = readCommandAt(source, skipWhitespace(source, index));
  return command ? { name: command.name, endIndex: command.endIndex } : null;
}

function expandTexMacros(source: string, macros: Map<string, TexMacroDefinition>, depth = 0): string {
  if (macros.size === 0 || depth >= MAX_MACRO_EXPANSION_DEPTH) {
    return source;
  }

  let output = "";
  let index = 0;
  while (index < source.length) {
    const command = readCommandAt(source, index);
    const macro = command ? macros.get(command.name) : undefined;
    if (!command || !macro) {
      output += source[index];
      index += 1;
      continue;
    }

    const invocation = readMacroInvocation(source, command.endIndex, macro);
    if (!invocation) {
      output += source[index];
      index += 1;
      continue;
    }

    output += expandTexMacros(applyTexMacroReplacement(macro, invocation.args), macros, depth + 1);
    index = invocation.endIndex;
  }

  return output;
}

function readMacroInvocation(
  source: string,
  index: number,
  macro: TexMacroDefinition,
): { args: string[]; endIndex: number } | null {
  const args: string[] = [];
  let cursor = index;

  if (macro.defaultArg !== undefined && macro.argCount > 0) {
    const optionalArg = readBracketGroup(source, cursor);
    if (optionalArg) {
      args.push(optionalArg.value);
      cursor = optionalArg.endIndex;
    } else {
      args.push(macro.defaultArg);
    }
  }

  while (args.length < macro.argCount) {
    const arg = readMacroInvocationArgument(source, cursor);
    if (!arg) {
      return null;
    }
    args.push(arg.value);
    cursor = arg.endIndex;
  }

  return { args, endIndex: cursor };
}

function readMacroInvocationArgument(source: string, index: number): TexGroup | null {
  const group = readBraceGroup(source, index);
  if (group) {
    return group;
  }

  const cursor = skipWhitespace(source, index);
  const command = readCommandAt(source, cursor);
  if (command) {
    return {
      value: source.slice(cursor, command.endIndex),
      endIndex: command.endIndex,
    };
  }

  const value = source[cursor];
  if (!value || /[{}\[\]\s]/.test(value)) {
    return null;
  }
  return {
    value,
    endIndex: cursor + 1,
  };
}

function applyTexMacroReplacement(macro: TexMacroDefinition, args: string[]): string {
  return macro.replacement.replace(/#([1-9])/g, (match, indexText: string) => {
    const index = Number.parseInt(indexText, 10) - 1;
    return args[index] ?? match;
  });
}

function parseTopLevelTexBlocks(source: string, createId: TexIdFactory): SigmaBlock[] {
  const blocks: SigmaBlock[] = [];
  let buffer = "";
  let index = 0;

  const flushBuffer = () => {
    const richBlocks = texSourceToRichBlocks(buffer, createId);
    blocks.push(...richBlocks);
    buffer = "";
  };

  while (index < source.length) {
    const environment = readEnvironmentAt(source, index);
    if (environment && TOP_LEVEL_PROBLEM_ENVIRONMENTS.has(environment.name)) {
      flushBuffer();
      blocks.push(createProblemFromTex(environment, createId));
      index = environment.endIndex;
      continue;
    }

    const command = readCommandAt(source, index);
    if (command) {
      const rulecenterProblem = readRulecenterProblemMarker(source, command);
      if (rulecenterProblem) {
        flushBuffer();
        const endIndex = findNextRulecenterProblemBoundary(source, rulecenterProblem.endIndex);
        blocks.push(createProblemFromTex({
          name: "problem",
          option: rulecenterProblem.title,
          contentStartIndex: rulecenterProblem.endIndex,
          body: source.slice(rulecenterProblem.endIndex, endIndex),
          endIndex,
        }, createId));
        index = endIndex;
        continue;
      }

      const heading = readHeadingCommand(source, command, createId);
      if (heading) {
        flushBuffer();
        blocks.push(heading.block);
        index = heading.endIndex;
        continue;
      }

      if (IGNORED_TOP_LEVEL_COMMANDS.has(command.name)) {
        index = skipCommandArguments(source, command.endIndex);
        continue;
      }
    }

    buffer += source[index];
    index += 1;
  }

  flushBuffer();
  return blocks;
}

function readRulecenterProblemMarker(source: string, command: TexCommand): { title: string; endIndex: number } | null {
  if (command.name !== "rulecenter") {
    return null;
  }
  const group = readBraceGroup(source, command.endIndex);
  if (!group) {
    return null;
  }
  const title = group.value.trim();
  if (!/^問題/.test(title)) {
    return null;
  }
  return { title, endIndex: group.endIndex };
}

function findNextRulecenterProblemBoundary(source: string, startIndex: number): number {
  let index = startIndex;
  while (index < source.length) {
    const command = readCommandAt(source, index);
    if (!command) {
      index += 1;
      continue;
    }

    if (command.name === "rulecenter" && readRulecenterProblemMarker(source, command)) {
      return index;
    }

    if (command.name === "section") {
      return index;
    }

    index = Math.max(command.endIndex, index + 1);
  }
  return source.length;
}

function readHeadingCommand(
  source: string,
  command: TexCommand,
  createId: TexIdFactory,
): { block: SigmaBlock; endIndex: number } | null {
  const level = headingLevelFromCommand(command.name);
  if (!level) {
    return null;
  }
  const group = readBraceGroup(source, command.endIndex);
  if (!group) {
    return null;
  }

  if (command.name === "section") {
    return {
      block: {
        type: "section",
        id: createId("section"),
        title: texToPlainText(group.value, createId),
      },
      endIndex: group.endIndex,
    };
  }

  return {
    block: createHeading(level, group.value, createId),
    endIndex: group.endIndex,
  };
}

function headingLevelFromCommand(commandName: string): 1 | 2 | 3 | null {
  if (commandName === "section") {
    return 1;
  }
  if (commandName === "subsection") {
    return 2;
  }
  if (commandName === "subsubsection" || commandName === "paragraph") {
    return 3;
  }
  return null;
}

function texSourceToRichBlocks(source: string, createId: TexIdFactory, forcedAlign?: TextAlign): RichBlock[] {
  const blocks: RichBlock[] = [];
  let buffer = "";
  let index = 0;

  const flushBuffer = () => {
    const paragraphs = splitTexParagraphs(buffer)
      .map((paragraph) => createParagraphFromTex(paragraph, createId, forcedAlign))
      .filter((block): block is ParagraphNode => Boolean(block));
    blocks.push(...paragraphs);
    buffer = "";
  };

  while (index < source.length) {
    const environment = readEnvironmentAt(source, index);
    if (environment && LIST_ENVIRONMENTS.has(environment.name)) {
      flushBuffer();
      blocks.push(...createListBlocks(environment, createId, forcedAlign));
      index = environment.endIndex;
      continue;
    }

    if (environment?.name === "itembox") {
      flushBuffer();
      blocks.push(...createItemboxBlocks(environment, createId, forcedAlign));
      index = environment.endIndex;
      continue;
    }

    if (environment && TRANSPARENT_TEXT_ENVIRONMENTS.has(environment.name)) {
      flushBuffer();
      blocks.push(...texSourceToRichBlocks(environment.body, createId, forcedAlign));
      index = environment.endIndex;
      continue;
    }

    if (environment && isAlignedTextEnvironment(environment.name)) {
      flushBuffer();
      blocks.push(...texSourceToRichBlocks(environment.body, createId, alignFromEnvironment(environment.name)));
      index = environment.endIndex;
      continue;
    }

    const command = readCommandAt(source, index);
    const level = command ? headingLevelFromCommand(command.name) : null;
    if (command && level) {
      const group = readBraceGroup(source, command.endIndex);
      if (group) {
        flushBuffer();
        blocks.push(createHeading(level, group.value, createId));
        index = group.endIndex;
        continue;
      }
    }

    buffer += source[index];
    index += 1;
  }

  flushBuffer();
  return blocks;
}

function splitTexParagraphs(source: string): string[] {
  const paragraphs: string[] = [];
  let buffer = "";
  let blankLine = false;

  for (const line of source.split("\n")) {
    if (line.trim() === "") {
      if (buffer.trim() !== "") {
        blankLine = true;
      }
      continue;
    }

    if (blankLine && buffer.trim() !== "") {
      paragraphs.push(buffer.trim());
      buffer = "";
    }
    buffer += buffer ? `\n${line}` : line;
    blankLine = false;
  }

  if (buffer.trim() !== "") {
    paragraphs.push(buffer.trim());
  }
  return paragraphs;
}

function createHeading(level: 1 | 2 | 3, source: string, createId: TexIdFactory): HeadingNode {
  const children = texToInlineNodes(source, createId);
  return {
    type: "heading",
    id: createId("heading"),
    level,
    children: children.length > 0 ? children : [{ type: "text", text: "" }],
  };
}

function createParagraphFromTex(source: string, createId: TexIdFactory, forcedAlign?: TextAlign): ParagraphNode | null {
  const cleanSource = source
    .replace(/\\(?:noindent|smallskip|medskip|bigskip)\b/g, "")
    .trim();
  if (!cleanSource) {
    return null;
  }

  const isCentered = forcedAlign === "center" || /^\\centering\b/.test(cleanSource) || isDisplayMathOnly(cleanSource);
  const withoutAlignmentCommand = cleanSource.replace(/^\\centering\b\s*/, "");
  const children = texToInlineNodes(withoutAlignmentCommand, createId);
  if (children.length === 0) {
    return null;
  }

  return {
    type: "paragraph",
    id: createId("p"),
    children,
    align: isCentered ? "center" : forcedAlign,
  };
}

function createListBlocks(environment: TexEnvironment, createId: TexIdFactory, forcedAlign?: TextAlign): ListNode[] {
  const items = splitListItems(environment.body);
  const listItems = items.flatMap((item, index): ListNode["items"] => {
    const label = listItemLabelNodes(environment.name, index + 1, item.label, createId);
    const { body, nested } = extractNestedListsFromItemSource(item.source, createId, forcedAlign);
    const children = prefixInlineNodes(label, texToInlineNodes(body, createId));
    if (children.length === 0 && nested.length === 0) {
      return [];
    }
    return [
      {
        type: "listItem",
        id: createId("li"),
        children,
        nested: nested.length > 0 ? nested : undefined,
      },
    ];
  });

  if (listItems.length === 0) {
    return [];
  }

  return [
    {
      type: "list",
      id: createId("list"),
      listType: environment.name === "enumerate" ? "ordered" : "bullet",
      // `enumerate` の既定マーカーは `1.` なので markerStyle は付けない (= decimal)。
      // `(1)` は enumitem の `label` 指定でしか出せず、それはまだ読んでいない。
      items: listItems,
    },
  ];
}

function extractNestedListsFromItemSource(
  source: string,
  createId: TexIdFactory,
  forcedAlign?: TextAlign,
): { body: string; nested: ListNode[] } {
  const nested: ListNode[] = [];
  let body = "";
  let index = 0;

  while (index < source.length) {
    const environment = readEnvironmentAt(source, index);
    if (environment && LIST_ENVIRONMENTS.has(environment.name)) {
      nested.push(...createListBlocks(environment, createId, forcedAlign));
      body += " ";
      index = environment.endIndex;
      continue;
    }

    body += source[index];
    index += 1;
  }

  return {
    body: body.trim(),
    nested,
  };
}

function createItemboxBlocks(environment: TexEnvironment, createId: TexIdFactory, forcedAlign?: TextAlign): ParagraphNode[] {
  const { title, body } = splitItemboxTitleAndBody(environment.body);
  const blocks = texSourceToRichBlocks(body, createId, forcedAlign).filter((block): block is ParagraphNode => block.type === "paragraph");
  if (!title) {
    return blocks;
  }

  const titleNodes = texToInlineNodes(`【${title}】`, createId);
  if (blocks.length === 0) {
    return [{
      type: "paragraph",
      id: createId("p"),
      children: titleNodes,
      align: forcedAlign,
    }];
  }

  const [firstBlock, ...restBlocks] = blocks;
  return [
    {
      ...firstBlock,
      children: [...titleNodes, { type: "text", text: " " }, ...firstBlock.children],
    },
    ...restBlocks,
  ];
}

function splitItemboxTitleAndBody(source: string): { title: string | null; body: string } {
  const group = readBraceGroup(source, 0);
  if (!group) {
    return { title: null, body: source };
  }
  return {
    title: group.value.trim(),
    body: source.slice(group.endIndex),
  };
}

function splitListItems(source: string): Array<{ label?: string; source: string }> {
  const items: Array<{ label?: string; source: string }> = [];
  let current = "";
  let currentLabel: string | undefined;
  let index = 0;

  const flush = () => {
    if (current.trim()) {
      items.push({ label: currentLabel, source: current.trim() });
    }
    current = "";
    currentLabel = undefined;
  };

  while (index < source.length) {
    const environment = readEnvironmentAt(source, index);
    if (environment) {
      current += source.slice(index, environment.endIndex);
      index = environment.endIndex;
      continue;
    }

    const command = readCommandAt(source, index);
    if (command?.name === "item") {
      flush();
      const labelGroup = readBracketGroup(source, command.endIndex);
      currentLabel = labelGroup?.value.trim();
      index = labelGroup?.endIndex ?? command.endIndex;
      continue;
    }

    current += source[index];
    index += 1;
  }

  flush();
  return items;
}

function listItemLabelNodes(
  environmentName: string,
  _itemNumber: number,
  explicitLabel: string | undefined,
  createId: TexIdFactory,
): InlineNode[] {
  if (explicitLabel) {
    return [...texToInlineNodes(explicitLabel, createId), { type: "text", text: " " }];
  }
  if (environmentName === "description") {
    return [];
  }
  return [];
}

function prefixInlineNodes(prefix: InlineNode[], children: InlineNode[]): InlineNode[] {
  if (prefix.length === 0) {
    return children;
  }
  return [...prefix, ...children];
}

function createProblemFromTex(environment: TexEnvironment, createId: TexIdFactory): ProblemNode {
  const title = environment.option ? texToPlainText(environment.option, createId).trim() : "";
  const areas = extractProblemAreas(environment.body);
  const prompt = texSourceToRichBlocks(areas.promptSource, createId);
  const solution = areas.solutionSources.flatMap((source) => texSourceToRichBlocks(source, createId));
  const hints = areas.hintSources.flatMap((source) => texSourceToRichBlocks(source, createId));
  const lead = title ? [textParagraph(title, createId)] : [];
  const tag = title.replace(/[#\s　]/g, "");

  return {
    type: "problem",
    id: createId("problem"),
    tags: tag ? [tag] : [],
    lead,
    prompt: prompt.length > 0 ? prompt : [emptyParagraph(createId)],
    answer: createAnswerDefinition(areas.answerSources.join("\n\n"), createId),
    solution,
    hints,
  };
}

function extractProblemAreas(source: string): ProblemAreas {
  const solutionMarkerResult = splitSolutionMarker(source);
  const environmentResult = extractAreaEnvironments(solutionMarkerResult.promptSource);
  const commandResult = extractAreaCommands(environmentResult.remaining);

  return {
    promptSource: commandResult.remaining,
    solutionSources: [
      ...environmentResult.solutionSources,
      ...commandResult.solutionSources,
      ...solutionMarkerResult.solutionSources,
    ],
    hintSources: [...environmentResult.hintSources, ...commandResult.hintSources],
    answerSources: [...environmentResult.answerSources, ...commandResult.answerSources],
  };
}

function splitSolutionMarker(source: string): Pick<ProblemAreas, "promptSource" | "solutionSources"> {
  const result = {
    promptSource: source,
    solutionSources: [] as string[],
  };
  let index = 0;

  while (index < source.length) {
    const command = readCommandAt(source, index);
    if (command?.name !== "ovalbox") {
      index += 1;
      continue;
    }

    const group = readBraceGroup(source, command.endIndex);
    if (!group) {
      index += 1;
      continue;
    }

    if (group.value.trim() !== "解答") {
      index = group.endIndex;
      continue;
    }

    result.promptSource = source.slice(0, index);
    const solutionSource = source.slice(group.endIndex);
    if (solutionSource.trim()) {
      result.solutionSources.push(solutionSource);
    }
    return result;
  }

  return result;
}

function extractAreaEnvironments(source: string): ProblemAreas & { remaining: string } {
  const result = {
    promptSource: "",
    solutionSources: [] as string[],
    hintSources: [] as string[],
    answerSources: [] as string[],
    remaining: "",
  };
  let index = 0;
  let lastIndex = 0;

  while (index < source.length) {
    const environment = readEnvironmentAt(source, index);
    if (environment && isProblemAreaEnvironment(environment.name)) {
      result.remaining += source.slice(lastIndex, index);
      pushProblemAreaSource(result, environment.name, environment.body);
      index = environment.endIndex;
      lastIndex = environment.endIndex;
      continue;
    }
    index += 1;
  }

  result.remaining += source.slice(lastIndex);
  result.promptSource = result.remaining;
  return result;
}

function extractAreaCommands(source: string): ProblemAreas & { remaining: string } {
  const result = {
    promptSource: "",
    solutionSources: [] as string[],
    hintSources: [] as string[],
    answerSources: [] as string[],
    remaining: "",
  };
  let index = 0;
  let lastIndex = 0;

  while (index < source.length) {
    const command = readCommandAt(source, index);
    if (command && AREA_COMMANDS.has(command.name)) {
      const group = readBraceGroup(source, command.endIndex);
      if (group) {
        result.remaining += source.slice(lastIndex, index);
        pushProblemAreaSource(result, command.name, group.value);
        index = group.endIndex;
        lastIndex = group.endIndex;
        continue;
      }
    }
    index += 1;
  }

  result.remaining += source.slice(lastIndex);
  result.promptSource = result.remaining;
  return result;
}

function isProblemAreaEnvironment(environmentName: string): boolean {
  return SOLUTION_ENVIRONMENTS.has(environmentName)
    || HINT_ENVIRONMENTS.has(environmentName)
    || ANSWER_ENVIRONMENTS.has(environmentName);
}

function pushProblemAreaSource(
  result: Pick<ProblemAreas, "solutionSources" | "hintSources" | "answerSources">,
  areaName: string,
  source: string,
) {
  if (SOLUTION_ENVIRONMENTS.has(areaName) || areaName === "solution") {
    result.solutionSources.push(source);
    return;
  }
  if (HINT_ENVIRONMENTS.has(areaName) || areaName === "hint") {
    result.hintSources.push(source);
    return;
  }
  result.answerSources.push(source);
}

function createAnswerDefinition(source: string, createId: TexIdFactory): AnswerDefinition | undefined {
  const trimmed = source.trim();
  if (!trimmed) {
    return undefined;
  }

  const math = extractSingleMathTex(trimmed);
  if (math !== null) {
    return { type: "math", expected: math };
  }

  return {
    type: "text",
    expected: texToPlainText(trimmed, createId),
  };
}

function extractSingleMathTex(source: string): string | null {
  if (source.startsWith("$") && !source.startsWith("$$") && source.endsWith("$") && !isEscaped(source, source.length - 1)) {
    return normalizeMathTex(source.slice(1, -1));
  }

  if (source.startsWith("$$") && source.endsWith("$$") && !isEscaped(source, source.length - 2)) {
    return normalizeMathTex(source.slice(2, -2));
  }

  const parenMatch = source.match(/^\\\(([\s\S]+?)\\\)$/);
  if (parenMatch) {
    return normalizeMathTex(parenMatch[1] ?? "");
  }

  const bracketMatch = source.match(/^\\\[([\s\S]+?)\\\]$/);
  if (bracketMatch) {
    return normalizeMathTex(bracketMatch[1] ?? "");
  }

  const environment = readEnvironmentAt(source, 0);
  if (environment && DISPLAY_MATH_ENVIRONMENTS.has(environment.name) && environment.endIndex === source.length) {
    return normalizeMathEnvironmentTex(environment.name, environment.body);
  }

  return null;
}

function textParagraph(text: string, createId: TexIdFactory): ParagraphNode {
  return {
    type: "paragraph",
    id: createId("p"),
    children: [{ type: "text", text }],
  };
}

function emptyParagraph(createId: TexIdFactory): ParagraphNode {
  return {
    type: "paragraph",
    id: createId("p"),
    children: [{ type: "text", text: "" }],
  };
}

function texToPlainText(source: string, createId: TexIdFactory): string {
  return inlineNodesToPlainText(texToInlineNodes(source, createId)).trim();
}

function inlineNodesToPlainText(children: InlineNode[]): string {
  return children.map((child) => child.type === "mathInline" ? child.tex : child.text).join("");
}

export function texToInlineNodes(source: string, createId: TexIdFactory): InlineNode[] {
  const nodes: InlineNode[] = [];
  let buffer = "";
  let index = 0;

  const flushText = () => {
    appendInlineNodes(nodes, texTextToInlineNodes(buffer));
    buffer = "";
  };

  while (index < source.length) {
    const displayEnvironment = readEnvironmentAt(source, index);
    if (displayEnvironment && DISPLAY_MATH_ENVIRONMENTS.has(displayEnvironment.name)) {
      flushText();
      appendMathNode(nodes, normalizeMathEnvironmentTex(displayEnvironment.name, displayEnvironment.body), createId);
      index = displayEnvironment.endIndex;
      continue;
    }

    if (startsWithUnescaped(source, index, "$$")) {
      const endIndex = findUnescaped(source, "$$", index + 2);
      if (endIndex >= 0) {
        flushText();
        appendMathNode(nodes, normalizeMathTex(source.slice(index + 2, endIndex)), createId);
        index = endIndex + 2;
        continue;
      }
    }

    if (startsWithUnescaped(source, index, "$")) {
      const endIndex = findInlineDollarEnd(source, index + 1);
      if (endIndex >= 0) {
        flushText();
        appendMathNode(nodes, normalizeMathTex(source.slice(index + 1, endIndex)), createId);
        index = endIndex + 1;
        continue;
      }
    }

    if (source.startsWith("\\(", index)) {
      const endIndex = source.indexOf("\\)", index + 2);
      if (endIndex >= 0) {
        flushText();
        appendMathNode(nodes, normalizeMathTex(source.slice(index + 2, endIndex)), createId);
        index = endIndex + 2;
        continue;
      }
    }

    if (source.startsWith("\\[", index)) {
      const endIndex = source.indexOf("\\]", index + 2);
      if (endIndex >= 0) {
        flushText();
        appendMathNode(nodes, normalizeMathTex(source.slice(index + 2, endIndex)), createId);
        index = endIndex + 2;
        continue;
      }
    }

    buffer += source[index];
    index += 1;
  }

  flushText();
  return nodes;
}

function appendMathNode(nodes: InlineNode[], tex: string, createId: TexIdFactory) {
  if (!tex) {
    return;
  }
  nodes.push({
    type: "mathInline",
    id: createId("math"),
    tex,
    display: "inline",
  });
}

function texTextToInlineNodes(source: string, activeMarks: TextMark[] = []): TextInlineNode[] {
  const nodes: TextInlineNode[] = [];
  let buffer = "";
  let index = 0;

  const flush = () => {
    const text = normalizeTextSegment(buffer);
    if (text) {
      appendTextNode(nodes, text, activeMarks);
    }
    buffer = "";
  };

  while (index < source.length) {
    const command = readCommandAt(source, index);
    if (command) {
      const mark = MARK_COMMANDS[command.name];
      const group = readCommandContentGroup(source, command.endIndex);
      if (command.name === "includegraphics") {
        const filename = group ? texToImageFilename(group.value) : "";
        flush();
        appendTextNode(nodes, filename ? `［画像: ${filename}］` : "［画像］", activeMarks);
        index = group?.endIndex ?? skipCommandArguments(source, command.endIndex);
        continue;
      }

      if (command.name === "footnote" && group) {
        flush();
        appendTextNode(nodes, "（注: ", activeMarks);
        appendTextNodes(nodes, texTextToInlineNodes(group.value, activeMarks));
        appendTextNode(nodes, "）", activeMarks);
        index = group.endIndex;
        continue;
      }

      if (command.name === "maru") {
        const argument = readCommandArgument(source, command.endIndex);
        if (argument) {
          buffer += circledText(texTextToInlineNodes(argument.value).map((node) => node.text).join(""));
          index = argument.endIndex;
          continue;
        }
      }

      if (command.name === "textcircled" && group) {
        flush();
        appendTextNode(nodes, circledText(texTextToInlineNodes(group.value).map((node) => node.text).join("")), activeMarks);
        index = group.endIndex;
        continue;
      }

      if (mark && group) {
        flush();
        appendTextNodes(nodes, texTextToInlineNodes(group.value, addMark(activeMarks, mark)));
        index = group.endIndex;
        continue;
      }

      if (UNWRAP_TEXT_COMMANDS.has(command.name) && group) {
        flush();
        appendTextNodes(nodes, texTextToInlineNodes(group.value, activeMarks));
        index = group.endIndex;
        continue;
      }

      if (TEXT_SYMBOL_COMMANDS[command.name]) {
        buffer += TEXT_SYMBOL_COMMANDS[command.name];
        index = command.endIndex;
        continue;
      }

      if (IGNORED_TEXT_COMMANDS.has(command.name)) {
        index = skipCommandArguments(source, command.endIndex);
        continue;
      }

      if (TEXT_SPACING_COMMANDS.has(command.name)) {
        buffer += " ";
        index = command.endIndex;
        continue;
      }

      buffer += `\\${command.name}${command.starred ? "*" : ""}`;
      index = command.endIndex;
      continue;
    }

    if (source[index] === "\\") {
      const escaped = source[index + 1];
      if (escaped) {
        buffer += escapedTextCharacter(escaped);
        index += 2;
        continue;
      }
    }

    buffer += source[index];
    index += 1;
  }

  flush();
  return nodes;
}

function texToImageFilename(source: string): string {
  return source.trim().replace(/^["']|["']$/g, "");
}

function circledText(value: string): string {
  const normalized = value.trim();
  const numericValue = Number(normalized);
  if (Number.isInteger(numericValue) && numericValue >= 1 && numericValue <= 20) {
    return String.fromCodePoint(0x2460 + numericValue - 1);
  }
  return normalized ? `(${normalized})` : "";
}

function normalizeTextSegment(text: string): string {
  return text
    .replace(/\n/g, " ")
    .replace(/~/g, " ")
    .replace(/[ \t\f\v]+/g, " ");
}

function appendInlineNodes(target: InlineNode[], nodes: InlineNode[]) {
  for (const node of nodes) {
    if (node.type === "text") {
      appendTextNode(target, node.text, node.marks);
      continue;
    }
    target.push(node);
  }
}

function appendTextNodes(target: TextInlineNode[], nodes: TextInlineNode[]) {
  for (const node of nodes) {
    appendTextNode(target, node.text, node.marks);
  }
}

function appendTextNode(target: InlineNode[], text: string, marks?: TextMark[]) {
  if (!text) {
    return;
  }
  const normalizedMarks = marks && marks.length > 0 ? [...marks] : undefined;
  const last = target[target.length - 1];
  if (
    last?.type === "text"
    && JSON.stringify(last.marks ?? []) === JSON.stringify(normalizedMarks ?? [])
  ) {
    last.text += text;
    return;
  }
  target.push(normalizedMarks ? { type: "text", text, marks: normalizedMarks } : { type: "text", text });
}

function addMark(marks: TextMark[], mark: TextMark): TextMark[] {
  return marks.includes(mark) ? marks : [...marks, mark];
}

function escapedTextCharacter(character: string): string {
  if (character === "\\" || character === " ") {
    return "\n";
  }
  if (character === "," || character === ";" || character === ":") {
    return " ";
  }
  if ("{}$&_#%~^".includes(character)) {
    return character;
  }
  return character;
}

function normalizeMathEnvironmentTex(environmentName: string, body: string): string {
  const tex = normalizeMathTex(body);
  if (environmentName.startsWith("align") || environmentName.startsWith("eqnarray")) {
    return `\\begin{aligned}${tex}\\end{aligned}`;
  }
  if (environmentName.startsWith("gather")) {
    return `\\begin{gathered}${tex}\\end{gathered}`;
  }
  return tex;
}

function normalizeMathTex(tex: string): string {
  return tex
    .replace(/\\label\s*\{(?:\\.|[^{}])*\}/g, "")
    .replace(/\s*\n\s*/g, " ")
    .trim();
}

function isDisplayMathOnly(source: string): boolean {
  return extractSingleMathTex(source) !== null;
}

function readEnvironmentAt(source: string, index: number): TexEnvironment | null {
  const open = readEnvironmentOpenAt(source, index);
  if (!open) {
    return null;
  }

  let depth = 1;
  let cursor = open.contentStartIndex;

  while (cursor < source.length) {
    const nextSlashIndex = source.indexOf("\\", cursor);
    if (nextSlashIndex < 0) {
      return null;
    }
    const command = readCommandAt(source, nextSlashIndex);
    if (!command || (command.name !== "begin" && command.name !== "end")) {
      cursor = nextSlashIndex + 1;
      continue;
    }

    const group = readBraceGroup(source, command.endIndex);
    if (!group) {
      cursor = command.endIndex;
      continue;
    }

    if (group.value.trim() === open.name) {
      if (command.name === "begin") {
        depth += 1;
      } else {
        depth -= 1;
        if (depth === 0) {
          return {
            ...open,
            body: source.slice(open.contentStartIndex, nextSlashIndex),
            endIndex: group.endIndex,
          };
        }
      }
    }
    cursor = group.endIndex;
  }

  return null;
}

function readEnvironmentOpenAt(source: string, index: number): TexEnvironmentOpen | null {
  const command = readCommandAt(source, index);
  if (command?.name !== "begin") {
    return null;
  }

  const group = readBraceGroup(source, command.endIndex);
  if (!group) {
    return null;
  }

  const option = readBracketGroup(source, group.endIndex);
  return {
    name: group.value.trim(),
    option: option?.value,
    contentStartIndex: option?.endIndex ?? group.endIndex,
  };
}

function readCommandAt(source: string, index: number): TexCommand | null {
  if (source[index] !== "\\" || !/[A-Za-z]/.test(source[index + 1] ?? "")) {
    return null;
  }

  let cursor = index + 1;
  while (/[A-Za-z]/.test(source[cursor] ?? "")) {
    cursor += 1;
  }
  const name = source.slice(index + 1, cursor);
  const starred = source[cursor] === "*";
  if (starred) {
    cursor += 1;
  }
  return { name, starred, endIndex: cursor };
}

function readCommandContentGroup(source: string, index: number): TexGroup | null {
  let cursor = index;
  while (true) {
    const option = readBracketGroup(source, cursor);
    if (!option) {
      break;
    }
    cursor = option.endIndex;
  }
  return readBraceGroup(source, cursor);
}

function readCommandArgument(source: string, index: number): TexGroup | null {
  const group = readCommandContentGroup(source, index);
  if (group) {
    return group;
  }

  const cursor = skipWhitespace(source, index);
  const value = source[cursor];
  if (!value || /[\\{}\[\]\s]/.test(value)) {
    return null;
  }
  return {
    value,
    endIndex: cursor + 1,
  };
}

function readBraceGroup(source: string, index: number): TexGroup | null {
  let cursor = skipWhitespace(source, index);
  if (source[cursor] !== "{") {
    return null;
  }
  cursor += 1;
  const start = cursor;
  let depth = 1;

  while (cursor < source.length) {
    const character = source[cursor];
    if (character === "\\") {
      cursor += 2;
      continue;
    }
    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return {
          value: source.slice(start, cursor),
          endIndex: cursor + 1,
        };
      }
    }
    cursor += 1;
  }

  return null;
}

function readBracketGroup(source: string, index: number): TexGroup | null {
  let cursor = skipWhitespace(source, index);
  if (source[cursor] !== "[") {
    return null;
  }
  cursor += 1;
  const start = cursor;
  let depth = 1;

  while (cursor < source.length) {
    const character = source[cursor];
    if (character === "\\") {
      cursor += 2;
      continue;
    }
    if (character === "[") {
      depth += 1;
    } else if (character === "]") {
      depth -= 1;
      if (depth === 0) {
        return {
          value: source.slice(start, cursor),
          endIndex: cursor + 1,
        };
      }
    }
    cursor += 1;
  }

  return null;
}

function skipCommandArguments(source: string, index: number): number {
  let cursor = index;
  let consumed = false;

  for (let count = 0; count < 3; count += 1) {
    const bracketGroup = readBracketGroup(source, cursor);
    if (bracketGroup) {
      cursor = bracketGroup.endIndex;
      consumed = true;
      continue;
    }

    const braceGroup = readBraceGroup(source, cursor);
    if (braceGroup) {
      cursor = braceGroup.endIndex;
      consumed = true;
      continue;
    }

    break;
  }

  return consumed ? cursor : index;
}

function skipWhitespace(source: string, index: number): number {
  let cursor = index;
  while (/\s/.test(source[cursor] ?? "")) {
    cursor += 1;
  }
  return cursor;
}

function stripTexComments(source: string): string {
  return source
    .split("\n")
    .map((line) => {
      for (let index = 0; index < line.length; index += 1) {
        if (line[index] === "%" && !isEscaped(line, index)) {
          return line.slice(0, index);
        }
      }
      return line;
    })
    .join("\n");
}

function extractTexTitle(source: string, createId: TexIdFactory, macros: Map<string, TexMacroDefinition>): string | null {
  let index = 0;
  while (index < source.length) {
    const command = readCommandAt(source, index);
    if (command?.name === "title") {
      const group = readBraceGroup(source, command.endIndex);
      if (group) {
        const title = texToPlainText(expandTexMacros(group.value, macros), createId);
        return title || null;
      }
    }
    index += 1;
  }
  return null;
}

function extractDocumentBody(source: string): string {
  let index = 0;
  while (index < source.length) {
    const environment = readEnvironmentAt(source, index);
    if (environment?.name === "document") {
      return environment.body;
    }
    index += 1;
  }
  return source;
}

function titleFromFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/, "") || "TeXインポート";
}

function isAlignedTextEnvironment(environmentName: string): boolean {
  return environmentName === "center" || environmentName === "flushright" || environmentName === "flushleft";
}

function alignFromEnvironment(environmentName: string): TextAlign {
  if (environmentName === "center") {
    return "center";
  }
  if (environmentName === "flushright") {
    return "right";
  }
  return "left";
}

function startsWithUnescaped(source: string, index: number, token: string): boolean {
  return source.startsWith(token, index) && !isEscaped(source, index);
}

function findUnescaped(source: string, token: string, startIndex: number): number {
  let cursor = source.indexOf(token, startIndex);
  while (cursor >= 0) {
    if (!isEscaped(source, cursor)) {
      return cursor;
    }
    cursor = source.indexOf(token, cursor + token.length);
  }
  return -1;
}

function findInlineDollarEnd(source: string, startIndex: number): number {
  let cursor = source.indexOf("$", startIndex);
  while (cursor >= 0) {
    if (!isEscaped(source, cursor) && !source.startsWith("$$", cursor)) {
      return cursor;
    }
    cursor = source.indexOf("$", cursor + 1);
  }
  return -1;
}

function isEscaped(source: string, index: number): boolean {
  let slashCount = 0;
  let cursor = index - 1;
  while (cursor >= 0 && source[cursor] === "\\") {
    slashCount += 1;
    cursor -= 1;
  }
  return slashCount % 2 === 1;
}
