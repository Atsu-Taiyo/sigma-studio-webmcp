import { describe, expect, it } from "vitest";

import {
  filterTextFlowCommandDefinitions,
  parseTextFlowCommandTrigger,
  type TextFlowCommandDefinition,
} from "./command-query";

const definitions: TextFlowCommandDefinition[] = [
  {
    id: "fancy",
    commandName: "fancybox",
    displayName: "囲み枠",
    description: "本文を枠で囲む",
    aliases: ["frame", "枠"],
  },
  {
    id: "note",
    commandName: "notebox",
    displayName: "ノート",
    description: "補足を書く",
    aliases: ["memo", "メモ"],
  },
  {
    id: "fullwidth",
    commandName: "ＦＵＬＬ",
    displayName: "全角",
    description: "全角英字の定義",
    aliases: ["ＷＩＤＥ"],
  },
  {
    id: "theorem",
    commandName: "theorem",
    displayName: "定理",
    description: "証明する命題",
    aliases: ["proof"],
  },
];

describe("parseTextFlowCommandTrigger", () => {
  it("accepts slash commands only at the start of a text block", () => {
    expect(parseTextFlowCommandTrigger("/")).toEqual({
      query: "",
      triggerLength: 1,
    });
    expect(parseTextFlowCommandTrigger("  /fancybox")).toEqual({
      query: "fancybox",
      triggerLength: 9,
    });
    expect(parseTextFlowCommandTrigger("／図形")).toEqual({
      query: "図形",
      triggerLength: 3,
    });
    expect(parseTextFlowCommandTrigger("本文/fancybox")).toBeNull();
    expect(parseTextFlowCommandTrigger("/fancybox test")).toBeNull();
    expect(parseTextFlowCommandTrigger("@公式")).toBeNull();
  });

  it("does not include accepted leading whitespace in the replacement length", () => {
    expect(parseTextFlowCommandTrigger("\t  ／abc")).toEqual({
      query: "abc",
      triggerLength: 4,
    });
  });
});

describe("filterTextFlowCommandDefinitions", () => {
  it("preserves definition order and applies the limit for an empty query", () => {
    expect(filterTextFlowCommandDefinitions(definitions, {
      query: "",
      limit: 2,
    }).map(({ id }) => id)).toEqual(["fancy", "note"]);
  });

  it("filters allowed ids without adopting allowed-id order", () => {
    expect(filterTextFlowCommandDefinitions(definitions, {
      query: "",
      allowedIds: ["theorem", "fancy"],
      limit: 6,
    }).map(({ id }) => id)).toEqual(["fancy", "theorem"]);
    expect(filterTextFlowCommandDefinitions(definitions, {
      query: "",
      allowedIds: [],
      limit: 6,
    })).toEqual([]);
  });

  it("matches every searchable field with NFKC and case normalization", () => {
    expect(filterTextFlowCommandDefinitions(definitions, {
      query: "ＦＡＮ",
      limit: 6,
    }).map(({ id }) => id)).toEqual(["fancy"]);
    expect(filterTextFlowCommandDefinitions(definitions, {
      query: "ノート",
      limit: 6,
    }).map(({ id }) => id)).toEqual(["note"]);
    expect(filterTextFlowCommandDefinitions(definitions, {
      query: "命題",
      limit: 6,
    }).map(({ id }) => id)).toEqual(["theorem"]);
    expect(filterTextFlowCommandDefinitions(definitions, {
      query: "wide",
      limit: 6,
    }).map(({ id }) => id)).toEqual(["fullwidth"]);
  });

  it("trims the normalized query before matching", () => {
    expect(filterTextFlowCommandDefinitions(definitions, {
      query: "  ＦＵＬＬ  ",
      limit: 6,
    }).map(({ id }) => id)).toEqual(["fullwidth"]);
  });
});
