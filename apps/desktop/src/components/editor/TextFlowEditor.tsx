"use client";

import { Extension, Node as TiptapNodeExtension, type Editor as TiptapEditor } from "@tiptap/core";
import { Fragment, Slice, type Mark as ProseMirrorMark, type Node as ProseMirrorModelNode } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey, Selection, TextSelection, type EditorState, type Selection as ProseMirrorSelection, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { EditorContent, useEditor } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import { Copy, Heading, ListChevronsUpDown, Minus, Moon, Plus, Settings2, Sun, Trash2, Type, X } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";

import {
  flushDeferredCaretScroll,
  getCaretSurfaceBand,
  getCaretZoomScale,
  scrollCaretIntoView,
} from "@/components/editor/text-flow/caret-scroll";
import {
  caretAtTextblockEdgeLine,
  focusCaretAddress,
  moveCaretHorizontally,
  moveCaretVertically,
  registerCaretSurface,
  updateCaretSurfaceFacets,
  type CaretSurfaceFacets,
} from "@/components/editor/text-flow/caret-router";
import { posAtClientPoint } from "@/components/editor/text-flow/pos-at-client-point";
import { BoxSettingsDialog } from "@/components/editor/BoxSettingsDialog";
import { MaterialContentPreview } from "@/components/editor/MaterialPreview";
import { Select } from "@/components/ui/Select";
import type { TextFlowChangeDecorationState } from "@/components/tiptap/change-decoration";
import {
  EditGuardExtension,
  editGuardKey,
  getTextFlowEditGuardsSyncKey,
  type TextFlowEditGuard,
} from "@/components/tiptap/edit-guard-extension";
import {
  ExternalTextRangeHighlightExtension,
  getPlainTextBlockLength,
  getTextRangeForBlock,
} from "@/components/tiptap/external-text-range-highlight-extension";
import {
  requestInlineMathEdit,
  sliceTextForClipboard,
} from "@/components/tiptap/inline-math-extension";
// `refreshPageBreakGaps` (個別 dispatch) は使わない: 装飾の更新は 1 本の transaction に
// まとめてあるので、meta キー (`paginationGapKey`) だけを取る。
import { PageBreakGapExtension, paginationGapKey, type PageBreakMarkerLayout } from "@/components/tiptap/page-break-gap-extension";
import { HeadingNumberingExtension, headingNumberingKey } from "@/components/tiptap/heading-numbering-extension";
import { createRichTextEngineExtensions } from "@/components/tiptap/rich-text-engine";
import { CodeBlockActionExtension } from "@/components/tiptap/code-block-action-extension";
import { useMathEnvironment } from "@/features/rendering/adapters/react";
import { CODE_BLOCK_LANGUAGES, normalizeCodeLanguage } from "@/features/rendering/adapters";
import {
  applyTextFormatCommand,
  dispatchTextFormatState,
  isTextFormatTargetNodeType,
  isValidTextFormatSelection,
  type TextFormatCommandOptions,
  type TextFormatSelectionRange,
  type TextFormatStateContext,
} from "@/components/tiptap/text-format-controller";
import { UrlDetectionExtension } from "@/components/tiptap/url-detection-extension";
import { startExpandedTextSelection } from "@/components/editor/expanded-text-selection";
import { createTranslator, getAppLocale, type Translate } from "@/lib/i18n";
import { useAppLocale, useT } from "@/lib/i18n/react";
import type { PageBreakMarkerKind } from "@/features/text-editing/model";
import {
  DEFAULT_FONT_FAMILY_VALUE,
  FONT_FAMILY_GROUPS,
  LINE_HEIGHT_OPTIONS,
} from "@/components/editor/editor-shell/constants";
import {
  boxFrameClassName,
  boxFrameDecorationAttributes,
  boxFrameStyleAttribute,
  cornerBoxReferenceHeightStyleVars,
  createBoxBlock,
  observeCornerBoxReferenceHeights,
  patchBoxFrame,
  resolveBoxFrame,
  resolveBoxStyles,
  setBoxStyle,
} from "@/lib/box-blocks";
import {
  getBlockSpaceAfterPreview,
  subscribeBlockSpaceAfterPreview,
} from "@/components/editor/text-flow/block-space-after-preview";
import { createSpaceAfterPreviewDecorations } from "@/components/editor/text-flow/space-after-preview-decorations";
import {
  applyRememberedBoxFrame,
  forgetRememberedBoxFrame,
  rememberBoxFramePatch,
} from "@/lib/remembered-box-style";
import { createId } from "@/lib/id";
import {
  BLOCK_SPACE_AFTER_CSS_VARIABLE,
  blockSpaceAfterFromStyleValue,
  blockSpaceAfterStyleAttr,
  MAX_LINE_HEIGHT,
  MIN_LINE_HEIGHT,
  normalizeCodeBlockTheme,
  normalizeLineHeight,
  stepLineHeight,
  type BoxBlockChildBlock,
  type BoxBlockNode,
  type BoxFrameSpec,
  type CodeBlockTheme,
  type InlineNode,
  type LineHeight,
  type SigmaCommentThread,
} from "@/features/document";
import { isOfficialMaterial } from "@/lib/official-materials";
import { materialMatchesQuery } from "@/lib/materials";
import { countDecorationBlockWalk } from "@/components/tiptap/decoration-walk-metrics";
import { countPerformanceEvent, measurePerformance } from "@/lib/performance";
import {
  inlineNodesToTiptapNodes,
  tiptapNodesToInlineNodes,
  type TiptapDoc,
  type TiptapNode,
} from "@/lib/tiptap-adapter";
import {
  cloneTextFlowBlocksForPaste,
  createTextFlowClipboardPayload,
  getLocalEditorClipboardPayload,
  markBodyTextCut,
  readEditorClipboardPayload,
  readTextSliceClipboardData,
  toOverlayShapesClipboardPayload,
  writeEditorPayloadToSystemClipboard,
  writeTextSliceClipboardData,
  type EditorClipboardPayload,
} from "@/lib/editor-clipboard";
import {
  areTextFlowBlockIdSequencesEqual,
  bodyTextFlowBlockContainsId,
  filterTextFlowCommandDefinitions,
  getCommentThreadsSyncKey,
  getNestedPageBreakBeforeIds,
  getPageBreakBeforeIds as collectPageBreakBeforeIds,
  getTextFlowBreakGapSyncKey,
  getTextFlowColumnLayoutsSyncKey,
  getTextFlowFragmentLayoutsSyncKey,
  getLastTextFlowBlockId,
  getTextFlowBlockEditorLength,
  getTextFlowBlockIds,
  getTextFlowBlocksSyncKey,
  hasTextFlowBlockAttributeChange,
  hasTextFlowBlockKindChange,
  idPrefixForTextNode,
  isRecord,
  normalizeLayoutSectionColumnCount,
  normalizeNonnegativeNumber,
  normalizeTextAlign,
  parseTextFlowCommandTrigger,
  resolveManualTextPageBreakBlocks,
  shouldSyncExternalTextFlowContent,
  shouldSyncFocusedTextFlowContent,
  shouldUseDocumentNextBlockForPageBreak,
  textFlowBlockAttributeSignature,
  textFlowBlocksContainId,
  textFlowCommandNameMatchRank,
  type ManualTextPageBreakSelection,
  type TextFlowBlock,
  type TextFlowBlockKind,
  type TextFlowCommandDefinition,
  clampCaretOffset,
  normalizeCaretAddressPath,
  DEFAULT_CARET_AFFINITY,
  type CaretAddress,
  type CaretAddressKind,
  type CaretAffinity,
  type CaretBlockPathEntry,
  type TextFlowSelectionBookmark,
  type TextPageBreakRequestDetail,
} from "@/features/text-editing";
import type { MaterialItem } from "@/types/material";
import {
  textFlowBlockToTiptapNode,
  textFlowToTiptap,
  tiptapToTextFlow,
} from "./text-flow/tiptap-document-adapter";
import {
  createTextFlowHistoryGroupingState,
  groupTextFlowTransaction,
} from "./text-flow/history-grouping";
import { pasteAsInlineContent } from "./text-flow/inline-block-paste";
import { parsePastedMarkdown } from "./text-flow/markdown-paste";
import type {
  TextFlowBoundaryDeleteRequest,
  TextFlowBoxFragmentSourceLayout,
  TextFlowColumnBlockLayout,
  TextFlowEditorProps,
} from "./text-flow/types";
import {
  beginTextFlowDocumentChange,
  publishTextFlowSelectionBookmark,
} from "./text-flow/caret-bookmark-events";
import { refreshManualColumnFlowHeights } from "./text-flow/manual-column-flow";
import {
  insertTextSliceWithFreshBlockIds,
  requestOverlayShapesPaste,
  resolveTextRunSpanAnchorBlockIdMap,
} from "./text-flow/text-and-shapes-clipboard";
import {
  SELECT_BODY_WITH_SHAPES_EVENT,
  collectSelectedBlockIds,
  requestBodySelectionShapes,
} from "./text-flow/body-shape-selection";
import {
  applyTextRunSpanFormatForEvent,
  beginTextRunSpanComposition,
  clearTextRunSpan,
  clearTextRunSpanOnOutsideFocus,
  collectTextRunSpanBlockIds,
  copyActiveTextRunSpan,
  getTextRunSpanCompositionHistoryGroup,
  getTextRunSpanToggleMarkStates,
  handleTextRunSpanKeyDown,
  handleTextRunSpanTextInput,
  isMultiEditorTextRunSpan,
  replaceActiveTextRunSpan,
  selectEntireTextRun,
  startTextRunPointerSelection,
  subscribeTextRunSpan,
} from "./text-flow/text-run-span";
import { plainTextToTextFlowParagraphs, sliceToTextFlowBlocks } from "./text-flow/text-run-slice";
import {
  clearBoxFragmentSelection,
  clearBoxFragmentSelectionOnOutsideFocus,
  startBoxFragmentPointerSelection,
} from "./text-flow/box-fragment-selection";

export type { TextFlowChangeDecorationState } from "@/components/tiptap/change-decoration";
export {
  isTextFlowBlock,
  resolveManualTextPageBreakBlocks,
  shouldSyncFocusedTextFlowContent,
  shouldUseDocumentNextBlockForPageBreak,
} from "@/features/text-editing";
export {
  textFlowToTiptap,
  tiptapToTextFlow,
} from "./text-flow/tiptap-document-adapter";
export type {
  ManualTextPageBreakResult,
  ManualTextPageBreakSelection,
  TextFlowBlock,
  TextFlowBodyBlockCommandRequest,
  TextFlowBoundaryDeleteRequest,
  TextFlowBoxCommandRequest,
  TextFlowBoxFragmentSourceLayout,
  TextFlowChangeContext,
  TextFlowColumnBlockLayout,
  TextFlowEditorProps,
  TextFlowMaterialInsertRequest,
  TextFlowProblemCommandRequest,
  TextFlowHeadingCommandRequest,
  TextFlowReplaceOptions,
  TextPageBreakRequestDetail,
} from "./text-flow/types";

const INSERT_INLINE_MATH_EVENT = "sigma-studio:insert-inline-math";
const FORMAT_TEXT_EVENT = "sigma-studio:format-text";
const TEXT_FORMAT_STATE_EVENT = "sigma-studio:text-format-state";
export const REQUEST_TEXT_PAGE_BREAK_EVENT = "sigma-studio:request-text-page-break";
export const REQUEST_BOX_SETTINGS_EVENT = "sigma-studio:request-box-settings";
const selectedTextBlockKey = new PluginKey("selectedTextBlock");
const changeDecorationKey = new PluginKey("textFlowChangeDecoration");
const commentDecorationKey = new PluginKey("commentDecorations");
const columnFlowLayoutKey = new PluginKey("columnFlowLayout");
const spaceAfterPreviewKey = new PluginKey("spaceAfterPreview");
const SPACE_AFTER_REFRESH_KINDS: ReadonlySet<TextFlowDecorationRefreshKind> = new Set(["spaceAfter"]);
const DIRECT_CONTROL_SELECTOR = "input, textarea, select, button, math-field";
const TEXT_FLOW_EDITOR_SELECTOR = ".text-flow-editor";
const MAX_MATERIAL_CANDIDATES = 8;
const MAX_SLASH_COMMAND_CANDIDATES = 12;
const SLASH_COMMAND_POPOVER_WIDTH = 300;
const SLASH_COMMAND_POPOVER_MAX_HEIGHT = 320;
const SLASH_COMMAND_PREVIEW_WIDTH = 260;
const SLASH_COMMAND_PREVIEW_HEIGHT = 224;
const SLASH_COMMAND_GAP = 10;
const SLASH_COMMAND_MARGIN = 12;
const LITERAL_PASTE_SHORTCUT_WINDOW_MS = 1500;
/**
 * Tiptap の `renderHTML` は React の外で走るので `useT` を呼べない。
 * 表示のたびにロケールストアから引く (言語を変えたあと、その箱が
 * 描き直されたときに追随する)。
 */
function boxActionLabel(): string {
  return createTranslator(getAppLocale(), "editor")("box.actions");
}

const MAX_BOX_COMMAND_CANDIDATES = 6;
/** 本文ブロック候補が無いときに渡す不変配列 (毎回新しい `[]` を作ると useMemo が毎回外れる)。 */
const EMPTY_BLOCK_COMMAND_IDS: readonly string[] = [];
const BOX_ACTION_DIALOG_WIDTH = 188;
const BOX_ACTION_DIALOG_HEIGHT = 180;
const BOX_ACTION_DIALOG_MARGIN = 12;
const CODE_SETTINGS_POPOVER_WIDTH = 260;
const CODE_SETTINGS_POPOVER_HEIGHT = 214;
const CODE_SETTINGS_POPOVER_MARGIN = 12;
const EDITOR_CORNERBOX_SELECTOR = ".sigma-doc-box-block.box-frame--corner[data-box-style='cornerbox']";
/**
 * `/` コマンドの一覧。**文言は毎回 `t` から解決する** (module 直下で作ると
 * 起動時の言語で焼き付き、切り替えても古い言語のまま残る)。
 */
function buildBoxCommandDefinitions(t: Translate<"editor">): TextFlowCommandDefinition[] {
  return resolveBoxStyles(t).map((style) => ({
    id: style.id,
    commandName: style.commandName,
    displayName: style.displayName,
    description: style.description,
    aliases: style.aliases,
  }));
}

/**
 * 本文ブロック (引用・コード・区切り線) の `/` コマンド。囲み枠と同じ一覧に並べる。
 *
 * `id` は**そのままブロック種別**として扱う ({@link insertBodyBlockCommandFromQuery})。
 * 打つ文字列 (`commandName`) は言語ごとに変わるので、分岐に使えるのは id だけ。
 */
const BODY_BLOCK_COMMAND_KINDS = ["quote", "codeBlock", "divider"] as const;

type BodyBlockCommandKind = (typeof BODY_BLOCK_COMMAND_KINDS)[number];

function bodyBlockCommandId(kind: BodyBlockCommandKind): string {
  return `insert.${kind}`;
}

function bodyBlockCommandKindFromId(id: string): BodyBlockCommandKind | null {
  return BODY_BLOCK_COMMAND_KINDS.find((kind) => bodyBlockCommandId(kind) === id) ?? null;
}

function buildBodyBlockCommandDefinitions(t: Translate<"editor">): TextFlowCommandDefinition[] {
  return BODY_BLOCK_COMMAND_KINDS.map((kind) => ({
    id: bodyBlockCommandId(kind),
    // コマンド名は打つ文字列そのもの。英語 UI では英語で打てないと使えない。
    commandName: t(`slash.block.${kind}.command` as never) as string,
    displayName: t(`slash.block.${kind}.displayName` as never) as string,
    description: t(`slash.block.${kind}.description` as never) as string,
    aliases: (t(`slash.block.${kind}.aliases` as never) as string).split(" ").filter(Boolean),
  }));
}

/**
 * いま置ける本文ブロック。置けない物を一覧に出すと「選んでも何も起きない」候補になるので、
 * キャレットの位置から先に絞る (引用の中の引用、コードの中のコードは作れない)。
 */
function getAvailableBodyBlockCommandIds(state: EditorState): string[] {
  const { $from } = state.selection;
  const ids: string[] = [];
  if (state.schema.nodes.quote && findAncestorNodeDepth($from, "quote") < 0) {
    ids.push(bodyBlockCommandId("quote"));
  }
  if (state.schema.nodes.codeBlock && $from.parent.type.name !== "codeBlock") {
    ids.push(bodyBlockCommandId("codeBlock"));
  }
  if (state.schema.nodes.divider) {
    ids.push(bodyBlockCommandId("divider"));
  }
  return ids;
}

function buildProblemCommandDefinition(t: Translate<"editor">): TextFlowCommandDefinition {
  return {
    id: "insert.problem",
    // コマンド名は打つ文字列そのもの。英語 UI では英語で打てないと使えない。
    commandName: t("slash.problem.command"),
    displayName: t("slash.problem.displayName"),
    description: t("slash.problem.description"),
    aliases: (t("slash.problem.aliases") as string).split(" ").filter(Boolean),
  };
}

function buildHeadingCommandDefinitions(t: Translate<"editor">): Array<TextFlowCommandDefinition & { level: 1 | 2 | 3 }> {
  const headings = [
    { level: 1, key: "heading1" },
    { level: 2, key: "heading2" },
    { level: 3, key: "heading3" },
  ] as const;
  return headings.map(({ level, key }) => ({
    id: `insert.heading.${level}`,
    level,
    commandName: t(`slash.${key}.command`),
    displayName: t(`slash.${key}.displayName`),
    description: t(`slash.${key}.description`),
    aliases: (t(`slash.${key}.aliases`) as string).split(" ").filter(Boolean),
  }));
}

interface ActiveSlashCommandQuery {
  blockId: string;
  from: number;
  to: number;
  query: string;
  canInsertBox: boolean;
  /** いまのキャレット位置で置ける本文ブロックの id。空なら本文ブロックは出さない。 */
  availableBlockCommandIds: string[];
  rect: {
    bottom: number;
    left: number;
  };
  screenPoint: {
    x: number;
    y: number;
  };
}

interface BoxActionDialogState {
  boxId: string;
  left: number;
  top: number;
}

interface BoxSettingsDialogState {
  boxId: string;
  styleId: string;
  frame?: BoxFrameSpec;
  title: InlineNode[];
  /** ⋯メニューの「タイトルを編集…」から開いたときだけ true。 */
  focusTitle: boolean;
}

interface CodeBlockSettingsPopoverState {
  codeBlockId: string;
  language: string | null;
  theme: CodeBlockTheme;
  left: number;
  top: number;
}

interface TextFormatContextMenuState {
  left: number;
  top: number;
  fontFamily: string;
  lineHeight: LineHeight;
  hasSelection: boolean;
  boxId: string | null;
}

type SlashCommandCandidate =
  | { kind: "box"; box: TextFlowCommandDefinition }
  | { kind: "block"; block: TextFlowCommandDefinition }
  | { kind: "problem"; problem: TextFlowCommandDefinition }
  | { kind: "heading"; heading: TextFlowCommandDefinition & { level: 1 | 2 | 3 } }
  | { kind: "material"; material: MaterialItem };

interface SelectedTextBlockOptions {
  getSelectedId: () => string | null;
}

interface CommentDecorationOptions {
  getActiveThreadId: () => string | null;
  getBlockIds: () => string[];
  getHighlightedThreadId: () => string | null;
  getThreads: () => SigmaCommentThread[];
}

interface ColumnFlowLayoutOptions {
  getLayouts: () => Record<string, TextFlowColumnBlockLayout>;
  getBoxFragmentSourceLayouts: () => Record<string, TextFlowBoxFragmentSourceLayout>;
}

export const SigmaDocTextAttrs = Extension.create({
  name: "sigmaDocTextAttrs",

  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading", "bulletList", "orderedList"],
        attributes: {
          textAlign: {
            default: null,
            parseHTML: (element) => element.style.textAlign || null,
            renderHTML: (attributes) => {
              const align = normalizeTextAlign(attributes.textAlign);
              return align ? { style: `text-align: ${align}` } : {};
            },
          },
          lineHeight: {
            default: null,
            parseHTML: (element) => element.style.lineHeight || null,
            renderHTML: (attributes) => {
              const lineHeight = normalizeLineHeight(attributes.lineHeight);
              return lineHeight ? { style: `line-height: ${lineHeight}` } : {};
            },
          },
          // ブロック下余白。`pagination` と違って **DOM へ出す** — 編集面・静的描画・印刷/PDF が
          // 同じインライン custom property を読んで `document-surface.css` の padding になる。
          // (`mergeAttributes` は同じ `style` キーを "; " で繋ぐので textAlign / lineHeight と共存する)
          spaceAfterPx: {
            default: null,
            // Enter で割ったとき後半へ複製しない。「このブロックの下の余白」なので前半が持つ。
            keepOnSplit: false,
            parseHTML: (element) => blockSpaceAfterFromStyleValue(
              element.style.getPropertyValue(BLOCK_SPACE_AFTER_CSS_VARIABLE),
            ),
            renderHTML: (attributes) => blockSpaceAfterStyleAttr(attributes.spaceAfterPx),
          },
          sigmaDocId: {
            default: null,
            renderHTML: (attributes) => {
              const id = typeof attributes.sigmaDocId === "string" ? attributes.sigmaDocId : undefined;
              return id ? { id, "data-sigma-doc-id": id } : {};
            },
          },
          sigmaDocType: {
            default: null,
            renderHTML: (attributes) => {
              const type = typeof attributes.sigmaDocType === "string" ? attributes.sigmaDocType : undefined;
              return type ? { "data-sigma-doc-type": type } : {};
            },
          },
        },
      },
      {
        // 改ページ / 改段 / keep 系。SigmaDoc のブロック属性であって見た目ではないので、DOM へは
        // 出さず (描画は page-break-gap-extension の decoration が SigmaDoc から作る)、PM の doc に
        // 載せるのはコピー&ペーストで運ぶためだけ。slice がこれを持たないと、貼り付け先では
        // 新しいブロック id になるので id 一致による復元が効かず、改ページが黙って消える。
        types: ["paragraph", "heading", "bulletList", "orderedList", "boxBlock", "layoutSection"],
        attributes: {
          pagination: {
            default: null,
            // Enter でブロックを割ったとき、後半へ改ページが複製されないようにする
            // (break は「このブロックの前で改ページ」の意味なので、前半だけが持つ)。
            keepOnSplit: false,
            parseHTML: () => null,
            renderHTML: () => ({}),
          },
        },
      },
      {
        // 囲み枠・段組は下余白を **描かない** (padding は枠の内側に入ってしまうため) が、値は
        // PM の doc に載せて往復させる — 載せないと編集のたびに attrs から落ちて黙って消える。
        types: ["boxBlock", "layoutSection"],
        attributes: {
          spaceAfterPx: {
            default: null,
            keepOnSplit: false,
            parseHTML: () => null,
            renderHTML: () => ({}),
          },
        },
      },
      {
        // Ordered lists only: `markerStyle` is meaningless on paragraphs, headings, and bullets.
        // The attribute name matches `ListNode.markerStyle`; the DOM attribute is what
        // `document-surface.css` selects on, so the editor and the static renderer agree.
        types: ["orderedList"],
        attributes: {
          markerStyle: {
            default: null,
            parseHTML: (element) => element.getAttribute("data-list-marker"),
            renderHTML: (attributes) => (
              attributes.markerStyle === "paren" ? { "data-list-marker": "paren" } : {}
            ),
          },
        },
      },
    ];
  },
});

export const BoxBlockExtension = TiptapNodeExtension.create({
  name: "boxBlock",
  group: "block",
  content: "boxBlockTitle boxBlockBody",
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      sigmaDocId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-sigma-doc-id"),
      },
      sigmaDocType: {
        default: "boxBlock",
      },
      styleId: {
        default: "fancybox",
        parseHTML: (element) => element.getAttribute("data-box-style") || "fancybox",
      },
      frame: {
        default: null,
      },
    };
  },

  parseHTML() {
    return [{ tag: "section[data-sigma-doc-type='boxBlock']" }];
  },

  renderHTML({ node }) {
    const styleId = typeof node.attrs.styleId === "string" ? node.attrs.styleId : "fancybox";
    const frame = isRecord(node.attrs.frame) ? node.attrs.frame as BoxFrameSpec : undefined;
    const resolvedFrame = resolveBoxFrame({ styleId, frame });
    const decorationAttrs = boxFrameDecorationAttributes(resolvedFrame);
    return [
      "section",
      {
        "data-sigma-doc-id": typeof node.attrs.sigmaDocId === "string" ? node.attrs.sigmaDocId : undefined,
        "data-sigma-doc-type": "boxBlock",
        "data-box-style": styleId,
        class: boxFrameClassName("sigma-doc-box-block", resolvedFrame, styleId),
        style: boxFrameStyleAttribute(resolvedFrame),
        ...decorationAttrs,
      },
      ["span", { class: "sigma-doc-box-corner top-left", contenteditable: "false" }],
      ["span", { class: "sigma-doc-box-corner top-right", contenteditable: "false" }],
      ["span", { class: "sigma-doc-box-corner bottom-left", contenteditable: "false" }],
      ["span", { class: "sigma-doc-box-corner bottom-right", contenteditable: "false" }],
      ["button", {
        type: "button",
        class: "sigma-doc-block-action-button sigma-doc-box-action-button",
        "data-box-action-button": "true",
        contenteditable: "false",
        title: boxActionLabel(),
        "aria-label": boxActionLabel(),
      }, "⋯"],
      ["div", { class: "sigma-doc-box-content" }, 0],
    ];
  },
});

interface BoxBlockTitleOptions {
  readOnly: boolean;
}

export const BoxBlockTitleExtension = TiptapNodeExtension.create<BoxBlockTitleOptions>({
  name: "boxBlockTitle",
  content: "inline*",
  defining: true,

  addOptions() {
    return {
      readOnly: false,
    };
  },

  parseHTML() {
    return [{ tag: "div[data-box-title-region='true']" }];
  },

  renderHTML() {
    return [
      "div",
      {
        class: "sigma-doc-box-title",
        "data-box-title-region": "true",
        ...(this.options.readOnly ? {
          contenteditable: "false",
          "aria-readonly": "true",
        } : {}),
      },
      0,
    ];
  },

  addKeyboardShortcuts() {
    return {
      Enter: () => (
        this.options.readOnly && isSelectionInsideBoxTitle(this.editor)
      ) || moveSelectionFromBoxTitleToBody(this.editor),
    };
  },
});

interface BoxBlockBodyOptions {
  titleReadOnly: boolean;
}

export const BoxBlockBodyExtension = TiptapNodeExtension.create<BoxBlockBodyOptions>({
  name: "boxBlockBody",
  content: "block+",
  defining: true,
  isolating: true,

  addOptions() {
    return {
      titleReadOnly: false,
    };
  },

  parseHTML() {
    return [{ tag: "div.sigma-doc-box-body" }];
  },

  renderHTML() {
    return ["div", { class: "sigma-doc-box-body" }, 0];
  },

  addKeyboardShortcuts() {
    return {
      Backspace: () => (
        this.options.titleReadOnly && isSelectionAtBoxBodyStart(this.editor)
      ) || moveSelectionFromBoxBodyStartToTitle(this.editor),
    };
  },
});

function moveSelectionFromBoxTitleToBody(editor: TiptapEditor): boolean {
  const { state } = editor;
  const { $from } = state.selection;
  const titleDepth = findAncestorNodeDepth($from, "boxBlockTitle");
  if (titleDepth < 1) {
    return false;
  }

  const boxDepth = titleDepth - 1;
  const boxNode = $from.node(boxDepth);
  const titleNode = boxNode.firstChild;
  if (boxNode.type.name !== "boxBlock" || titleNode?.type.name !== "boxBlockTitle") {
    return false;
  }

  const boxStart = $from.before(boxDepth);
  const bodyStart = boxStart + 1 + titleNode.nodeSize;
  const selection = TextSelection.near(state.doc.resolve(bodyStart + 1), 1);
  editor.view.dispatch(state.tr.setSelection(selection).scrollIntoView());
  return true;
}

function isSelectionInsideBoxTitle(editor: TiptapEditor): boolean {
  return findAncestorNodeDepth(editor.state.selection.$from, "boxBlockTitle") >= 0;
}

