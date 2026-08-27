export interface TextFlowCommandDefinition {
  id: string;
  commandName: string;
  displayName: string;
  description: string;
  aliases: readonly string[];
}

export interface TextFlowCommandTriggerQuery {
  query: string;
  triggerLength: number;
}

export interface FilterTextFlowCommandDefinitionsOptions {
  query: string;
  allowedIds?: readonly string[];
  limit: number;
}

export function parseTextFlowCommandTrigger(
  beforeCursor: string,
): TextFlowCommandTriggerQuery | null {
  const match = beforeCursor.match(/^\s*([/／])([^\s]*)$/);
  if (!match) {
    return null;
  }

  const query = match[2] ?? "";
  return {
    query,
    triggerLength: (match[1]?.length ?? 1) + query.length,
  };
}

export function filterTextFlowCommandDefinitions(
  definitions: readonly TextFlowCommandDefinition[],
  options: FilterTextFlowCommandDefinitionsOptions,
): TextFlowCommandDefinition[] {
  const normalizedQuery = options.query.normalize("NFKC").trim().toLowerCase();
  const allowed = options.allowedIds ? new Set(options.allowedIds) : null;
  const candidates = definitions.filter((definition) => (
    !allowed || allowed.has(definition.id)
  ));

  if (!normalizedQuery) {
    return candidates.slice(0, options.limit);
  }

  return candidates
    .filter((candidate) => [
      candidate.commandName,
      candidate.displayName,
      candidate.description,
      ...candidate.aliases,
    ].some((value) => (
      value.normalize("NFKC").toLowerCase().includes(normalizedQuery)
    )))
    .slice(0, options.limit);
}