function moveSelectionFromBoxBodyStartToTitle(editor: TiptapEditor): boolean {
  if (!isSelectionAtBoxBodyStart(editor)) {
    return false;
  }

  const { state } = editor;
  const { $from } = state.selection;
  const bodyDepth = findAncestorNodeDepth($from, "boxBlockBody");
  const boxDepth = bodyDepth - 1;
  const boxNode = $from.node(boxDepth);
  const titleNode = boxNode.firstChild;
  if (boxNode.type.name !== "boxBlock" || titleNode?.type.name !== "boxBlockTitle") {
    return false;
  }

  const boxStart = $from.before(boxDepth);
  const titleEnd = boxStart + titleNode.nodeSize;
  const selection = TextSelection.near(state.doc.resolve(titleEnd), -1);
  editor.view.dispatch(state.tr.setSelection(selection).scrollIntoView());
  return true;
}

function isSelectionAtBoxBodyStart(editor: TiptapEditor): boolean {
  const { state } = editor;
  if (!state.selection.empty) {
    return false;
  }

  const { $from } = state.selection;
  const bodyDepth = findAncestorNodeDepth($from, "boxBlockBody");
  if (bodyDepth < 1) {
    return false;
  }

  const bodyStart = $from.before(bodyDepth);
  const firstBodySelection = TextSelection.findFrom(state.doc.resolve(bodyStart + 1), 1, true);
  return firstBodySelection?.from === state.selection.from;
}

function findAncestorNodeDepth(
  position: EditorState["selection"]["$from"],
  nodeTypeName: string,
): number {
  for (let depth = position.depth; depth > 0; depth -= 1) {
    if (position.node(depth).type.name === nodeTypeName) {
      return depth;
    }
  }
  return -1;
}

export const LayoutSectionExtension = TiptapNodeExtension.create({
  name: "layoutSection",
  group: "block",
  // `divider` を名指しているので、この拡張は `createRichTextEngineExtensions` の
  // `bodyBlocks: true` (= DividerExtension を積む) と **必ず同時に** 使う。
  // 片方だけだと ProseMirror がスキーマ構築時に "No node type or group 'divider' found" で落ちる。
  content: "(paragraph | heading | bulletList | orderedList | divider | boxBlock)+",
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      sigmaDocId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-sigma-doc-id"),
      },
      sigmaDocType: {
        default: "layoutSection",
      },
      columnCount: {
        default: 2,
        parseHTML: (element) => Number.parseInt(element.getAttribute("data-column-count") ?? "2", 10),
      },
      columnGapMm: {
        default: 8,
        parseHTML: (element) => Number.parseFloat(element.getAttribute("data-column-gap-mm") ?? "8"),
      },
    };
  },

  parseHTML() {
    return [{ tag: "section[data-sigma-doc-type='layoutSection']" }];
  },

  renderHTML({ node }) {
    const columnCount = normalizeLayoutSectionColumnCount(node.attrs.columnCount);
    const columnGapMm = normalizeNonnegativeNumber(node.attrs.columnGapMm) ?? 8;
    return [
      "section",
      {
        "data-sigma-doc-id": typeof node.attrs.sigmaDocId === "string" ? node.attrs.sigmaDocId : undefined,
        "data-sigma-doc-type": "layoutSection",
        "data-column-count": String(columnCount),
        "data-column-gap-mm": String(columnGapMm),
        class: "sigma-doc-layout-section-block",
        style: [
          `--sigma-doc-local-column-count:${columnCount}`,
          `--sigma-doc-local-column-gap:${columnGapMm}mm`,
        ].join(";"),
      },
      ["div", { class: "sigma-doc-layout-section-body" }, 0],
    ];
  },
});

export const SigmaDocTextIdentity = Extension.create({
  name: "sigmaDocTextIdentity",

  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { state } = this.editor;
        const parent = state.selection.$from.parent;

        if (parent.type.name !== "heading") {
          return false;
        }

        const activeMarks = state.storedMarks ?? (
          state.selection.$to.parentOffset > 0
            ? state.selection.$from.marks()
            : null
        );
        const marks = activeMarks?.filter((mark) => (
          this.editor.extensionManager.splittableMarks.includes(mark.type.name)
        )) ?? null;

        return this.editor
          .chain()
          .splitBlock()
          .setParagraph()
          .updateAttributes("paragraph", {
            sigmaDocId: createId("p"),
            sigmaDocType: "paragraph",
          })
          // setParagraph / updateAttributes add node-markup steps after splitBlock has restored
          // the active marks. ProseMirror clears storedMarks for each added step, so restore them
          // once more at the end of this compound Enter command.
          .command(({ tr }) => {
            if (marks !== null) {
              tr.setStoredMarks(marks);
            }
            return true;
          })
          .run();
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction: appendSigmaDocTextIdentityTransaction,
      }),
    ];
  },
});

export function appendSigmaDocTextIdentityTransaction(
  transactions: readonly Transaction[],
  oldState: EditorState,
  newState: EditorState,
): Transaction | null {
  if (!transactions.some((transaction) => transaction.docChanged)) {
    return null;
  }

  const textNodes: Array<{
    node: ProseMirrorModelNode;
    pos: number;
    currentId: string;
    currentType: string;
    nextType: string;
  }> = [];

  // id を配るのは本文のブロック (段落/見出し/引用/コード/区切り線) だけ。その中身
  // (テキスト・数式) に降りても用は無いので降りない — 打鍵のたびに本文の全ノードを
  // 歩くのはここだった。
  //
  // 引用・コード・区切り線を外すと、PM のコマンド (`toggleQuoteBlock` 等) が作った
  // ノードが id 無しのまま残る。段組みのブロック配置は id で引くので、id が付くまで
  // そのブロックだけ配置されず「潰れた編集面 root の原点 = 1 ページ目上端」に取り残される。
  countDecorationBlockWalk();
  newState.doc.descendants((node, pos, parent, index) => {
    const typeName = node.type.name;
    const isIdentityTarget = typeName === "paragraph" || typeName === "heading"
      || typeName === "quote" || typeName === "codeBlock" || typeName === "divider";
    if (!isIdentityTarget) {
      // 入れ子のリスト項目や枠の中に段落があるので、構造には降り続ける。
      return !node.isTextblock && !node.isLeaf;
    }

    const currentType =
      typeof node.attrs.sigmaDocType === "string" ? node.attrs.sigmaDocType : typeName;
    const isListItemLead = parent?.type.name === "listItem" && index === 0;
    textNodes.push({
      node,
      pos,
      currentId: typeof node.attrs.sigmaDocId === "string" ? node.attrs.sigmaDocId : "",
      currentType,
      nextType: isListItemLead ? "listItem" : currentType === "section" && typeName === "heading" ? "section" : typeName,
    });
    // 引用は中に段落を持つ入れ物なので、中の id も配るために降り続ける。
    return typeName === "quote";
  });

  const textNodeCountById = new Map<string, number>();
  textNodes.forEach((entry) => {
    if (entry.currentId) {
      textNodeCountById.set(entry.currentId, (textNodeCountById.get(entry.currentId) ?? 0) + 1);
    }
  });
  const splitCreatedDuplicateId = [...textNodeCountById.values()].some((count) => count > 1);

  const keepIndexById = new Map<string, number>();
  textNodes.forEach((entry, index) => {
    if (!entry.currentId) {
      return;
    }

    const previousIndex = keepIndexById.get(entry.currentId);
    if (previousIndex === undefined) {
      keepIndexById.set(entry.currentId, index);
      return;
    }

    const previous = textNodes[previousIndex];
    if (isEmptyEditorTextBlock(previous.node) && !isEmptyEditorTextBlock(entry.node)) {
      keepIndexById.set(entry.currentId, index);
    }
  });

  const usedIds = new Set<string>();
  const transaction = newState.tr;
  const marksBeforeSplit = oldState.selection.empty
    ? oldState.storedMarks ?? (
      oldState.selection.$from.parentOffset > 0
        ? oldState.selection.$from.marks().filter((mark) => mark.type.name !== "link")
        : null
    )
    : null;
  const storedMarks = newState.storedMarks ?? (splitCreatedDuplicateId ? marksBeforeSplit : null);
  let changed = false;

  textNodes.forEach((entry, index) => {
    const shouldKeepCurrentId = Boolean(entry.currentId) &&
      keepIndexById.get(entry.currentId) === index &&
      !usedIds.has(entry.currentId);
    const nextId = shouldKeepCurrentId
      ? entry.currentId
      : createId(idPrefixForTextNode(entry.currentType, entry.node.type.name));

    usedIds.add(nextId);

    if (entry.currentId !== nextId || entry.node.attrs.sigmaDocType !== entry.nextType) {
      transaction.setNodeMarkup(entry.pos, undefined, {
        ...entry.node.attrs,
        sigmaDocId: nextId,
        sigmaDocType: entry.nextType,
      });
      changed = true;
    }
  });

  // Splitting a block deliberately arms stored marks for the next typed character. Assigning a
  // fresh SigmaDoc id is metadata-only, but setNodeMarkup clears those marks unless restored.
  if (changed && storedMarks !== null) {
    transaction.setStoredMarks(storedMarks);
  }

  return changed ? transaction : null;
}

/**
 * このスレッドの装飾が、その編集器が持つブロックの上に出るか。
 *
 * 判定はコメント装飾の描画側と同じ: ブロック / 数式はそのブロック、範囲は両端のどちらかが
 * この編集器にあれば (順序表に片端しか無い範囲は描けないが、増減で見た目が変わりうる)。
 */
function commentThreadTouchesBlocks(thread: SigmaCommentThread, blockIds: ReadonlySet<string>): boolean {
  const anchor = thread.anchor;
  switch (anchor.type) {
    case "block":
    case "inlineMath":
      return blockIds.has(anchor.blockId);
    case "textRange":
      return blockIds.has(anchor.start.blockId) || blockIds.has(anchor.end.blockId);
    default:
      return false;
  }
}

const SelectedTextBlockExtension = Extension.create<SelectedTextBlockOptions>({
  name: "selectedTextBlock",

  addOptions() {
    return {
      getSelectedId: () => null,
    };
  },

  addProseMirrorPlugins() {
    const getSelectedId = () => this.options.getSelectedId();

    return [
      new Plugin({
        key: selectedTextBlockKey,
        props: {
          decorations: (state) => {
            const selectedId = getSelectedId();
            if (!selectedId) {
              return DecorationSet.empty;
            }

            const decorations: Decoration[] = [];
            state.doc.forEach((node, offset) => {
              if (node.attrs?.sigmaDocId !== selectedId) {
                return;
              }

              decorations.push(
                Decoration.node(offset, offset + node.nodeSize, {
                  class: "text-flow-selected-line",
                }),
              );
            });

            return decorations.length ? DecorationSet.create(state.doc, decorations) : DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

interface ChangeDecorationOptions {
  getState: () => TextFlowChangeDecorationState | null;
}

/** Renders host-supplied before/applying/after states as node decorations,
 * keyed by `sigmaDocId` exactly like `SelectedTextBlockExtension` above.
 * `removingIds`/`addedIds` take priority over the static `removedIds` so an
 * in-flight transition is not fought by its static before-state background. */
const ChangeDecorationExtension = Extension.create<ChangeDecorationOptions>({
  name: "textFlowChangeDecoration",

  addOptions() {
    return {
      getState: () => null,
    };
  },

  addProseMirrorPlugins() {
    const getState = () => this.options.getState();

    return [
      new Plugin({
        key: changeDecorationKey,
        props: {
          decorations: (state) => {
            const diffState = getState();
            if (!diffState) {
              return DecorationSet.empty;
            }

            const removedIds = diffState.removedIds;
            const removingIds = diffState.removingIds;
            const addedIds = diffState.addedIds;
            if (!removedIds?.length && !removingIds?.length && !addedIds?.length) {
              return DecorationSet.empty;
            }

            const decorations: Decoration[] = [];
            state.doc.forEach((node, offset) => {
              const id = node.attrs?.sigmaDocId;
              if (typeof id !== "string" || !id) {
                return;
              }

              const className = removingIds?.includes(id)
                ? "text-flow-change-removing"
                : addedIds?.includes(id)
                  ? "text-flow-change-added"
                  : removedIds?.includes(id)
                    ? "text-flow-change-before"
                    : null;
              if (!className) {
                return;
              }

              decorations.push(
                Decoration.node(offset, offset + node.nodeSize, { class: className }),
              );
            });

            return decorations.length ? DecorationSet.create(state.doc, decorations) : DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

const CommentDecorationExtension = Extension.create<CommentDecorationOptions>({
  name: "commentDecoration",

  addOptions() {
      return {
        getActiveThreadId: () => null,
        getBlockIds: () => [],
        getHighlightedThreadId: () => null,
        getThreads: () => [],
      };
  },

  addProseMirrorPlugins() {
    const getActiveThreadId = () => this.options.getActiveThreadId();
    const getBlockIds = () => this.options.getBlockIds();
    const getHighlightedThreadId = () => this.options.getHighlightedThreadId();
    const getThreads = () => this.options.getThreads();

    return [
      new Plugin({
        key: commentDecorationKey,
        props: {
          decorations: (state) => {
            const activeThreadId = getActiveThreadId();
            const highlightedThreadId = getHighlightedThreadId();
            const threads = getThreads().filter((thread) => (
              !thread.resolved ||
              thread.id === activeThreadId ||
              thread.id === highlightedThreadId
            ));
            if (threads.length === 0) {
              return DecorationSet.empty;
            }

            const decorations: Decoration[] = [];
            const blockIds = getBlockIds();
            const order = new Map(blockIds.map((id, index) => [id, index]));
            // コメントが 1 つも無ければ上で抜けている。ここへ来るのは「この編集器にコメントが
            // 掛かっている」ときだけなので、走査はブロック構造どまり (中身へは範囲装飾と
            // 数式アンカーの生成側が必要な分だけ降りる)。
            countDecorationBlockWalk();
            state.doc.descendants((node, pos) => {
              if (node.type.name !== "paragraph" && node.type.name !== "heading") {
                return !node.isTextblock && !node.isLeaf;
              }

              const blockId = typeof node.attrs.sigmaDocId === "string" ? node.attrs.sigmaDocId : "";
              if (!blockId) {
                return false;
              }

              const blockThreads = threads.filter((thread) => (
                thread.anchor.type === "block" && thread.anchor.blockId === blockId
              ));
              if (blockThreads.length > 0) {
                decorations.push(Decoration.node(pos, pos + node.nodeSize, commentDecorationAttrs(blockThreads, highlightedThreadId, "text-flow-commented-line")));
              }

              for (const thread of threads) {
                if (thread.anchor.type === "textRange") {
                  const range = getTextRangeForBlock(thread.anchor, blockId, order, getPlainTextBlockLength(node));
                  if (range) {
                    for (const decoration of createTextRangeDecorations(node, pos, range.from, range.to, thread, highlightedThreadId)) {
                      decorations.push(decoration);
                    }
                  }
                } else if (thread.anchor.type === "inlineMath") {
                  const mathInlineId = thread.anchor.mathInlineId;
                  node.descendants((child, childPos) => {
                    if (child.type.name !== "mathInline" || child.attrs.id !== mathInlineId) {
                      return;
                    }
                    const mathPos = pos + 1 + childPos;
                    decorations.push(Decoration.node(mathPos, mathPos + child.nodeSize, commentDecorationAttrs([thread], highlightedThreadId, "comment-inline-math-highlight")));
                  });
                }
              }
              return false;
            });

            return decorations.length ? DecorationSet.create(state.doc, decorations) : DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

const ColumnFlowLayoutExtension = Extension.create<ColumnFlowLayoutOptions>({
  name: "columnFlowLayout",

  addOptions() {
    return {
      getLayouts: () => ({}),
      getBoxFragmentSourceLayouts: () => ({}),
    };
  },

  addProseMirrorPlugins() {
    const getLayouts = () => this.options.getLayouts();
    const getBoxFragmentSourceLayouts = () => this.options.getBoxFragmentSourceLayouts();

    return [
      new Plugin({
        key: columnFlowLayoutKey,
        props: {
          decorations: (state) => createColumnFlowLayoutDecorations(
            state.doc,
            getLayouts(),
            getBoxFragmentSourceLayouts(),
          ),
        },
      }),
    ];
  },
});

function createColumnFlowLayoutDecorations(
  doc: ProseMirrorModelNode,
  layouts: Record<string, TextFlowColumnBlockLayout>,
  boxFragmentSourceLayouts: Record<string, TextFlowBoxFragmentSourceLayout>,
): DecorationSet {
  const decorations: Decoration[] = [];

  doc.forEach((node, offset) => {
    if (node.type.name !== "paragraph" && node.type.name !== "heading" && node.type.name !== "bulletList" && node.type.name !== "orderedList" && node.type.name !== "boxBlock" && node.type.name !== "layoutSection" && node.type.name !== "quote" && node.type.name !== "codeBlock" && node.type.name !== "divider") {
      return;
    }

    const blockId = typeof node.attrs?.sigmaDocId === "string" ? node.attrs.sigmaDocId : "";
    const layout = blockId ? layouts[blockId] : undefined;
    // Any block (not only a box) can be split into clipped fragments when it is
    // taller than a page/column, so the source clip applies whenever a fragment
    // source layout exists for this block.
    const fragmentSource = blockId ? boxFragmentSourceLayouts[blockId] : undefined;
    if (!layout && !fragmentSource) {
      return;
    }

    const classes: string[] = [];
    const styles: string[] = [];
    if (layout) {
      classes.push("text-flow-column-block");
      styles.push(
        "position:absolute",
        `left:${Math.round(layout.x)}px`,
        `top:${Math.round(layout.y)}px`,
        `width:${Math.round(layout.width)}px`,
      );
    }
    if (fragmentSource && fragmentSource.totalHeight > fragmentSource.visibleHeight + 0.5) {
      const hiddenBottom = Math.max(0, fragmentSource.totalHeight - fragmentSource.visibleHeight);
      classes.push("text-flow-box-fragment-source");
      styles.push(
        `--text-flow-box-fragment-visible-height:${Math.round(fragmentSource.visibleHeight)}px`,
        `--text-flow-box-fragment-hidden-bottom:${Math.round(hiddenBottom)}px`,
        ...styleVarsToInlineCss(cornerBoxReferenceHeightStyleVars(fragmentSource.totalHeight)),
        `clip-path:inset(0 0 ${Math.round(hiddenBottom)}px 0)`,
      );
    }

    decorations.push(
      Decoration.node(offset, offset + node.nodeSize, {
        class: classes.join(" "),
        style: styles.join(";"),
        ...(fragmentSource && fragmentSource.totalHeight > fragmentSource.visibleHeight + 0.5
          ? { "data-box-fragment-source-id": blockId }
          : {}),
      }),
    );
  });

  return decorations.length ? DecorationSet.create(doc, decorations) : DecorationSet.empty;
}

/**
 * ドラッグ中のブロック下余白プレビュー。掴んだブロックの後続に「追従する」印を配るだけで、
 * 移動量そのものは紙面の親に書かれた custom property から読む ({@link createSpaceAfterPreviewDecorations})。
 *
 * **複製の面には載せない**。ページを跨いだ続きを描く複製は、正本と同じブロック id を持つ面を
 * もう 1 つ作る。印はモジュールのストアから id で配られるので、素通りさせると「掴んだ側とは
 * 別のページにあるクリップ窓の中身」まで一緒に平行移動する (追従集合は同じページのものしか
 * 選んでいないのに、id が一致するだけで届いてしまう)。
 */
const SpaceAfterPreviewExtension = Extension.create<{ isReplicaSurface: () => boolean }>({
  name: "spaceAfterPreview",

  addOptions() {
    return { isReplicaSurface: () => false };
  },

  addProseMirrorPlugins() {
    const isReplicaSurface = this.options.isReplicaSurface;
    return [
      new Plugin({
        key: spaceAfterPreviewKey,
        props: {
          decorations: (state) => (isReplicaSurface()
            ? DecorationSet.empty
            : createSpaceAfterPreviewDecorations(state.doc, getBlockSpaceAfterPreview())),
        },
      }),
    ];
  },
});

function styleVarsToInlineCss(vars: Record<string, string>): string[] {
  return Object.entries(vars).map(([property, value]) => `${property}:${value}`);
}

function TextFlowEditorImpl({
  blocks,
  selectedId,
  mathFractionSizing,
  placeholder,
  showPlaceholder = true,
  singleBlock = false,
  historyRevision,
  breakGaps,
  paginationBeforeIds,
  paginationMarkerKind,
  paginationMarkerKinds,
  paginationMarkerLayouts,
  columnFlowBlockLayouts,
  boxFragmentSourceLayouts,
  headingNumbers = {},
  boxFragmentReplicaId,
  boxFragmentReplicaIndex,
  syncFocusedContent = false,
  commentThreads = [],
  activeCommentThreadId = null,
  highlightedCommentThreadId = null,
  onCommentThreadSelect,
  onFocusChange,
  onSelect,
  onChange,
  onBoundaryDelete,
  materials = [],
  onMaterialInsert,
  enableSelectionFormatMenu = true,
  enableBoxCommands = true,
  boxCommandStyleIds,
  onBoxCommand,
  enableProblemCommands = false,
  onProblemCommand,
  onBodyBlockCommand,
  enableHeadingCommands = false,
  onHeadingCommand,
  formatTarget = "document",
  changeDecorationState,
  editPolicy,
  readOnlyBoxTitle = false,
  textRunGroupId,
  textRunOrder = 0,
  textRunUnitId,
  textRunScopeId,
  textRunScopeContainer,
  textRunPreserveEmpty = false,
}: TextFlowEditorProps) {
  const t = useT("editor");
  const locale = useAppLocale();
  countPerformanceEvent("TextFlowEditor.render");
  const mathEnvironment = useMathEnvironment();
  // ブロック ID の並びと内容キーは「値」で持つ。`blocks` は打鍵のたびに作り直される配列なので、
  // 識別子のまま memo/effect の deps に置くと打鍵 1 回で本文ユニット数だけ装飾更新の
  // transaction が飛ぶ (中身は 1 文字も変わっていない)。
  const previousIdsKey = useMemo(() => getTextFlowBlockIds(blocks).join("\u0000"), [blocks]);
  const previousIds = useMemo(
    () => getTextFlowBlockIds(blocks),
    // ID 列が同じなら同じ配列を使い回す (`blocks` は毎レンダー新しい配列なので識別子では判定できない)。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [previousIdsKey],
  );
  const blocksSyncKey = useMemo(() => getTextFlowBlocksSyncKey(blocks), [blocks]);
  const previousIdsRef = useRef(previousIds);
  /**
   * この面が「ページを跨いだ続きを見せる複製」か。
   *
   * 装飾プラグインは render の外 (transaction のたび) に走るので ref で持つ。**useEditor より
   * 前に宣言する** — プラグインが最初の装飾をエディタ生成の途中で走らせるため。
   */
  const isBoxFragmentReplicaRef = useRef(boxFragmentReplicaId !== undefined);
  useLayoutEffect(() => {
    isBoxFragmentReplicaRef.current = boxFragmentReplicaId !== undefined;
  }, [boxFragmentReplicaId]);
  const blocksRef = useRef(blocks);
  const selectedIdRef = useRef(selectedId);
  /** この編集器が今どのブロックを「選択中の行」として描いているか (合図の要否判定に使う)。 */
  const ownedSelectedIdRef = useRef<string | null>(null);
  const changeDecorationStateRef = useRef(changeDecorationState);
  const onSelectRef = useRef(onSelect);
  const onChangeRef = useRef(onChange);
  const onBoundaryDeleteRef = useRef(onBoundaryDelete);
  const onMaterialInsertRef = useRef(onMaterialInsert);
  const onBoxCommandRef = useRef(onBoxCommand);
  const onProblemCommandRef = useRef(onProblemCommand);
  const onBodyBlockCommandRef = useRef(onBodyBlockCommand);
  const onHeadingCommandRef = useRef(onHeadingCommand);
  const openCodeBlockSettingsRef = useRef<(codeBlockId: string, button: HTMLButtonElement) => void>(() => {});
  const codeBlockActionLabelRef = useRef(t("codeBlock.settings"));
  const slashCommandQueryRef = useRef<ActiveSlashCommandQuery | null>(null);
  /**
   * `useEditor` の中 (editorProps.handleKeyDown) からは `editor` をまだ参照できないので、
   * `/` から Tiptap のコマンドを呼ぶためにインスタンスを ref で持ち回る。
   */
  const tiptapEditorRef = useRef<TiptapEditor | null>(null);
  const editGuardsByBlockId = useMemo(() => {
    const guards = new Map<string, TextFlowEditGuard>();
    for (const guard of editPolicy?.guards ?? []) {
      guards.set(guard.blockId, guard);
    }
    if (editPolicy?.lockAll) {
      for (const blockId of previousIds) {
        if (!guards.has(blockId)) {
          guards.set(blockId, {
            ...editPolicy.lockAll,
            blockId,
            isPrimaryActionTarget: false,
          });
        }
      }
    }
    return guards;
  }, [editPolicy, previousIds]);
  const editGuardsKey = useMemo(() => getTextFlowEditGuardsSyncKey(editGuardsByBlockId), [editGuardsByBlockId]);
  const editGuardsRef = useRef(editGuardsByBlockId);
  const [editGuardNotice, setEditGuardNotice] = useState<string | null>(null);
  const editGuardNoticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleEditGuardBlockedAttempt = useCallback((blockId: string) => {
    const guard = editGuardsRef.current.get(blockId);
    if (!guard) {
      return;
    }
    setEditGuardNotice(guard.blockedMessage);
    if (editGuardNoticeTimeoutRef.current) {
      clearTimeout(editGuardNoticeTimeoutRef.current);
    }
    editGuardNoticeTimeoutRef.current = setTimeout(() => setEditGuardNotice(null), 6000);
  }, []);
  const onEditGuardBlockedAttemptRef = useRef(handleEditGuardBlockedAttempt);
  const slashCommandCandidatesRef = useRef<SlashCommandCandidate[]>([]);
  const slashCommandActiveIndexRef = useRef(0);
  const lastTextSelectionRef = useRef<{ blockId: string; from: number; to: number } | null>(null);
  const selectionBeforeTransactionRef = useRef<TextFlowSelectionBookmark | null>(null);
  const verticalNavigationXRef = useRef<number | null>(null);
  const literalPasteRequestedAtRef = useRef(0);
  const previousHistoryRevisionRef = useRef(historyRevision);
  /** Blocks key the history-restore layout effect has already pushed into the editor. */
  const syncedContentKeyRef = useRef<string | null>(null);
  /**
   * Blocks key the editor was created with — valid only until its content is first replaced.
   * It keeps the passive sync below from re-applying the very content Tiptap was just created
   * with (a duplicate `setContent` per unit on every open), and is dropped at the first real
   * update so a later round trip back to this exact content is never mistaken for "already in
   * the editor".
   */
  const mountContentKeyRef = useRef<string | null>(blocksSyncKey);
  /**
   * Pending cross-editor span replacement (registry onChange). The passive sync below must
   * apply it even when this editor is focused with unchanged block ids — the replacement was
   * assembled outside the editor, so "same ids" does not mean "already in the editor". Carries
   * the mutation's caret bookmark so the focused editor lands on it without waiting for the
   * scheduled restore.
   */
  const crossEditorSyncRef = useRef<{ selection: TextFlowSelectionBookmark | null } | null>(null);
  const [historyGroupScope] = useState(() => createId("text_history"));
  const historyGroupingRef = useRef(createTextFlowHistoryGroupingState());
  // Tiptap reads `content` only while it creates an editor, and it creates one only when the
  // `useEditor` dependency list below changes. Converting on every render meant every keystroke
  // paid a full textFlowToTiptap() per unit for a value nothing reads. **This dependency list
  // must stay identical to the `useEditor` one below**: if the editor is recreated without
  // recomputing this, the new editor starts from the blocks of an older render.
  const initialContent = useMemo(
    () => textFlowToTiptap(blocks),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mathEnvironment, mathFractionSizing, readOnlyBoxTitle, showPlaceholder, singleBlock],
  );
  const breakGapsRef = useRef<Record<string, number>>(breakGaps ?? {});
  const paginationBeforeIdsRef = useRef<string[]>(paginationBeforeIds ?? []);
  // 区切りの**種別**を受け取り、表示文言はここで解決する
  // (文字列で受け取ると「段区切りかどうか」の判定が表示言語に依存してしまう)。
  const resolvedPaginationMarkerKind = paginationMarkerKind ?? "pageBreak";
  // プレースホルダ文言は ref 経由で言語に追従する。useEditor の deps に載せると
  // 言語切替のたびに本文ユニット数だけ Tiptap が破棄・再生成され、未マウントの
  // `editor.view.dom` アクセスが例外になる。
  const placeholderRef = useRef(placeholder ?? t("body.placeholder"));
  const paginationMarkerKindRef = useRef(resolvedPaginationMarkerKind);
  const paginationMarkerKindsRef = useRef<Record<string, PageBreakMarkerKind>>(paginationMarkerKinds ?? {});
  const markerLabelOf = useCallback(
    (kind: PageBreakMarkerKind) => (
      kind === "columnBreak" ? t("pagination.columnBreak") : t("pagination.pageBreak")
    ),
    [t],
  );
  const paginationMarkerLabelRef = useRef(markerLabelOf);
  useEffect(() => {
    paginationMarkerLabelRef.current = markerLabelOf;
  }, [markerLabelOf]);
  const paginationMarkerLayoutsRef = useRef<Record<string, PageBreakMarkerLayout>>(paginationMarkerLayouts ?? {});
  const columnFlowBlockLayoutsRef = useRef<Record<string, TextFlowColumnBlockLayout>>(columnFlowBlockLayouts ?? {});
  const headingNumbersRef = useRef<Readonly<Record<string, string>>>(headingNumbers);
  const boxFragmentSourceLayoutsRef = useRef<Record<string, TextFlowBoxFragmentSourceLayout>>(boxFragmentSourceLayouts ?? {});
  const commentThreadsRef = useRef(commentThreads);
  const activeCommentThreadIdRef = useRef(activeCommentThreadId);
  const highlightedCommentThreadIdRef = useRef(highlightedCommentThreadId);
  const getBreakGaps = useCallback(() => breakGapsRef.current, []);
  const getPageBreakBeforeIds = useCallback(() => paginationBeforeIdsRef.current, []);
  const getPageBreakMarkerKind = useCallback(() => paginationMarkerKindRef.current, []);
  const getPageBreakMarkerKinds = useCallback(() => paginationMarkerKindsRef.current, []);
  const getPageBreakMarkerLabel = useCallback(
    (kind: PageBreakMarkerKind) => paginationMarkerLabelRef.current(kind),
    [],
  );
  const getPageBreakMarkerLayouts = useCallback(() => paginationMarkerLayoutsRef.current, []);
  const getColumnFlowBlockLayouts = useCallback(() => columnFlowBlockLayoutsRef.current, []);
  const getHeadingNumbers = useCallback(() => headingNumbersRef.current, []);
  const getHeadingNumberLayoutKey = useCallback((blockId: string) => {
    const layout = columnFlowBlockLayoutsRef.current[blockId];
    return layout
      ? `${Math.round(layout.x)}:${Math.round(layout.y)}:${Math.round(layout.width)}`
      : "flow";
  }, []);
  const getBoxFragmentSourceLayouts = useCallback(() => boxFragmentSourceLayoutsRef.current, []);
  const [slashCommandQuery, setSlashCommandQuery] = useState<ActiveSlashCommandQuery | null>(null);
  const [slashCommandActiveIndex, setSlashCommandActiveIndex] = useState(0);
  const [boxActionDialog, setBoxActionDialog] = useState<BoxActionDialogState | null>(null);
  const [boxSettingsDialog, setBoxSettingsDialog] = useState<BoxSettingsDialogState | null>(null);
  const [codeBlockSettingsPopover, setCodeBlockSettingsPopover] = useState<CodeBlockSettingsPopoverState | null>(null);
  const [textFormatContextMenu, setTextFormatContextMenu] = useState<TextFormatContextMenuState | null>(null);
  const boxSettingsBlockExists = boxSettingsDialog
    ? findBoxBlockInTextFlowBlocks(blocks, boxSettingsDialog.boxId) !== null
    : false;
  const activeBoxSettingsDialog = boxSettingsBlockExists ? boxSettingsDialog : null;
  const activeCodeBlockSettingsPopover = codeBlockSettingsPopover
    && previousIds.includes(codeBlockSettingsPopover.codeBlockId)
    ? codeBlockSettingsPopover
    : null;
  const slashCommandBlockIds = singleBlock ? EMPTY_BLOCK_COMMAND_IDS : slashCommandQuery?.availableBlockCommandIds ?? EMPTY_BLOCK_COMMAND_IDS;
  const slashCommandCandidates = useMemo(
    () => filterSlashCommandCandidates(
      materials,
      slashCommandQuery?.query ?? "",
      enableBoxCommands && (slashCommandQuery?.canInsertBox ?? false),
      t,
      boxCommandStyleIds,
      enableProblemCommands,
      slashCommandBlockIds,
      enableHeadingCommands,
    ),
    [boxCommandStyleIds, enableBoxCommands, enableHeadingCommands, enableProblemCommands, materials, slashCommandBlockIds, slashCommandQuery?.canInsertBox, slashCommandQuery?.query, t],
  );
  const slashCommandMaxIndex = Math.max(0, slashCommandCandidates.length - 1);
  const clampedSlashCommandActiveIndex = Math.min(slashCommandActiveIndex, slashCommandMaxIndex);

  const openCodeBlockSettings = useCallback((codeBlockId: string, button: HTMLButtonElement) => {
    const codeBlock = button.closest<HTMLElement>(".print-code[data-sigma-doc-id]");
    if (!codeBlock || codeBlock.dataset.sigmaDocId !== codeBlockId) {
      return;
    }

    const rect = button.getBoundingClientRect();
    const maxLeft = Math.max(
      CODE_SETTINGS_POPOVER_MARGIN,
      window.innerWidth - CODE_SETTINGS_POPOVER_WIDTH - CODE_SETTINGS_POPOVER_MARGIN,
    );
    const maxTop = Math.max(
      CODE_SETTINGS_POPOVER_MARGIN,
      window.innerHeight - CODE_SETTINGS_POPOVER_HEIGHT - CODE_SETTINGS_POPOVER_MARGIN,
    );
    setCodeBlockSettingsPopover((current) => current?.codeBlockId === codeBlockId ? null : {
      codeBlockId,
      language: normalizeCodeLanguage(codeBlock.dataset.codeLanguage) ?? null,
      theme: normalizeCodeBlockTheme(codeBlock.dataset.codeTheme) ?? "light",
      left: clampNumber(rect.right - CODE_SETTINGS_POPOVER_WIDTH, CODE_SETTINGS_POPOVER_MARGIN, maxLeft),
      top: clampNumber(rect.bottom + 6, CODE_SETTINGS_POPOVER_MARGIN, maxTop),
    });
    selectedIdRef.current = codeBlockId;
    onSelectRef.current(codeBlockId);
  }, [setCodeBlockSettingsPopover]);

  useEffect(() => {
    openCodeBlockSettingsRef.current = openCodeBlockSettings;
  }, [openCodeBlockSettings]);

  useEffect(() => {
    codeBlockActionLabelRef.current = t("codeBlock.settings");
    placeholderRef.current = placeholder ?? t("body.placeholder");
  }, [placeholder, t]);

  useEffect(() => {
    previousIdsRef.current = previousIds;
    blocksRef.current = blocks;
  }, [blocks, previousIds]);

  useEffect(() => {
    if (!boxSettingsDialog || boxSettingsBlockExists) {
      return;
    }
    const timeoutId = window.setTimeout(() => setBoxSettingsDialog(null), 0);
    return () => window.clearTimeout(timeoutId);
  }, [boxSettingsBlockExists, boxSettingsDialog, setBoxSettingsDialog]);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    clearTextRunSpan();
  }, [historyRevision]);

  useEffect(() => {
    onBoundaryDeleteRef.current = onBoundaryDelete;
  }, [onBoundaryDelete]);

  useEffect(() => {
    onMaterialInsertRef.current = onMaterialInsert;
  }, [onMaterialInsert]);

  useEffect(() => {
    onBoxCommandRef.current = onBoxCommand;
  }, [onBoxCommand]);

  useEffect(() => {
    onProblemCommandRef.current = onProblemCommand;
    onHeadingCommandRef.current = onHeadingCommand;
  }, [onHeadingCommand, onProblemCommand]);

  useEffect(() => {
    onBodyBlockCommandRef.current = onBodyBlockCommand;
  }, [onBodyBlockCommand]);

  useEffect(() => {
    onEditGuardBlockedAttemptRef.current = handleEditGuardBlockedAttempt;
  }, [handleEditGuardBlockedAttempt]);

  useEffect(() => () => {
    if (editGuardNoticeTimeoutRef.current) {
      clearTimeout(editGuardNoticeTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    slashCommandQueryRef.current = slashCommandQuery;
  }, [slashCommandQuery]);

  useEffect(() => {
    slashCommandCandidatesRef.current = slashCommandCandidates;
    slashCommandActiveIndexRef.current = clampedSlashCommandActiveIndex;
  }, [clampedSlashCommandActiveIndex, slashCommandCandidates]);

	  useEffect(() => {
	    slashCommandActiveIndexRef.current = clampedSlashCommandActiveIndex;
	  }, [clampedSlashCommandActiveIndex]);

  const refreshInlineQueries = useCallback((activeEditor: TiptapEditor) => {
    const nextQuery = getActiveSlashCommandQuery(activeEditor.view);
    setSlashCommandQuery((current) => {
      if (sameSlashCommandQuery(current, nextQuery)) {
        return current;
      }
      setSlashCommandActiveIndex(0);
      return nextQuery;
    });
  }, [setSlashCommandActiveIndex, setSlashCommandQuery]);

  const editor = useEditor({
    extensions: [
      ...createRichTextEngineExtensions({
        blockExtensions: [
          SigmaDocTextAttrs,
          BoxBlockExtension,
          BoxBlockTitleExtension.configure({ readOnly: readOnlyBoxTitle }),
          BoxBlockBodyExtension.configure({ titleReadOnly: readOnlyBoxTitle }),
          LayoutSectionExtension,
          SigmaDocTextIdentity,
        ],
        bodyBlocks: true,
        listMarkerTypography: true,
        mathEnvironment,
        mathFractionSizing,
        orderedListMarkerStyles: true,
        searchHighlight: true,
      }),
      // プレースホルダ文言は ref。言語切替でエディタを作り直さず、装飾の再描画だけで追従する。
      // eslint-disable-next-line react-hooks/refs
      ...(showPlaceholder ? [Placeholder.configure({ placeholder: () => placeholderRef.current })] : []),
      // Widget は SigmaDoc/Tiptap の内容に混ざらず、右上の設定ボタンだけを編集面へ足す。
      // eslint-disable-next-line react-hooks/refs
      CodeBlockActionExtension.configure({
        onOpen: (codeBlockId, button) => openCodeBlockSettingsRef.current(codeBlockId, button),
        getLabel: () => codeBlockActionLabelRef.current,
      }),
      // getSelectedId is a stable callback read by the decoration plugin, not during render.
      // eslint-disable-next-line react-hooks/refs
      SelectedTextBlockExtension.configure({
        getSelectedId: () => {
          const id = selectedIdRef.current;
          return id && previousIdsRef.current.includes(id) ? id : null;
        },
      }),
      // getState is a stable callback read by the decoration plugin, not during render.
      // eslint-disable-next-line react-hooks/refs
      ChangeDecorationExtension.configure({
        getState: () => changeDecorationStateRef.current ?? null,
      }),
      // getBreakGaps is a stable callback that reads the latest gaps when the
      // decoration plugin runs (not during render).
      // eslint-disable-next-line react-hooks/refs
      PageBreakGapExtension.configure({
        getGaps: getBreakGaps,
        getBreakBeforeIds: getPageBreakBeforeIds,
        getBreakBeforeKind: getPageBreakMarkerKind,
        getBreakBeforeKinds: getPageBreakMarkerKinds,
        getBreakBeforeLabel: getPageBreakMarkerLabel,
        getBreakBeforeMarkerLayouts: getPageBreakMarkerLayouts,
      }),
      // Column-flow positions are computed outside the editor and read by this
      // decoration plugin without changing the SigmaDoc/Tiptap document.
      // eslint-disable-next-line react-hooks/refs
      ColumnFlowLayoutExtension.configure({
        getLayouts: getColumnFlowBlockLayouts,
        getBoxFragmentSourceLayouts,
      }),
      // 複製かどうかはこの面の一生を通じて変わらないので、プラグインからそのまま読む。
      // eslint-disable-next-line react-hooks/refs
      SpaceAfterPreviewExtension.configure({
        isReplicaSurface: () => isBoxFragmentReplicaRef.current,
      }),
      // These stable callbacks are read by the decoration plugin when it runs,
      // not during React render. Heading labels stay outside editable content.
      // eslint-disable-next-line react-hooks/refs
      HeadingNumberingExtension.configure({
        getNumbers: getHeadingNumbers,
        // The key includes the current column placement so ProseMirror cannot reuse a widget from
        // another segment when a multi-column layout is recalculated.
        getLayoutKey: getHeadingNumberLayoutKey,
      }),
      // These stable callbacks are read by the decoration plugin when it runs,
      // not during React render.
      // eslint-disable-next-line react-hooks/refs
      CommentDecorationExtension.configure({
        getActiveThreadId: () => activeCommentThreadIdRef.current,
        getBlockIds: () => previousIdsRef.current,
        getHighlightedThreadId: () => highlightedCommentThreadIdRef.current,
        getThreads: () => commentThreadsRef.current,
      }),
      ExternalTextRangeHighlightExtension,
      UrlDetectionExtension,
      // getGuards/onBlockedAttempt are stable ref-backed
      // callbacks read by the plugin when it runs (decorations) or a
      // transaction is dispatched (filterTransaction), not during render.
      // eslint-disable-next-line react-hooks/refs
      EditGuardExtension.configure({
        getGuards: () => editGuardsRef.current,
        onBlockedAttempt: (blockId) => onEditGuardBlockedAttemptRef.current(blockId),
      }),
    ],
    content: initialContent,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "text-flow-editor",
      },
      // ProseMirror の既定のスクロール追従を止める。既定は `overflow` を見ずに全ての祖先へ
      // `scrollTop += moveY` を試みるので、断片の viewport を動かして「見えない場所へ
      // スクロールした状態」を作ってしまう。
      handleScrollToSelection: (view) => scrollCaretIntoView(view, () => {
        // この面が見せていない位置へキャレットが動いた (矢印・Home/End・クリック)。
        // 紙面を動かすのではなく、見せている面へ配り直す。PM の更新中なので次のフレームで。
        const address = getTextFlowCaretAddress(
          view.state.doc,
          view.state.selection.head,
          DEFAULT_CARET_AFFINITY,
        );
        if (address) {
          window.requestAnimationFrame(() => focusCaretAddress(address));
        }
      }),
      handleKeyDown: (view, event) => {
        if (handleTextRunSpanKeyDown(event, view.dom)) {
          return true;
        }

        if (isLiteralPasteShortcut(event)) {
          literalPasteRequestedAtRef.current = Date.now();
        }

        if (handleSlashCommandQueryKeyDown(
          view,
          event,
          slashCommandQueryRef,
          slashCommandCandidatesRef,
          slashCommandActiveIndexRef,
          setSlashCommandActiveIndex,
          onMaterialInsertRef,
          onBoxCommandRef,
          onProblemCommandRef,
          onBodyBlockCommandRef,
          tiptapEditorRef,
          onHeadingCommandRef,
          setSlashCommandQuery,
        )) {
          return true;
        }

        if (singleBlock && event.key === "Enter") {
          event.preventDefault();
          return true;
        }

        if (
          (event.key === "ArrowUp" || event.key === "ArrowDown")
          && !event.altKey
          && !event.ctrlKey
          && !event.metaKey
          && !event.shiftKey
          && !event.isComposing
          && view.state.selection.empty
        ) {
          const preferredX = verticalNavigationXRef.current
            ?? view.coordsAtPos(view.state.selection.head).left;
          verticalNavigationXRef.current = preferredX;
          // 行き先を**先回りして**決める。1 rAF 後に「位置が変わらなかったら隣へ」では、
          // 断片の複製はブロック全体の doc を持つのでネイティブ移動が必ず成功してしまい、
          // 見えない行へ入ったまま隣の面へ移らない。
          const direction = event.key === "ArrowUp" ? "up" : "down";
          if (moveCaretVertically(view.dom, direction, preferredX)) {
            event.preventDefault();
            return true;
          }
          // 段組みセクション (CSS multicol) の中では、テキストブロックの端を越える上下の
          // ネイティブ移動が信用できない (段を跨ぐ移動で DOM 選択だけ動いて ProseMirror の
          // 選択が古いまま残ることがある)。論理的な隣のテキストブロックへ自前で置き、行の中の
          // 横位置だけ preferredX で選び直す。
          const verticalJump = resolveLayoutSectionArrowJump(view, direction);
          if (verticalJump) {
            applyLayoutSectionArrowJump(view, verticalJump, preferredX);
            event.preventDefault();
            return true;
          }
        } else if (event.key !== "Shift") {
          verticalNavigationXRef.current = null;
        }

        if (
          (event.key === "ArrowLeft" || event.key === "ArrowRight")
          && !event.altKey
          && !event.ctrlKey
          && !event.metaKey
          && !event.shiftKey
          && !event.isComposing
          && view.state.selection.empty
        ) {
          const direction = event.key === "ArrowRight" ? "forward" : "backward";
          // 段組みセクション (CSS multicol) の外→中・中→外は、Chromium のネイティブ移動が
          // 渡れずキャレットが動かない。論理的な隣のテキストブロックへ自前で置く。
          const sectionJump = resolveLayoutSectionArrowJump(view, direction);
          if (sectionJump) {
            view.dispatch(view.state.tr.setSelection(sectionJump).scrollIntoView());
            event.preventDefault();
            return true;
          }
          // 断片境界・doc の端 (ユニット境界・複製の端) は面をまたぐのでルーターが解決する。
          if (moveCaretHorizontally(view.dom, direction)) {
            event.preventDefault();
            return true;
          }
        }

        const manualBreakNavigation = resolveManualBreakBoundaryNavigation(
          view.state,
          event.key === "Backspace" ? "backward" : event.key === "Delete" ? "forward" : null,
          blocksRef.current,
          event,
        );
        if (manualBreakNavigation) {
          view.dispatch(
            view.state.tr.setSelection(
              TextSelection.create(view.state.doc, manualBreakNavigation.position),
            ),
          );
          event.preventDefault();
          return true;
        }

        const request = getBoundaryDeleteRequest(view.state, event, blocksRef.current);
        if (!request) {
          return false;
        }

        const handled = onBoundaryDeleteRef.current?.(request) ?? false;
        if (handled) {
          event.preventDefault();
        }
        return handled;
      },
      handleTextInput: (view, _from, _to, text) => handleTextRunSpanTextInput(view.dom, text),
      handleDOMEvents: {
        mousedown: () => {
          verticalNavigationXRef.current = null;
          return false;
        },
        compositionstart: (view) => {
          // 跨ぎ選択への IME 入力。合成テキストはこのエディタのネイティブ選択 (担当分) を
          // IME 自身が置換する (単一エディタと同じ経路 = セッションが切れない) ので、
          // ここでは他ユニットの担当分だけを削除して span を解除する。
          beginTextRunSpanComposition(view.dom);
          return false;
        },
        copy: (_view, event) => {
          if (event.clipboardData && copyActiveTextRunSpan(event.clipboardData)) {
            event.preventDefault();
            return true;
          }
          return false;
        },
        cut: (view, event) => {
          if (!event.clipboardData) {
            return false;
          }
          if (isMultiEditorTextRunSpan()) {
            if (!copyActiveTextRunSpan(event.clipboardData)) {
              return false;
            }
            event.preventDefault();
            const written = readTextSliceClipboardData(event.clipboardData);
            if (written) {
              markBodyTextCut(event, written);
            }
            // 本文を消すのはイベントを抜けてから。overlay の window ハンドラは同じ
            // イベントの中で本文の矩形を測って図形のアンカーを引き直すので、先に
            // 本文が消えていると測り直しがずれる。マイクロタスクではリスナーの合間に
            // 走ってしまうので、イベント 1 つ分あとになるタイマーへ逃がす。
            window.setTimeout(() => replaceActiveTextRunSpan([]), 0);
            return true;
          }
          if (view.state.selection.empty) {
            return false;
          }
          // PM 本体の cut はこの後で `clipboardData.clearData()` を呼ぶので、private MIME
          // ではなくモジュール側の印で overlay へ渡す (混在切り取りの本文側)。
          const slice = view.state.selection.content();
          markBodyTextCut(event, { slice: slice.toJSON(), text: sliceTextForClipboard(slice) });
          return false;
        },
      },
      handlePaste: (view, event, slice) => {
        const literalPasteRequested = Date.now() - literalPasteRequestedAtRef.current
          <= LITERAL_PASTE_SHORTCUT_WINDOW_MS;
        literalPasteRequestedAtRef.current = 0;
        if (isMultiEditorTextRunSpan() && event.clipboardData) {
          // 置換が拒否されても (AI ロック等) イベントは飲み込む。PM 既定へ流すと焦点
          // エディタの担当分だけにペーストされてしまう。
          event.preventDefault();
          if (literalPasteRequested) {
            // literal paste (Cmd+Shift+V) も span をバイパスさせない: プレーンテキストを
            // 段落列にして span 置換として適用する (単一エディタの view.pasteText と同じ分割)。
            const literalText = event.clipboardData.getData("text/plain");
            if (literalText) {
              replaceActiveTextRunSpan(plainTextToTextFlowParagraphs(literalText));
            }
            return true;
          }
          const spanPayload = readEditorClipboardPayload(event.clipboardData);
          if (spanPayload?.kind === "textFlowBlocks") {
            replaceActiveTextRunSpan(cloneTextFlowBlocksForPaste(spanPayload.blocks));
            return true;
          }
          if (spanPayload?.kind === "textAndShapes") {
            pasteTextAndShapesIntoTextRunSpan(view, slice, spanPayload);
            return true;
          }
          // payload の無いプレーンテキストは単一エディタ経路 (pasteTextFlowBlocksFromClipboard)
          // と同じく Markdown として解釈してから貼る。跨ぎ選択だけ素通しだと、見えない
          // チャンク境界の有無で「# 見出し」「**太字**」の貼り付け結果が変わってしまう。
          const markdownBlocks = spanPayload
            ? null
            : parsePastedMarkdown(event.clipboardData.getData("text/plain"));
          if (markdownBlocks && markdownBlocks.length > 0) {
            replaceActiveTextRunSpan(markdownBlocks);
            return true;
          }
          const fallbackBlocks = sliceToTextFlowBlocks(slice);
          if (fallbackBlocks.length > 0) {
            replaceActiveTextRunSpan(fallbackBlocks);
          }
          // テキストの無いクリップボード (画像・ファイル等) は選択を保つ。単一エディタの
          // 貼り付けが何もしないのと同じで、選択だけ消える事故を防ぐ。
          return true;
        }
        // コード・箱のタイトルのように inline しか持てない入れ物への貼り付けは、貼るものを
        // 畳んでその中へ入れる (通常経路へ流すと入れ物が閉じて残りが外へ溢れる)。コードは
        // 書式も Markdown も持ち込まないので、literal paste との違いも無い。
        if (pasteAsInlineContent(view, event, slice)) {
          return true;
        }
        if (literalPasteRequested) {
          return pasteClipboardAsLiteralText(view, event);
        }
        const payload = event.clipboardData ? readEditorClipboardPayload(event.clipboardData) : null;
        if (payload?.kind === "textAndShapes") {
          return pasteTextAndShapesFromClipboard(view, event, slice, payload);
        }
        return pasteTextFlowBlocksFromClipboard(view, event, (blockId) => {
          selectedIdRef.current = blockId;
          onSelectRef.current(blockId);
        });
      },
    },
    // Toolbar state rides on onTransaction, not on selection/doc updates: toggling a
    // mark at a collapsed caret only sets storedMarks, which changes neither the
    // selection nor the doc, so B/I/U would otherwise stay stale until the next
    // keystroke. The isFocused guard keeps a background editor's programmatic
    // transactions from clobbering the focused editor's toolbar state.
    onTransaction: ({ editor: activeEditor, transaction }) => {
      if (transaction.docChanged) {
        selectionBeforeTransactionRef.current = getTextFlowSelectionBookmarkBeforeTransaction(
          transaction,
          verticalNavigationXRef.current,
        );
      }
      if (activeEditor.isFocused) {
        dispatchDocumentTextFormatState(activeEditor);
      }
    },
    onSelectionUpdate: ({ editor: activeEditor }) => {
      refreshInlineQueries(activeEditor);
      const selectedBlockId = getSelectedTextBlockId(activeEditor);
      const selectionBookmark = getTextFlowSelectionBookmark(activeEditor, verticalNavigationXRef.current);
      if (selectionBookmark && activeEditor.isFocused) {
        publishTextFlowSelectionBookmark(selectionBookmark);
      }
      if (selectedBlockId) {
        selectedIdRef.current = selectedBlockId;
        onSelect(selectedBlockId);
        refreshSelectedTextBlock(activeEditor.view);
        const { from, to, empty } = activeEditor.state.selection;
        if (!empty) {
          lastTextSelectionRef.current = { blockId: selectedBlockId, from, to };
        }
      }
    },
    onFocus: ({ editor: activeEditor }) => {
      // 跨ぎ選択のグループ外エディタ (ヘッダー/フッター・box 継続 fragment・素材ダイアログ)
      // に焦点が移ったら span を解除する。残すと本文に選択帯が出たままになる。
      clearTextRunSpanOnOutsideFocus(activeEditor);
      clearBoxFragmentSelectionOnOutsideFocus(activeEditor);
      dispatchDocumentTextFormatState(activeEditor);
      refreshInlineQueries(activeEditor);
      const selectedBlockId = getSelectedTextBlockId(activeEditor);
      const selectionBookmark = getTextFlowSelectionBookmark(activeEditor, verticalNavigationXRef.current);
      if (selectionBookmark) {
        publishTextFlowSelectionBookmark(selectionBookmark);
      }
      if (selectedBlockId) {
        selectedIdRef.current = selectedBlockId;
        onSelect(selectedBlockId);
        refreshSelectedTextBlock(activeEditor.view);
      }
      onFocusChange?.(
        true,
        getEditorTextBlockIds(activeEditor),
        selectedBlockId ?? null,
        selectionBookmark,
      );
    },
    onBlur: ({ editor: activeEditor }) => {
      window.setTimeout(() => {
        if (!activeEditor.isDestroyed && !activeEditor.isFocused) {
          setSlashCommandQuery(null);
        }
      }, 120);
      onFocusChange?.(false, getEditorTextBlockIds(activeEditor));
    },
    onUpdate: ({ editor: activeEditor, transaction }) => measurePerformance("TextFlowEditor.onUpdate", () => {
      clearBoxFragmentSelection();
      // このエディタ自身の編集が始まった時点で、未消化の跨ぎ置換マークは古い (置換がこの
      // ユニットの内容を変えなかったときだけ残る)。放置すると、この編集の blocksSyncKey
      // 変化でタイピング途中の setContent + 古い選択復元が走り、キャレットが飛ぶ。
      crossEditorSyncRef.current = null;
      refreshInlineQueries(activeEditor);
      const nextBlocks = measurePerformance(
        "TextFlowEditor.tiptapToTextFlow",
        () => tiptapToTextFlow(activeEditor.getJSON() as TiptapDoc, blocksRef.current),
      );
      const normalizedBlocks = singleBlock ? nextBlocks.slice(0, 1) : nextBlocks;
      const activeBlockId = getSelectedTextBlockId(activeEditor) ?? getLastTextFlowBlockId(normalizedBlocks);
      const selectionBookmark = getTextFlowSelectionBookmark(activeEditor, verticalNavigationXRef.current);
      if (activeBlockId) {
        selectedIdRef.current = activeBlockId;
        onSelect(activeBlockId);
        refreshSelectedTextBlock(activeEditor.view);
      }
      const normalizedBlockIds = getTextFlowBlockIds(normalizedBlocks);
      onFocusChange?.(true, normalizedBlockIds, activeBlockId, selectionBookmark);
      beginTextFlowDocumentChange(selectionBeforeTransactionRef.current);
      const historyGrouping = groupTextFlowTransaction(historyGroupingRef.current, transaction);
      historyGroupingRef.current = historyGrouping.state;
      // 跨ぎ選択への IME 合成中は、compositionstart で流した他ユニット削除・compositionend
      // 後の境界結合と同じグループに載せる (undo 1 回で IME 置換全体が戻る)。
      const spanCompositionGroup = getTextRunSpanCompositionHistoryGroup(activeEditor);
      onChange(previousIdsRef.current, normalizedBlocks, activeBlockId, {
        historyGroup: spanCompositionGroup ?? `${historyGroupScope}:${historyGrouping.group}`,
        selection: selectionBookmark,
      });
      if (selectionBookmark) {
        publishTextFlowSelectionBookmark(selectionBookmark);
      }
      if (syncFocusedContent && !areTextFlowBlockIdSequencesEqual(normalizedBlockIds, previousIdsRef.current)) {
        const ownedBlocks = normalizedBlocks.filter((block) => getTextFlowBlockIds([block]).some((id) => previousIdsRef.current.includes(id)));
        setTextFlowContentPreservingSelection(
          activeEditor,
          ownedBlocks.length > 0 ? ownedBlocks : blocksRef.current,
        );
      }
    }),
  // A non-empty dependency list keeps Tiptap from calling editor.setOptions()
  // after every React render. That passive-effect update can remount React node
  // views while React is already committing an approved SigmaDoc, which is the
  // exact lifecycle race that left inline math visually stale until a tab
  // remount. Runtime callbacks still read Tiptap's latest options, while the
  // editor is recreated only when extension/editor-prop configuration changes.
  }, [mathEnvironment, mathFractionSizing, readOnlyBoxTitle, showPlaceholder, singleBlock]);

  useEffect(() => {
    if (!editor) {
      return;
    }
    const label = t("codeBlock.settings");
    const dom = readMountedEditorDom(editor);
    if (!dom) {
      return;
    }
    dom.querySelectorAll<HTMLButtonElement>("[data-code-block-action-button='true']")
      .forEach((button) => {
        button.title = label;
        button.setAttribute("aria-label", label);
      });
  }, [editor, locale, t]);

  /**
   * 装飾の再描画合図をまとめる。
   *
   * 種類ごとに transaction を打つと、その回数だけ全プラグインの装飾が計算し直される。合図は
   * meta なので 1 本の transaction に何種類でも載る。2 系統あるのは意味が違うため:
   *
   * - **遅延** (`setTimeout(0)`): ProseMirror の update 中に dispatch しないための逃がし。
   *   コメント・選択行・編集ガードはこちら (元からこの形だった)。
   * - **同期**: 余白や段組みのように、この commit の DOM を親 (`PageCanvasEditor`) が
   *   そのまま測りにくる合図。1 tick でも遅れるとページ割りが古いまま測られる。
   */
  const pendingDeferredRefreshRef = useRef<Set<TextFlowDecorationRefreshKind>>(new Set());
  const pendingSyncRefreshRef = useRef<Set<TextFlowDecorationRefreshKind>>(new Set());
  const deferredRefreshTimeoutRef = useRef<number | null>(null);

  const scheduleDecorationRefresh = useCallback((kind: TextFlowDecorationRefreshKind) => {
    pendingDeferredRefreshRef.current.add(kind);
    if (deferredRefreshTimeoutRef.current !== null) {
      return;
    }
    deferredRefreshTimeoutRef.current = window.setTimeout(() => {
      deferredRefreshTimeoutRef.current = null;
      // 溜めた種類を捨てるのは「打てた」ときだけ。editor が作り直された tick に捨てると、
      // 合図が飛ばないまま消える (装飾が古いまま残る)。
      if (!editor || editor.isDestroyed) {
        return;
      }
      const kinds = pendingDeferredRefreshRef.current;
      pendingDeferredRefreshRef.current = new Set();
      dispatchTextFlowDecorationRefresh(editor.view, kinds);
    }, 0);
  }, [editor]);

  // `/` から Tiptap のコマンドを呼ぶための ref。`useEditor` の設定の中では `editor` を
  // まだ参照できないので、作られた後にここで持ち回りへ渡す。
  useEffect(() => {
    tiptapEditorRef.current = editor ?? null;
    return () => {
      tiptapEditorRef.current = null;
    };
  }, [editor]);

  const requestSyncDecorationRefresh = useCallback((kind: TextFlowDecorationRefreshKind) => {
    pendingSyncRefreshRef.current.add(kind);
  }, []);

  useEffect(() => () => {
    if (deferredRefreshTimeoutRef.current !== null) {
      window.clearTimeout(deferredRefreshTimeoutRef.current);
      deferredRefreshTimeoutRef.current = null;
    }
  }, []);

  // 装飾プラグインは走るたびにこの ref から最新のスレッドを読むので、代入は毎レンダー行う。
  useEffect(() => {
    commentThreadsRef.current = commentThreads;
    activeCommentThreadIdRef.current = activeCommentThreadId;
    highlightedCommentThreadIdRef.current = highlightedCommentThreadId;
  });

  // 再描画の合図 (transaction) は、装飾の見た目が変わりうる時だけ。スレッド配列は文書が
  // 作り直されるたびに新しくなるので、識別子で判定すると打鍵ごとにユニット数だけ dispatch が出る。
  //
  // 鍵は**この編集器が描くコメントだけ**から作る。装飾はこの編集器が持つブロックに掛かるものしか
  // 描かないので、よそのブロックのスレッドが増減しても見た目は変わらない。開いている/強調中の
  // スレッドは画面全体で 1 つなので、素直に deps へ入れると全ユニットが合図を打つ。
  // (本文ユニットには親がユニット分だけを渡すが、問題エリアと段組みセクションには文書全体の
  //  一覧が渡るので、絞り込みはここで行う必要がある。)
  const ownCommentDecorationKey = useMemo(() => {
    const blockIds = new Set(previousIds);
    const ownThreads = commentThreads.filter((thread) => commentThreadTouchesBlocks(thread, blockIds));
    const ownThreadIds = new Set(ownThreads.map((thread) => thread.id));
    const active = activeCommentThreadId && ownThreadIds.has(activeCommentThreadId) ? activeCommentThreadId : "";
    const highlighted = highlightedCommentThreadId && ownThreadIds.has(highlightedCommentThreadId)
      ? highlightedCommentThreadId
      : "";
    return `${getCommentThreadsSyncKey(ownThreads)}\u0000${active}\u0000${highlighted}`;
  }, [activeCommentThreadId, commentThreads, highlightedCommentThreadId, previousIds]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) {
      return;
    }
    scheduleDecorationRefresh("comments");
  }, [editor, ownCommentDecorationKey, scheduleDecorationRefresh]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
    if (!editor || editor.isDestroyed) {
      return;
    }
    // 選択中の行の装飾は「その行がこの編集器にあるとき」だけ出る (`getSelectedId` と同じ判定)。
    // よその編集器で選択が動いただけなら、この編集器の見た目は変わらない = 合図も要らない。
    // 本文 1500 段落では矢印キー 1 回で 37 ユニット分の transaction が飛んでいた。
    const owned = selectedId && previousIds.includes(selectedId) ? selectedId : null;
    if (owned === ownedSelectedIdRef.current) {
      return;
    }
    ownedSelectedIdRef.current = owned;
    scheduleDecorationRefresh("selected");
  }, [editor, previousIds, scheduleDecorationRefresh, selectedId]);

  // 「本文と図形をまとめて選択」: キャレットを持っている編集器だけが応える。範囲が無ければ
  // まず全選択し、選択が覆ったブロック id をシェルへ返す (図形選択への変換はシェルの仕事)。
  //
  // 本文は改ページ・チャンク境界・問題エリア・段組ごとに別の Tiptap インスタンスなので、
  // この編集器の `selectAll` / `state.selection` だけを見ると「キャレットのあるページ分」
  // しか拾えない。全選択は跨ぎ選択 (⌘A と同じ経路) へ広げ、ブロック id も全ユニットから集める。
  useEffect(() => {
    const handleSelectWithShapes = () => {
      if (!editor || editor.isDestroyed || !editor.isFocused) {
        return;
      }
      const wholeDocument = editor.state.selection.empty;
      if (wholeDocument && !selectEntireTextRun(editor)) {
        // 分割の無い文書 (本文エディタが 1 つ) はこの編集器の全選択がそのまま文書全体。
        editor.commands.selectAll();
      }
      const blockIds = isMultiEditorTextRunSpan()
        ? collectTextRunSpanBlockIds()
        : collectSelectedBlockIds(editor.state);
      if (blockIds.length === 0) {
        return;
      }
      const source = readMountedEditorDom(editor);
      if (!source) {
        return;
      }
      requestBodySelectionShapes({ blockIds, source, wholeDocument });
    };

    window.addEventListener(SELECT_BODY_WITH_SHAPES_EVENT, handleSelectWithShapes);
    return () => window.removeEventListener(SELECT_BODY_WITH_SHAPES_EVENT, handleSelectWithShapes);
  }, [editor]);

  useEffect(() => {
    changeDecorationStateRef.current = changeDecorationState;
    if (editor && !editor.isDestroyed) {
      requestSyncDecorationRefresh("changes");
    }
  }, [changeDecorationState, editor, requestSyncDecorationRefresh]);

  // ガード表も同じ: 参照の更新は毎レンダー、再描画の合図はガードの中身が変わった時だけ。
  useEffect(() => {
    editGuardsRef.current = editGuardsByBlockId;
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed) {
      return;
    }
    scheduleDecorationRefresh("guards");
  }, [editGuardsKey, editor, scheduleDecorationRefresh]);

  /**
   * Undo/Redo swaps the content **synchronously, in the layout phase**.
   *
   * `PageCanvasEditor` reacts to a `historyRevision` change with a synchronous `recompute()` in
   * its own layout effect, so that the page never paints an un-paginated frame. React runs layout
   * effects child-first, so doing the swap here means that measurement sees the restored DOM.
   * While this ran on a `setTimeout(0)` the order was inverted: the parent measured the *pre-undo*
   * ProseMirror DOM and fed those heights into the box clip (`--text-flow-box-fragment-visible-height`)
   * and the fragment preview's `minHeight`, which is what made the frame swallow the body for a
   * frame or two.
   *
   * `blocks` is read from props, not `blocksRef`: that ref is refreshed in a passive effect, which
   * runs *after* every layout effect, so it still holds the pre-undo blocks at this point.
   *
   * `setTextFlowContentPreservingSelection` uses `setContent(..., { emitUpdate: false })`, so this
   * cannot loop back through `onUpdate` → `onReplaceTextFlow` and push the undo result onto the
   * history as a fresh change.
   */
  useLayoutEffect(() => {
    if (!editor || previousHistoryRevisionRef.current === historyRevision) {
      return;
    }

    previousHistoryRevisionRef.current = historyRevision;
    historyGroupingRef.current = createTextFlowHistoryGroupingState();
    // 履歴復元はこの下で内容を丸ごと入れ直すので、未消化の跨ぎ置換マークはここで役目を
    // 終える。残すと復元後の最初の同期で古い選択復元が走る。
    crossEditorSyncRef.current = null;
    if (!editor.isDestroyed) {
      setTextFlowContentPreservingSelection(editor, blocks);
      // Tell the passive sync below that this render's content is already in the editor, so it
      // does not apply the very same blocks a second time (once per unit, after paint).
      syncedContentKeyRef.current = blocksSyncKey;
    }
    // `blocks` is intentionally not a dependency: the restore is keyed on the revision, and the
    // blocks that belong to it are whatever this render was given.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocksSyncKey, editor, historyRevision]);

  /** この面はページを跨いで分割されたブロック (正本のクリップ、または続きの複製) を描くか。 */
  const drawsPageSplitBlock = boxFragmentReplicaId !== undefined
    || Object.keys(boxFragmentSourceLayouts ?? {}).length > 0;

  /**
   * 分割されたブロックを描いている面への外からの内容更新も、**レイアウトフェーズで**入れる。
   *
   * 続きの複製に打つと、正本 (ページ 1 側) の内容はこの同期でしか変わらない。それが下の
   * パッシブ経路 (`setTimeout(0)`) に乗っていると、順番がこうなる:
   *
   *   複製の打鍵 → 描画 → 正本の内容が伸びる → 描画 (下の本文が 1 行ぶん下がる)
   *   → 親がページ割りを取り直す → 描画 (下の本文が戻る)
   *
   * つまり「新しい内容 × 古いページ割り」が必ず 1 フレーム描かれる。ここで入れておけば、
   * 親 (`PageCanvasEditor`) のレイアウトエフェクト (React はレイアウトエフェクトを子から
   * 先に走らせる) が新しい DOM を測れるので、描画は 1 回で済む。
   *
   * フォーカスのある面は自分の ProseMirror が正本なので触らない。IME 合成中も触らない
   * (合成セッションが切れる) — どちらも従来どおり下のパッシブ経路が面倒を見る。
   */
  useLayoutEffect(() => {
    if (!editor || editor.isDestroyed || !drawsPageSplitBlock) {
      return;
    }
    if (editor.isFocused || editor.view.composing || crossEditorSyncRef.current) {
      return;
    }
    if (!shouldSyncExternalTextFlowContent(
      syncedContentKeyRef.current,
      mountContentKeyRef.current,
      blocksSyncKey,
    )) {
      return;
    }
    setTextFlowContentPreservingSelection(editor, blocks);
    syncedContentKeyRef.current = blocksSyncKey;
    // `blocks` はこのレンダーが渡されたものを使う (`blocksRef` はパッシブ効果で更新されるので
    // この時点ではまだ前のレンダーの値)。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocksSyncKey, drawsPageSplitBlock, editor]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    // History restores are handled synchronously by the layout effect above, which also records
    // the key it applied — so this passive path only ever sees ordinary external updates, and
    // never re-applies content that is already in the editor (mount included).
    if (!shouldSyncExternalTextFlowContent(
      syncedContentKeyRef.current,
      mountContentKeyRef.current,
      blocksSyncKey,
    )) {
      return;
    }
    // 以降このエディタの内容はマウント時のものではない (下でこのレンダーの blocks を入れるか、
    // 入れないと決めた場合でも、そう判断できるのはこの 1 回だけ)。
    mountContentKeyRef.current = null;

    const crossEditorSync = crossEditorSyncRef.current;
    crossEditorSyncRef.current = null;
    const editorBlockIds = getEditorTextBlockIds(editor);
    const nextBlockIds = getTextFlowBlockIds(blocksRef.current);
    // ブロック id 列が同じでも段落種別が変わっていれば描き直す。段落スタイルの変更は id を
    // 動かさないので、これが無いと SigmaDoc だけ見出しになって紙面は `<p>` のまま残る。
    if (
      !crossEditorSync
      && editor.isFocused
      && areTextFlowBlockIdSequencesEqual(editorBlockIds, nextBlockIds)
      && !hasTextFlowBlockKindChange(getEditorTextBlockKinds(editor), blocksRef.current)
      && !hasTextFlowBlockAttributeChange(getEditorTextBlockAttributes(editor), blocksRef.current)
    ) {
      return;
    }

    // IME 合成中の setContent は合成セッションを切り、確定前の文字を失わせる (跨ぎ選択への
    // IME 入力で、他ユニットの削除が再チャンクを起こしこのエディタの担当ブロック列が変わる
    // 場合が典型)。合成が終わって PM が DOM 差分を取り込んだ後に同じ同期をやり直す。
    let compositionRetry: (() => void) | null = null;
    let retryTimeoutId: number | null = null;
    const applySync = (apply: () => void): void => {
      if (editor.view.composing) {
        compositionRetry = () => {
          retryTimeoutId = window.setTimeout(() => {
            if (!editor.isDestroyed && !editor.view.composing) {
              apply();
            }
          }, 0);
        };
        const root = readMountedEditorDom(editor);
        root?.addEventListener("compositionend", compositionRetry, { once: true });
        return;
      }
      apply();
    };

    if (editor.isFocused && (syncFocusedContent || crossEditorSync)) {
      applySync(() => {
        setTextFlowContentPreservingSelection(editor, blocksRef.current);
        if (crossEditorSync?.selection) {
          const restored = applyTextFlowSelectionBookmark(editor, crossEditorSync.selection);
          if (restored.applied) {
            focusTextFlowSurface(editor, restored.activeMarks);
          }
        }
      });
      return () => {
        if (compositionRetry) {
          readMountedEditorDom(editor)?.removeEventListener("compositionend", compositionRetry);
        }
        if (retryTimeoutId !== null) {
          window.clearTimeout(retryTimeoutId);
        }
      };
    }

    const timeoutId = window.setTimeout(() => {
      const shouldSyncFocusedEditor =
        editor.isFocused &&
        (shouldSyncFocusedTextFlowContent(getEditorTextBlockIds(editor), blocksRef.current)
          || hasTextFlowBlockKindChange(getEditorTextBlockKinds(editor), blocksRef.current)
          || hasTextFlowBlockAttributeChange(getEditorTextBlockAttributes(editor), blocksRef.current));
      if (!editor.isDestroyed && (!editor.isFocused || shouldSyncFocusedEditor)) {
        applySync(() => {
          setTextFlowContentPreservingSelection(editor, blocksRef.current);
          if (crossEditorSync?.selection) {
            const restored = applyTextFlowSelectionBookmark(editor, crossEditorSync.selection);
            if (restored.applied) {
              focusTextFlowSurface(editor, restored.activeMarks);
            }
          }
        });
      }
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
      if (compositionRetry) {
        readMountedEditorDom(editor)?.removeEventListener("compositionend", compositionRetry);
      }
      if (retryTimeoutId !== null) {
        window.clearTimeout(retryTimeoutId);
      }
    };
  }, [blocksSyncKey, editor, syncFocusedContent]);

  const breakGapsKey = useMemo(() => getTextFlowBreakGapSyncKey(breakGaps), [breakGaps]);
  const paginationBeforeIdsKey = useMemo(() => (paginationBeforeIds ?? []).join("\u0000"), [paginationBeforeIds]);
  const paginationMarkerKindsKey = useMemo(
    () => Object.entries(paginationMarkerKinds ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([id, kind]) => `${id}:${kind}`).join("\u0000"),
    [paginationMarkerKinds],
  );
  const paginationMarkerLayoutsKey = useMemo(() => getTextFlowColumnLayoutsSyncKey(paginationMarkerLayouts), [paginationMarkerLayouts]);
  useEffect(() => {
    breakGapsRef.current = breakGaps ?? {};
    paginationBeforeIdsRef.current = paginationBeforeIds ?? [];
    paginationMarkerKindRef.current = resolvedPaginationMarkerKind;
    paginationMarkerKindsRef.current = paginationMarkerKinds ?? {};
    paginationMarkerLayoutsRef.current = paginationMarkerLayouts ?? {};
    if (editor && !editor.isDestroyed) {
      requestSyncDecorationRefresh("gaps");
    }
    // `locale` を依存に入れるのは、言語を切り替えたときに印のラベルを描き直させるため。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, breakGapsKey, locale, paginationBeforeIdsKey, paginationMarkerKind, paginationMarkerKindsKey, paginationMarkerLayoutsKey, requestSyncDecorationRefresh]);

  const columnFlowBlockLayoutsKey = useMemo(() => getTextFlowColumnLayoutsSyncKey(columnFlowBlockLayouts), [columnFlowBlockLayouts]);
  const boxFragmentSourceLayoutsKey = useMemo(() => getTextFlowFragmentLayoutsSyncKey(boxFragmentSourceLayouts), [boxFragmentSourceLayouts]);
  const headingNumbersKey = useMemo(
    () => Object.entries(headingNumbers).sort(([a], [b]) => a.localeCompare(b)).map(([id, number]) => `${id}:${number}`).join("\u0000"),
    [headingNumbers],
  );
  useEffect(() => {
    columnFlowBlockLayoutsRef.current = columnFlowBlockLayouts ?? {};
    boxFragmentSourceLayoutsRef.current = boxFragmentSourceLayouts ?? {};
    headingNumbersRef.current = headingNumbers;
    if (editor && !editor.isDestroyed) {
      requestSyncDecorationRefresh("columnFlow");
      requestSyncDecorationRefresh("headingNumbers");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, columnFlowBlockLayoutsKey, boxFragmentSourceLayoutsKey, headingNumbersKey, requestSyncDecorationRefresh]);

  // ドラッグ中の下余白プレビュー。`requestSyncDecorationRefresh` は「この commit の最後に打つ」
  // 予約なので、React の外 (pointerdown / pointerup) から来るこの合図はその場で打つ。
  //
  // 合図が来るのは 1 ドラッグにつき 2 回だけ (掴んだ瞬間と離した瞬間)。移動量は custom
  // property で運ぶので、pointermove ごとにここへ来ることはない。
  //
  // それでも **印を付ける面だけ** に絞る。ストアは全 `TextFlowEditor` が共有するので、
  // 素通りさせると掴むたびに紙面上のすべてのエディタで装飾プラグインが走り直す。
  const drawsSpaceAfterPreviewRef = useRef(false);
  useEffect(() => subscribeBlockSpaceAfterPreview(() => {
    // 複製の面は印を描かない (装飾側で捨てる) ので、合図も要らない。
    if (!editor || editor.isDestroyed || isBoxFragmentReplicaRef.current) {
      return;
    }
    const followerIds = getBlockSpaceAfterPreview()?.followerBlockIds ?? [];
    const draws = followerIds.some((id) => previousIdsRef.current.includes(id));
    // 直前まで描いていた面は「外す」ために 1 回だけ打つ必要がある。
    if (!draws && !drawsSpaceAfterPreviewRef.current) {
      return;
    }
    drawsSpaceAfterPreviewRef.current = draws;
    dispatchTextFlowDecorationRefresh(editor.view, SPACE_AFTER_REFRESH_KINDS);
  }), [editor]);

  // この commit で要求された同期の合図を 1 本の transaction にまとめて打つ。上の effect が
  // それぞれ打つと、余白と段組みが同時に変わったとき (ページ割り確定の瞬間がまさにそれ) に
  // 2 本になる。deps 無しなのは「要求があった commit の最後」に必ず走らせるため。
  useEffect(() => {
    const kinds = pendingSyncRefreshRef.current;
    if (kinds.size === 0 || !editor || editor.isDestroyed) {
      return;
    }
    pendingSyncRefreshRef.current = new Set();
    dispatchTextFlowDecorationRefresh(editor.view, kinds);
    // 段組みの配置が今この dispatch で付いた。配置待ちで保留していたキャレット追従を
    // ここでやり直す (確定前の座標で動くと紙面が文書先頭へ飛ぶ — 保留の理由はそちら)。
    flushDeferredCaretScroll(editor.view);
  });

  useLayoutEffect(() => {
    if (!editor || editor.isDestroyed) {
      return;
    }
    const root = readMountedEditorDom(editor);
    if (!root) {
      return;
    }

    return observeCornerBoxReferenceHeights(root, EDITOR_CORNERBOX_SELECTOR);
  }, [editor]);

  useLayoutEffect(() => {
    if (!editor || editor.isDestroyed) {
      return;
    }

    const root = readMountedEditorDom(editor);
    if (!root) {
      return;
    }
    const refresh = () => refreshManualColumnFlowHeights(root);
    refresh();
    const observer = new ResizeObserver(refresh);
    observer.observe(root);
    return () => observer.disconnect();
  }, [blocksSyncKey, editor, paginationBeforeIdsKey]);

  const fragmentedBoxIdsKey = useMemo(() => [
    ...Object.keys(boxFragmentSourceLayouts ?? {}),
    ...(boxFragmentReplicaId ? [boxFragmentReplicaId] : []),
  ].sort().join("\u0000"), [boxFragmentReplicaId, boxFragmentSourceLayouts]);

  /**
   * 面の可変情報。**登録には混ぜない** — 混ぜると担当ブロック列が変わるたびに登録と解除が
   * 走り、その解除が跨ぎ選択と IME 合成の予約を消す (罠 1)。
   */
  const caretFacetsRef = useRef<CaretSurfaceFacets | null>(null);

  // 登録より **前** に宣言する: マウント時はこの effect が先に走り、下の登録 effect が
  // ここで組み立てたファセットをそのまま使う。
  //
  // `useLayoutEffect` なのは順序のため。React は子の layout effect を親より先に走らせるので、
  // 親 (`PageCanvasEditor`) が `setFragmentTables` を撃つ時点で、面のファセットは必ず今の
  // レンダーの値になっている。passive effect にすると 1 フレーム古い値で配送先が決まる。
  useLayoutEffect(() => {
    if (!editor || editor.isDestroyed) {
      return;
    }
    const unitId = textRunUnitId ?? previousIds[0] ?? textRunGroupId ?? "";
    const boxIds = fragmentedBoxIdsKey ? fragmentedBoxIdsKey.split("\u0000") : [];
    const sourceLayouts = boxFragmentSourceLayouts ?? {};
    const facets: CaretSurfaceFacets = {
      boxIds,
      // 1 つのユニットに分割されたブロックが複数あることがある。面ごとに 1 つへ潰すと、
      // 別のブロックの表で断片番号を読んで無関係な面へ配送してしまう。
      fragmentBlockIdFor: (blockId) => resolveFragmentBlockId(
        blocksRef.current,
        sourceLayouts,
        boxFragmentReplicaId,
        blockId,
      ),
      // 文書順タプル。複製は [持ち主のユニットの順番, 断片番号] で、正本 [順番] の直後に並ぶ。
      // 順番を持たない面 (素材ダイアログ・ヘッダ/フッタ) は空配列にして行き先にしない。
      // 複製は `textRunGroupId` を持たない (跨ぎ選択のグループには入らない) ので、
      // グループの有無ではなく `boxFragmentReplicaId` で判定する。
      order: boxFragmentReplicaId
        ? [textRunOrder, boxFragmentReplicaIndex ?? 0]
        : (textRunGroupId ? [textRunOrder] : []),
      surface: boxFragmentReplicaId
        ? {
          kind: "fragmentReplica",
          blockId: boxFragmentReplicaId,
          fragmentIndex: boxFragmentReplicaIndex ?? 0,
        }
        : { kind: "unit", unitId },
      ownsBlock: (blockId) => blocksRef.current.some(
        (block) => bodyTextFlowBlockContainsId(block, blockId),
      ),
      addressAt: (position) => getTextFlowCaretAddress(
        editor.state.doc,
        position,
        DEFAULT_CARET_AFFINITY,
      ),
      posFor: (address) => getTextFlowSelectionPosition(editor, address),
      localYFor: (address, containerBlockId) => getTextFlowLocalY(editor, address, containerBlockId),
      caretLineAdvance: (containerBlockId, direction) => {
        try {
          const container = getTextFlowBlockElement(editor, containerBlockId);
          const scale = container
            ? getCaretZoomScale(container, container.getBoundingClientRect())
            : 1;
          const caret = editor.view.coordsAtPos(editor.state.selection.head);
          const fallback = (caret.bottom - caret.top) / scale;
          // ブロックの中の折り返しなら、次の行はキャレット矩形のすぐ下。
          if (!editor.view.endOfTextblock(direction)) {
            return fallback > 0 ? fallback : null;
          }
          // ブロックの端。次のブロックの先頭行を**実測**する (段落間の余白が入るので、
          // キャレット矩形の高さで代用すると断片の境界を跨いだ判定にならない)。
          const { $head } = editor.state.selection;
          const doc = editor.state.doc;
          if ($head.depth === 0) {
            return fallback > 0 ? fallback : null;
          }
          const boundary = direction === "down"
            ? $head.after($head.depth)
            : $head.before($head.depth);
          if (boundary < 0 || boundary > doc.content.size) {
            return fallback > 0 ? fallback : null;
          }
          const near = TextSelection.near(
            doc.resolve(boundary),
            direction === "down" ? 1 : -1,
          );
          if (near.$head.parent === $head.parent) {
            return fallback > 0 ? fallback : null;
          }
          const advance = Math.abs(
            editor.view.coordsAtPos(near.head).top - caret.top,
          ) / scale;
          // 隣のブロックが真下 (真上) に組まれていない構成 — 段組みの絶対配置や、間に
          // 分割ブロックを挟む場合 — では差が意味を持たない。行 4 つぶんを超えたら
          // measurement を信用せず矩形の高さへ戻す。
          const sane = advance > 0 && (fallback <= 0 || advance <= fallback * 4);
          return sane ? advance : (fallback > 0 ? fallback : null);
        } catch {
          return null;
        }
      },
      focusCaretAtLocalY: ({ containerBlockId, localY, preferredX }) => {
        const container = getTextFlowBlockElement(editor, containerBlockId);
        if (!container) {
          return false;
        }
        const rect = container.getBoundingClientRect();
        const clientY = rect.top + localY * getCaretZoomScale(container, rect);
        const placed = focusTextFlowCaretAtClientPoint(
          editor,
          preferredX,
          clientY,
          getCaretSurfaceBand(readMountedEditorDom(editor) ?? container, containerBlockId),
        );
        if (placed) {
          verticalNavigationXRef.current = preferredX;
          publishCaretMove(editor, preferredX);
        }
        return placed;
      },
      focusCaretAtEdge: (edge, preferredX) => {
        const root = readMountedEditorDom(editor);
        if (!root) {
          return false;
        }
        const band = getCaretSurfaceBand(root, null);
        const placed = focusTextFlowCaretAtClientPoint(
          editor,
          preferredX,
          edge === "top" ? band.top + 1 : band.bottom - 1,
          band,
        );
        if (placed) {
          verticalNavigationXRef.current = preferredX;
          publishCaretMove(editor, preferredX);
        }
        return placed;
      },
      focusCaretAfterBlock: (containerBlockId, direction, preferredX) => {
        // 行き先は**幾何ではなく doc 位置**で決める。分割ブロックはレイアウト上は全高を
        // 占めるので、矩形の下端の少し下を突くと箱の内側 (clip されて見えない場所) に
        // 当たってしまう。
        const placed = focusTextFlowCaretAfterBlock(editor, containerBlockId, direction, preferredX);
        if (placed) {
          if (preferredX !== null) {
            verticalNavigationXRef.current = preferredX;
          }
          publishCaretMove(editor, preferredX);
        }
        return placed;
      },
      docEdgeAddress: (edge) => {
        const doc = editor.state.doc;
        const selection = edge === "start" ? Selection.atStart(doc) : Selection.atEnd(doc);
        return getTextFlowCaretAddress(doc, selection.head, DEFAULT_CARET_AFFINITY);
      },
      adjacentTextblockAddress: (direction) => {
        try {
          const { $head } = editor.state.selection;
          const doc = editor.state.doc;
          if ($head.depth === 0) {
            return null;
          }
          const boundary = direction === "down"
            ? $head.after($head.depth)
            : $head.before($head.depth);
          if (boundary < 0 || boundary > doc.content.size) {
            return null;
          }
          const near = TextSelection.near(doc.resolve(boundary), direction === "down" ? 1 : -1);
          if (near.$head.parent === $head.parent) {
            return null;
          }
          return getTextFlowCaretAddress(doc, near.head, DEFAULT_CARET_AFFINITY);
        } catch {
          return null;
        }
      },
      ensureCaretVisible: () => {
        if (!editor.isDestroyed) {
          scrollCaretIntoView(editor.view);
        }
      },
      applyCaret: (selection) => {
        if (editor.isDestroyed) {
          return false;
        }
        const restored = applyTextFlowSelectionBookmark(editor, selection);
        if (!restored.applied) {
          return false;
        }
        focusTextFlowSurface(editor, restored.activeMarks);
        selectedIdRef.current = selection.head.blockId;
        onSelectRef.current(selection.head.blockId);
        return true;
      },
      textRun: textRunGroupId
        ? {
          editor,
          groupId: textRunGroupId,
          unitId,
          order: textRunOrder,
          preserveEmpty: textRunPreserveEmpty,
          scopeId: textRunScopeId ?? unitId,
          ...(textRunScopeContainer ? { scopeContainer: textRunScopeContainer } : {}),
          getBlocks: () => blocksRef.current,
          // 跨ぎ選択の置換 (エディタの外で組み立てた変更) の印。焦点があるエディタの受動
          // 同期は「id が同じなら何もしない」ため、そのままでは古い内容へ次の入力が入る。
          // 次の同期で必ず流し込むよう印を付けておく (writer 以外の関与ユニットにも付く)。
          markCrossEditorSync: (selection) => {
            crossEditorSyncRef.current = { selection };
          },
          // キャレットの乗るユニットの即時同期 (受動同期の再適用は同内容なので冪等)。
          // ここはルーター経由にしない: 受動同期を待つと置換前の doc に次の打鍵が入る。
          applyCrossEditorSync: (nextBlocks, selection) => {
            if (editor.isDestroyed) {
              return;
            }
            setTextFlowContentPreservingSelection(editor, nextBlocks);
            if (selection) {
              const restored = applyTextFlowSelectionBookmark(editor, selection);
              if (restored.applied) {
                focusTextFlowSurface(editor, restored.activeMarks);
              }
            }
          },
          onChange: (changedIds, nextBlocks, activeBlockId, context) => {
            onChangeRef.current(changedIds, nextBlocks, activeBlockId, context);
          },
        }
        : null,
    };
    caretFacetsRef.current = facets;
    updateCaretSurfaceFacets(editor, facets);
  }, [
    boxFragmentReplicaId,
    boxFragmentReplicaIndex,
    boxFragmentSourceLayouts,
    editor,
    fragmentedBoxIdsKey,
    previousIds,
    textRunGroupId,
    textRunOrder,
    textRunPreserveEmpty,
    textRunScopeContainer,
    textRunScopeId,
    textRunUnitId,
  ]);

  /** 面の登録。**deps は `[editor]` だけ**にすること (上のコメント参照)。 */
  useLayoutEffect(() => {
    const facets = caretFacetsRef.current;
    if (!editor || editor.isDestroyed || !facets) {
      return;
    }
    return registerCaretSurface({ editor, ...facets });
  }, [editor]);

  // span の変化でツールバーの書式状態を配り直す。Shift+矢印での跨ぎ拡張は head 側の
  // (焦点ではない) エディタにしか transaction を流さないため、onTransaction の配信だけだと
  // 焦点エディタの担当分を最後に見た状態のまま止まり、トグルの向きと表示がずれる。
  useEffect(() => {
    if (!editor) {
      return;
    }
    return subscribeTextRunSpan(() => {
      if (!editor.isDestroyed && editor.isFocused) {
        dispatchDocumentTextFormatState(editor);
      }
    });
  }, [editor]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    const requestTextPageBreak = (event: Event) => {
      const detail = event instanceof CustomEvent ? detailFromTextPageBreakEvent(event) : null;
      if (!detail) {
        return;
      }

      const currentBlocks = tiptapToTextFlow(editor.getJSON() as TiptapDoc, blocksRef.current);
      const selection = getManualTextPageBreakSelection(editor, detail.blockId, currentBlocks);
      if (shouldUseDocumentNextBlockForPageBreak(currentBlocks, detail, selection)) {
        return;
      }
      const result = resolveManualTextPageBreakBlocks(
        currentBlocks,
        detail.blockId,
        detail.enabled,
        selection,
        { createId },
      );
      if (!result) {
        return;
      }

      detail.handled = true;
      detail.focusBlockId = result.focusBlockId;
      detail.focusPosition = result.focusPosition;
      if (result.blocks !== currentBlocks) {
        setTextFlowContentPreservingSelection(editor, result.blocks);
      }
      onChange(previousIdsRef.current, result.blocks);
    };

    window.addEventListener(REQUEST_TEXT_PAGE_BREAK_EVENT, requestTextPageBreak);
    return () => window.removeEventListener(REQUEST_TEXT_PAGE_BREAK_EVENT, requestTextPageBreak);
  }, [editor, onChange]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    const insertInlineMath = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : null;
      const tex = typeof detail?.tex === "string" ? detail.tex : "";
      const shouldEdit = detail?.edit === true;
      const eventTarget = typeof detail?.target === "string" ? detail.target : "document";
      if (eventTarget !== formatTarget) {
        return;
      }

	      const handlesSelectedBlock = !!selectedId && textFlowBlocksContainId(blocks, selectedId);

      if ((!tex && !shouldEdit) || (!editor.isFocused && !handlesSelectedBlock)) {
        return;
      }

      const id = createId("m_inline");
      editor
        .chain()
        .focus()
        .insertMathInline({
          id,
          tex,
        })
        .run();

      if (shouldEdit) {
        requestInlineMathEdit(id);
      }
    };

    window.addEventListener(INSERT_INLINE_MATH_EVENT, insertInlineMath);
    return () => window.removeEventListener(INSERT_INLINE_MATH_EVENT, insertInlineMath);
  }, [blocks, editor, formatTarget, selectedId]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    const formatText = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : null;
      const eventTarget = typeof detail?.target === "string" ? detail.target : "document";
      if (eventTarget !== formatTarget) {
        return;
      }
      // 跨ぎ選択への書式適用は span 経路で全ユニットの担当範囲へ配る (ネイティブ選択は
      // 焦点エディタの担当分にしか無いので、通常経路だと部分適用になる)。リスナーは
      // 全ユニットに付いているため、同じイベントにつき 1 回だけ適用される。
      if (isMultiEditorTextRunSpan()) {
        if (typeof detail?.command === "string") {
          applyTextRunSpanFormatForEvent(event, {
            command: detail.command,
            value: detail.value,
          });
        }
        return;
      }
      const handlesSelectedBlock = !!selectedId && textFlowBlocksContainId(blocks, selectedId);
      if ((!editor.isFocused && !handlesSelectedBlock) || !detail?.command) {
        return;
      }

      applyTextFormatCommand(editor, {
        command: detail.command as string,
        value: detail.value,
      }, resolveTextFlowFormatCommandOptions(
        editor,
        selectedId,
        lastTextSelectionRef.current,
      ));

      // 適用後にキャレットが入ったブロックを、イベント経由で呼び出し側へ返す。
      // ブロックの入れ物を作り替えるとこのエディタごと remount されることがあり、
      // 呼び出し側 (EditorShell) は「どこへ焦点を戻すか」をこれでしか知れない。
      if (detail && typeof detail === "object") {
        (detail as { focusBlockId?: string | null }).focusBlockId = getSelectedTextBlockId(editor);
      }
    };

    window.addEventListener(FORMAT_TEXT_EVENT, formatText);
    return () => window.removeEventListener(FORMAT_TEXT_EVENT, formatText);
  }, [blocks, editor, formatTarget, selectedId]);

  const selectSlashCommandCandidate = useCallback((candidate: SlashCommandCandidate) => {
    if (!editor || editor.isDestroyed) {
      return;
    }

    insertSlashCommandFromQuery(
      editor.view,
      candidate,
      slashCommandQueryRef,
      onMaterialInsertRef,
      onBoxCommandRef,
      onProblemCommandRef,
      onBodyBlockCommandRef,
      tiptapEditorRef,
      onHeadingCommandRef,
      setSlashCommandQuery,
    );
  }, [editor, setSlashCommandQuery]);

  const openBoxActionDialog = useCallback((button: HTMLElement) => {
    const box = button.closest<HTMLElement>(".sigma-doc-box-block[data-sigma-doc-id]");
    const boxId = box?.dataset.sigmaDocId;
    if (!boxId) {
      return;
    }

    const rect = button.getBoundingClientRect();
    const maxLeft = Math.max(
      BOX_ACTION_DIALOG_MARGIN,
      window.innerWidth - BOX_ACTION_DIALOG_WIDTH - BOX_ACTION_DIALOG_MARGIN,
    );
    const maxTop = Math.max(
      BOX_ACTION_DIALOG_MARGIN,
      window.innerHeight - BOX_ACTION_DIALOG_HEIGHT - BOX_ACTION_DIALOG_MARGIN,
    );
    setBoxActionDialog((current) => current?.boxId === boxId ? null : {
      boxId,
      left: clampNumber(rect.right - BOX_ACTION_DIALOG_WIDTH, BOX_ACTION_DIALOG_MARGIN, maxLeft),
      top: clampNumber(rect.bottom + 6, BOX_ACTION_DIALOG_MARGIN, maxTop),
    });
    selectedIdRef.current = boxId;
    onSelect(boxId);
  }, [onSelect, setBoxActionDialog]);

  const deleteBoxBlock = useCallback((boxId: string) => {
    if (!editor || editor.isDestroyed) {
      return;
    }

    const nextSelectedId = deleteBoxBlockFromEditor(editor, boxId);
    setBoxActionDialog(null);
    setBoxSettingsDialog(null);
    selectedIdRef.current = nextSelectedId;
    if (nextSelectedId) {
      onSelect(nextSelectedId);
    }
  }, [editor, onSelect, setBoxActionDialog, setBoxSettingsDialog]);

  const copyBoxBlock = useCallback((boxId: string) => {
    if (!editor || editor.isDestroyed) {
      return;
    }

    const currentBlocks = tiptapToTextFlow(editor.getJSON() as TiptapDoc, blocksRef.current);
    const box = findBoxBlockInTextFlowBlocks(currentBlocks, boxId);
    if (!box) {
      return;
    }

    void writeEditorPayloadToSystemClipboard(createTextFlowClipboardPayload([box]));
    setBoxActionDialog(null);
  }, [editor, setBoxActionDialog]);

  const openBoxSettingsDialog = useCallback((boxId: string, options: { focusTitle?: boolean } = {}) => {
    if (!editor || editor.isDestroyed) {
      return;
    }
    setBoxActionDialog(null);
    // ページを跨いだ箱は複数の面に描かれるが、設定を持てるのは元の面だけ。複製面でも開くと
    // 同じ箱のダイアログが面の数だけ積み上がり、下の層は「開いた時点のタイトル」を抱えたまま
    // 残る (閉じると空欄のダイアログが顔を出す)。ここでは所有者へ回すだけにする。
    if (readOnlyBoxTitle) {
      window.dispatchEvent(new CustomEvent(REQUEST_BOX_SETTINGS_EVENT, {
        detail: { boxId, focusTitle: options.focusTitle === true },
      }));
      return;
    }
    const target = findBoxBlockNodeInDoc(editor.state.doc, boxId);
    const boxBlock = target ? boxSettingsBlockFromNode(target.node) : null;
    setBoxSettingsDialog(boxBlock && target ? {
      boxId: boxBlock.id,
      styleId: boxBlock.styleId,
      frame: boxBlock.frame,
      title: boxTitleFromNode(target.node),
      focusTitle: options.focusTitle === true,
    } : null);
  }, [editor, readOnlyBoxTitle, setBoxActionDialog, setBoxSettingsDialog]);

  useEffect(() => {
    const openSettings = (event: Event) => {
      // 複製面は所有者ではないので受け取らない (受け取ると上の再送と往復する)。
      if (readOnlyBoxTitle) {
        return;
      }
      const detail = event instanceof CustomEvent ? event.detail : null;
      const boxId = typeof detail?.boxId === "string" ? detail.boxId : null;
      if (boxId) {
        openBoxSettingsDialog(boxId, { focusTitle: detail?.focusTitle === true });
      }
    };
    window.addEventListener(REQUEST_BOX_SETTINGS_EVENT, openSettings);
    return () => window.removeEventListener(REQUEST_BOX_SETTINGS_EVENT, openSettings);
  }, [openBoxSettingsDialog, readOnlyBoxTitle]);

  const applyBoxSettings = useCallback((
    boxId: string,
    updater: (boxBlock: BoxBlockNode) => BoxBlockNode,
  ) => {
    if (!editor || editor.isDestroyed) {
      return;
    }
    const target = findBoxBlockNodeInDoc(editor.state.doc, boxId);
    const boxBlock = target ? boxSettingsBlockFromNode(target.node) : null;
    if (!target || !boxBlock) {
      setBoxSettingsDialog(null);
      return;
    }

    const nextBoxBlock = updater(boxBlock);
    const transaction = editor.state.tr.setNodeMarkup(target.pos, undefined, {
      ...target.node.attrs,
      styleId: nextBoxBlock.styleId,
      frame: nextBoxBlock.frame ?? null,
    });
    editor.view.dispatch(transaction);
    setBoxSettingsDialog((current) => ({
      boxId: nextBoxBlock.id,
      styleId: nextBoxBlock.styleId,
      frame: nextBoxBlock.frame,
      title: current?.boxId === nextBoxBlock.id ? current.title : boxTitleFromNode(target.node),
      focusTitle: false,
    }));
  }, [editor, setBoxSettingsDialog]);

  /**
   * 設定ダイアログを閉じたあと、キャレットをその箱へ戻す。
   *
   * これを置かないと ModalFrame の復帰先が「開いた時にフォーカスしていた要素」= 既に消えている
   * ⋯ ダイアログのボタンになり、body 先頭の入力 (画面上端の教材タイトル) が全選択された状態で
   * 残る。タイトルを付け終えた直後の 1 打鍵が教材名の書き換えになるので、必ず引き取る。
   */
  const focusBoxAfterSettings = useCallback((boxId: string) => {
    if (!editor || editor.isDestroyed) {
      return;
    }
    const target = findBoxBlockNodeInDoc(editor.state.doc, boxId);
    const titleNode = target?.node.firstChild;
    if (!target || titleNode?.type.name !== "boxBlockTitle") {
      return;
    }

    const selection = TextSelection.near(editor.state.doc.resolve(target.pos + titleNode.nodeSize), -1);
    editor.view.focus();
    editor.view.dispatch(editor.state.tr.setSelection(selection).scrollIntoView());
  }, [editor]);

  /**
   * ダイアログで打ったタイトルを箱へ書き戻す。
   *
   * 差し替えるのは `boxBlockTitle` の**中身だけ**で、ノード自体は残す。ノードごと入れ替えると
   * 1 打鍵ごとにタイトル領域の DOM (と中の数式ノードビュー) が作り直されてしまう。
   */
  const applyBoxTitle = useCallback((boxId: string, title: InlineNode[]) => {
    if (!editor || editor.isDestroyed) {
      return;
    }
    const target = findBoxBlockNodeInDoc(editor.state.doc, boxId);
    const titleNode = target?.node.firstChild;
    if (!target || titleNode?.type.name !== "boxBlockTitle") {
      return;
    }

    const titleStart = target.pos + 1;
    const contentFrom = titleStart + 1;
    const contentTo = titleStart + titleNode.nodeSize - 1;
    const nextContent = Fragment.fromJSON(editor.state.schema, inlineNodesToTiptapNodes(title));
    editor.view.dispatch(editor.state.tr.replaceWith(contentFrom, contentTo, nextContent));
    setBoxSettingsDialog((current) => (
      current && current.boxId === boxId ? { ...current, title, focusTitle: false } : current
    ));
  }, [editor, setBoxSettingsDialog]);

  const applyCodeBlockSettings = useCallback((
    codeBlockId: string,
    patch: { language?: string | null; theme?: CodeBlockTheme },
  ) => {
    if (!editor || editor.isDestroyed) {
      return;
    }
    const target = findCodeBlockNodeInDoc(editor.state.doc, codeBlockId);
    if (!target) {
      setCodeBlockSettingsPopover(null);
      return;
    }

    const language = patch.language === undefined
      ? normalizeCodeLanguage(target.node.attrs.language) ?? null
      : normalizeCodeLanguage(patch.language) ?? null;
    const theme = patch.theme === undefined
      ? normalizeCodeBlockTheme(target.node.attrs.theme) ?? "light"
      : patch.theme;
    editor.view.dispatch(editor.state.tr.setNodeMarkup(target.pos, undefined, {
      ...target.node.attrs,
      language,
      theme,
    }));
    setCodeBlockSettingsPopover((current) => current?.codeBlockId === codeBlockId
      ? { ...current, language, theme }
      : current);
  }, [editor, setCodeBlockSettingsPopover]);

  const closeCodeBlockSettings = useCallback(() => {
    setCodeBlockSettingsPopover((current) => {
      if (!current || !editor || editor.isDestroyed) {
        return null;
      }
      const { codeBlockId } = current;
      window.requestAnimationFrame(() => {
        const button = Array.from(readMountedEditorDom(editor)?.querySelectorAll<HTMLButtonElement>(
          "[data-code-block-action-button='true']",
        ) ?? []).find((candidate) => candidate.dataset.codeBlockId === codeBlockId);
        button?.focus({ preventScroll: true });
      });
      return null;
    });
  }, [editor, setCodeBlockSettingsPopover]);

  const applyContextTextFormat = useCallback((command: "fontFamily" | "lineHeight", value: string) => {
    window.dispatchEvent(new CustomEvent(FORMAT_TEXT_EVENT, {
      detail: { command, value, target: formatTarget },
    }));
  }, [formatTarget]);

  return (
    <div
      className={`text-flow-shell ${columnFlowBlockLayouts ? "column-flow-positioned" : ""}`}
      onCopy={(event) => {
        // ProseMirror のコピー処理はエディタ根の DOM に付いていて、React に委譲されたこの
        // ハンドラより先に走る。ここでは PM が書いた text/html には触らず、選択範囲の slice を
        // private MIME に添えるだけ。図形も選択されている混在コピーで、オーバーレイ側の window
        // ハンドラが同じイベント内からこれを拾って本文と図形を 1 つの payload にまとめる。
        //
        // 跨ぎ選択 (span) のコピーも同じ形: copyActiveTextRunSpan が payload と一緒に
        // 結合 slice を private MIME へ添えるので、stopPropagation せず window まで流し、
        // 図形が選択されていればオーバーレイ側が textAndShapes へまとめ直す。
        if (event.clipboardData && copyActiveTextRunSpan(event.clipboardData)) {
          event.preventDefault();
          return;
        }
        if (!editor || editor.state.selection.empty || !event.clipboardData) {
          return;
        }
        const slice = editor.state.selection.content();
        writeTextSliceClipboardData(event.clipboardData, slice.toJSON(), sliceTextForClipboard(slice));
      }}
      onMouseDown={(event) => {
        event.stopPropagation();
        const boxActionButton = getClosestBoxActionButton(event.target);
        if (boxActionButton) {
          event.preventDefault();
          openBoxActionDialog(boxActionButton);
          return;
        }
        const commentThreadId = getClosestCommentThreadId(event.target);
        if (commentThreadId) {
          onCommentThreadSelect?.(commentThreadId);
        }
        const boxFragmentSelectionStarted = editor
          ? startBoxFragmentPointerSelection(event, editor)
          : false;
        const expandedSelectionStarted = !boxFragmentSelectionStarted && (textRunGroupId && editor
          ? startTextRunPointerSelection(event, editor, textRunGroupId)
          : startExpandedTextSelection(event, editor));
        const pointerSelection = !boxFragmentSelectionStarted && !expandedSelectionStarted && editor && !editor.isDestroyed
          ? getTextFlowPointerSelection(event, editor)
          : null;
        const blockId =
          getClosestTextFlowBlockId(event.target) ??
          (isInsideTextFlowEditor(event.target) ? pointerSelection?.blockId ?? null : null);
        if (blockId) {
          selectedIdRef.current = blockId;
          onSelect(blockId);
          if (editor && !editor.isDestroyed) {
            if (pointerSelection) {
              focusTextFlowEditorAtPosition(editor, pointerSelection.position);
            }
            refreshSelectedTextBlock(editor.view);
          }
        }
      }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        if (!enableSelectionFormatMenu) {
          return;
        }
        if (!editor || editor.isDestroyed || !isInsideTextFlowEditor(event.target)) {
          return;
        }

        const hasSelection = !editor.state.selection.empty;
        const boxId = getBoxBlockIdAtContext(editor, event.target);
        if (!hasSelection && !boxId) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        const selectedBlockId = getSelectedTextBlockId(editor);
        if (selectedBlockId && hasSelection) {
          const { from, to } = editor.state.selection;
          lastTextSelectionRef.current = { blockId: selectedBlockId, from, to };
          selectedIdRef.current = selectedBlockId;
          onSelect(selectedBlockId);
        }

        const styledTextAttrs = editor.getAttributes("styledText");
        const currentNodeAttrs = editor.state.selection.$from.parent.attrs;
        const currentFontFamily = typeof styledTextAttrs.fontFamily === "string" && styledTextAttrs.fontFamily.trim()
          ? styledTextAttrs.fontFamily
          : DEFAULT_FONT_FAMILY_VALUE;
        const currentLineHeight = normalizeLineHeight(currentNodeAttrs.lineHeight) ?? "1.75";
        const selectionRect = window.getSelection()?.rangeCount
          ? window.getSelection()?.getRangeAt(0).getBoundingClientRect()
          : null;
        const requestedLeft = Number.isFinite(event.clientX)
          ? event.clientX
          : selectionRect?.left ?? 12;
        const requestedTop = Number.isFinite(event.clientY)
          ? event.clientY
          : selectionRect?.bottom ?? 12;
        setTextFormatContextMenu({
          left: Math.max(12, requestedLeft),
          top: Math.max(12, requestedTop),
          fontFamily: currentFontFamily,
          lineHeight: currentLineHeight,
          hasSelection,
          boxId,
        });
      }}
    >
      <div className="text-flow-side-selection-gutter" aria-hidden="true" />
      <EditorContent editor={editor} />
      {editGuardNotice && (
        <p className="text-flow-edit-guard-notice" role="status" aria-live="polite">
          {editGuardNotice}
        </p>
      )}
	      <SlashCommandPopover
        query={slashCommandQuery}
        candidates={slashCommandCandidates}
        activeIndex={clampedSlashCommandActiveIndex}
        onHover={setSlashCommandActiveIndex}
	        onSelect={selectSlashCommandCandidate}
	      />
      <BoxActionDialog
        state={boxActionDialog}
        onClose={() => setBoxActionDialog(null)}
        onEditTitle={(boxId) => openBoxSettingsDialog(boxId, { focusTitle: true })}
        onSettings={openBoxSettingsDialog}
        onCopy={copyBoxBlock}
        onDelete={deleteBoxBlock}
      />
      {activeBoxSettingsDialog ? (
        <BoxSettingsDialog
          boxBlock={{
            id: activeBoxSettingsDialog.boxId,
            styleId: activeBoxSettingsDialog.styleId,
            frame: activeBoxSettingsDialog.frame,
          }}
          title={activeBoxSettingsDialog.title}
          mathFractionSizing={mathFractionSizing}
          autoFocusTitle={activeBoxSettingsDialog.focusTitle}
          onStyleChange={(styleId) => {
            // スタイルを選び直すのも「そのスタイルを手に入れる」操作。覚えている見た目があれば
            // 挿入と同じように載せる (でないと、記憶した色がスタイル切替のたびに剥がれる)。
            applyBoxSettings(activeBoxSettingsDialog.boxId, (boxBlock) => (
              applyRememberedBoxFrame(setBoxStyle(boxBlock, styleId))
            ));
          }}
          onFrameChange={(patch) => {
            applyBoxSettings(activeBoxSettingsDialog.boxId, (boxBlock) => patchBoxFrame(boxBlock, patch));
            rememberBoxFramePatch(activeBoxSettingsDialog.styleId, patch);
          }}
          onResetStyle={() => {
            forgetRememberedBoxFrame(activeBoxSettingsDialog.styleId);
            applyBoxSettings(activeBoxSettingsDialog.boxId, (boxBlock) => (
              setBoxStyle(boxBlock, activeBoxSettingsDialog.styleId)
            ));
          }}
          onTitleChange={(title) => applyBoxTitle(activeBoxSettingsDialog.boxId, title)}
          onClose={() => {
            const { boxId } = activeBoxSettingsDialog;
            setBoxSettingsDialog(null);
            // ModalFrame のフォーカス復帰はアンマウント時に走るので、その後で引き取る。
            window.setTimeout(() => focusBoxAfterSettings(boxId), 0);
          }}
        />
      ) : null}
      <CodeBlockSettingsPopover
        state={activeCodeBlockSettingsPopover}
        onClose={closeCodeBlockSettings}
        onLanguageChange={(language) => {
          if (activeCodeBlockSettingsPopover) {
            applyCodeBlockSettings(activeCodeBlockSettingsPopover.codeBlockId, { language });
          }
        }}
        onThemeChange={(theme) => {
          if (activeCodeBlockSettingsPopover) {
            applyCodeBlockSettings(activeCodeBlockSettingsPopover.codeBlockId, { theme });
          }
        }}
      />
      <TextFormatContextMenu
        state={textFormatContextMenu}
        onClose={() => setTextFormatContextMenu(null)}
        onBoxEditTitle={(boxId) => {
          setTextFormatContextMenu(null);
          openBoxSettingsDialog(boxId, { focusTitle: true });
        }}
        onBoxSettings={(boxId) => {
          setTextFormatContextMenu(null);
          openBoxSettingsDialog(boxId);
        }}
        onBoxCopy={(boxId) => {
          setTextFormatContextMenu(null);
          copyBoxBlock(boxId);
        }}
        onBoxDelete={(boxId) => {
          setTextFormatContextMenu(null);
          deleteBoxBlock(boxId);
        }}
        onFontFamilyChange={(fontFamily) => {
	          setTextFormatContextMenu((current) => current ? { ...current, fontFamily } : current);
	          applyContextTextFormat("fontFamily", fontFamily === DEFAULT_FONT_FAMILY_VALUE ? "" : fontFamily);
	        }}
	        onLineHeightChange={(lineHeight) => {
	          setTextFormatContextMenu((current) => current ? { ...current, lineHeight } : current);
	          applyContextTextFormat("lineHeight", lineHeight);
	        }}
	      />
	    </div>
	  );
	}

function TextFormatContextMenu({
  state,
  onClose,
  onBoxEditTitle,
  onBoxSettings,
  onBoxCopy,
  onBoxDelete,
  onFontFamilyChange,
  onLineHeightChange,
}: {
  state: TextFormatContextMenuState | null;
  onClose: () => void;
  onBoxEditTitle?: (boxId: string) => void;
  onBoxSettings?: (boxId: string) => void;
  onBoxCopy?: (boxId: string) => void;
  onBoxDelete?: (boxId: string) => void;
  onFontFamilyChange: (fontFamily: string) => void;
  onLineHeightChange: (lineHeight: LineHeight) => void;
}) {
  const t = useT("editor");
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuPosition, setMenuPosition] = useState({ left: 12, top: 12 });

  useLayoutEffect(() => {
    if (!state) {
      return;
    }

    const repositionMenu = () => {
      const menu = menuRef.current;
      if (!menu) {
        return;
      }

      const margin = 12;
      const { width, height } = menu.getBoundingClientRect();
      const nextPosition = {
        left: Math.max(margin, Math.min(state.left, Math.max(margin, window.innerWidth - width - margin))),
        top: Math.max(margin, Math.min(state.top, Math.max(margin, window.innerHeight - height - margin))),
      };
      setMenuPosition((current) => (
        current.left === nextPosition.left && current.top === nextPosition.top ? current : nextPosition
      ));
    };

    repositionMenu();
    window.addEventListener("resize", repositionMenu);
    return () => window.removeEventListener("resize", repositionMenu);
  }, [state]);

  useEffect(() => {
    if (!state) {
      return;
    }

    const closeOnPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".text-format-context-menu")) {
        return;
      }
      onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose, state]);

  if (!state || typeof document === "undefined") {
    return null;
  }

  const step = (direction: "increase" | "decrease") => {
    onLineHeightChange(stepLineHeight(state.lineHeight, direction));
  };
  const fontFamilyIsListed = FONT_FAMILY_GROUPS.some((group) => (
    group.options.some((option) => option.value === state.fontFamily)
  ));

  return createPortal(
    <div
      ref={menuRef}
      className="text-format-context-menu"
      role="dialog"
      aria-label={state.hasSelection ? t("textFormat.selectionAria") : t("box.actions")}
      style={{ left: menuPosition.left, top: menuPosition.top }}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="text-format-context-menu-title">
        <span>{state.hasSelection ? t("textFormat.title") : t("box.actions")}</span>
        <button type="button" aria-label={t("common.close")} title={t("common.close")} onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      {state.hasSelection && (
        <>
          <label className="text-format-context-field">
            <span><Type size={15} aria-hidden="true" />{t("textFormat.fontFamily")}</span>
            <Select
              aria-label={t("textFormat.fontFamily")}
              value={state.fontFamily}
              style={{ fontFamily: state.fontFamily }}
              options={[
                ...(fontFamilyIsListed ? [] : [{ value: state.fontFamily, label: t("textFormat.currentFont") }]),
                ...FONT_FAMILY_GROUPS.map((group) => ({
                  label: group.label,
                  options: group.options.map((option) => ({
                    value: option.value,
                    label: option.label,
                    style: { fontFamily: option.value },
                  })),
                })),
              ]}
              onChange={onFontFamilyChange}
            />
          </label>
          <div className="text-format-context-field">
            <span><ListChevronsUpDown size={15} aria-hidden="true" />{t("textFormat.lineHeight")}</span>
            <Select
              aria-label={t("textFormat.lineHeight")}
              value={LINE_HEIGHT_OPTIONS.some((option) => option.value === state.lineHeight) ? state.lineHeight : "custom"}
              options={[
                ...(LINE_HEIGHT_OPTIONS.some((option) => option.value === state.lineHeight)
                  ? []
                  : [{ value: "custom", label: t("textFormat.lineHeightValue", { lines: state.lineHeight }) }]),
                ...LINE_HEIGHT_OPTIONS.map((option) => ({
                  value: option.value,
                  label: t("textFormat.lineHeightValue", { lines: option.value }),
                })),
              ]}
              onChange={(value) => {
                const lineHeight = normalizeLineHeight(value);
                if (lineHeight) {
                  onLineHeightChange(lineHeight);
                }
              }}
            />
            <div className="line-height-stepper text-format-context-stepper" role="group" aria-label={t("textFormat.lineHeightFine")}>
              <button
                type="button"
                aria-label={t("textFormat.lineHeightDecrease")}
                disabled={state.lineHeight === String(MIN_LINE_HEIGHT)}
                onClick={() => step("decrease")}
              >
                <Minus size={15} />
              </button>
              <output aria-live="polite">{t("textFormat.lineHeightValue", { lines: state.lineHeight })}</output>
              <button
                type="button"
                aria-label={t("textFormat.lineHeightIncrease")}
                disabled={state.lineHeight === String(MAX_LINE_HEIGHT)}
                onClick={() => step("increase")}
              >
                <Plus size={15} />
              </button>
            </div>
          </div>
        </>
      )}
      {state.boxId && onBoxEditTitle && (
        <button
          type="button"
          className="text-format-context-action"
          onClick={() => onBoxEditTitle(state.boxId!)}
        >
          <Heading size={15} aria-hidden="true" />
          <span>{t("box.editTitle")}</span>
        </button>
      )}
      {state.boxId && onBoxSettings && (
        <button
          type="button"
          className="text-format-context-action"
          onClick={() => onBoxSettings(state.boxId!)}
        >
          <Settings2 size={15} aria-hidden="true" />
          <span>{t("box.settings")}</span>
        </button>
      )}
      {state.boxId && onBoxCopy && (
        <button
          type="button"
          className="text-format-context-action"
          onClick={() => onBoxCopy(state.boxId!)}
        >
          <Copy size={15} aria-hidden="true" />
          <span>{t("box.copy")}</span>
        </button>
      )}
      {state.boxId && onBoxDelete && (
        <button
          type="button"
          className="text-format-context-action danger"
          onClick={() => onBoxDelete(state.boxId!)}
        >
          <Trash2 size={15} aria-hidden="true" />
          <span>{t("box.delete")}</span>
        </button>
      )}
    </div>,
    document.body,
  );
}

function BoxActionDialog({
  state,
  onClose,
  onEditTitle,
  onSettings,
  onCopy,
  onDelete,
}: {
  state: BoxActionDialogState | null;
  onClose: () => void;
  onEditTitle: (boxId: string) => void;
  onSettings: (boxId: string) => void;
  onCopy: (boxId: string) => void;
  onDelete: (boxId: string) => void;
}) {
  const t = useT("editor");
  useEffect(() => {
    if (!state) {
      return;
    }

    const closeOnPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".box-action-dialog, .sigma-doc-box-action-button")) {
        return;
      }
      onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose, state]);

  if (!state || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="box-action-dialog"
      role="dialog"
      aria-label={t("box.actions")}
      style={{ left: state.left, top: state.top }}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="box-action-dialog-title">
        <span>{t("box.actions")}</span>
        <button type="button" aria-label={t("common.close")} title={t("common.close")} onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      <button
        type="button"
        className="box-action-dialog-item"
        onClick={() => onEditTitle(state.boxId)}
      >
        <Heading size={15} />
        <span>{t("box.editTitle")}</span>
      </button>
      <button
        type="button"
        className="box-action-dialog-item"
        onClick={() => onSettings(state.boxId)}
      >
        <Settings2 size={15} />
        <span>{t("box.settings")}</span>
      </button>
      <button
        type="button"
        className="box-action-dialog-item"
        onClick={() => onCopy(state.boxId)}
      >
        <Copy size={15} />
        <span>{t("box.copy")}</span>
      </button>
      <button
        type="button"
        className="box-action-dialog-item danger"
        onClick={() => onDelete(state.boxId)}
      >
        <Trash2 size={15} />
        <span>{t("box.delete")}</span>
      </button>
    </div>,
    document.body,
  );
}

function CodeBlockSettingsPopover({
  state,
  onClose,
  onLanguageChange,
  onThemeChange,
}: {
  state: CodeBlockSettingsPopoverState | null;
  onClose: () => void;
  onLanguageChange: (language: string | null) => void;
  onThemeChange: (theme: CodeBlockTheme) => void;
}) {
  const t = useT("editor");
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!state) {
      return;
    }

    const focusFrame = window.requestAnimationFrame(() => {
      popoverRef.current?.querySelector<HTMLSelectElement>("select")?.focus({ preventScroll: true });
    });
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const actionButton = target?.closest<HTMLElement>("[data-code-block-action-button='true']");
      if (
        target?.closest(".code-block-settings-popover")
        || actionButton?.dataset.codeBlockId === state.codeBlockId
      ) {
        return;
      }
      onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };

    window.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [onClose, state]);

  if (!state || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      ref={popoverRef}
      className="code-block-settings-popover"
      role="dialog"
      aria-label={t("codeBlock.settings")}
      style={{ left: state.left, top: state.top }}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="code-block-settings-title">
        <span>{t("codeBlock.title")}</span>
        <button type="button" aria-label={t("common.close")} title={t("common.close")} onClick={onClose}>
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      <label className="code-block-settings-field">
        <span>{t("codeBlock.language")}</span>
        <Select
          aria-label={t("codeBlock.languageAria")}
          value={state.language ?? ""}
          options={[
            { value: "", label: t("codeBlock.auto") },
            ...CODE_BLOCK_LANGUAGES.map((option) => ({
              value: option.value,
              label: option.labelKey ? t(option.labelKey) : option.label,
            })),
          ]}
          onChange={(value) => onLanguageChange(value || null)}
        />
      </label>
      <fieldset className="code-block-settings-field">
        <legend>{t("codeBlock.background")}</legend>
        <div className="code-block-theme-options" role="radiogroup" aria-label={t("codeBlock.backgroundAria")}>
          <button
            type="button"
            role="radio"
            aria-checked={state.theme === "light"}
            className={state.theme === "light" ? "selected" : ""}
            onClick={() => onThemeChange("light")}
          >
            <Sun size={15} aria-hidden="true" />
            <span>{t("codeBlock.light")}</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={state.theme === "dark"}
            className={state.theme === "dark" ? "selected" : ""}
            onClick={() => onThemeChange("dark")}
          >
            <Moon size={15} aria-hidden="true" />
            <span>{t("codeBlock.dark")}</span>
          </button>
        </div>
      </fieldset>
    </div>,
    document.body,
  );
}

function SlashCommandPopover({
  query,
  candidates,
  activeIndex,
  onHover,
  onSelect,
}: {
  query: ActiveSlashCommandQuery | null;
  candidates: SlashCommandCandidate[];
  activeIndex: number;
  onHover: (index: number) => void;
  onSelect: (candidate: SlashCommandCandidate) => void;
}) {
  const t = useT("editor");
  if (!query || typeof document === "undefined" || typeof window === "undefined") {
    return null;
  }

  const position = getSlashCommandPopoverPosition(query.rect.left, query.rect.bottom);
  const style: CSSProperties = {
    position: "fixed" as const,
    top: position.top,
    left: position.left,
    zIndex: 240,
  };
  const activeCandidate = candidates[activeIndex] ?? candidates[0] ?? null;
  const activeMaterial = activeCandidate?.kind === "material" ? activeCandidate.material : null;
  const previewStyle = activeMaterial
    ? getSlashCommandPreviewStyle(position.left, position.top)
    : undefined;

  return createPortal(
    <>
      <div className="slash-command-popover" role="listbox" aria-label={t("slash.candidates")} style={style}>
        <div className="slash-command-title">{t("slash.title")}</div>
        {candidates.length === 0 ? (
          <div className="slash-command-empty">{t("slash.empty")}</div>
        ) : (
          candidates.map((candidate, index) => (
            <button
              key={getSlashCommandCandidateKey(candidate)}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className="slash-command-option"
              data-command-kind={candidate.kind}
              onMouseEnter={() => onHover(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(candidate);
              }}
            >
              <span className="slash-command-row">
                <span className="slash-command-name">{getSlashCommandCandidateName(candidate)}</span>
                <span className="slash-command-kind">{getSlashCommandCandidateKindLabel(candidate, t)}</span>
              </span>
              <span className="slash-command-meta">{getSlashCommandCandidateMeta(candidate, t)}</span>
            </button>
          ))
        )}
      </div>
      {activeMaterial && previewStyle && (
        <aside className="slash-command-preview" style={previewStyle} aria-hidden="true">
          <MaterialContentPreview content={activeMaterial.content} title={activeMaterial.name} box={isOfficialMaterial(activeMaterial)} />
          <div className="slash-command-preview-caption">
            <strong>{activeMaterial.name}</strong>
            <span>{getMaterialSummaryLabel(activeMaterial, t)}</span>
          </div>
        </aside>
      )}
    </>,
    document.body,
  );
}

function getSlashCommandPopoverPosition(left: number, bottom: number): { left: number; top: number } {
  const popoverWidth = getSlashCommandPopoverWidth();
  const popoverHeight = getSlashCommandPopoverHeight();
  const maxLeft = Math.max(SLASH_COMMAND_MARGIN, window.innerWidth - popoverWidth - SLASH_COMMAND_MARGIN);
  const maxTop = Math.max(SLASH_COMMAND_MARGIN, window.innerHeight - popoverHeight - SLASH_COMMAND_MARGIN);
  return {
    left: clampNumber(left, SLASH_COMMAND_MARGIN, maxLeft),
    top: clampNumber(bottom + 6, SLASH_COMMAND_MARGIN, maxTop),
  };
}

function getSlashCommandPreviewStyle(popoverLeft: number, popoverTop: number): CSSProperties {
  const popoverWidth = getSlashCommandPopoverWidth();
  const preferredLeft = popoverLeft + popoverWidth + SLASH_COMMAND_GAP;
  const left = preferredLeft + SLASH_COMMAND_PREVIEW_WIDTH <= window.innerWidth - SLASH_COMMAND_MARGIN
    ? preferredLeft
    : Math.max(SLASH_COMMAND_MARGIN, popoverLeft - SLASH_COMMAND_PREVIEW_WIDTH - SLASH_COMMAND_GAP);
  const maxTop = Math.max(SLASH_COMMAND_MARGIN, window.innerHeight - SLASH_COMMAND_PREVIEW_HEIGHT - SLASH_COMMAND_MARGIN);
  return {
    position: "fixed",
    left,
    top: clampNumber(popoverTop, SLASH_COMMAND_MARGIN, maxTop),
    zIndex: 241,
  };
}

function getSlashCommandPopoverWidth(): number {
  return Math.min(SLASH_COMMAND_POPOVER_WIDTH, Math.max(120, window.innerWidth - SLASH_COMMAND_MARGIN * 2));
}

function getSlashCommandPopoverHeight(): number {
  return Math.min(SLASH_COMMAND_POPOVER_MAX_HEIGHT, Math.max(120, window.innerHeight - SLASH_COMMAND_MARGIN * 2));
}

function handleSlashCommandQueryKeyDown(
  view: EditorView,
  event: KeyboardEvent,
  slashCommandQueryRef: { current: ActiveSlashCommandQuery | null },
  slashCommandCandidatesRef: { current: SlashCommandCandidate[] },
  slashCommandActiveIndexRef: { current: number },
  setSlashCommandActiveIndex: (updater: (current: number) => number) => void,
  onMaterialInsertRef: { current: TextFlowEditorProps["onMaterialInsert"] },
  onBoxCommandRef: { current: TextFlowEditorProps["onBoxCommand"] },
  onProblemCommandRef: { current: TextFlowEditorProps["onProblemCommand"] },
  onBodyBlockCommandRef: { current: TextFlowEditorProps["onBodyBlockCommand"] },
  editorRef: { current: TiptapEditor | null },
  onHeadingCommandRef: { current: TextFlowEditorProps["onHeadingCommand"] },
  setSlashCommandQuery: (query: ActiveSlashCommandQuery | null) => void,
): boolean {
  if (!slashCommandQueryRef.current) {
    return false;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    setSlashCommandQuery(null);
    return true;
  }

  const candidates = slashCommandCandidatesRef.current;
  if (candidates.length === 0) {
    return false;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    setSlashCommandActiveIndex((current) => (current + 1) % candidates.length);
    return true;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    setSlashCommandActiveIndex((current) => (current - 1 + candidates.length) % candidates.length);
    return true;
  }

  if ((event.key === "Enter" || event.key === "Tab") && !event.metaKey && !event.ctrlKey) {
    event.preventDefault();
    insertSlashCommandFromQuery(
      view,
      candidates[slashCommandActiveIndexRef.current] ?? candidates[0],
      slashCommandQueryRef,
      onMaterialInsertRef,
      onBoxCommandRef,
      onProblemCommandRef,
      onBodyBlockCommandRef,
      editorRef,
      onHeadingCommandRef,
      setSlashCommandQuery,
    );
    return true;
  }

  return false;
}

function insertSlashCommandFromQuery(
  view: EditorView,
  candidate: SlashCommandCandidate,
  slashCommandQueryRef: { current: ActiveSlashCommandQuery | null },
  onMaterialInsertRef: { current: TextFlowEditorProps["onMaterialInsert"] },
  onBoxCommandRef: { current: TextFlowEditorProps["onBoxCommand"] },
  onProblemCommandRef: { current: TextFlowEditorProps["onProblemCommand"] },
  onBodyBlockCommandRef: { current: TextFlowEditorProps["onBodyBlockCommand"] },
  editorRef: { current: TiptapEditor | null },
  onHeadingCommandRef: { current: TextFlowEditorProps["onHeadingCommand"] },
  setSlashCommandQuery: (query: ActiveSlashCommandQuery | null) => void,
): void {
  if (candidate.kind === "problem") {
    insertProblemCommandFromQuery(view, slashCommandQueryRef, onProblemCommandRef, setSlashCommandQuery);
    return;
  }

  if (candidate.kind === "block") {
    insertBodyBlockCommandFromQuery(
      view,
      candidate.block,
      slashCommandQueryRef,
      editorRef,
      onBodyBlockCommandRef,
      setSlashCommandQuery,
    );
    return;
  }

  if (candidate.kind === "heading") {
    insertHeadingCommandFromQuery(
      view,
      candidate.heading.level,
      slashCommandQueryRef,
      onHeadingCommandRef,
      setSlashCommandQuery,
    );
    return;
  }

  if (candidate.kind === "box") {
    insertBoxCommandFromQuery(view, candidate.box, slashCommandQueryRef, onBoxCommandRef, setSlashCommandQuery);
    return;
  }

  insertMaterialFromQuery(view, candidate.material, slashCommandQueryRef, onMaterialInsertRef, setSlashCommandQuery);
}

function insertHeadingCommandFromQuery(
  view: EditorView,
  level: 1 | 2 | 3,
  slashCommandQueryRef: { current: ActiveSlashCommandQuery | null },
  onHeadingCommandRef: { current: TextFlowEditorProps["onHeadingCommand"] },
  setSlashCommandQuery: (query: ActiveSlashCommandQuery | null) => void,
): void {
  const query = slashCommandQueryRef.current;
  if (!query) return;
  const { state } = view;
  const { $from } = state.selection;
  const trailingText = $from.parent.textBetween($from.parentOffset, $from.parent.content.size, "", "");
  const headingType = state.schema.nodes.heading;
  if (!state.selection.empty || !$from.parent.isTextblock || trailingText.trim() || !headingType) {
    setSlashCommandQuery(null);
    return;
  }
  if (!(onHeadingCommandRef.current?.({ triggerBlockId: query.blockId, level }) ?? true)) {
    setSlashCommandQuery(null);
    return;
  }

  const blockFrom = $from.before($from.depth);
  const removedSize = query.to - query.from;
  const transaction = state.tr.delete(query.from, query.to);
  transaction.setBlockType(
    blockFrom,
    Math.max(blockFrom + 1, $from.after($from.depth) - removedSize),
    headingType,
    { ...$from.parent.attrs, level },
  );
  transaction.setSelection(TextSelection.create(transaction.doc, query.from));
  view.dispatch(transaction.scrollIntoView());
  view.focus();
  setSlashCommandQuery(null);
}

function insertMaterialFromQuery(
  view: EditorView,
  material: MaterialItem,
  slashCommandQueryRef: { current: ActiveSlashCommandQuery | null },
  onMaterialInsertRef: { current: TextFlowEditorProps["onMaterialInsert"] },
  setSlashCommandQuery: (query: ActiveSlashCommandQuery | null) => void,
): void {
  const query = slashCommandQueryRef.current;
  if (!query) {
    return;
  }

  setSlashCommandQuery(null);
  view.dispatch(view.state.tr.delete(query.from, query.to));
  view.focus();

  onMaterialInsertRef.current?.({
    material,
    triggerBlockId: query.blockId,
    screenPoint: query.screenPoint,
  });
}

function insertProblemCommandFromQuery(
  view: EditorView,
  slashCommandQueryRef: { current: ActiveSlashCommandQuery | null },
  onProblemCommandRef: { current: TextFlowEditorProps["onProblemCommand"] },
  setSlashCommandQuery: (query: ActiveSlashCommandQuery | null) => void,
): void {
  const query = slashCommandQueryRef.current;
  if (!query) {
    return;
  }

  const { state } = view;
  if (!state.selection.empty || isSelectionInsideBoxBlock(state)) {
    setSlashCommandQuery(null);
    return;
  }

  const { $from } = state.selection;
  const trailingText = $from.parent.textBetween($from.parentOffset, $from.parent.content.size, "", "");
  if (!$from.parent.isTextblock || trailingText.trim().length > 0) {
    setSlashCommandQuery(null);
    return;
  }

  const handledByHost = onProblemCommandRef.current?.({
    triggerBlockId: query.blockId,
  }) ?? false;
  if (!handledByHost) {
    setSlashCommandQuery(null);
    return;
  }

  view.dispatch(state.tr.delete(query.from, query.to).scrollIntoView());
  view.focus();
  setSlashCommandQuery(null);
}

/**
 * 本文ブロック (引用・コード・区切り線) を `/` から作る。
 *
 * 打った `/引用` の文字を消してから **Tiptap のコマンドをそのまま呼ぶ** のが肝で、ツールバー・
 * 入力ルール (`> `, ```` ``` ````, `---`) と同じ 1 本の経路を通る。ここで独自に段落を作り替えると、
 * リストからの抜け方やコードの fence 除去といった約束が `/` からだけ抜け落ちる。
 */
function insertBodyBlockCommandFromQuery(
  view: EditorView,
  candidate: TextFlowCommandDefinition,
  slashCommandQueryRef: { current: ActiveSlashCommandQuery | null },
  editorRef: { current: TiptapEditor | null },
  onBodyBlockCommandRef: { current: TextFlowEditorProps["onBodyBlockCommand"] },
  setSlashCommandQuery: (query: ActiveSlashCommandQuery | null) => void,
): void {
  const query = slashCommandQueryRef.current;
  const editor = editorRef.current;
  const kind = bodyBlockCommandKindFromId(candidate.id);
  setSlashCommandQuery(null);
  if (!query || !kind || !editor || editor.isDestroyed) {
    return;
  }

  // 先にトリガー文字だけを消す。ブロックを作り替えるコマンドは「いまの段落」を対象に取るので、
  // `/引用` が残ったまま包むと引用の中に `/引用` という本文が残る。
  view.dispatch(view.state.tr.delete(query.from, query.to));
  view.focus();

  // ホストが受けるならそちらへ渡す。入れ物を作る操作はこのエディタごと remount させるので、
  // 焦点の戻し先を知っているのはホストだけ (ツールバーのブロックボタンと同じ経路)。
  if (onBodyBlockCommandRef.current?.({ kind, triggerBlockId: query.blockId })) {
    return;
  }

  const chain = editor.chain().focus();
  if (kind === "quote") {
    chain.toggleQuoteBlock().run();
    return;
  }
  if (kind === "codeBlock") {
    chain.toggleCodeBlock().run();
    return;
  }
  chain.toggleDivider().run();
}

function insertBoxCommandFromQuery(
  view: EditorView,
  candidate: TextFlowCommandDefinition,
  slashCommandQueryRef: { current: ActiveSlashCommandQuery | null },
  onBoxCommandRef: { current: TextFlowEditorProps["onBoxCommand"] },
  setSlashCommandQuery: (query: ActiveSlashCommandQuery | null) => void,
): void {
  const query = slashCommandQueryRef.current;
  if (!query) {
    return;
  }

  const { state } = view;
  const { selection } = state;
  if (!selection.empty || !query.canInsertBox || isSelectionInsideBoxBlock(state)) {
    setSlashCommandQuery(null);
    return;
  }

  const { $from } = selection;
  const trailingText = $from.parent.textBetween($from.parentOffset, $from.parent.content.size, "", "");
  if (!$from.parent.isTextblock || trailingText.trim().length > 0) {
    setSlashCommandQuery(null);
    return;
  }

  const handledByHost = onBoxCommandRef.current?.({
    styleId: candidate.id,
    commandName: candidate.commandName,
    displayName: candidate.displayName,
    triggerBlockId: query.blockId,
  }) ?? false;

  if (handledByHost) {
    view.dispatch(state.tr.delete(query.from, query.to).scrollIntoView());
    view.focus();
    setSlashCommandQuery(null);
    return;
  }

  // 既定タイトルは**文書に焼き込まれる**ので、挿入した時点の UI 言語で解決する。
  // ここは React の外 (module 直下のヘルパ) なので `useT` ではなくストアから引く。
  const boxBlock = applyRememberedBoxFrame(
    createBoxBlock(candidate.id, "", {}, createTranslator(getAppLocale(), "editor")),
  );
  const boxNode = state.schema.nodeFromJSON(textFlowBlockToTiptapNode(boxBlock));
  const from = $from.before($from.depth);
  const to = $from.after($from.depth);
  const transaction = state.tr.replaceWith(from, to, boxNode);
  const focusPos = Math.min(transaction.doc.content.size, from + 2);
  try {
    transaction.setSelection(TextSelection.create(transaction.doc, focusPos));
  } catch {
    // If the schema changes, the insertion should still succeed even if focus falls back.
  }
  view.dispatch(transaction.scrollIntoView());
  view.focus();
  setSlashCommandQuery(null);
}

function getActiveSlashCommandQuery(view: EditorView): ActiveSlashCommandQuery | null {
  const { selection } = view.state;
  if (!selection.empty) {
    return null;
  }

  const { $from } = selection;
  if (findAncestorNodeDepth($from, "boxBlockTitle") >= 0) {
    return null;
  }
  const parent = $from.parent;
  if (!parent.isTextblock) {
    return null;
  }

  const blockId = typeof parent.attrs.sigmaDocId === "string" ? parent.attrs.sigmaDocId : "";
  if (!blockId) {
    return null;
  }

  const beforeCursor = parent.textBetween(0, $from.parentOffset, "", "");
  const trigger = parseTextFlowCommandTrigger(beforeCursor);
  if (!trigger) {
    return null;
  }

  const trailingText = parent.textBetween($from.parentOffset, parent.content.size, "", "");
  const canInsertBox = !isSelectionInsideBoxBlock(view.state) && trailingText.trim().length === 0;
  const availableBlockCommandIds = trailingText.trim().length === 0
    ? getAvailableBodyBlockCommandIds(view.state)
    : [];
  const from = selection.from - trigger.triggerLength;
  const to = selection.from;
  try {
    const rect = view.coordsAtPos(from);
    return {
      blockId,
      from,
      to,
      query: trigger.query,
      canInsertBox,
      availableBlockCommandIds,
      rect: {
        bottom: rect.bottom,
        left: rect.left,
      },
      screenPoint: {
        x: rect.left,
        y: rect.top,
      },
    };
  } catch {
    return null;
  }
}

function filterMaterialCandidates(materials: MaterialItem[], query: string): MaterialItem[] {
  return materials
    .filter((material) => materialMatchesQuery(material, query))
    .sort((a, b) => Number(isOfficialMaterial(a)) - Number(isOfficialMaterial(b)))
    .slice(0, MAX_MATERIAL_CANDIDATES);
}

function filterSlashCommandCandidates(
  materials: MaterialItem[],
  query: string,
  includeBoxCommands: boolean,
  t: Translate<"editor">,
  boxCommandStyleIds?: readonly string[],
  includeProblemCommand = false,
  blockCommandIds: readonly string[] = [],
  includeHeadingCommands = false,
): SlashCommandCandidate[] {
  const problemCandidates = includeProblemCommand
    ? filterTextFlowCommandDefinitions([buildProblemCommandDefinition(t)], {
        query,
        limit: 1,
      }).map((problem): SlashCommandCandidate => ({ kind: "problem", problem }))
    : [];
  const headingCandidates = includeHeadingCommands
    ? filterTextFlowCommandDefinitions(buildHeadingCommandDefinitions(t), {
        query,
        limit: 3,
      }).map((heading): SlashCommandCandidate => ({ kind: "heading", heading }))
    : [];
  const boxCandidates = includeBoxCommands
    ? filterTextFlowCommandDefinitions(buildBoxCommandDefinitions(t), {
        query,
        allowedIds: boxCommandStyleIds,
        limit: MAX_BOX_COMMAND_CANDIDATES,
      }).map((box): SlashCommandCandidate => ({ kind: "box", box }))
    : [];
  const blockCandidates = blockCommandIds.length > 0
    ? filterTextFlowCommandDefinitions(buildBodyBlockCommandDefinitions(t), {
        query,
        allowedIds: blockCommandIds,
        limit: BODY_BLOCK_COMMAND_KINDS.length,
      }).map((block): SlashCommandCandidate => ({ kind: "block", block }))
    : [];
  const materialCandidates = filterMaterialCandidates(materials, query)
    .map((material): SlashCommandCandidate => ({ kind: "material", material }));
  // 名前が前方一致した候補を先に出す。`/引用` は引用ブロックであって「引用」を別名に持つ箱
  // (leftbar) ではない、という当たり前の順番は、説明文や別名まで見る絞り込みだけでは作れない。
  const commandCandidates = [...problemCandidates, ...headingCandidates, ...blockCandidates, ...boxCandidates];
  const rankedCommands = [...commandCandidates].sort((a, b) => (
    textFlowCommandNameMatchRank(getSlashCommandCandidateName(a).slice(1), query)
    - textFlowCommandNameMatchRank(getSlashCommandCandidateName(b).slice(1), query)
  ));
  return [...rankedCommands, ...materialCandidates].slice(0, MAX_SLASH_COMMAND_CANDIDATES);
}

function getSlashCommandCandidateKey(candidate: SlashCommandCandidate): string {
  if (candidate.kind === "problem") {
    return `problem:${candidate.problem.id}`;
  }
  if (candidate.kind === "block") {
    return `block:${candidate.block.id}`;
  }
  if (candidate.kind === "heading") {
    return `heading:${candidate.heading.id}`;
  }
  return candidate.kind === "box" ? `box:${candidate.box.id}` : `material:${candidate.material.id}`;
}

function getSlashCommandCandidateName(candidate: SlashCommandCandidate): string {
  if (candidate.kind === "problem") {
    return `/${candidate.problem.commandName}`;
  }
  if (candidate.kind === "block") {
    return `/${candidate.block.commandName}`;
  }
  if (candidate.kind === "heading") {
    return `/${candidate.heading.commandName}`;
  }
  return candidate.kind === "box" ? `/${candidate.box.commandName}` : `/${candidate.material.name}`;
}

function getSlashCommandCandidateMeta(candidate: SlashCommandCandidate, t: Translate<"editor">): string {
  if (candidate.kind === "problem") {
    return candidate.problem.description;
  }
  if (candidate.kind === "block") {
    return candidate.block.description;
  }
  if (candidate.kind === "heading") {
    return candidate.heading.description;
  }
  return candidate.kind === "box" ? candidate.box.description : getMaterialSummaryLabel(candidate.material, t);
}

function getSlashCommandCandidateKindLabel(candidate: SlashCommandCandidate, t: Translate<"editor">): string {
  if (candidate.kind === "box") {
    return t("slash.kindBox");
  }
  if (candidate.kind === "block") {
    return t("slash.kindBlock");
  }
  if (candidate.kind === "problem") return t("slash.kindProblem");
  if (candidate.kind === "heading") return t("slash.kindHeading");
  return t("slash.kindMaterial");
}

function sameSlashCommandQuery(a: ActiveSlashCommandQuery | null, b: ActiveSlashCommandQuery | null): boolean {
  return a?.blockId === b?.blockId &&
    a?.from === b?.from &&
    a?.to === b?.to &&
    a?.query === b?.query &&
    a?.canInsertBox === b?.canInsertBox &&
    (a?.availableBlockCommandIds ?? []).join(" ") === (b?.availableBlockCommandIds ?? []).join(" ") &&
    a?.rect.left === b?.rect.left &&
    a?.rect.bottom === b?.rect.bottom;
}

function getMaterialSummaryLabel(material: MaterialItem, t: Translate<"editor">): string {
  const prefix = isOfficialMaterial(material) ? t("material.official") : "";
  if (material.description) {
    return prefix ? `${prefix} \u30fb ${material.description}` : material.description;
  }
  const blockCount = material.content.blocks.length;
  const shapeCount = material.content.overlaySnapshot.shapes.length;
  const detail = blockCount > 0 && shapeCount > 0
    ? t("material.summaryBoth", { blocks: blockCount, shapes: shapeCount })
    : blockCount > 0
      ? t("material.summaryBlocks", { blocks: blockCount })
      : t("material.summaryShapes", { shapes: shapeCount });
  return prefix ? `${prefix} / ${detail}` : detail;
}

/**
 * 装飾の再描画合図。**1 まとめ = 1 transaction**。
 *
 * 種類ごとに transaction を打つと、1 回の変更で装飾プラグイン全部の走査が種類の数だけ回る
 * (打鍵で 2〜5 本、選択の移動でも本文ユニットの数だけ)。合図は meta なので 1 つの
 * transaction に何種類でも載る。
 */
export type TextFlowDecorationRefreshKind =
  | "changes"
  | "columnFlow"
  | "comments"
  | "gaps"
  | "headingNumbers"
  | "guards"
  | "selected"
  | "spaceAfter";

function dispatchTextFlowDecorationRefresh(
  view: EditorView | null | undefined,
  kinds: ReadonlySet<TextFlowDecorationRefreshKind>,
): void {
  if (!view || kinds.size === 0) {
    return;
  }
  const transaction = view.state.tr;
  const stamp = Date.now();
  if (kinds.has("changes")) {
    transaction.setMeta(changeDecorationKey, stamp);
  }
  if (kinds.has("columnFlow")) {
    transaction.setMeta(columnFlowLayoutKey, stamp);
  }
  if (kinds.has("spaceAfter")) {
    transaction.setMeta(spaceAfterPreviewKey, stamp);
  }
  if (kinds.has("comments")) {
    transaction.setMeta(commentDecorationKey, stamp);
  }
  if (kinds.has("gaps")) {
    transaction.setMeta(paginationGapKey, stamp);
  }
  if (kinds.has("headingNumbers")) {
    transaction.setMeta(headingNumberingKey, stamp);
  }
  if (kinds.has("guards")) {
    transaction.setMeta(editGuardKey, stamp);
  }
  if (kinds.has("selected")) {
    transaction.setMeta(selectedTextBlockKey, stamp);
  }
  countPerformanceEvent("TextFlowEditor.refreshDispatch");
  view.dispatch(transaction);
}

function getClosestCommentThreadId(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) {
    return null;
  }

  const element = target.closest<HTMLElement>("[data-comment-thread-id]");
  return element?.dataset.commentThreadId ?? null;
}

function commentDecorationAttrs(
  threads: readonly SigmaCommentThread[],
  highlightedThreadId: string | null,
  baseClass: string,
): Record<string, string> {
  const threadIds = threads.map((thread) => thread.id);
  const highlighted = highlightedThreadId ? threadIds.includes(highlightedThreadId) : false;
  const className = [
    baseClass,
    highlighted ? "comment-highlight-active" : "",
    threadIds.length > 1 ? "comment-highlight-multiple" : "",
  ].filter(Boolean).join(" ");

  return {
    class: className,
    "data-comment-thread-id": highlighted && highlightedThreadId ? highlightedThreadId : threadIds[0] ?? "",
    "data-comment-thread-ids": threadIds.join(" "),
    "data-comment-count": String(threadIds.length),
  };
}

function createTextRangeDecorations(
  node: ProseMirrorModelNode,
  blockPos: number,
  fromOffset: number,
  toOffset: number,
  thread: SigmaCommentThread,
  activeThreadId: string | null,
): Decoration[] {
  if (toOffset <= fromOffset) {
    return [];
  }

  const decorations: Decoration[] = [];
  let cursor = 0;
  node.descendants((child, childPos) => {
    if (child.type.name !== "text" && child.type.name !== "mathInline") {
      return undefined;
    }

    const length = getPlainTextInlineLength(child);
    const inlineStart = cursor;
    const inlineEnd = cursor + length;
    cursor = inlineEnd;

    const overlapStart = Math.max(fromOffset, inlineStart);
    const overlapEnd = Math.min(toOffset, inlineEnd);
    if (overlapEnd <= overlapStart) {
      return undefined;
    }

    const absoluteStart = blockPos + 1 + childPos;
    if (child.type.name === "mathInline") {
      decorations.push(
        Decoration.node(
          absoluteStart,
          absoluteStart + child.nodeSize,
          commentDecorationAttrs([thread], activeThreadId, "comment-inline-math-highlight"),
        ),
      );
      return false;
    }

    decorations.push(
      Decoration.inline(
        absoluteStart + (overlapStart - inlineStart),
        absoluteStart + (overlapEnd - inlineStart),
        commentDecorationAttrs([thread], activeThreadId, "comment-text-highlight"),
      ),
    );

    return undefined;
  });

  return decorations;
}

function getPlainTextInlineLength(node: ProseMirrorModelNode): number {
  if (node.type.name === "mathInline") {
    const tex = typeof node.attrs.tex === "string" ? node.attrs.tex : "";
    return tex ? tex.length + 2 : 1;
  }

  const text = typeof node.text === "string" ? node.text : node.textContent;
  return text.length;
}

function detailFromTextPageBreakEvent(event: CustomEvent<unknown>): TextPageBreakRequestDetail | null {
  const detail = event.detail;
  if (!isRecord(detail) || typeof detail.blockId !== "string" || typeof detail.enabled !== "boolean") {
    return null;
  }
  return detail as unknown as TextPageBreakRequestDetail;
}

function getManualTextPageBreakSelection(
  editor: TiptapEditor,
  requestedBlockId: string,
  blocks: TextFlowBlock[],
): ManualTextPageBreakSelection | null {
  const selectedBlockId = getSelectedTextBlockId(editor);
  const blockIds = new Set(blocks.map((block) => block.id));
  if (!blockIds.has(requestedBlockId)) {
    return null;
  }

  if (selectedBlockId !== requestedBlockId || !blockIds.has(selectedBlockId)) {
    const requestedBlock = blocks.find((block) => block.id === requestedBlockId);
    return requestedBlock
      ? { blockId: requestedBlockId, offset: getTextFlowBlockEditorLength(requestedBlock) }
      : null;
  }

  return {
    blockId: selectedBlockId,
    offset: editor.state.selection.$from.parentOffset,
  };
}

function getTextBlockRange(
  doc: ProseMirrorModelNode,
  selectedId: string | null,
): { from: number; to: number; nodeType: "paragraph" | "heading" | "boxBlockTitle" | "codeBlock" } | null {
  if (!selectedId) {
    return null;
  }

  let range: {
    from: number;
    to: number;
    nodeType: "paragraph" | "heading" | "boxBlockTitle" | "codeBlock";
  } | null = null;
  doc.descendants((node, pos, parent) => {
    const nodeType = node.type.name;
    if (
      range ||
      !isTextFormatTargetNodeType(nodeType)
    ) {
      return;
    }

    const nodeId = nodeType === "boxBlockTitle"
      ? parent?.attrs.sigmaDocId
      : node.attrs.sigmaDocId;
    if (nodeId === selectedId) {
      range = {
        from: pos + 1,
        to: Math.max(pos + 1, pos + node.nodeSize - 1),
        nodeType,
      };
    }
  });

  return range;
}

/**
 * 本文ツールバーへ書式状態を配信する。跨ぎ選択 (text-run-span) 中はトグル系マークを
 * span 全体で判定した値で上書きする — 焦点エディタの担当分だけを見た表示だと、
 * `applyTextRunSpanFormat` の「全範囲が付いているときだけ外す」判定と向きが割れて、
 * 「インジケータは太字 ON なのに押すと全体へ太字が追加される」矛盾が出る。
 */
function dispatchDocumentTextFormatState(activeEditor: TiptapEditor): void {
  dispatchTextFormatState(
    activeEditor,
    TEXT_FORMAT_STATE_EVENT,
    "document",
    resolveTextFormatStateContext(activeEditor.state),
    { state: activeEditor.state, documentFontFamily: DEFAULT_FONT_FAMILY_VALUE },
    getTextRunSpanToggleMarkStates(activeEditor) ?? undefined,
  );
}

export function resolveTextFormatStateContext(state: EditorState): TextFormatStateContext {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    const nodeType = node.type.name;
    if (nodeType === "boxBlockTitle") {
      for (let boxDepth = depth - 1; boxDepth > 0; boxDepth -= 1) {
        const boxNode = $from.node(boxDepth);
        if (boxNode.type.name === "boxBlock") {
          const blockId = typeof boxNode.attrs.sigmaDocId === "string"
            ? boxNode.attrs.sigmaDocId
            : null;
          return {
            enabled: Boolean(blockId),
            nodeType: "boxBlockTitle",
            blockId,
          };
        }
      }
    }

    if (nodeType === "codeBlock") {
      const blockId = typeof node.attrs.sigmaDocId === "string"
        ? node.attrs.sigmaDocId
        : null;
      return {
        enabled: Boolean(blockId),
        nodeType,
        blockId,
      };
    }

    if (nodeType === "paragraph" || nodeType === "heading") {
      let blockId = typeof node.attrs.sigmaDocId === "string"
        ? node.attrs.sigmaDocId
        : null;
      if (!blockId) {
        for (let listDepth = depth - 1; listDepth > 0; listDepth -= 1) {
          const listItem = $from.node(listDepth);
          if (listItem.type.name !== "listItem") {
            continue;
          }
          blockId = typeof listItem.attrs.sigmaDocId === "string"
            ? listItem.attrs.sigmaDocId
            : null;
          break;
        }
      }
      return {
        enabled: Boolean(blockId),
        nodeType,
        blockId,
      };
    }
  }

  return {
    enabled: false,
    nodeType: null,
    blockId: null,
  };
}

export function resolveTextFlowFormatCommandOptions(
  editor: TiptapEditor,
  selectedId: string | null,
  lastSelection: { blockId: string; from: number; to: number } | null,
): TextFormatCommandOptions {
  const currentSelection = editor.state.selection;
  let selection: TextFormatSelectionRange | null = null;
  if (
    !currentSelection.empty &&
    isValidTextFormatSelection(currentSelection, editor.state.doc.content.size)
  ) {
    selection = { from: currentSelection.from, to: currentSelection.to };
  } else if (!editor.isFocused) {
    // A focused editor still owns its collapsed caret. Paragraph attributes such as alignment can
    // update that text block directly, while inline commands use stored marks. Selecting the whole
    // block here would leave its text selected, so the next Enter would erase it. Only a blurred
    // editor needs the saved-selection / selected-block fallback below.
    if (
      lastSelection &&
      lastSelection.blockId === selectedId &&
      isValidTextFormatSelection(lastSelection, editor.state.doc.content.size)
    ) {
      selection = {
        from: lastSelection.from,
        to: lastSelection.to,
      };
    } else {
      const selectedRange = getTextBlockRange(editor.state.doc, selectedId);
      selection = selectedRange
        ? { from: selectedRange.from, to: selectedRange.to }
        : null;
    }
  }

  const range = getTextBlockRange(editor.state.doc, selectedId);
  const nodeType = range?.nodeType ?? editor.state.selection.$from.parent.type.name;
  return {
    selection,
    blockNodeType: nodeType === "heading" ? "heading" : "paragraph",
    allowBlockStyle: nodeType !== "boxBlockTitle",
    preserveSelectionForBlockAttributes: true,
  };
}

function pasteTextFlowBlocksFromClipboard(
  view: EditorView,
  event: ClipboardEvent,
  onSelect: (blockId: string) => void,
): boolean {
  const clipboardData = event.clipboardData;
  if (!clipboardData) {
    return false;
  }

  const clipboardPayload = readEditorClipboardPayload(clipboardData);
  let pastedBlocks: TextFlowBlock[];
  if (clipboardPayload?.kind === "textFlowBlocks") {
    pastedBlocks = cloneTextFlowBlocksForPaste(clipboardPayload.blocks);
  } else if (clipboardPayload) {
    return false;
  } else {
    const markdownBlocks = parsePastedMarkdown(clipboardData.getData("text/plain"));
    if (markdownBlocks) {
      pastedBlocks = markdownBlocks;
    } else {
      const localPayload = getLocalEditorClipboardPayload();
      if (localPayload?.kind !== "textFlowBlocks") {
        return false;
      }
      pastedBlocks = cloneTextFlowBlocksForPaste(localPayload.blocks);
    }
  }
  if (pastedBlocks.length === 0) {
    return false;
  }

  const nodes = pastedBlocks
    .map((block) => {
      try {
        return view.state.schema.nodeFromJSON(textFlowBlockToTiptapNode(block));
      } catch {
        return null;
      }
    })
    .filter((node): node is ProseMirrorModelNode => Boolean(node));
  if (nodes.length === 0) {
    return false;
  }

  event.preventDefault();
  const slice = new Slice(Fragment.fromArray(nodes), 0, 0);
  const nextSelectedId = pastedBlocks[pastedBlocks.length - 1]?.id;
  try {
    const insertPos = getTextBlockBoundaryInsertPosition(view.state);
    let transaction = insertPos === null
      ? view.state.tr.replaceSelection(slice)
      : view.state.tr.insert(insertPos, slice.content);
    if (insertPos === null && nextSelectedId) {
      transaction = removeEmptyTextBlockAfterPastedBlock(transaction, nextSelectedId);
    }
    const selectionPos = insertPos === null
      ? transaction.selection.from
      : Math.min(insertPos + slice.content.size, transaction.doc.content.size);
    try {
      transaction = transaction.setSelection(TextSelection.near(transaction.doc.resolve(selectionPos), -1));
    } catch {
      // Keep the paste operation even if ProseMirror cannot place a nearby cursor.
    }
    view.dispatch(transaction.scrollIntoView());
  } catch {
    return true;
  }
  view.focus();

  if (nextSelectedId) {
    onSelect(nextSelectedId);
    refreshSelectedTextBlock(view);
  }
  return true;
}

function pasteTextAndShapesFromClipboard(
  view: EditorView,
  event: ClipboardEvent,
  fallbackSlice: Slice,
  payload: Extract<EditorClipboardPayload, { kind: "textAndShapes" }>,
): boolean {
  let textSlice: Slice | null = null;
  try {
    textSlice = Slice.fromJSON(view.state.schema, payload.text.slice);
  } catch {
    textSlice = fallbackSlice.size > 0 ? fallbackSlice : null;
  }
  if (!textSlice || textSlice.size === 0) {
    return false;
  }

  const { transaction, anchorBlockIdMap } = insertTextSliceWithFreshBlockIds(view.state, textSlice);
  event.preventDefault();
  view.dispatch(transaction.scrollIntoView().setMeta("paste", true).setMeta("uiEvent", "paste"));
  requestOverlayShapesPaste({
    payload: toOverlayShapesClipboardPayload(payload),
    anchorBlockIdMap,
    source: view.dom,
  });
  return true;
}

/**
 * 跨ぎ選択への本文+図形ペースト。テキストは span 置換で入れ、図形はコピー元ブロック id →
 * 置換後ブロック id の対応でアンカーを読み替えてオーバーレイ側に貼ってもらう
 * (単一エディタの pasteTextAndShapesFromClipboard と同じ流れ)。
 */
function pasteTextAndShapesIntoTextRunSpan(
  view: EditorView,
  fallbackSlice: Slice,
  payload: Extract<EditorClipboardPayload, { kind: "textAndShapes" }>,
): void {
  let textSlice: Slice;
  try {
    textSlice = Slice.fromJSON(view.state.schema, payload.text.slice);
  } catch {
    textSlice = fallbackSlice;
  }
  const sourceBlocks = sliceToTextFlowBlocks(textSlice);
  if (sourceBlocks.length === 0) {
    return;
  }
  const pastedBlocks = cloneTextFlowBlocksForPaste(sourceBlocks);
  const mutations = replaceActiveTextRunSpan(pastedBlocks);
  if (!mutations) {
    return;
  }
  requestOverlayShapesPaste({
    payload: toOverlayShapesClipboardPayload(payload),
    anchorBlockIdMap: resolveTextRunSpanAnchorBlockIdMap(sourceBlocks, pastedBlocks, mutations),
    source: view.dom,
  });
}

export function isLiteralPasteShortcut(
  event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey">,
): boolean {
  return !event.altKey &&
    event.shiftKey &&
    (event.metaKey || event.ctrlKey) &&
    event.key.toLowerCase() === "v";
}

function pasteClipboardAsLiteralText(view: EditorView, event: ClipboardEvent): boolean {
  const clipboardData = event.clipboardData;
  if (!clipboardData) {
    return false;
  }

  event.preventDefault();
  // Use ProseMirror's plain-text parser so newlines still become editor blocks.
  // Omitting the original event also keeps Sigma Studio's Markdown/math paste
  // handlers from interpreting the literal clipboard characters a second time.
  view.pasteText(clipboardData.getData("text/plain"));
  return true;
}

function getTextBlockBoundaryInsertPosition(state: EditorState): number | null {
  const { selection } = state;
  if (!selection.empty) {
    return null;
  }

  const { $from } = selection;
  if ($from.depth === 0) {
    return $from.pos;
  }

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name !== "paragraph" && node.type.name !== "heading") {
      continue;
    }

    const offset = $from.pos - $from.start(depth);
    if (offset === 0) {
      return $from.before(depth);
    }
    if (offset === node.content.size) {
      return $from.after(depth);
    }
    return null;
  }

  return null;
}

function findBoxBlockInTextFlowBlocks(blocks: TextFlowBlock[], boxId: string): BoxBlockNode | null {
  for (const block of blocks) {
    const found = findBoxBlockInTextFlowBlock(block, boxId);
    if (found) {
      return found;
    }
  }
  return null;
}

function findBoxBlockInTextFlowBlock(block: TextFlowBlock | BoxBlockChildBlock, boxId: string): BoxBlockNode | null {
  if (block.type === "boxBlock") {
    if (block.id === boxId) {
      return block;
    }
    return findBoxBlockInTextFlowBlocks(block.blocks, boxId);
  }

  if (block.type === "layoutSection") {
    return findBoxBlockInTextFlowBlocks(block.children, boxId);
  }

  return null;
}

function removeEmptyTextBlockAfterPastedBlock(transaction: Transaction, blockId: string): Transaction {
  let deleteRange: { from: number; to: number } | null = null;
  transaction.doc.descendants((node, pos, parent, index) => {
    if (deleteRange || !parent || typeof index !== "number" || node.attrs.sigmaDocId !== blockId) {
      return undefined;
    }

    if (index >= parent.childCount - 1) {
      return false;
    }

    const next = parent.child(index + 1);
    if (next.type.name === "paragraph" && isEmptyEditorTextBlock(next)) {
      const from = pos + node.nodeSize;
      deleteRange = { from, to: from + next.nodeSize };
    }
    return false;
  });

  const range = deleteRange as { from: number; to: number } | null;
  return range ? transaction.delete(range.from, range.to) : transaction;
}

function deleteBoxBlockFromEditor(editor: TiptapEditor, boxId: string): string | null {
  const { state, view } = editor;
  const target = findBoxBlockNodeInDoc(state.doc, boxId);
  if (!target) {
    return null;
  }

  let transaction = state.tr.delete(target.pos, target.pos + target.node.nodeSize);
  if (transaction.doc.childCount === 0) {
    const paragraph = state.schema.nodes.paragraph.create({
      sigmaDocId: createId("p"),
      sigmaDocType: "paragraph",
    });
    transaction = transaction.insert(0, paragraph);
  }

  const nextSelectedId = getFirstEditorTextBlockId(transaction.doc);
  try {
    const selectionPos = clampNumber(target.pos, 1, Math.max(1, transaction.doc.content.size));
    transaction = transaction.setSelection(TextSelection.near(transaction.doc.resolve(selectionPos), -1));
  } catch {
    // Keep the delete operation even if ProseMirror cannot place a nearby cursor.
  }

  view.dispatch(transaction.scrollIntoView());
  view.focus();
  return nextSelectedId;
}

function findBoxBlockNodeInDoc(doc: ProseMirrorModelNode, boxId: string): { node: ProseMirrorModelNode; pos: number } | null {
  let found: { node: ProseMirrorModelNode; pos: number } | null = null;
  doc.descendants((node, pos) => {
    if (found) {
      return false;
    }
    if (node.type.name === "boxBlock" && node.attrs.sigmaDocId === boxId) {
      found = { node, pos };
      return false;
    }
    return undefined;
  });
  return found;
}

function findCodeBlockNodeInDoc(
  doc: ProseMirrorModelNode,
  codeBlockId: string,
): { node: ProseMirrorModelNode; pos: number } | null {
  let found: { node: ProseMirrorModelNode; pos: number } | null = null;
  doc.descendants((node, pos) => {
    if (found) {
      return false;
    }
    if (node.type.name === "codeBlock" && node.attrs.sigmaDocId === codeBlockId) {
      found = { node, pos };
      return false;
    }
    return undefined;
  });
  return found;
}

function boxTitleFromNode(node: ProseMirrorModelNode): InlineNode[] {
  const titleNode = node.firstChild;
  if (titleNode?.type.name !== "boxBlockTitle") {
    return [];
  }

  const json = titleNode.toJSON() as { content?: TiptapNode[] };
  return tiptapNodesToInlineNodes(json.content ?? []);
}

function boxSettingsBlockFromNode(node: ProseMirrorModelNode): BoxBlockNode | null {
  const boxId = typeof node.attrs.sigmaDocId === "string" ? node.attrs.sigmaDocId : null;
  if (node.type.name !== "boxBlock" || !boxId) {
    return null;
  }
  return {
    type: "boxBlock",
    id: boxId,
    styleId: typeof node.attrs.styleId === "string" ? node.attrs.styleId : "fancybox",
    ...(isRecord(node.attrs.frame) ? { frame: node.attrs.frame as BoxFrameSpec } : {}),
    blocks: [],
  };
}

function getFirstEditorTextBlockId(doc: ProseMirrorModelNode): string | null {
  let id: string | null = null;
  doc.descendants((node) => {
    if (id) {
      return false;
    }
    if (!isEditorTextFlowBlockNode(node.type.name)) {
      return undefined;
    }
    const candidate = node.attrs.sigmaDocId;
    if (typeof candidate === "string") {
      id = candidate;
      return false;
    }
    return undefined;
  });
  return id;
}

/**
 * PM の doc から読んだ段落種別。`hasTextFlowBlockKindChange` が SigmaDoc 側と突き合わせる。
 * section も PM では level 1 の heading なので、SigmaDoc 側の "heading1" と自然に一致する。
 */
function getEditorTextBlockKinds(editor: TiptapEditor): Map<string, TextFlowBlockKind> {
  const kinds = new Map<string, TextFlowBlockKind>();

  editor.state.doc.descendants((node) => {
    const id = node.attrs.sigmaDocId;
    if (typeof id !== "string") {
      return;
    }
    if (node.type.name === "heading") {
      const level = Number(node.attrs.level ?? 1);
      kinds.set(id, `heading${level === 2 || level === 3 ? level : 1}` as TextFlowBlockKind);
      return;
    }
    // コードブロックは段落と id を共有したまま種別だけ変わるので、必ず突き合わせる。
    if (node.type.name === "codeBlock") {
      kinds.set(id, "codeBlock");
      return;
    }
    // リスト項目の先頭段落は SigmaDoc では listItem。突き合わせの対象にしない。
    if (node.type.name === "paragraph" && node.attrs.sigmaDocType !== "listItem") {
      kinds.set(id, "paragraph");
    }
  });

  return kinds;
}

/**
 * PM の doc から読んだ非構造属性の署名。`hasTextFlowBlockAttributeChange` が SigmaDoc 側と
 * 突き合わせる。**署名を作るのは SigmaDoc 側と同じ関数**なので、属性が増えてもここは変わらない。
 *
 * リスト項目の先頭段落は SigmaDoc では listItem で、あちらの写像に載らない。両側に載っている
 * id だけを突き合わせる規約なので、ここでも素直に外しておく。
 */
export function getEditorTextBlockAttributes(editor: TiptapEditor): Map<string, string> {
  const attributes = new Map<string, string>();

  editor.state.doc.descendants((node) => {
    const id = node.attrs.sigmaDocId;
    if (typeof id !== "string" || node.attrs.sigmaDocType === "listItem") {
      return;
    }
    attributes.set(id, textFlowBlockAttributeSignature(node.attrs));
  });

  return attributes;
}

function getEditorTextBlockIds(editor: TiptapEditor): string[] {
  const ids: string[] = [];

  editor.state.doc.descendants((node) => {
    if (!isEditorTextFlowBlockNode(node.type.name)) {
      return;
    }

    const id = node.attrs.sigmaDocId;
    if (typeof id === "string") {
      ids.push(id);
    }
  });

  return ids;
}

function isEditorTextFlowBlockNode(nodeType: string): boolean {
  return nodeType === "paragraph"
    || nodeType === "heading"
    || nodeType === "bulletList"
    || nodeType === "orderedList"
    || nodeType === "boxBlock"
    || nodeType === "layoutSection"
    || nodeType === "quote"
    || nodeType === "codeBlock"
    || nodeType === "divider";
}

function refreshSelectedTextBlock(view: EditorView | null | undefined): void {
  if (!view) {
    return;
  }
  countPerformanceEvent("TextFlowEditor.refreshDispatch");
  view.dispatch(view.state.tr.setMeta(selectedTextBlockKey, Date.now()));
}

function getTextFlowPointerSelection(
  event: ReactMouseEvent<HTMLElement>,
  editor: TiptapEditor,
): { blockId: string | null; position: number } | null {
  if (
    event.button !== 0 ||
    event.detail > 1 ||
    event.defaultPrevented ||
    event.shiftKey ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    isDirectControlTarget(event.target)
  ) {
    return null;
  }

  const position = getTextFlowPositionAtClientPoint(editor, event.clientX, event.clientY);
  if (position === null) {
    return null;
  }

  return {
    blockId: getTextFlowBlockIdAtPosition(editor, position),
    position,
  };
}

function focusTextFlowEditorAtPosition(editor: TiptapEditor, position: number): void {
  const selectionPosition = clampNumber(position, 1, Math.max(1, editor.state.doc.content.size));
  try {
    const selection = TextSelection.near(editor.state.doc.resolve(selectionPosition), 1);
    editor.chain().focus().setTextSelection({ from: selection.from, to: selection.to }).run();
  } catch {
    editor.chain().focus().setTextSelection(selectionPosition).run();
  }
}

function isDirectControlTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(DIRECT_CONTROL_SELECTOR));
}

function isInsideTextFlowEditor(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(TEXT_FLOW_EDITOR_SELECTOR));
}

function getTextFlowPositionAtClientPoint(
  editor: TiptapEditor,
  clientX: number,
  clientY: number,
): number | null {
  const root = readMountedEditorDom(editor);
  if (!root) {
    return null;
  }
  return posAtClientPoint(editor.view, clientX, clientY);
}

function getTextFlowBlockIdAtPosition(editor: TiptapEditor, position: number): string | null {
  const doc = editor.state.doc;
  const resolvedPosition = doc.resolve(Math.max(0, Math.min(position, doc.content.size)));
  for (let depth = resolvedPosition.depth; depth >= 0; depth -= 1) {
    const id = resolvedPosition.node(depth).attrs.sigmaDocId;
    if (typeof id === "string" && id) {
      return id;
    }
  }

  return getTextFlowBlockIdFromAdjacentNode(resolvedPosition.nodeAfter) ??
    getTextFlowBlockIdFromAdjacentNode(resolvedPosition.nodeBefore);
}

function getTextFlowBlockIdFromAdjacentNode(node: ProseMirrorModelNode | null): string | null {
  const id = node?.attrs.sigmaDocId;
  return typeof id === "string" && id ? id : null;
}

/**
 * ProseMirror の位置を、**必ず葉ブロックを指す** `CaretAddress` へ写す。
 *
 * 規則そのもの (どこまで降りるか / offset をどう丸めるか) は `features/text-editing` の純関数
 * が持ち、ここは ProseMirror から素データを取り出すだけにする。
 */
function getTextFlowCaretAddress(
  doc: ProseMirrorModelNode,
  position: number,
  affinity: CaretAffinity,
): CaretAddress | null {
  const clampedPosition = Math.max(0, Math.min(position, doc.content.size));
  const resolvedPosition = doc.resolve(clampedPosition);
  const path: CaretBlockPathEntry[] = [];
  for (let depth = 0; depth <= resolvedPosition.depth; depth += 1) {
    const node = resolvedPosition.node(depth);
    path.push({
      blockId: getTextFlowBlockIdFromAdjacentNode(node),
      contentSize: node.content.size,
      contentStart: depth === 0 ? 0 : resolvedPosition.start(depth),
      isAtom: node.isAtom,
    });
  }
  // どの祖先も id を持たない = ブロックとブロックの隙間 (gap cursor・文書の端)。ここは
  // 「隣のブロックの端」でも「隣のブロックそのもの」でもないので、隣接ノードから作り出さない。
  // 区切り線などを丸ごと選んだ状態は `getTextFlowSelectionBookmark` が選択の種類から立てる。
  return normalizeCaretAddressPath(path, clampedPosition, affinity);
}

export function getTextFlowSelectionBookmark(
  editor: TiptapEditor,
  preferredX: number | null,
): TextFlowSelectionBookmark | null {
  const selection = editor.state.selection;
  // 区切り線 / 箱 / 段組みセクションを丸ごと選んでいる状態。位置からは「隙間」にしか見えない
  // ので、選択の種類を知っているここで `kind: "node"` を立てる。
  if (selection instanceof NodeSelection) {
    const blockId = getTextFlowBlockIdFromAdjacentNode(selection.node);
    if (blockId) {
      const address: CaretAddress = {
        affinity: DEFAULT_CARET_AFFINITY,
        blockId,
        kind: "node",
        offset: 0,
      };
      return { anchor: address, head: address, preferredX };
    }
  }
  const anchorAddress = getTextFlowCaretAddress(
    editor.state.doc,
    selection.anchor,
    DEFAULT_CARET_AFFINITY,
  );
  const headAddress = getTextFlowCaretAddress(
    editor.state.doc,
    selection.head,
    DEFAULT_CARET_AFFINITY,
  );
  return anchorAddress && headAddress
    ? { anchor: anchorAddress, head: headAddress, preferredX }
    : null;
}

function getTextFlowSelectionBookmarkBeforeTransaction(
  transaction: Transaction,
  preferredX: number | null,
): TextFlowSelectionBookmark | null {
  const invertedMapping = transaction.mapping.invert();
  const anchor = invertedMapping.map(transaction.selection.anchor, -1);
  const head = invertedMapping.map(transaction.selection.head, 1);
  // ±1 は写像の bias であって「境界のどちら側に属するか」ではない。ProseMirror は position に
  // affinity を持たないので、ここでも既定のままにする (発明しない)。
  const anchorAddress = getTextFlowCaretAddress(transaction.before, anchor, DEFAULT_CARET_AFFINITY);
  const headAddress = getTextFlowCaretAddress(transaction.before, head, DEFAULT_CARET_AFFINITY);
  return anchorAddress && headAddress
    ? { anchor: anchorAddress, head: headAddress, preferredX }
    : null;
}

function getTextFlowSelectionPosition(
  editor: TiptapEditor,
  address: CaretAddress,
): number | null {
  let position: number | null = null;
  editor.state.doc.descendants((node, nodePosition) => {
    if (node.attrs.sigmaDocId !== address.blockId) {
      return true;
    }
    // ノードを丸ごと選ぶときはノードの**手前**の位置。文字位置は内容の開始からの offset。
    position = address.kind === "node"
      ? nodePosition
      : nodePosition + 1 + clampCaretOffset(address.offset, node.content.size);
    return false;
  });
  return position;
}

export interface AppliedTextFlowSelection {
  applied: boolean;
  activeMarks: readonly ProseMirrorMark[] | null;
}

/**
 * ブックマークをこの面の選択として適用する。**DOM フォーカスは取らない。**
 *
 * ページを跨ぐブロックは正本と断片の複製の N+1 個の面に描かれ、どの面も同じ論理位置を復元
 * できる。フォーカスまで一緒に取ると、購読順 (= React ツリー順) の最後の面が必ず勝ち、
 * 見えていない断片がキャレットを攫う。「適用」と「フォーカス取得」を分け、可視判定を挟んで
 * `focusTextFlowSurface` を呼ぶのは 1 面だけにする。
 */
export function applyTextFlowSelectionBookmark(
  editor: TiptapEditor,
  selection: TextFlowSelectionBookmark,
): AppliedTextFlowSelection {
  // 書式は dispatch の前に読む (dispatch 後の storedMarks は既に落ちている)。
  const activeMarks = editor.state.selection.empty ? editor.state.storedMarks : null;
  const anchor = getTextFlowSelectionPosition(editor, selection.anchor);
  const head = getTextFlowSelectionPosition(editor, selection.head);
  if (anchor === null || head === null) {
    return { activeMarks: null, applied: false };
  }

  // 片側だけ `"node"` の bookmark (別経路で組まれた古い値) を NodeSelection に倒すと、
  // 選択範囲が黙って別物になる。両端が同じノードを指しているときだけノード選択にする。
  const isNodeSelection = selection.anchor.kind === "node"
    && selection.head.kind === "node"
    && selection.anchor.blockId === selection.head.blockId;
  const nextSelection = createTextFlowSelection(
    editor.state.doc,
    anchor,
    head,
    isNodeSelection ? "node" : "text",
  );
  if (!nextSelection) {
    return { activeMarks: null, applied: false };
  }
  const transaction = editor.state.tr.setSelection(nextSelection);
  if (activeMarks && transaction.selection.empty) {
    transaction.setStoredMarks(activeMarks);
  }
  editor.view.dispatch(transaction);
  return { activeMarks, applied: true };
}

/**
 * コンテナ id が混ざったブックマークなどで `TextSelection.create` は `RangeError` を投げる。
 * 例外のまま抜けると「フォーカスだけ動いて選択は元のまま」という最悪の状態が残るので、
 * 近傍のテキスト位置へ倒し、それも無理なら諦める。
 */
function createTextFlowSelection(
  doc: ProseMirrorModelNode,
  anchor: number,
  head: number,
  kind: CaretAddressKind,
): ProseMirrorSelection | null {
  if (kind === "node") {
    try {
      return NodeSelection.create(doc, head);
    } catch {
      // ノードが消えている / そこが選べない位置なら文字選択へ倒す。
    }
  }
  try {
    const selection = TextSelection.create(doc, anchor, head);
    // コンテナ id が混ざった bookmark は「箱のすぐ内側」など文字の無い位置を指す。
    // `TextSelection.create` はそれを例外にしないので、ここで葉に載っているか確かめる。
    if (selection.$head.parent.inlineContent && selection.$anchor.parent.inlineContent) {
      return selection;
    }
  } catch {
    // 位置そのものが解決できないときも下の近傍探索へ倒す。
  }
  try {
    return TextSelection.near(doc.resolve(head), 1);
  } catch {
    return null;
  }
}

/**
 * この面に DOM フォーカスを渡す。`view.focus()` は DOM 選択の同期を通じて storedMarks を
 * 落とすことがあるので、落ちていたら張り直す (Enter を跨いだ書式保持の番人)。
 */
export function focusTextFlowSurface(
  editor: TiptapEditor,
  activeMarks: readonly ProseMirrorMark[] | null,
): void {
  editor.view.focus();
  if (
    activeMarks
    && editor.state.selection.empty
    && editor.state.storedMarks !== activeMarks
  ) {
    editor.view.dispatch(editor.state.tr.setStoredMarks(activeMarks));
  }
  // 配り直したキャレットは ProseMirror のスクロール追従を通らない (transaction に
  // `scrollIntoView` を立てていない)。焦点を取った面で必ず可視域へ入れる。既に見えていれば
  // 差分 0 で何も動かさないので、ユーザーのスクロール位置を奪わない。
  scrollCaretIntoView(editor.view);
}

/**
 * この面が見せているブロックの上端から、キャレットまでの縦位置 (拡大前の紙面 px)。
 *
 * 正本は `clip-path` で下を隠されているだけでレイアウト上は全高を占め、複製は
 * `translateY(-sourceOffsetY)` されている。どちらも「ブロックの矩形の上端との差」を取れば
 * 同じ値になるので、面の種類で分岐しない。
 */
function getTextFlowLocalY(
  editor: TiptapEditor,
  address: CaretAddress,
  containerBlockId: string | null,
): number | null {
  const position = getTextFlowSelectionPosition(editor, address);
  if (position === null) {
    return null;
  }
  // 断片の帯 (`sourceOffsetY`) は**分割されたブロック**の上端が原点。キャレットが載っている
  // 葉ブロックの上端から測ると、どの断片でもほぼ 0 になって宛先が決まらない。
  const blockElement = getTextFlowBlockElement(editor, containerBlockId ?? address.blockId);
  if (!blockElement) {
    return null;
  }
  let caretTop: number;
  try {
    caretTop = editor.view.coordsAtPos(position).top;
  } catch {
    return null;
  }
  const rect = blockElement.getBoundingClientRect();
  // 倍率は実寸との比で取る (`clip-path` は `offsetHeight` を変えないので純粋な表示倍率)。
  const scale = blockElement.offsetHeight > 0 ? rect.height / blockElement.offsetHeight : 1;
  const zoomScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return (caretTop - rect.top) / zoomScale;
}

function readMountedEditorDom(editor: TiptapEditor | null | undefined): HTMLElement | null {
  if (!editor || editor.isDestroyed) {
    return null;
  }
  try {
    const dom = editor.view.dom;
    return dom instanceof HTMLElement ? dom : null;
  } catch {
    return null;
  }
}

function getTextFlowBlockElement(editor: TiptapEditor, blockId: string): HTMLElement | null {
  const root = readMountedEditorDom(editor);
  if (!root) {
    return null;
  }
  const escaped = typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(blockId)
    : blockId.replace(/["\\]/g, "\\$&");
  return root.querySelector<HTMLElement>(`[data-sigma-doc-id="${escaped}"]`);
}

/** キャレットのブロックを含んでいる「分割されたブロック」の id。 */
function resolveFragmentBlockId(
  blocks: readonly TextFlowBlock[],
  sourceLayouts: Record<string, TextFlowBoxFragmentSourceLayout>,
  replicaBlockId: string | undefined,
  blockId: string,
): string | null {
  if (replicaBlockId) {
    const owns = blockId === replicaBlockId
      || blocks.some((block) => (
        block.id === replicaBlockId && bodyTextFlowBlockContainsId(block, blockId)
      ));
    return owns ? replicaBlockId : null;
  }
  const owner = blocks.find((block) => (
    block.id in sourceLayouts && bodyTextFlowBlockContainsId(block, blockId)
  ));
  return owner?.id ?? null;
}

/** 上下移動でキャレットが動いたことを、選択の購読者へ知らせる。 */
function publishCaretMove(editor: TiptapEditor, preferredX: number | null): void {
  const bookmark = getTextFlowSelectionBookmark(editor, preferredX);
  if (bookmark) {
    publishTextFlowSelectionBookmark(bookmark);
  }
}

/**
 * 段組みセクション (CSS multicol) が絡むテキストブロック境界の矢印移動の行き先。
 *
 * Chromium のネイティブキャレット移動は multicol の境界で信用できない:
 *
 * - 外→中・中→外の ← / → は渡れず、キャレットが動かない。
 * - 段を跨ぐ ↑ / ↓ は DOM 選択だけが動いて ProseMirror の選択が古いまま残ることがある。
 *
 * 行き先が論理的に決まる形 (テキストブロックの端 × 隣のテキストブロックがセクションの中か
 * 反対側) だけをここで解決し、セクションが絡まない境界は従来どおりネイティブに任せる。
 */
function resolveLayoutSectionArrowJump(
  view: EditorView,
  direction: "forward" | "backward" | "up" | "down",
): ProseMirrorSelection | null {
  const state = view.state;
  const { $head, empty } = state.selection;
  if (!empty || $head.depth === 0) {
    return null;
  }
  // 端の判定は方向で分ける。左右は論理オフセットで決まる (幾何を見ないので multicol でも
  // 揺れない)。上下は端の行かどうか — `endOfTextblock` は multicol の中で偽陰性を出すので
  // 幾何の補いが入った判定を使う。
  const atEdge = direction === "forward"
    ? $head.parentOffset === $head.parent.content.size
    : direction === "backward"
      ? $head.parentOffset === 0
      : caretAtTextblockEdgeLine(view, direction);
  if (!atEdge) {
    return null;
  }
  const forward = direction === "forward" || direction === "down";
  const doc = state.doc;
  const boundary = forward ? $head.after($head.depth) : $head.before($head.depth);
  if (boundary < 0 || boundary > doc.content.size) {
    return null;
  }
  const near = TextSelection.near(doc.resolve(boundary), forward ? 1 : -1);
  if (near.$head.parent === $head.parent) {
    return null;
  }
  const fromSection = layoutSectionAncestorPos($head);
  const toSection = layoutSectionAncestorPos(near.$head);
  if (direction === "forward" || direction === "backward") {
    // 左右はセクションの境界を渡るときだけ。中どうしはネイティブで足りる。
    return fromSection !== toSection ? near : null;
  }
  // 上下は「セクションの中」であれば介入する。ページ紙面のセクションは**ユニットとして**
  // 描かれ、その editor の doc に layoutSection ノードは無い (multicol はユニットの殻の
  // CSS)。doc の祖先では判定できないので、殻の DOM で判定する。
  if (fromSection === null && toSection === null
    && !view.dom.closest(".layout-section-paper-body")) {
    return null;
  }
  return near;
}

/**
 * セクション境界の上下ジャンプを適用する。行き先の**ブロック**は doc 位置で決まっているので、
 * その行の中の横位置だけ `preferredX` (画面 px) で選び直す — 上下移動の列を保つ。
 */
function applyLayoutSectionArrowJump(
  view: EditorView,
  jump: ProseMirrorSelection,
  preferredX: number,
): void {
  view.dispatch(view.state.tr.setSelection(jump).scrollIntoView());
  try {
    const top = view.coordsAtPos(view.state.selection.head).top;
    const refined = view.posAtCoords({ left: preferredX, top: top + 1 })?.pos;
    if (refined !== undefined) {
      const $refined = view.state.doc.resolve(refined);
      if ($refined.parent === view.state.selection.$head.parent) {
        view.dispatch(view.state.tr.setSelection(TextSelection.near($refined, 1)));
      }
    }
  } catch {
    // 横位置の微調整は失敗しても致命ではない。
  }
}

/** その位置を含む段組みセクションの doc 位置。セクションの外なら null。 */
function layoutSectionAncestorPos(position: ProseMirrorSelection["$head"]): number | null {
  for (let depth = position.depth; depth > 0; depth -= 1) {
    if (position.node(depth).type.name === "layoutSection") {
      return position.before(depth);
    }
  }
  return null;
}

/**
 * 分割されたブロックの直前 / 直後のブロックへキャレットを置く。行き先の**ブロック**は doc
 * 位置で決め、その行の中の横位置だけ `preferredX` で選ぶ。
 */
function focusTextFlowCaretAfterBlock(
  editor: TiptapEditor,
  containerBlockId: string,
  direction: "up" | "down",
  preferredX: number | null,
): boolean {
  let containerPosition: number | null = null;
  let containerSize = 0;
  editor.state.doc.descendants((node, nodePosition) => {
    if (containerPosition !== null) {
      return false;
    }
    if (node.attrs.sigmaDocId === containerBlockId) {
      containerPosition = nodePosition;
      containerSize = node.nodeSize;
      return false;
    }
    return true;
  });
  if (containerPosition === null) {
    return false;
  }
  const start: number = containerPosition;
  const end = start + containerSize;
  const boundary = direction === "down" ? end : start;
  try {
    const doc = editor.state.doc;
    if (boundary < 0 || boundary > doc.content.size) {
      return false;
    }
    const near = TextSelection.near(doc.resolve(boundary), direction === "down" ? 1 : -1);
    // 近傍探索がブロックの中へ戻ってしまったら、その向きに出口は無い。
    if (near.head > start && near.head < end) {
      return false;
    }
    editor.view.dispatch(editor.state.tr.setSelection(near));
    focusTextFlowSurface(editor, null);
    if (preferredX === null) {
      // 左右移動の出口。論理的な端 (直後の先頭 / 直前の末尾) がそのまま答えで、横位置は選ばない。
      return true;
    }
    // 行が決まったので、その行の中の横位置だけ `preferredX` で選び直す。
    try {
      const top = editor.view.coordsAtPos(editor.state.selection.head).top;
      const root = readMountedEditorDom(editor);
      if (!root) {
        return true;
      }
      const band = getCaretSurfaceBand(root, null);
      const left = clampNumber(preferredX, band.left + 1, band.right - 1);
      const refined = editor.view.posAtCoords({ left, top: top + 1 })?.pos;
      if (refined !== undefined && refined > start === refined > end) {
        editor.view.dispatch(
          editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(refined), 1)),
        );
      }
    } catch {
      // 横位置の微調整は失敗しても致命ではない。
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 画面上の座標にいちばん近い位置へキャレットを置き、この面にフォーカスを取る。
 * `preferredX` は client px、`clientY` も client px。
 */
function focusTextFlowCaretAtClientPoint(
  editor: TiptapEditor,
  preferredX: number,
  clientY: number,
  band: { bottom: number; left: number; right: number; top: number },
): boolean {
  if (editor.isDestroyed || band.bottom - band.top < 2) {
    return false;
  }
  const left = clampNumber(preferredX, band.left + 1, band.right - 1);
  const top = clampNumber(clientY, band.top + 1, band.bottom - 1);
  const position = editor.view.posAtCoords({ left, top })?.pos;
  if (position === undefined) {
    return false;
  }
  try {
    const selection = TextSelection.near(editor.state.doc.resolve(position), 1);
    editor.view.dispatch(editor.state.tr.setSelection(selection));
  } catch {
    return false;
  }
  focusTextFlowSurface(editor, null);
  return true;
}

export function setTextFlowContentPreservingSelection(
  editor: TiptapEditor,
  blocks: TextFlowBlock[],
): void {
  const selection = getTextFlowSelectionBookmark(editor, null);
  const wasFocused = editor.isFocused;
  const activeMarks = editor.state.selection.empty
    ? editor.state.storedMarks ?? (
      editor.state.selection.$from.parentOffset > 0
        ? editor.state.selection.$from.marks()
        : null
    )
    : null;
  editor.commands.setContent(textFlowToTiptap(blocks), { emitUpdate: false });
  if (selection) {
    const restored = applyTextFlowSelectionBookmark(editor, selection);
    if (restored.applied && wasFocused) {
      focusTextFlowSurface(editor, restored.activeMarks);
    }
  }
  if (activeMarks && editor.state.selection.empty) {
    editor.view.dispatch(editor.state.tr.setStoredMarks(activeMarks));
  }
}

function getSelectedTextBlockId(editor: TiptapEditor): string | null {
  return getTextFlowBlockIdAtPosition(editor, editor.state.selection.from);
}

function getBoxBlockIdAtContext(editor: TiptapEditor, target: EventTarget | null): string | null {
  if (target instanceof Element) {
    const boxElement = target.closest<HTMLElement>('.sigma-doc-box-block[data-sigma-doc-id]');
    const boxId = boxElement?.dataset.sigmaDocId;
    if (boxId) {
      return boxId;
    }
  }

  const { $from } = editor.state.selection;
  const boxDepth = findAncestorNodeDepth($from, "boxBlock");
  if (boxDepth < 0) {
    return null;
  }

  const boxId = $from.node(boxDepth).attrs.sigmaDocId;
  return typeof boxId === "string" && boxId ? boxId : null;
}

function isSelectionInsideBoxBlock(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === "boxBlock") {
      return true;
    }
  }
  return false;
}

function getClosestTextFlowBlockId(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) {
    return null;
  }

  const block = target.closest<HTMLElement>("[data-sigma-doc-id]");
  const id = block?.getAttribute("data-sigma-doc-id");
  return id || null;
}

function getClosestBoxActionButton(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) {
    return null;
  }

  return target.closest<HTMLElement>(".sigma-doc-box-action-button[data-box-action-button='true']");
}

function clampNumber(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}

function getBoundaryDeleteRequest(
  state: EditorState,
  event: KeyboardEvent,
  blocks: TextFlowBlock[],
): TextFlowBoundaryDeleteRequest | null {
  if (
    (event.key !== "Backspace" && event.key !== "Delete") ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.isComposing ||
    !state.selection.empty
  ) {
    return null;
  }

  const direction = event.key === "Backspace" ? "backward" : "forward";
  const { $from } = state.selection;
  const parent = $from.parent;
  if (parent.type.name !== "paragraph" && parent.type.name !== "heading") {
    return null;
  }

  const blockId = parent.attrs.sigmaDocId;
  if (typeof blockId !== "string") {
    return null;
  }

  const blockIndex = blocks.findIndex((block) => block.id === blockId);
  if (blockIndex < 0) {
    return null;
  }

  if (direction === "backward") {
    if (blockIndex > 0 || state.selection.from !== $from.start()) {
      return null;
    }
  } else if (blockIndex < blocks.length - 1 || state.selection.from !== $from.end()) {
    return null;
  }

  return {
    direction,
    blockId,
    emptyBlock: isEmptyEditorTextBlock(parent),
  };
}

export function resolveManualBreakBoundaryNavigation(
  state: EditorState,
  direction: "backward" | "forward" | null,
  blocks: TextFlowBlock[],
  event?: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey" | "isComposing" | "shiftKey">,
): { blockId: string; position: number } | null {
  if (
    !direction
    || event?.altKey
    || event?.ctrlKey
    || event?.metaKey
    || event?.shiftKey
    || event?.isComposing
    || !state.selection.empty
  ) {
    return null;
  }

  const breakIds = new Set([
    ...collectPageBreakBeforeIds(blocks),
    ...getNestedPageBreakBeforeIds(blocks),
  ]);
  if (breakIds.size === 0) {
    return null;
  }

  const { $from } = state.selection;
  const parent = $from.parent;
  if (
    (parent.type.name !== "paragraph" && parent.type.name !== "heading")
    || state.selection.from !== (direction === "backward" ? $from.start() : $from.end())
  ) {
    return null;
  }

  if (direction === "backward") {
    const owner = getManualBreakOwnerAtPosition(state, state.selection.from, breakIds);
    if (!owner || state.selection.from !== owner.firstCursorPosition) {
      return null;
    }
    const previous = TextSelection.findFrom(state.doc.resolve(owner.nodeStart), -1, true);
    return previous ? { blockId: owner.blockId, position: previous.from } : null;
  }

  const next = TextSelection.findFrom(
    state.doc.resolve(Math.min(state.doc.content.size, $from.end() + 1)),
    1,
    true,
  );
  if (!next) {
    return null;
  }
  const owner = getManualBreakOwnerAtPosition(state, next.from, breakIds);
  if (!owner || next.from !== owner.firstCursorPosition) {
    return null;
  }
  return { blockId: owner.blockId, position: next.from };
}

function getManualBreakOwnerAtPosition(
  state: EditorState,
  position: number,
  breakIds: ReadonlySet<string>,
): { blockId: string; nodeStart: number; firstCursorPosition: number } | null {
  const resolved = state.doc.resolve(Math.max(0, Math.min(position, state.doc.content.size)));
  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    const blockId = resolved.node(depth).attrs.sigmaDocId;
    if (typeof blockId !== "string" || !breakIds.has(blockId)) {
      continue;
    }
    const nodeStart = resolved.before(depth);
    const first = TextSelection.findFrom(
      state.doc.resolve(Math.min(state.doc.content.size, nodeStart + 1)),
      1,
      true,
    );
    if (first) {
      return {
        blockId,
        nodeStart,
        firstCursorPosition: first.from,
      };
    }
  }
  return null;
}

function isEmptyEditorTextBlock(node: EditorState["doc"]): boolean {
  if (node.content.size === 0) {
    return true;
  }

  let hasNonTextInline = false;
  node.descendants((child) => {
    if (child.type.name !== "text") {
      hasNonTextInline = true;
      return false;
    }
    return undefined;
  });

  return !hasNonTextInline && node.textContent.trim().length === 0;
}

/**
 * 本文ユニットは 1 文書あたり数十個あり、打鍵のたびに親から描き直される。ここで memo を
 * 効かせるために、props はユニット局所かつ参照安定にしてある (`TextFlowWithInlineContent`)。
 */
export const TextFlowEditor = memo(TextFlowEditorImpl);
