"use client";

import {
  Loader2,
  MoreHorizontal,
  PanelLeft,
  PlusCircle,
  Search,
  X,
} from "lucide-react";
import {
  startTransition,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, MouseEvent, PointerEvent as ReactPointerEvent, SetStateAction } from "react";

import {
  OPEN_OVERLAY_CHART_SETTINGS_EVENT,
  OPEN_OVERLAY_GRAPH_SETTINGS_EVENT,
  SELECT_OVERLAY_CHART_EVENT,
  SELECT_OVERLAY_GRAPH_EVENT,
  type SelectedInlineMath,
  type SelectedOverlayChart,
  type SelectedOverlayGraph,
} from "@/components/editor/EditorSettings";
import { ChartSettingsPanel } from "@/components/editor/ChartSettingsPanel";
import { GraphSettingsPanel } from "@/components/editor/GraphSettingsPanel";
import {
  Graph3DSettingsPanelHost,
  OPEN_OVERLAY_GRAPH3D_SETTINGS_EVENT,
} from "@/components/editor/Graph3DSettingsPanel";
import { DEFAULT_FILL_OPACITY } from "@/lib/fill-opacity";
import { CommandSettingsDialog } from "@/components/editor/CommandSettingsDialog";
import { TexCommandReferenceDialog } from "@/components/editor/TexCommandReferenceDialog";
import { TexEnvironmentSettingsDialog } from "@/components/editor/TexEnvironmentSettingsDialog";
import { PageSettingsDialog } from "@/components/editor/PageSettingsDialog";
import { viewportToCanvasAnchor } from "@/components/editor/PageCanvasEditor";
import {
  AI_APPLY_ADD_FLASH_MS,
  AI_APPLY_REMOVE_ANIMATION_MS,
  aiDocumentWriteInProgressMessage,
  AI_REFERENCE_TEXT_RANGE_EVENT,
  AI_SIDEBAR_WIDTH,
  AiPageCanvasEditor,
  buildAiProposalApplyContext,
  buildAppliedTurnChangesByTurnId,
  buildCommentAiRunRequestPlan,
  buildInsertedShapePreviewsByTurnId,
  buildRestorableProposalsByTurnId,
  buildSourceReferencesByTurnId,
  describeAiLockedTargets,
  deriveAiEditPreviewDiff,
  deriveAiProposalApprovedFileFeedback,
  deriveAiProposalApplyDecision,
  deriveAiProposalBusyGuardFeedback,
  deriveAiProposalDismissEffects,
  deriveAiProposalPresentation,
  deriveAiProposalResolutionTargets,
  deriveAiReferenceRequestPlan,
  deriveAiRunStartTransition,
  deriveAiStaleProposalDiscardEffects,
  deriveCommentAiRunEligibility,
  derivePostApplyHighlightIds,
  findAiLockedTargetsTouched,
  findAiProposalGroupByIds,
  groupMcpProposalsForPreview,
  hasAiLockedTargetsTouched,
  isAiLockedBlock,
  isAiLockedShapeSelection,
  normalizeAiProposalIds,
  selectSequentialAiRevertProposalIds,
  useAiLockedTargets,
  useAiPinnedReferences,
  type AiApplyAnimationState,
  type AiEditReference,
  type AiEditPreviewState,
  type AiEditShapeOnlyPreview,
  type AiProposalApplyOutcome,
  type AiProposalRejectEffect,
  type RejectProposalsOutcome,
} from "@/features/ai-edit";
import {
  appendCommentMessage,
  createCommentThread,
  diffDeletedContentIds,
  DocumentHistoryController,
  ensurePageLayout,
  expandMarginsForRunningRegions,
  getPageLayoutIssues,
  MIN_PAGE_BODY_HEIGHT_MM,
  getPageMetrics,
  getDefaultPageLayout,
  inlineNodesToPlainText,
  insertTopLevelDocumentBlocks,
  insertTopLevelDocumentBlocksBefore,
  normalizePageLayout,
  MAX_LINE_HEIGHT,
  MIN_LINE_HEIGHT,
  isWhiteboardPageLayout,
  formatLineHeightLabel,
  normalizeLineHeight,
  removeCommentReplyMessage,
  removeCommentThread,
  repairDuplicateTopLevelIds,
  setCommentThreadResolved,
  stepLineHeight,
  toggleCommentMessageReaction,
  updateCommentMessageBody,
  updateCommentThreadBody,
  type BoxedVariant,
  type CommentMutationPorts,
  type DocumentBlockClock,
  type DocumentBlockIdFactory,
  type SigmaBlock,
  type SigmaCommentAnchor,
  type SigmaCommentThread,
  type SigmaDocument,
  type SigmaTextRangeCommentAnchor,
  type InlineNode,
  type LineHeight,
  type OverlayShape,
  type PageLayout,
  type PageOverlay,
  type ProblemAreaKind,
  type RichBlock,
  type TextAlign,
} from "@/features/document";
import {
  countTextMatches,
  convertBlockStyle,
  findFirstBlockWithText,
  insertTopLevelTextFlowBlocks,
  replaceInDocument,
  replaceTopLevelTextFlowBlocks,
  setLayoutSectionColumnCount,
  type TextFlowBlock,
  type TextFlowSelectionBookmark,
  updateInlineMathTexInDocument,
} from "@/features/text-editing";
import {
  TEXT_FLOW_CHANGE_START_EVENT,
  TEXT_FLOW_SELECTION_BOOKMARK_EVENT,
} from "@/components/editor/text-flow/caret-bookmark-events";
import { deliverCaret, requestCaret } from "@/components/editor/text-flow/caret-router";
import { scrollElementIntoCanvasView } from "@/components/editor/text-flow/caret-scroll";
import type { TextFlowChangeContext, TextFlowReplaceOptions } from "@/components/editor/text-flow/types";
import { AiEditPanel } from "@/components/editor/AiEditPanel";
import { AiTaskDock } from "@/components/editor/AiTaskDock";
import { CommentDock } from "@/components/editor/CommentDock";
import { WebMcpBridge, type WebMcpBridgeHandle } from "@/components/editor/webmcp/WebMcpBridge";
import { AiEditWebPlaceholder } from "@/components/editor/AiEditWebPlaceholder";
import {
  AI_INLINE_ANCHOR_OFFSET_Y,
  AI_INLINE_DEFAULT_LEFT_PX,
  AI_INLINE_DEFAULT_TOP_PX,
  getAiInlineDragPosition,
  getAiInlineHostPosition,
  getAiInlineTopBoundary,
} from "@/components/editor/ai-inline-placement";
import {
  closeSurface,
  isInlineToggleShortcut,
  openInline,
  promoteToSidebar,
  resolveAiSurface,
  toggleSurface,
  type AiDisplayMode,
  type AiSurfaceState,
} from "@/lib/ai/ai-surface";
import { MaterialContentPreview, MaterialPreview } from "@/components/editor/MaterialPreview";
import type { CommentPanelAuthor } from "@/components/editor/CommentThreadsPanel";
import {
  PrintPreviewPageNavigator,
} from "@/components/print/PrintPreview";
import {
  PagedRenderSurface,
  type PagedRenderStateSnapshot,
} from "@/components/print/paged-render/PagedRenderSurface";
import {
  PrintPreviewToolbar,
  resolveDrawerExportUnavailableReason,
  shouldOfferExternalPrintWindow,
} from "@/components/print/PrintPreviewToolbar";
import { PdfExportSuccessDialog } from "@/components/print/PdfExportSuccessDialog";
import { getShapesSelectionBounds, type MeasuredBlock } from "@/features/drawing";
import { DocumentTitleText, MathEnvironmentProvider } from "@/features/rendering/adapters/react";
import { parseDocumentTitleInlineNodes } from "@/features/rendering/core";
import {
  SELECT_INLINE_MATH_EVENT,
  updateInlineMathDraft,
} from "@/components/tiptap/inline-math-extension";
import { QR_CODE_REQUEST_EVENT, type QrCodeRequestDetail } from "@/components/tiptap/url-detection-extension";
import { generateQrPngFile } from "@/lib/qr-code";
import {
  DEFAULT_AI_EDIT_MODEL,
  DEFAULT_AI_EDIT_REASONING_EFFORT,
} from "@/lib/ai/sigma-doc-edit-schema";
import { runAiEditViaDesktopRuntime } from "@/lib/ai/codex-ai-edit-client";
import { focusSourceReferenceInDocument, resolveSourceReferenceNavigationTarget } from "@/lib/ai/ai-source-reference-navigation";
import { submitRejectionFeedback } from "@/lib/ai/ai-run-controller";
import { isAiRunStatusActive, useAiRunSessions } from "@/lib/ai/ai-run-session-store";
import { useAiConnection, useClaudeConnection, useGeminiConnection } from "@/lib/ai/ai-connection";
import { DEFAULT_CLAUDE_AI_EDIT_MODEL, DEFAULT_GEMINI_AI_EDIT_MODEL } from "@/lib/ai/ai-providers";
import { countPerformanceEvent, measurePerformance } from "@/lib/performance";
import { getHeadingNumberMap } from "@/lib/heading-numbering";
import {
  addRichBlockToProblem,
  collectOutline,
  createBlock,
  deleteBlocksFromDocument,
  duplicateTopLevelBlock,
  ensureBodyBlockAfterProblem,
  ensureEditableBody,
  findBlock,
  findContainingLayoutSection,
  insertTopLevelBlock,
  insertTopLevelBlockReplacingEmptySelection,
  isEmptyTopLevelTextFlowBlock,
  moveTopLevelBlock,
  removeBlockFromDocument,
  type EditableBlock,
  unwrapLayoutSection,
  updateBlockInDocument,
  wrapTextFlowBlocksInLayoutSection,
} from "@/lib/document-tree";
import {
  cloneDocumentBlocksForPaste,
  createInlineMathClipboardPayload,
  cloneTextFlowBlocksForPaste,
  createDocumentBlocksClipboardPayload,
  createTextFlowClipboardPayload,
  getLocalEditorClipboardPayload,
  isTextFlowClipboardBlock,
  readEditorClipboardPayload,
  toOverlayShapesClipboardPayload,
  writeEditorClipboardData,
  writeEditorPayloadToSystemClipboard,
} from "@/lib/editor-clipboard";
import {
  OVERLAY_SHAPES_PASTE_REQUEST_EVENT,
  type OverlayShapesPasteRequestDetail,
} from "@/components/editor/text-flow/text-and-shapes-clipboard";
import { HeldBodySelectionOverlay } from "@/components/editor/editor-shell/HeldBodySelectionOverlay";
import {
  isMultiEditorTextRunSpan,
  replaceActiveTextRunSpan,
  subscribeTextRunSpan,
} from "@/components/editor/text-flow/text-run-span";
import {
  BODY_SELECTION_SHAPES_REQUEST_EVENT,
  SELECT_BODY_WITH_SHAPES_EVENT,
  type BodySelectionShapesRequestDetail,
} from "@/components/editor/text-flow/body-shape-selection";
import {
  parseSigmaDocument,
  recoverSigmaDocument,
  type SigmaDocumentRecoveryIssue,
} from "@/lib/sigma-doc-schema";
import { mergeExternalDocumentChange } from "@/lib/document-block-merge";
import { areStructurallyEqual } from "@/lib/structural-equality";
import {
  applyMcpEditPreview as runSerializedMcpEditPreview,
  decideAiApprovedDocument,
  replaceDocumentAfterRequiredBackup,
  trackInFlightSave,
  type BackupFirstDocumentReplacementResult,
} from "@/lib/ai-run-applier";
import {
  DEFAULT_COMMENT_COLOR,
  inlineNodesToCommentText,
  isInlineBodyEmpty,
  visibleCommentThreads,
} from "@/lib/comments";
import { DEFAULT_DOCUMENT_TITLE, documentTitleInputValue, isDocumentTitleExplicit, resolveDocumentTitle, resolveDocumentTitleContent } from "@/lib/document-title";
import type { Graph2DPreset } from "@/lib/graph2d";
import { createId } from "@/lib/id";
import { createBlankDocument, createEmptyEditorDocument } from "@/lib/blank-document";
import {
  detectEditorShortcutPlatform,
  findCommandByShortcut,
  formatShortcutText,
  getEditorCommandCatalog,
  getShortcutForCommand,
  isSingleCharacterShortcut,
  loadEditorCustomCommands,
  loadEditorShortcutOverrides,
  parseEditorCustomCommands,
  parseEditorShortcutOverrides,
  resolveEditorCommandCatalog,
  saveEditorCustomCommands,
  saveEditorShortcutOverrides,
  shouldDispatchOverlayArrangeShortcut,
  type EditorCommandId,
  type EditorCustomCommandAction,
  type EditorCustomCommandDefinition,
  type EditorShortcutBinding,
  type EditorShortcutOverrides,
} from "@/lib/editor-command-shortcuts";
import { APP_READY_EVENT } from "@/components/StartupSplash";
import {
  createObservedDocumentWrite,
  createNewDocument,
  createDocumentFromSigmaDocument,
  deleteDocument,
  duplicateDocument,
  initializeDocumentWorkspace,
  listSavedDocuments,
  loadDocumentByFileIdWithRecovery,
  saveDocumentRecord,
  saveWorkspaceState,
  type DocumentLoadResult,
  type DocumentFileRecord,
  type DocumentMetadata,
} from "@/lib/storage";
import type { LedgerSchemaFailure } from "@/lib/library-schema";
import { getAppRouteHref, navigateToAppRoute } from "@/lib/app-navigation";
import { getDesktopBridge } from "@/lib/desktop-bridge";
import { getAppRuntime, isPersistentRuntime } from "@/lib/runtime";
import { createCurrentLocaleTranslator, createTranslator, getAppLocale, normalizeLocale, setAppLocale, type AppLocale, type Translate } from "@/lib/i18n";
import { formatSigmaValidationCode } from "@/lib/validation-text";
import { useT } from "@/lib/i18n/react";
import { CommandPalette } from "@/components/editor/CommandPalette";
import { buildPaletteEntries, type PaletteEntry } from "@/components/editor/command-palette-model";
import { SETTINGS_SURFACE_DESKTOP_MODE } from "@/components/editor/settings-catalog";
import { DesktopSettingsModal } from "@/components/editor/DesktopSettingsModal";
import { DocumentLibraryDialog } from "@/components/editor/DocumentLibraryDialog";
import { useCustomFonts } from "@/lib/use-custom-fonts";
import { useUiLayoutPreference } from "@/lib/ui-layout-preference";
import { renderEditorChrome } from "@/components/editor/editor-shell/chrome/editor-chrome";
import type { EditorChromeValue } from "@/components/editor/editor-shell/chrome/chrome-types";
import { NO_COLUMN_COMMAND, resolveColumnCommandState } from "@/components/editor/editor-shell/chrome/layout-commands";
import {
  DEFAULT_RIBBON_TAB_STATE,
  closeRibbonOverlay,
  resolveRibbonTabState,
  resolveTabClickWhileCollapsed,
  ribbonTabElementId,
  selectRibbonTab as selectRibbonTabState,
  toggleRibbonCollapse as toggleRibbonCollapseState,
} from "@/components/editor/editor-shell/chrome/ribbon-tabs";
import type { RibbonCollapseState, RibbonPanelTabId } from "@/components/editor/editor-shell/chrome/ribbon-tabs";
import {
  DEFAULT_BACKSTAGE_STATE,
  closeBackstage as closeBackstageState,
  resolveBackstageStateForLayout,
  ribbonBackstagePanelId,
  selectBackstageSection as selectBackstageSectionState,
  toggleBackstage as toggleBackstageState,
} from "@/components/editor/editor-shell/chrome/ribbon-backstage";
import type { BackstageSectionId } from "@/components/editor/editor-shell/chrome/ribbon-backstage";
import { AiSettingsDialog } from "@/components/editor/AiSettingsDialog";
import { Tooltip } from "@/components/ui/Tooltip";
import type { TooltipContent } from "@/components/ui/Tooltip";
import {
  importEditorMathProtectedBuffer,
  isEditorMathPrtFilename,
  isEditorMathSprFilename,
  DEFAULT_EDITOR_MATH_IMPORT_FILENAME,
  EDITOR_MATH_IMPORT_AVAILABLE,
  EditorMathPrtPasswordError,
} from "@/lib/classic-format-import";
import { importTexDocument, isTexFilename } from "@/lib/tex-import";
import { importPresentationSlidesBuffer, isPresentationSlidesFilename } from "@/lib/presentation-import";
import { getSupportedOverlayImageFiles } from "@/lib/overlay-image-files";
import {
  cloneMaterialContentForInsert,
  inferDefaultMaterialPorts,
  materialMatchesQuery,
  mergeMaterialOverlayIntoDocument,
  normalizeMaterialMetadata,
  replaceMaterialTriggerWithBlocks,
} from "@/lib/materials";
import { fitOfficialBoxToColumnWidth, isOfficialMaterial, mergeOfficialMaterials } from "@/lib/official-materials";
import { templateInsertContent } from "@/lib/templates";
import { TemplateGallery } from "@/components/templates/TemplateGallery";
import { FLUSH_OVERLAY_CHANGES_EVENT, type OverlayActionRequest, type OverlayActionRequestInput, type OverlayArrangeAction, type OverlayChangeOptions, type OverlayCommand, type OverlayCommandRequest, type OverlayImageRequest, type OverlayModeStatus, type OverlaySelectionStylePatch, type OverlaySelectionSummary, type PageLayoutChangeOptions } from "@/components/editor/page-overlay-types";
import type { OverlayPoint, OverlayTool } from "@/components/editor/overlay-canvas/types";
import {
  isLineToolCommand,
  buildLineToolItems,
  buildShapeGallerySections,
} from "@/components/editor/overlay-canvas/shape-gallery";
import { getTextShapeFontSizePt } from "@/features/drawing";
import type {
  DesktopMcpEditProposalSummary,
  DesktopStorageChangeEvent,
  DesktopUpdateState,
} from "@/types/desktop";
import type { MaterialContent, MaterialItem } from "@/types/material";
import type { TemplateItem } from "@/types/template";
import {
  BASE_EDITOR_FONT_SIZE,
  BASE_EDITOR_LINE_HEIGHT,
  BASE_EDITOR_TEXT_COLOR,
  DEFAULT_FONT_FAMILY_VALUE,
  DEFAULT_OUTLINE_WIDTH,
  EMPTY_OVERLAY_SELECTION,
  filterFontFamilyGroups,
  FONT_FAMILY_OPTIONS,
  FONT_FAMILY_OPTION_VALUES,
  FORMAT_TEXT_EVENT,
  INSERT_INLINE_MATH_EVENT,
  KEYBOARD_ZOOM_STEP,
  MAX_DOCUMENT_HISTORY,
  MAX_OUTLINE_WIDTH,
  MIN_EDITOR_WIDTH_WHILE_RESIZING_OUTLINE,
  MIN_OUTLINE_WIDTH,
  PAGE_NAVIGATOR_MAX_SCALE,
  PAGE_NAVIGATOR_MIN_SCALE,
  PAGE_NAVIGATOR_PRINT_PAGE_HEIGHT_PX,
  PAGE_NAVIGATOR_PRINT_PAGE_WIDTH_PX,
  PAGE_NAVIGATOR_SCALE_GUTTER_PX,
  REPORT_ISSUE_FORM_URL,
  SEARCH_QUERY_EVENT,
  SHORTCUT_ARROWHEAD_VALUES,
  SHORTCUT_BLOCK_STYLES,
  SHORTCUT_FILL_COLORS,
  SHORTCUT_FONT_FAMILIES,
  SHORTCUT_FONT_SIZES,
  SHORTCUT_LINE_DASHES,
  SHORTCUT_LINE_HEIGHTS,
  SHORTCUT_LINE_WIDTHS,
  SHORTCUT_OVERLAY_ALIGN_ACTIONS,
  SHORTCUT_OVERLAY_ARRANGE_ACTIONS,
  SHORTCUT_OVERLAY_DISTRIBUTE_ACTIONS,
  SHORTCUT_STROKE_COLORS,
  SHORTCUT_TEXT_ALIGNS,
  TEXT_ALIGN_OPTIONS,
  TEXT_FORMAT_STATE_EVENT,
  ZOOM_PRESETS,
} from "@/components/editor/editor-shell/constants";
import type {
  ColorStylePanel,
  DocumentChange,
  DocumentChangeOptions,
  EditorMenu,
} from "@/components/editor/editor-shell/types";
import { formatDocumentRecoveryStatus } from "@/components/editor/editor-shell/recovery-status";
import {
  isTextFormatTargetNodeType,
  type TextFormatStateContext,
} from "@/components/tiptap/text-format-controller";
import {
  toDocumentOpenFailure,
  type DocumentOpenFailure,
} from "@/components/editor/editor-shell/document-open-failure";
import { DocumentOpenFailurePanel } from "@/components/editor/DocumentOpenFailurePanel";
import { LedgerSchemaFailurePanel } from "@/components/ledger/LedgerSchemaFailurePanel";
import { useStore } from "zustand";

import { createEditorStore, EditorStoreProvider, type EditorStore } from "@/features/editor-state";
import { createBlockCommentAnchor } from "@/components/editor/page-canvas/popover-anchors";
import type {
  TextFlowBodyBlockCommandRequest,
  TextFlowHeadingCommandRequest,
  TextFlowMaterialInsertRequest,
  TextFlowProblemCommandRequest,
} from "@/components/editor/text-flow/types";
import { handleHeadingCommandAutoNumbering } from "@/components/editor/editor-shell/heading-command";
import { applyRememberedBoxFrame } from "@/lib/remembered-box-style";
import { shouldDispatchSearchQuery } from "@/components/editor/search-query-dispatch";
import { useStableCallback } from "@/lib/react/use-stable-callback";
import { setLatestSearchQuery } from "@/components/tiptap/search-highlight-extension";
import {
  getScrollForZoomAnchor,
  panCamera,
  resetCamera,
  resolveNextZoom,
  resolveWheelIntent,
  WHEEL_LINE_HEIGHT_PX,
  zoomCameraAt,
} from "@/components/editor/editor-shell/whiteboard-camera";
import {
  areGraphSpecsEqual,
  areSelectedOverlayChartsEqual,
  areSelectedOverlayGraphsEqual,
  getDefaultDocumentSelectionId,
  sameDocumentMetadatas,
  sameOverlaySelectionSummary,
} from "@/components/editor/editor-shell/document-helpers";
import {
  captureEditorTabViewState,
  resolveEditorTabViewState,
  scheduleEditorTabViewRestore,
  type EditorTabViewState,
  type ResolvedEditorTabViewState,
} from "@/components/editor/editor-shell/editor-tab-view-state";
import {
  applyAiApprovalAdoptionIfFileActive,
  beginPendingAiApprovalAdoption,
  hasPendingAiApprovalForFile,
  persistWorkspaceBeforeAiApprovalAdoption,
  preventCloseForPendingAiApproval,
  queueLatestDocumentChange,
  recordSuccessfulDocumentSave,
  resolveRevisionedBackup,
  runSingleFlight,
  saveBeforeDocumentReplacement,
  syncDocumentRefWhenStateIsCurrent,
  takeLatestDocumentChange,
  type SuccessfulDocumentSave,
} from "@/components/editor/editor-shell/document-state-sync";
import {
  applyOverlayGraphAxisLabelEdit,
  mergeOverlayGraphDetailWithPending,
  recordPendingOverlayGraphAxisLabelEdit,
  recordPendingOverlayGraphSpecEdit,
  type PendingOverlayGraphEdits,
} from "@/components/editor/editor-shell/overlay-graph-pending-edits";
import {
  convertOverlayToWhiteboard,
  createOverlaySelectionCommentAnchor,
  ensureOverlayAnchorOffsets,
  getSharedOverlayLineDash,
  getSharedOverlayLineSize,
} from "@/components/editor/editor-shell/overlay-helpers";
import {
  suggestedPdfFileName,
} from "@/components/editor/editor-shell/formatting-icons";
import {
  cloneMaterialContentForEditing,
  createEmptyMaterialMetadataDraft,
  InfoDialog,
  MaterialActionMenu,
  MaterialEditDialog,
  materialMetadataDraftToInput,
  MaterialMetadataDraftFields,
  materialToMetadataDraft,
  suggestVisualConceptsForMaterialContent,
  type MaterialMetadataDraft,
} from "@/components/editor/editor-shell/material-dialogs";
import {
  getMaterialNameFromBlock,
} from "@/components/editor/editor-shell/material-capture";
import { buildSelectedMaterialContent } from "@/components/editor/editor-shell/material-selection";
import {
  clampBoxedTextPaddingY,
  EMPTY_BLOCK_STYLE_TOOLBAR_STATE,
  getFontFamilyLabel,
  nextBlockStyleToolbarState,
  normalizeBoxedTextVariant,
  normalizeToolbarFontFamily,
  type BlockStyleCommandValue,
  type BlockStyleToolbarState,
} from "@/components/editor/editor-shell/toolbar-formatting";
import {
  getVisibleEditorPageNumber,
  scrollEditorCanvasToPage,
} from "@/components/editor/editor-shell/page-navigation";
import {
  clearRequestedFileId,
  createUnsavedEditBackupTitle,
  getRequestedFileId,
  isDesktopStorageChangeEvent,
  updateDegradedWatcherScopes,
  type DegradedWatcherScope,
  uniqueStringIds,
} from "@/components/editor/editor-shell/workspace-request";
/**
 * コメントの既定の作者。
 *
 * **参照が毎描画で変わってはいけない** — この値を依存に持つメモ化 (コメント追加・
 * 返信・リアクション・パネル props) が軒並み崩れるため。一方で表示名は言語で
 * 変わるので、`name` は getter にして**読むたびに**現在の言語で解決する。
 * 言語切り替え時に画面へ反映させるのは `commentPanelProps` の依存に入れた
 * `uiLocale` の役目。
 */
const COMMENT_AUTHOR: CommentPanelAuthor = {
  avatarUrl: null,
  get name() {
    return tEditor("shell.guest");
  },
};

/**
 * 本文編集面の文言 (`editor` namespace)。
 *
 * **`useT` ではなく呼び出し時にロケールを読む。** ステータス文言のほとんどは
 * `useCallback` の中から出るので、hook で受け取ると 40 本以上の依存配列に
 * 翻訳関数が載り、React Compiler の手動メモ化保持と噛み合わなくなる
 * (実測: lint エラーが 109 → 124 に増えた)。呼び出し時解決なら依存が増えず、
 * しかもイベント発火時点の言語で解決するので、こちらの方が意味的にも正しい。
 *
 * 画面 (JSX) から呼んだ場合も正しい言語になる: `EditorShell` は `useT` を
 * 経由してロケールストアを購読しているので、言語を切り替えれば再描画される。
 */
const editorTextCache: { locale: AppLocale | null; translate: Translate<"editor"> | null } = {
  locale: null,
  translate: null,
};

function resolveEditorTranslate(): Translate<"editor"> {
  const locale = getAppLocale();
  if (editorTextCache.locale !== locale || !editorTextCache.translate) {
    editorTextCache.locale = locale;
    editorTextCache.translate = createTranslator(locale, "editor");
  }
  return editorTextCache.translate;
}

// `TFunction` は補間の型を鍵ごとに推論するオーバーロードの塊で、可変長引数を
// そのまま通すと型が合わない。ここは「同じ引数をそのまま渡す」だけなので
// 二段キャストで包む (キーと補間の検査は呼び出し側で効いたままになる)。
const tEditor = ((key: string, options?: Record<string, unknown>) =>
  resolveEditorTranslate()(key as never, options as never)) as unknown as Translate<"editor">;

/** ワークスペース / 素材面の文言 (`workspace` namespace)。解決の仕方は `tEditor` と同じ。 */
const tWorkspace = createCurrentLocaleTranslator("workspace");

/**
 * 起動時の状態表示。**保存先がこのセッション限りのときは、その事実を先に出す。**
 * ブラウザがサイトデータを拒む (プライベートウィンドウ等) と編集自体はできてしまうので、
 * 「準備完了」とだけ出すとタブを閉じた時に黙って消える。
 */
const storageWarningOrStatus = (status: string): string =>
  isPersistentRuntime() ? status : tWorkspace("error.browserStorageUnavailable");

/** 図形 / グラフ面の文言 (`shape` namespace)。解決の仕方は `tEditor` と同じ。 */
const shapeTextCache: { locale: AppLocale | null; translate: Translate<"shape"> | null } = {
  locale: null,
  translate: null,
};

const tShape = ((key: string, options?: Record<string, unknown>) => {
  const locale = getAppLocale();
  if (shapeTextCache.locale !== locale || !shapeTextCache.translate) {
    shapeTextCache.locale = locale;
    shapeTextCache.translate = createTranslator(locale, "shape");
  }
  return shapeTextCache.translate(key as never, options as never);
}) as unknown as Translate<"shape">;
/**
 * AI 編集面の文言 (`ai` namespace)。**フックではなく module 直下**なのは、ここから
 * 呼ぶ AI ヘルパが `useMemo` / `useCallback` の中にいて、フック値を足すと依存配列が
 * 軒並み動くため (`tEditor` / `tShape` と同じ理由)。解決は呼び出し時のロケール。
 */
const tAi = createCurrentLocaleTranslator("ai");

const LINE_HEIGHT_LONG_PRESS_DELAY_MS = 400;
const LINE_HEIGHT_LONG_PRESS_INTERVAL_MS = 120;
const MCP_PROPOSAL_REFRESH_DEBOUNCE_MS = 75;
type McpProposalRefreshBatch = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (reason: unknown) => void;
};
const COMMENT_MUTATION_PORTS: CommentMutationPorts = {
  now: () => new Date().toISOString(),
  createId,
};
const DOCUMENT_BLOCK_OPERATION_PORTS: DocumentBlockClock & DocumentBlockIdFactory = {
  now: () => new Date().toISOString(),
  createId,
};
/** 図形の無い文書でも参照が変わらないよう固定 (memo依存の無駄な再計算を避ける)。 */
const EMPTY_OVERLAY_SHAPES: OverlayShape[] = [];
/** コメントの無い文書でも参照が変わらないよう固定 (装飾更新の再 dispatch を避ける)。 */
const EMPTY_COMMENT_THREADS: SigmaCommentThread[] = [];

export interface EmbeddedEditorHost {
  document: SigmaDocument;
  onChange: (document: SigmaDocument) => void;
  onSave?: (document: SigmaDocument) => void | Promise<void>;
}

export interface EditorShellProps {
  embeddedHost?: EmbeddedEditorHost;
}

interface EditorHistorySelection {
  selectedId: string | null;
  textSelection: TextFlowSelectionBookmark | null;
}

type DocumentStorageChangeEvent = Extract<
  DesktopStorageChangeEvent,
  { type: "document" }
>;

interface PendingAiApprovalAdoption {
  fileId: string;
  document: SigmaDocument;
  revision: number;
  userDocument: SigmaDocument;
  userDocumentDirtyRevision: number;
  backup?: DocumentFileRecord;
  backupSourceDirtyRevision?: number;
}

/**
 * 画面 1 つ分の状態ストアを作って配るだけの薄い外側。
 *
 * **モジュール singleton にしない** — 同時に複数の文書 (別ウィンドウ・埋め込み) を開けるので、
 * ストアの寿命はこの画面の寿命に一致させる。React の外から `getState()` で同期的に読めるため、
 * 保存や CAS のように「今この瞬間の値」が要る経路も ref の二重管理なしに書ける。
 */
export function EditorShell({ embeddedHost }: EditorShellProps = {}) {
  // **毎レンダーで呼ばない。** `createEmptyEditorDocument()` は文書 1 個分を
  // 組み立てる (旧 `emptyEditorDocument` は module 定数だった)。打鍵のたびに
  // 走ると perf 予算 `typing.longTasksPerChar` を割る。
  const [editorStore] = useState(() => {
    const initialDocument = embeddedHost?.document ?? createEmptyEditorDocument();
    return createEditorStore({
      selectedId: getDefaultDocumentSelectionId(initialDocument),
      // ストアの初期値は 1 回きり (言語を切り替えたときは次のステータス更新で追いつく)。
      statusMessage: tEditor("status.ready"),
      outlineWidth: DEFAULT_OUTLINE_WIDTH,
    });
  });

  return (
    <EditorStoreProvider store={editorStore}>
      <EditorShellBody embeddedHost={embeddedHost} editorStore={editorStore} />
    </EditorStoreProvider>
  );
}

/**
 * `target` から `boundary` までの祖先に、このホイールを実際に消化できるスクロール要素があるか。
 *
 * ホワイトボードのホイールは capture で受けて `stopPropagation()` するので、これを見ないと
 * 盤面の中に置いた `overflow: auto` の中身 (数式の TeX 入力欄など) が二度とスクロールできない。
 * 「スクロールできる」だけでなく「その向きにまだ余地がある」まで見ないと、端まで来た要素に
 * ホイールを吸われて盤面が動かせなくなる。
 */
function canScrollWithin(
  target: EventTarget | null,
  boundary: HTMLElement,
  dx: number,
  dy: number,
): boolean {
  let node = target instanceof Element ? target : null;

  while (node && node !== boundary) {
    // 先に「はみ出しているか」だけを見る。何も置いていない盤面の上をパンしている間は
    // ここで全部弾けるので、ホイール 1 発ごとに `getComputedStyle` を呼ばずに済む。
    const overflowsY = node.scrollHeight > node.clientHeight;
    const overflowsX = node.scrollWidth > node.clientWidth;
    if (!overflowsY && !overflowsX) {
      node = node.parentElement;
      continue;
    }

    const style = window.getComputedStyle(node);
    const scrollsY = overflowsY && (style.overflowY === "auto" || style.overflowY === "scroll");
    const scrollsX = overflowsX && (style.overflowX === "auto" || style.overflowX === "scroll");

    if (dy !== 0 && scrollsY && (
      dy < 0
        ? node.scrollTop > 0
        : node.scrollTop + node.clientHeight < node.scrollHeight
    )) {
      return true;
    }
    if (dx !== 0 && scrollsX && (
      dx < 0
        ? node.scrollLeft > 0
        : node.scrollLeft + node.clientWidth < node.scrollWidth
    )) {
      return true;
    }

    node = node.parentElement;
  }

  return false;
}

function EditorShellBody({ embeddedHost, editorStore }: EditorShellProps & { editorStore: EditorStore }) {
  countPerformanceEvent("EditorShell.render");
  // クロームの文言。`renderEditorChrome` は hook を呼べないので、ここで解決して
  // `chrome.shared.t` から配る。同一ロケール内では参照が変わらない。
  const t = useT("chrome");
  /**
   * **描画 (JSX) 用の翻訳関数。** イベントから出るステータス文言は `tEditor`
   * (呼び出し時にロケールを読む module 関数) を使うが、描画には使えない:
   * 静的 export の HTML は日本語で焼かれるので、最初のクライアント描画も
   * 日本語でなければハイドレーションがずれる。`useT` は `getServerAppLocale()`
   * を経由してそれを守っている (`lib/i18n/react.ts` の理由コメント参照)。
   */
  const tE = useT("editor");
  /** 図形の呼び名 (描画用)。クロームのツールバーにも出るのでハイドレーション安全な hook 版。 */
  const tShapeChrome = useT("shape");
  const tCommand = useT("command");
  const tSettings = useT("settings");
  // 同上。埋め込みホストが変わったときだけ作り直す。
  const initialDocument = useMemo(
    () => embeddedHost?.document ?? createEmptyEditorDocument(),
    [embeddedHost],
  );
  const isEmbedded = Boolean(embeddedHost);
  const embeddedHostRef = useRef(embeddedHost);
  useEffect(() => {
    embeddedHostRef.current = embeddedHost;
  }, [embeddedHost]);
  // 埋め込みホストから本文が空の文書を渡されても、最初の描画から入力できる状態で始める。
  const [document, setDocument] = useState<SigmaDocument>(() => ensureEditableBody(initialDocument).document);
  const isWhiteboardDocument = isWhiteboardPageLayout(normalizePageLayout(document.pageLayout));
  const [documentStateStamp, setDocumentStateStamp] = useState(0);
  // アクションはストア生成時に 1 度だけ作られるので、ここで取り出しても識別子は安定する
  // (= useCallback の deps に入れてよい)。値はここでは読まない — 読むと購読していないのに
  // 「その時の値」を握ってしまう。
  const {
    clearCommentReplyDrafts,
    setActiveCommentThreadId,
    setCommentAnchorCandidate,
    setCommentReplyDraft,
    setHighlightedCommentThreadId,
    setOutlineOpen,
    setOutlineWidth,
    setPendingCommentAnchor,
    setSaveState,
    setSelectedId,
    setSelectedInlineMath,
    setStatusMessage,
  } = editorStore.getState();
  const selectedId = useStore(editorStore, (state) => state.selectedId);
  const [degradedWatcherScopes, setDegradedWatcherScopes] = useState<DegradedWatcherScope[]>([]);
  const [hasPendingAiApprovalAdoption, setHasPendingAiApprovalAdoption] = useState(false);
  const announceRecovery = useCallback((
    issues: SigmaDocumentRecoveryIssue[],
    recoveryBackupPath?: string,
  ) => {
    const message = formatDocumentRecoveryStatus(issues, Boolean(recoveryBackupPath), tE);
    if (!message) {
      return;
    }
    setSaveState("warning");
    setStatusMessage(message);
  }, [setSaveState, setStatusMessage, tE]);
  /** `null` = run 自身の指定なし。ツールバーは「自動」と出し、見出しの大きさを潰さない。 */
  const [textFontSize, setTextFontSize] = useState<number | null>(BASE_EDITOR_FONT_SIZE);
  const [boxedTextPaddingY, setBoxedTextPaddingY] = useState(0);
  const [boxedTextActive, setBoxedTextActive] = useState(false);
  // B/I/U mirror the caret: the editors publish isActive() for each mark on every
  // transaction, so the buttons light up while the caret sits inside a bold run.
  const [boldActive, setBoldActive] = useState(false);
  const [italicActive, setItalicActive] = useState(false);
  const [underlineActive, setUnderlineActive] = useState(false);
  // ブロック種別のトグル (箇条書き / 番号付き / 引用 / コード)。B/I/U と同じで、キャレットが
  // そのブロックの中にいる間ボタンが点く。
  const [blockStyleState, setBlockStyleState] = useState<BlockStyleToolbarState>(
    EMPTY_BLOCK_STYLE_TOOLBAR_STATE,
  );
  const [documentTextFormatTarget, setDocumentTextFormatTarget] = useState<TextFormatStateContext | null>(null);
  // チャンクを跨ぐ本文選択 (text-run-span) の有無。跨ぎドラッグは mousedown/mouseup の
  // ターゲットが別エディタになるため、selectedId だけではリボンの書式ボタンの enable を
  // 表しきれない場面がある (⌘A 直後など)。span が生きている間は書式適用先が確実にあるので、
  // enable 判定へ直接効かせる。同値 setState は React が bail するので、ドラッグ中の
  // span 通知が毎フレーム来ても再レンダーは跨ぎ選択の開始/終了時しか起きない。
  const [hasMultiEditorTextRunSpan, setHasMultiEditorTextRunSpan] = useState(false);
  useEffect(() => subscribeTextRunSpan(() => {
    setHasMultiEditorTextRunSpan(isMultiEditorTextRunSpan());
  }), []);
  const [boxedTextVariant, setBoxedTextVariant] = useState<BoxedVariant>("frame");
  // The toolbar variant/padding state mirrors the current selection (reset to
  // frame/0 when an unboxed range is selected), so it can't carry "last used".
  // This ref persists the last format the user applied and seeds the next insert.
  const lastBoxedFormatRef = useRef<{ paddingY: number; variant: BoxedVariant }>({ paddingY: 0, variant: "frame" });
  const zoom = useStore(editorStore, (state) => state.zoom);
  // パンは倍率と同じストアに置く (理由は EditorToolbarSlice の宣言のコメント)。
  const whiteboardPan = useStore(editorStore, (state) => state.whiteboardPan);
  // 錨の基準になるビューポート要素。PageCanvasEditor から ref 経由で受け取る。
  const whiteboardViewportRef = useRef<HTMLDivElement | null>(null);
  const handleWhiteboardViewportChange = useCallback((element: HTMLDivElement | null) => {
    whiteboardViewportRef.current = element;
  }, []);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [exportedPdfPath, setExportedPdfPath] = useState<string | null>(null);
  const [printPreviewRenderState, setPrintPreviewRenderState] = useState<PagedRenderStateSnapshot>({
    state: "pending",
    surfaceId: "",
    revision: 0,
    pageCount: 0,
    pageWidthMm: 0,
    pageHeightMm: 0,
  });
  const [pageSettingsOpen, setPageSettingsOpen] = useState(false);
  const [commandSettingsOpen, setCommandSettingsOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  // パレットから設定項目を選んだとき、開いたダイアログのどこを見せるか
  // (`settings-catalog.ts` の id)。ダイアログを閉じたら捨てる。
  const [settingsFocusEntryId, setSettingsFocusEntryId] = useState<string | undefined>(undefined);
  const [texCommandReferenceOpen, setTexCommandReferenceOpen] = useState(false);
  const [texEnvironmentSettingsOpen, setTexEnvironmentSettingsOpen] = useState(false);
  const [documentListOpen, setDocumentListOpen] = useState(false);
  const [workspaceReady, setWorkspaceReady] = useState(isEmbedded);
  const [ledgerFailure, setLedgerFailure] = useState<LedgerSchemaFailure | null>(null);
  const [workspaceReloadNonce, setWorkspaceReloadNonce] = useState(0);
  const [loadingFileId, setLoadingFileId] = useState<string | null>(null);
  // 教材の中身 (壊れたJSON / スキーマ違反) が原因で本文を組み立てられなかった教材。
  // その教材がアクティブな間だけ、編集キャンバスの代わりに原因と修復プロンプトを出す。
  const [documentOpenFailure, setDocumentOpenFailure] = useState<DocumentOpenFailure | null>(null);
  const documentOpenFailureRef = useRef<DocumentOpenFailure | null>(null);
  // 直前の読み込みで観測した失敗の一時置き場。開く判断をした呼び出し側だけが
  // showRecordedDocumentOpenFailure で受け取る (候補を読み飛ばす経路では捨てる)。
  const pendingDocumentOpenFailureRef = useRef<DocumentOpenFailure | null>(null);
  const [documentMetadatas, setDocumentMetadatas] = useState<DocumentMetadata[]>([]);
  const [mcpEditProposals, setMcpEditProposals] = useState<DesktopMcpEditProposalSummary[]>([]);
  // チャット turn の参照元チップ・挿入図形サムネイル用。pending プレビューとは別に
  // 全 status の proposal を保持し、適用/却下後も派生表示を turn 下に残す。
  const [mcpProposalCitations, setMcpProposalCitations] = useState<DesktopMcpEditProposalSummary[]>([]);
  const [appUpdateState, setAppUpdateState] = useState<DesktopUpdateState | null>(null);
  const [appUpdateActionBusy, setAppUpdateActionBusy] = useState(false);
  const [openFileIds, setOpenFileIds] = useState<string[]>(() => [initialDocument.docId]);
  const [activeFileId, setActiveFileId] = useState(initialDocument.docId);
  const [shortcutOverrides, setShortcutOverrides] = useState<EditorShortcutOverrides>(() => (
    getDesktopBridge()?.settings ? {} : loadEditorShortcutOverrides()
  ));
  const [customCommands, setCustomCommands] = useState<EditorCustomCommandDefinition[]>(() => (
    getDesktopBridge()?.settings ? [] : loadEditorCustomCommands()
  ));
  const [commandSettingsLoaded, setCommandSettingsLoaded] = useState(() => !getDesktopBridge()?.settings);
  const [commandSettingsError, setCommandSettingsError] = useState<string | null>(null);
  const [textColor, setTextColor] = useState("#111111");
  const [textBackgroundColor, setTextBackgroundColor] = useState<string | null>("#fff3c2");
  const [strokeColor, setStrokeColor] = useState<string | null>("#000000");
  const [fontFamily, setFontFamily] = useState(DEFAULT_FONT_FAMILY_VALUE);
  const { customFonts, reloadCustomFonts } = useCustomFonts();
  const preferredFontFamilyRef = useRef(DEFAULT_FONT_FAMILY_VALUE);
  const [lineHeight, setLineHeight] = useState<LineHeight>("1.75");
  const [lineHeightInput, setLineHeightInput] = useState("1.75");
  const [lineHeightInputError, setLineHeightInputError] = useState<string | null>(null);
  const lineHeightStepDelayTimerRef = useRef<number | null>(null);
  const lineHeightStepRepeatTimerRef = useRef<number | null>(null);
  const lineHeightStepCurrentRef = useRef<LineHeight | null>(null);
  const [lineHeightCustomOpen, setLineHeightCustomOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [materialLibraryOpen, setMaterialLibraryOpen] = useState(false);
  const [templateGalleryOpen, setTemplateGalleryOpen] = useState(false);
  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [materialError, setMaterialError] = useState<string | null>(null);
  const [materialSearch, setMaterialSearch] = useState("");
  const [materialNameDraft, setMaterialNameDraft] = useState("");
  const [materialDescriptionDraft, setMaterialDescriptionDraft] = useState("");
  const [materialEditingId, setMaterialEditingId] = useState<string | null>(null);
  const [materialEditingDraft, setMaterialEditingDraft] = useState<MaterialMetadataDraft>(() => createEmptyMaterialMetadataDraft());
  const [materialEditingContent, setMaterialEditingContent] = useState<MaterialContent | null>(null);
  const materialEditingOpenRef = useRef(false);
  const materialEditingContentRef = useRef<MaterialContent | null>(null);
  const [materialMetadataInfoOpen, setMaterialMetadataInfoOpen] = useState(false);
  const [materialAddDialogOpen, setMaterialAddDialogOpen] = useState(false);
  const [materialAddContent, setMaterialAddContent] = useState<MaterialContent | null>(null);
  const [materialAddName, setMaterialAddName] = useState("");
  const [materialAddDraft, setMaterialAddDraft] = useState<MaterialMetadataDraft>(() => createEmptyMaterialMetadataDraft());
  const [materialActionMenu, setMaterialActionMenu] = useState<{ materialId: string; x: number; y: number } | null>(null);
  const [canPasteProblem, setCanPasteProblem] = useState(false);
  const updateMaterialEditingContent = useCallback((content: MaterialContent | null) => {
    if (content && !materialEditingOpenRef.current) {
      return;
    }
    materialEditingContentRef.current = content;
    setMaterialEditingContent(content);
  }, []);

  const closeMaterialEditing = useCallback(() => {
    materialEditingOpenRef.current = false;
    setMaterialEditingId(null);
    setMaterialEditingDraft(createEmptyMaterialMetadataDraft());
    updateMaterialEditingContent(null);
    setMaterialMetadataInfoOpen(false);
  }, [updateMaterialEditingContent]);
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);
  const [lineToolMenuOpen, setLineToolMenuOpen] = useState(false);
  const [inlineMathMenuOpen, setInlineMathMenuOpen] = useState(false);
  const [fontFamilyMenuOpen, setFontFamilyMenuOpen] = useState(false);
  const [fontFamilyQuery, setFontFamilyQuery] = useState("");
  const [blockStyleMenuOpen, setBlockStyleMenuOpen] = useState(false);
  const [fontSizeMenuOpen, setFontSizeMenuOpen] = useState(false);
  const [boxedTextMenuOpen, setBoxedTextMenuOpen] = useState(false);
  const [lineHeightMenuOpen, setLineHeightMenuOpen] = useState(false);
  const [textAlignMenuOpen, setTextAlignMenuOpen] = useState(false);
  const [orderedListMenuOpen, setOrderedListMenuOpen] = useState(false);
  const [moreBlocksMenuOpen, setMoreBlocksMenuOpen] = useState(false);
  const [lineDashMenuOpen, setLineDashMenuOpen] = useState(false);
  const [lineWidthMenuOpen, setLineWidthMenuOpen] = useState(false);
  const [colorStylePanel, setColorStylePanel] = useState<ColorStylePanel>(null);
  const [lineEndpointMenu, setLineEndpointMenu] = useState<"start" | "end" | null>(null);
  const [activeMenu, setActiveMenu] = useState<EditorMenu>(null);
  const [newDocMenuOpen, setNewDocMenuOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  /** 直近に検索ハイライトへ通知した検索語 (未通知なら null)。 */
  const lastDispatchedSearchQueryRef = useRef<string | null>(null);
  const [replaceText, setReplaceText] = useState("");
  const outlineOpen = useStore(editorStore, (state) => state.outlineOpen);
  const outlineWidth = useStore(editorStore, (state) => state.outlineWidth);
  // 一旦、左側の印刷プレビュー（ページナビゲータ）は非表示にする。true に戻せば復活する。
  const [showPageNavigator] = useState(false);
  const [outlineDialogOpen, setOutlineDialogOpen] = useState(false);
  const [activePageNumber, setActivePageNumber] = useState(1);
  // 描画されたページ総数。真値は PageCanvasEditor の layoutViewState.pageCount だけなので
  // prop で上げてもらう（DOM の data-page-count から読み戻すのは派生の逆流）。
  const [editorPageCount, setEditorPageCount] = useState(1);
  const selectedInlineMath = useStore(editorStore, (state) => state.selectedInlineMath);
  const [selectedOverlayGraph, setSelectedOverlayGraph] = useState<SelectedOverlayGraph | null>(null);
  const [selectedOverlayChart, setSelectedOverlayChart] = useState<SelectedOverlayChart | null>(null);
  const pendingOverlayGraphEditsRef = useRef<PendingOverlayGraphEdits | null>(null);
  const recordPendingAxisLabelEdit = useCallback((
    shapeId: string,
    key: Parameters<typeof recordPendingOverlayGraphAxisLabelEdit>[2],
    edit: Parameters<typeof recordPendingOverlayGraphAxisLabelEdit>[3],
  ) => {
    pendingOverlayGraphEditsRef.current = recordPendingOverlayGraphAxisLabelEdit(
      pendingOverlayGraphEditsRef.current,
      shapeId,
      key,
      edit,
    );
  }, []);
  const recordPendingSpecEdit = useCallback((
    shapeId: string,
    spec: Parameters<typeof recordPendingOverlayGraphSpecEdit>[2],
  ) => {
    pendingOverlayGraphEditsRef.current = recordPendingOverlayGraphSpecEdit(
      pendingOverlayGraphEditsRef.current,
      shapeId,
      spec,
    );
  }, []);
  const [graphSettingsShapeId, setGraphSettingsShapeId] = useState<string | null>(null);
  const [graph3DSettingsShapeId, setGraph3DSettingsShapeId] = useState<string | null>(null);
  const graphSettingsShapeIdRef = useRef<string | null>(null);
  const [chartSettingsShapeId, setChartSettingsShapeId] = useState<string | null>(null);
  const chartSettingsShapeIdRef = useRef<string | null>(null);
  const graphSettingsShapeWasInDocumentRef = useRef(false);
  const [aiEditReference, setAiEditReference] = useState<AiEditReference | null>(null);
  // ワンドボタン「AIに追加」で明示的に積んだ参照 (複数)。本文選択だけの暗黙候補
  // (aiEditReference) とは別管理で、ブロック選択が移っても消えない。
  const {
    references: aiEditPinnedReferences,
    previews: aiEditPinnedReferencePreviews,
    clear: clearAiEditPinnedReferences,
    pin: pinAiEditPinnedReference,
    remove: removeAiPinnedReference,
    reconcileTextRanges: reconcileAiEditPinnedReferenceTextRanges,
  } = useAiPinnedReferences();
  const [aiSidebarOpen, setAiSidebarOpen] = useState(false);
  const [aiDisplayMode, setAiDisplayMode] = useState<AiDisplayMode>("inline");
  const [aiInlineOpen, setAiInlineOpen] = useState(false);
  const [aiInlineAnchor, setAiInlineAnchor] = useState<{ left: number; top: number } | null>(null);
  const [aiInlineRunAnchor, setAiInlineRunAnchor] = useState<{ left: number; top: number } | null>(null);
  const [aiInlineRunAnchorCanvas, setAiInlineRunAnchorCanvas] = useState<{ left: number; top: number } | null>(null);
  const [aiInlineRunPortal, setAiInlineRunPortal] = useState<HTMLElement | null>(null);
  // User-dragged position of the inline AI box; null = follow the selection anchor.
  const [aiInlineDragPosition, setAiInlineDragPosition] = useState<{ left: number; top: number } | null>(null);
  const pageCanvasRef = useRef<HTMLElement | null>(null);
  const measuredBodyBlockRectsRef = useRef<ReadonlyMap<string, MeasuredBlock>>(new Map());
  const captureMeasuredBodyBlockRects = useCallback((blockRects: ReadonlyMap<string, MeasuredBlock>) => {
    measuredBodyBlockRectsRef.current = blockRects;
  }, []);
  const aiInlineRunAnchorRef = useRef<{ left: number; top: number } | null>(null);
  useEffect(() => {
    aiInlineRunAnchorRef.current = aiInlineRunAnchor;
  }, [aiInlineRunAnchor]);

  const syncInlineRunAnchorCanvas = useCallback((viewportAnchor: { left: number; top: number } | null) => {
    if (!viewportAnchor || !pageCanvasRef.current) {
      setAiInlineRunAnchorCanvas(null);
      return;
    }
    setAiInlineRunAnchorCanvas(viewportToCanvasAnchor({
      left: viewportAnchor.left,
      top: viewportAnchor.top + AI_INLINE_ANCHOR_OFFSET_Y,
    }, pageCanvasRef.current));
  }, []);

  const handleInlineRunAnchorChange = useCallback((anchor: { left: number; top: number } | null) => {
    setAiInlineRunAnchor(anchor);
    syncInlineRunAnchorCanvas(anchor);
  }, [syncInlineRunAnchorCanvas]);

  useEffect(() => {
    syncInlineRunAnchorCanvas(aiInlineRunAnchor);
  }, [aiInlineRunAnchor, syncInlineRunAnchorCanvas, zoom]);

  useEffect(() => {
    if (!aiInlineRunAnchor) {
      return;
    }
    const handleViewportChange = () => syncInlineRunAnchorCanvas(aiInlineRunAnchor);
    window.addEventListener("resize", handleViewportChange);
    return () => window.removeEventListener("resize", handleViewportChange);
  }, [aiInlineRunAnchor, syncInlineRunAnchorCanvas]);

  // Stable identity so PageCanvasEditor's portal-ready effect (which fires this
  // as a cleanup/setup pair keyed on this callback) doesn't re-run on every
  // EditorShell render — an inline arrow here previously caused an infinite
  // setState(null)/setState(portal) render loop once an inline run started.
  const handleInlineRunPortalReady = useCallback((portal: HTMLElement | null) => {
    setAiInlineRunPortal(portal);
    if (portal) {
      pageCanvasRef.current = portal.closest<HTMLElement>(".page-canvas");
    } else {
      pageCanvasRef.current = null;
    }
    syncInlineRunAnchorCanvas(aiInlineRunAnchorRef.current);
  }, [syncInlineRunAnchorCanvas]);
  const [aiInlineSessionId, setAiInlineSessionId] = useState(0);
  const [aiInlineClosing, setAiInlineClosing] = useState(false);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const metadataByFileId = useMemo(() => {
    return new Map(documentMetadatas.map((metadata) => [metadata.fileId, metadata]));
  }, [documentMetadatas]);
  const activeDocumentMetadata = metadataByFileId.get(activeFileId);
  // useMemo (not a plain derived const) so the compiler can prove this primitive is
  // stable across renders where activeDocumentMetadata's revision didn't change;
  // otherwise the mcpProposalPreview useMemo below can't preserve its memoization.
  const activeDocumentRevision = useMemo(
    () => activeDocumentMetadata?.revision ?? null,
    [activeDocumentMetadata],
  );
  // AiEditPanel が保持する assistant turn の 適用済み/破棄済み バッジは、この request が
  // 変化するたびに outcome に応じて確定する (applied: 適用成功, dismissed: 却下・キャンセル)。
  // targets は解決された提案グループのroom/turn帰属先。複数グループ/複数ルームが
  // 同時に存在しても、他の未解決ターンを誤って確定させないため。
  const [aiEditPreviewClearRequest, setAiEditPreviewClearRequest] = useState<{
    seq: number;
    outcome: "applied" | "dismissed";
    targets?: Array<{ roomId?: string; turnId?: string }>;
    includeResolved?: boolean;
  }>({
    seq: 0,
    outcome: "dismissed",
  });
  const mcpProposalPreview = useMemo(
    () => groupMcpProposalsForPreview(mcpEditProposals, activeFileId, activeDocumentRevision, tAi),
    [mcpEditProposals, activeFileId, activeDocumentRevision],
  );
  const aiRunSessions = useAiRunSessions();
  const aiProposalPresentation = useMemo(
    () => deriveAiProposalPresentation(
      mcpProposalPreview.groups,
      aiRunSessions,
      activeFileId,
      isAiRunStatusActive,
    ),
    [activeFileId, aiRunSessions, mcpProposalPreview.groups],
  );
  // AI編集のロックは対象単位。live run が握っている anchor (ユーザーが依頼時に明示的に
  // 渡したブロック/図形) と、pending提案が実際に書き換える対象だけが読み取り専用になり、
  // それ以外は人間が編集できる。他の場所への人手編集は per-block の内容ハッシュ鮮度判定で
  // 吸収されるため、提案をstaleにしない。
  // グラフのラベルはグラフの兄弟図形なので、ロック集合はラベルまで広げる (locked-targets.ts)。
  const aiLockedTargets = useAiLockedTargets(
    activeFileId,
    aiProposalPresentation.previewGroups,
    document.pageLayout?.overlay?.overlaySnapshot?.shapes ?? EMPTY_OVERLAY_SHAPES,
  );
  // MCP プレビューの apply/dismiss の二重実行を防ぐ (承認済み提案への再実行で error 表示に
  // なるのを回避)。承認は文書を丸ごと差し替えるので、この窓だけは唯一の文書全体ロックも兼ねる
  // (途中の打鍵が黙って失われるため)。commitDocumentChange から参照するのでここで宣言する。
  const mcpPreviewBusyRef = useRef(false);
  const [mcpPreviewBusy, setMcpPreviewBusy] = useState(false);
  const aiDocumentWriteInProgress = mcpPreviewBusy;
  // AI ロック集合の最新値。`commitDocumentChange` の deps に入れると、保存のたびに動く
  // 提案プレビュー由来でその識別子が変わり、ぶら下がる全コールバック → memo 済み本文ユニット
  // 全部が描き直される。**イベント処理から呼ばれる前提**の choke point なので ref で足りる
  // (書き込み中フラグは同期更新の `mcpPreviewBusyRef` をそのまま読む)。
  const aiLockedTargetsRef = useRef(aiLockedTargets);
  useLayoutEffect(() => {
    aiLockedTargetsRef.current = aiLockedTargets;
  }, [aiLockedTargets]);
  const seenActiveAiRunIdsRef = useRef(new Set<string>());
  const seededActiveAiRunIdsRef = useRef(false);
  useEffect(() => {
    const transition = deriveAiRunStartTransition({
      sessions: aiRunSessions.values(),
      activeDocumentId: activeFileId,
      seenRunIds: seenActiveAiRunIdsRef.current,
      initialized: seededActiveAiRunIdsRef.current,
      isRunActive: isAiRunStatusActive,
    });
    seenActiveAiRunIdsRef.current = transition.seenRunIds;

    if (!seededActiveAiRunIdsRef.current) {
      // マウント時点ですでに active の run は先に記録し、以前開始した run で再マウント時の選択解除が起きないようにする。
      seededActiveAiRunIdsRef.current = true;
      return;
    }

    if (!transition.shouldClearActiveDocumentReference) {
      return;
    }

    // A microtask runs before the browser can deliver another user-input event,
    // so this still clears only the selection that existed when the run appeared.
    window.queueMicrotask(() => {
      // startRun receives a snapshot of turnReferences before publishing this
      // active session. Replacing the UI arrays cannot mutate that run payload.
      setAiEditReference(null);
      clearAiEditPinnedReferences();

      // Remove only a native selection owned by the body editor. Selection API
      // changes neither focus nor scroll, so the AI composer keeps its input focus.
      const selection = window.getSelection();
      const selectionTouchesTextFlow = [selection?.anchorNode, selection?.focusNode].some((node) => {
        const element = node instanceof Element ? node : node?.parentElement;
        return Boolean(element?.closest(".text-flow-editor"));
      });
      if (selectionTouchesTextFlow) {
        selection?.removeAllRanges();
      }
    });
  }, [activeFileId, aiRunSessions, clearAiEditPinnedReferences]);
  // 決定B: baseRevision一致の pending proposal は runId (帰属不明なら "unattributed")
  // ごとに独立したプレビュー単位になる。各グループが自分の apply/dismiss を持つ。
  // AI run が書き込みtoolを複数回呼ぶ途中では、proposal watcherが同じカードを何度も
  // 増補して見せてしまう。roomに紐づくrunが完了するまではcanvas/本文プレビューだけを
  // 抑止し、完了後に集約済みグループを一度表示する。room帰属のない外部MCP提案は、
  // 対応するrun状態を特定できないため従来どおり即時表示する。
  const aiEditPreviewGroups = aiProposalPresentation.previewGroups;
  const staleProposalGroups = mcpProposalPreview.stale;
  const resolvedMcpEditProposals = useMemo(
    () => mcpProposalCitations.filter(
      (proposal) => proposal.fileId === activeFileId && proposal.status !== "pending",
    ),
    [activeFileId, mcpProposalCitations],
  );
  // Phase 1: Agentic RAG。チャットサイドバーの各 assistant turn の下に「参照したドキュメント」
  // を出すため、turnId ごとに proposal (pending / approved / rejected / reverted すべて)
  // の sourceReferences を集約・重複排除する。適用後もチップを残すため pending 専用にしない。
  const sourceReferencesByTurnId = useMemo(
    () => buildSourceReferencesByTurnId(mcpProposalCitations),
    [mcpProposalCitations],
  );
  const insertedShapePreviewsByTurnId = useMemo(
    () => buildInsertedShapePreviewsByTurnId(
      mcpProposalCitations.filter((proposal) => proposal.fileId === activeFileId),
    ),
    [activeFileId, mcpProposalCitations],
  );
  // AIチャット履歴の各 assistant turn に「復元」ボタンを出すかどうかの判定。turnId ごとに
  // 最新の提案が rejected/reverted のときだけ復元可能 (pending/approvedのターンは対象外)。
  // 全件を渡さず最小限のMapだけをAiEditPanelへ渡す (不要な情報は表示せず、必要になった時
  // だけ追加する)。
  const restorableProposalsByTurnId = useMemo(
    () => buildRestorableProposalsByTurnId(mcpProposalCitations),
    [mcpProposalCitations],
  );
  const appliedChangesByTurnId = useMemo(
    () => buildAppliedTurnChangesByTurnId(
      mcpProposalCitations,
      activeFileId,
      activeDocumentRevision,
      document.pageLayout?.overlay?.overlaySnapshot?.shapes ?? [],
      tAi,
    ),
    [activeDocumentRevision, activeFileId, document.pageLayout?.overlay?.overlaySnapshot?.shapes, mcpProposalCitations],
  );
  const commentAnchorCandidate = useStore(editorStore, (state) => state.commentAnchorCandidate);
  const pendingCommentAnchor = useStore(editorStore, (state) => state.pendingCommentAnchor);
  const [pendingCommentDraft, setPendingCommentDraft] = useState<InlineNode[]>([]);
  const commentReplyDrafts = useStore(editorStore, (state) => state.commentReplyDrafts);
  const activeCommentThreadId = useStore(editorStore, (state) => state.activeCommentThreadId);
  const highlightedCommentThreadId = useStore(editorStore, (state) => state.highlightedCommentThreadId);
  const [commentsPanelOpen, setCommentsPanelOpen] = useState(() => !isWhiteboardDocument);
  const [showResolvedComments, setShowResolvedComments] = useState(false);
  const commentAuthor = COMMENT_AUTHOR;
  const [overlayEditing, setOverlayEditing] = useState(false);
  const [overlayModeStatus, setOverlayModeStatus] = useState<OverlayModeStatus | null>(null);
  const [runningRegionEditingKind, setRunningRegionEditingKind] = useState<"header" | "footer" | null>(null);
  const [overlayCommandRequest, setOverlayCommandRequest] = useState<OverlayCommandRequest | null>(null);
  const [overlayImageRequest, setOverlayImageRequest] = useState<OverlayImageRequest | null>(null);
  const [overlayActionRequest, setOverlayActionRequest] = useState<OverlayActionRequest | null>(null);
  const [overlaySelection, setOverlaySelection] = useState<OverlaySelectionSummary>(EMPTY_OVERLAY_SELECTION);
  const [webMcpPreviewGroups, setWebMcpPreviewGroups] = useState<AiEditPreviewState[]>([]);
  const webMcpBridgeRef = useRef<WebMcpBridgeHandle | null>(null);
  const [webMcpPanelTarget, setWebMcpPanelTarget] = useState<HTMLDivElement | null>(null);
  const visibleAiEditPreviewGroups = useMemo(
    () => [...aiEditPreviewGroups, ...webMcpPreviewGroups],
    [aiEditPreviewGroups, webMcpPreviewGroups],
  );
  /** 常に最新の選択。state 側はシェルの見た目に関わる差分でしか進まない。 */
  const overlaySelectionRef = useRef<OverlaySelectionSummary>(EMPTY_OVERLAY_SELECTION);
  const [activeOverlayTool, setActiveOverlayTool] = useState<OverlayTool>({ kind: "select" });
  const [historyRevision, setHistoryRevision] = useState(0);
  const [documentInstanceRevision, setDocumentInstanceRevision] = useState(0);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const otherImportInputRef = useRef<HTMLInputElement | null>(null);
  // EditorMath教材(.legacy/.archive)はパスワードゲート: 正しいパスワードが入力される
  // まで選択ファイルを保持し、ダイアログで照合してからインポートする。
  const [editorMathPasswordRequest, setEditorMathPasswordRequest] = useState<File | null>(null);
  const [editorMathPassword, setEditorMathPassword] = useState("");
  const [editorMathPasswordError, setEditorMathPasswordError] = useState<string | null>(null);
  const [editorMathImporting, setEditorMathImporting] = useState(false);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const fontFamilyButtonRef = useRef<HTMLButtonElement | null>(null);
  const blockStyleButtonRef = useRef<HTMLButtonElement | null>(null);
  const fontSizeButtonRef = useRef<HTMLButtonElement | null>(null);
  const textColorButtonRef = useRef<HTMLButtonElement | null>(null);
  const textBackgroundColorButtonRef = useRef<HTMLButtonElement | null>(null);
  const strokeColorButtonRef = useRef<HTMLButtonElement | null>(null);
  const fillColorButtonRef = useRef<HTMLButtonElement | null>(null);
  const lineDashButtonRef = useRef<HTMLButtonElement | null>(null);
  const lineWidthButtonRef = useRef<HTMLButtonElement | null>(null);
  const shapeMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const lineToolMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const inlineMathButtonRef = useRef<HTMLButtonElement | null>(null);
  const inlineMathMenuCloseTimeoutRef = useRef<number | null>(null);
  const searchButtonRef = useRef<HTMLButtonElement | null>(null);
  const boxedTextButtonRef = useRef<HTMLButtonElement | null>(null);
  const lineHeightButtonRef = useRef<HTMLButtonElement | null>(null);
  const textAlignButtonRef = useRef<HTMLButtonElement | null>(null);
  const orderedListMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const moreBlocksMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const fileMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const insertMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const aiMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const newDocButtonRef = useRef<HTMLButtonElement | null>(null);
  const newDocMenuCloseTimerRef = useRef<number | null>(null);
  const settingsMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const editorCanvasRef = useRef<HTMLElement | null>(null);
  const overlayCommandRequestIdRef = useRef(0);
  const overlayImageRequestIdRef = useRef(0);
  const overlayActionRequestIdRef = useRef(0);
  const [documentHistory] = useState(
    () => new DocumentHistoryController<SigmaDocument, EditorHistorySelection>(MAX_DOCUMENT_HISTORY),
  );
  const runShortcutCommandRef = useRef<(commandId: EditorCommandId) => void>(() => undefined);
  // Ctrl+F1 のリスナーは毎レンダー張り替えたくないので、ハンドラは ref 越しに読む
  // (runShortcutCommandRef と同じ手)。
  const toggleRibbonCollapseRef = useRef<() => void>(() => undefined);
  const documentRef = useRef(document);
  // Revision observed at the boundary where documentRef.current was adopted.
  // Metadata refreshes deliberately never mutate this value: a newer catalog
  // revision must not be attached to an older in-memory payload.
  const documentObservedRevisionRef = useRef<number | null>(null);
  const selectedIdRef = useRef(selectedId);
  const textSelectionBookmarkRef = useRef<TextFlowSelectionBookmark | null>(null);
  const pendingTextHistorySelectionRef = useRef<TextFlowSelectionBookmark | null | undefined>(undefined);
  const materialBlockSelectionRef = useRef<string | null>(null);
  // 教材タブごとの選択・キャレット・スクロール。切替で document を差し替えても戻せるようにする。
  const editorTabViewStateByFileIdRef = useRef(new Map<string, EditorTabViewState>());
  const pendingEditorTabViewRestoreRef = useRef<ResolvedEditorTabViewState | null>(null);
  const activeFileIdRef = useRef(activeFileId);
  const openFileIdsRef = useRef(openFileIds);
  const workspaceReadyRef = useRef(workspaceReady);
  const lastSavedDocumentRef = useRef<SigmaDocument>(document);
  // 「rendererが最後にディスクと同期した時点の文書」全体。lastSavedDocumentRef はdirty判定用、
  // lastSyncedDocumentRefは3-wayマージ(mergeExternalDocumentChange)のbaseとして使う実体。
  // 初回ロード・resetEditorDocument (ファイル切替/revert/外部変更の従来フォールバック)・自動保存
  // 成功・外部変更のマージ成功、のいずれの時点でも「今ディスク上にある内容」に更新する。
  const lastSyncedDocumentRef = useRef<SigmaDocument>(document);
  const documentDirtyRevisionRef = useRef(0);
  const lastSavedDirtyRevisionRef = useRef(0);
  const inFlightSavePromiseRef = useRef<Promise<unknown> | null>(null);
  const successfulDocumentSavesRef = useRef(new Map<string, SuccessfulDocumentSave<SigmaDocument>>());
  const externalChangeFileIdsRef = useRef(new Set<string>());
  const pendingActiveDocumentChangeRef = useRef<DocumentStorageChangeEvent | null>(null);
  // mainの自動承認通知の直後には、同じ保存を見たfs watcherの一般通知も届く。後者が先の
  // 非同期loadを追い越してもAI適用の履歴情報を失わないよう、active file分だけ別に保持する。
  const pendingAutoAppliedProposalIdsByFileRef = useRef(new Map<string, string[]>());
  const documentStorageChangeProcessorRef = useRef<((event: DocumentStorageChangeEvent) => void) | null>(null);
  const pendingAiApprovalAdoptionRef = useRef<PendingAiApprovalAdoption | null>(null);
  const aiApprovalAdoptionPromiseRef = useRef<Promise<BackupFirstDocumentReplacementResult<DocumentFileRecord>> | null>(null);
  const [autosaveRetry, setAutosaveRetry] = useState(0);
  const autosaveRetryTimerRef = useRef<number | null>(null);

  const clearPendingAiApprovalAdoption = useCallback(() => {
    pendingAiApprovalAdoptionRef.current = null;
    setHasPendingAiApprovalAdoption(false);
  }, []);

  useEffect(() => {
    if (!hasPendingAiApprovalAdoption) {
      return;
    }
    const warnBeforeClose = (event: BeforeUnloadEvent) => preventCloseForPendingAiApproval(event);
    window.addEventListener("beforeunload", warnBeforeClose);
    return () => window.removeEventListener("beforeunload", warnBeforeClose);
  }, [hasPendingAiApprovalAdoption]);

  const finishMcpPreviewBusy = useCallback(() => {
    mcpPreviewBusyRef.current = false;
    setMcpPreviewBusy(false);
    const pending = takeLatestDocumentChange(pendingActiveDocumentChangeRef);
    if (pending) {
      documentStorageChangeProcessorRef.current?.(pending);
    }
  }, []);

  const dispatchDocumentStorageChange = useCallback((event: DocumentStorageChangeEvent) => {
    if (event.fileId === activeFileIdRef.current && event.autoAppliedProposalIds?.length) {
      const existing = pendingAutoAppliedProposalIdsByFileRef.current.get(event.fileId) ?? [];
      pendingAutoAppliedProposalIdsByFileRef.current.set(
        event.fileId,
        uniqueStringIds([...existing, ...event.autoAppliedProposalIds]),
      );
    }
    if (
      event.fileId === activeFileIdRef.current
      && mcpPreviewBusyRef.current
    ) {
      queueLatestDocumentChange(pendingActiveDocumentChangeRef, event);
      return;
    }
    documentStorageChangeProcessorRef.current?.(event);
  }, []);

  useEffect(() => {
    const updateSelectionBookmark = (event: Event) => {
      if (event instanceof CustomEvent) {
        textSelectionBookmarkRef.current = event.detail as TextFlowSelectionBookmark;
      }
    };
    const captureChangeStart = (event: Event) => {
      pendingTextHistorySelectionRef.current = event instanceof CustomEvent
        ? event.detail as TextFlowSelectionBookmark | null
        : null;
    };

    window.addEventListener(TEXT_FLOW_SELECTION_BOOKMARK_EVENT, updateSelectionBookmark);
    window.addEventListener(TEXT_FLOW_CHANGE_START_EVENT, captureChangeStart);
    return () => {
      window.removeEventListener(TEXT_FLOW_SELECTION_BOOKMARK_EVENT, updateSelectionBookmark);
      window.removeEventListener(TEXT_FLOW_CHANGE_START_EVENT, captureChangeStart);
    };
  }, []);
  const closeGraphSettings = useCallback(() => {
    pendingOverlayGraphEditsRef.current = null;
    graphSettingsShapeIdRef.current = null;
    graphSettingsShapeWasInDocumentRef.current = false;
    setGraphSettingsShapeId(null);
  }, []);
  const openGraphSettings = useCallback((shapeId: string) => {
    graphSettingsShapeIdRef.current = shapeId;
    graphSettingsShapeWasInDocumentRef.current = Boolean(
      documentRef.current.pageLayout?.overlay?.overlaySnapshot?.shapes.some(
        (shape) => shape.id === shapeId && shape.type === "graph2dShape",
      ),
    );
    setGraphSettingsShapeId(shapeId);
  }, []);
  const closeChartSettings = useCallback(() => {
    chartSettingsShapeIdRef.current = null;
    setChartSettingsShapeId(null);
  }, []);
  const openChartSettings = useCallback((shapeId: string) => {
    chartSettingsShapeIdRef.current = shapeId;
    setChartSettingsShapeId(shapeId);
  }, []);
  const closeGraph3DSettings = useCallback(() => {
    setGraph3DSettingsShapeId(null);
  }, []);
  const openGraph3DSettings = useCallback((shapeId: string) => {
    setGraph3DSettingsShapeId(shapeId);
  }, []);

  useEffect(() => {
    if (!graphSettingsShapeId) {
      return;
    }

    const shapeExists = Boolean(
      document.pageLayout?.overlay?.overlaySnapshot?.shapes.some(
        (shape) => shape.id === graphSettingsShapeId && shape.type === "graph2dShape",
      ),
    );
    if (shapeExists) {
      graphSettingsShapeWasInDocumentRef.current = true;
      return;
    }
    if (!graphSettingsShapeWasInDocumentRef.current) {
      return;
    }

    closeGraphSettings();
    setSelectedOverlayGraph((current) => (
      current?.shapeId === graphSettingsShapeId ? null : current
    ));
  }, [closeGraphSettings, document.pageLayout?.overlay?.overlaySnapshot?.shapes, graphSettingsShapeId]);

  const scheduleAutosaveRetry = useCallback(() => {
    if (autosaveRetryTimerRef.current !== null) {
      return;
    }
    autosaveRetryTimerRef.current = window.setTimeout(() => {
      autosaveRetryTimerRef.current = null;
      setAutosaveRetry((current) => current + 1);
    }, 300);
  }, []);
  useEffect(() => () => {
    if (autosaveRetryTimerRef.current !== null) {
      window.clearTimeout(autosaveRetryTimerRef.current);
      autosaveRetryTimerRef.current = null;
    }
  }, []);
  const [pendingDeletion, setPendingDeletion] = useState<{ revision: number; deletedIds: string[] } | null>(null);
  const deletionSeqRef = useRef(0);
  const appUpdateAutoCheckStartedRef = useRef(false);
  const isDesktopApp = useSyncExternalStore(
    useCallback(() => () => undefined, []),
    useCallback(() => Boolean(getDesktopBridge()), []),
    useCallback(() => false, []),
  );
  const [desktopSettingsOpen, setDesktopSettingsOpen] = useState(false);
  const [desktopSettingsUpdateCheckRequest, setDesktopSettingsUpdateCheckRequest] = useState(0);
  /**
   * クロームのメニュー/ツールバーから「アプリ設定」を開く経路。素の setter を渡すと、
   * Help > Check for Updates… 由来の更新チェック要求が残ったままになり、普通に設定を
   * 開いただけで更新チェックが走ってしまう。開閉のたびに要求を落としておく。
   */
  const openDesktopSettingsFromChrome = useCallback((value: SetStateAction<boolean>) => {
    setDesktopSettingsUpdateCheckRequest(0);
    setDesktopSettingsOpen(value);
  }, []);
  const [storedUiLayoutPreference, updateUiLayoutPreference] = useUiLayoutPreference();
  // Word風リボンは再検討まで露出しない。保存済み設定は消さず、表示時だけ既定UIへ倒す。
  const uiLayoutPreference = useMemo(() => (
    storedUiLayoutPreference.mode === "docs"
      ? storedUiLayoutPreference
      : { ...storedUiLayoutPreference, mode: "docs" as const }
  ), [storedUiLayoutPreference]);
  const [ribbonTabState, setRibbonTabState] = useState(DEFAULT_RIBBON_TAB_STATE);
  // ファイルタブ = Backstage（編集画面を覆う全画面）。リボンのタブ状態とは混ぜない
  // ので、閉じれば自動的に「直前に自分で選んだタブ」へ戻る。
  const [ribbonBackstage, setRibbonBackstage] = useState(DEFAULT_BACKSTAGE_STATE);
  // 折りたたみは永続 (ui-layout-preference)、浮かせている状態は一時。
  // 2つを1つの純関数へ渡すために、レンダーのたびに組で作る。
  const [ribbonOverlayOpen, setRibbonOverlayOpen] = useState(false);
  const ribbonContextualWasVisibleRef = useRef(false);
  // SDK は EditorShell を埋め込むので、1ページに2つ載っても id が衝突しないようにする。
  const ribbonIdPrefix = useId();
  const saveEditorFontFamilyPreference = useCallback((nextFontFamily: string) => {
    preferredFontFamilyRef.current = nextFontFamily;
    const bridge = getDesktopBridge();
    if (!bridge?.app.saveEditorPreferences) {
      return;
    }
    bridge.app.saveEditorPreferences({ fontFamily: nextFontFamily }).catch((error) => {
      console.warn("Failed to save editor font preference", error);
    });
  }, []);

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge?.app.getEditorPreferences) {
      return;
    }

    let canceled = false;
    bridge.app.getEditorPreferences()
      .then((preferences) => {
        if (!canceled && typeof preferences.fontFamily === "string") {
          const nextFontFamily = normalizeToolbarFontFamily(preferences.fontFamily);
          preferredFontFamilyRef.current = nextFontFamily;
          setFontFamily(nextFontFamily);
        }
      })
      .catch((error) => {
        console.warn("Failed to load editor font preference", error);
      });

    return () => {
      canceled = true;
    };
  }, []);

  const shortcutPlatform = useMemo(() => detectEditorShortcutPlatform(), []);
  const visibleCommentThreadsForPanel = useMemo(
    () => visibleCommentThreads(document.comments, {
      activeThreadId: activeCommentThreadId,
      showResolved: showResolvedComments,
    }),
    [activeCommentThreadId, document.comments, showResolvedComments],
  );
  const currentOverlayCommentAnchor = useMemo(
    () => createOverlaySelectionCommentAnchor(overlaySelection, tE),
    [overlaySelection, tE],
  );
  const currentCommentAnchor = useMemo((): SigmaCommentAnchor | null => {
    if (currentOverlayCommentAnchor) {
      return currentOverlayCommentAnchor;
    }
    return commentAnchorCandidate;
  }, [commentAnchorCandidate, currentOverlayCommentAnchor]);

  const openCommentComposer = useCallback((anchor: SigmaCommentAnchor | null) => {
    if (!anchor) {
      setStatusMessage(tEditor("status.selectCommentTarget"));
      return;
    }
    // 候補アンカーは「場所」で持ち回しているので、引用文は最後に選択された時点のもの。
    // コメントを作る瞬間にいまの本文から取り直す (打鍵ごとに候補を作り直さないための対価)。
    const anchoredAtNow = anchor.type === "block"
      ? createBlockCommentAnchor(documentRef.current, anchor.blockId) ?? anchor
      : anchor;
    setPendingCommentAnchor(anchoredAtNow);
    setPendingCommentDraft([]);
    setActiveCommentThreadId(null);
    setCommentsPanelOpen(true);
    setStatusMessage(tEditor("status.commentReady"));
  }, [setActiveCommentThreadId, setPendingCommentAnchor, setStatusMessage]);

  const focusCommentLocation = useCallback((threadId?: string | null) => {
    if (typeof window === "undefined") {
      return;
    }

    const targetThreadId = threadId ?? activeCommentThreadId ?? visibleCommentThreadsForPanel[0]?.id ?? null;
    if (!targetThreadId) {
      return;
    }

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const escaped = CSS.escape(targetThreadId);
        const element = window.document.querySelector<HTMLElement>(
          `[data-comment-thread-id="${escaped}"], [data-comment-thread-ids~="${escaped}"]`,
        );
        if (!element) {
          return;
        }

        element.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
        element.classList.add("comment-focus-pulse");
        window.setTimeout(() => element.classList.remove("comment-focus-pulse"), 1000);
      });
    });
  }, [activeCommentThreadId, visibleCommentThreadsForPanel]);

  const toggleCommentsPanel = useCallback(() => {
    setHighlightedCommentThreadId(null);
    setCommentsPanelOpen((current) => {
      const next = !current;
      if (next) {
        focusCommentLocation();
      }
      return next;
    });
  }, [focusCommentLocation, setHighlightedCommentThreadId]);

  const selectCommentThread = useCallback((threadId: string) => {
    setActiveCommentThreadId(threadId);
    setCommentsPanelOpen(true);
    focusCommentLocation(threadId);
  }, [focusCommentLocation, setActiveCommentThreadId]);

  const resetEditorDocument = useCallback((
    incomingDocument: SigmaDocument,
    nextSelectedId?: string | null,
    nextObservedRevision?: number | null,
  ) => {
    // 本文が空の文書 (この不具合で空のまま保存されたファイル、埋め込みホストからの差し替え、
    // AI が全消しした正本) はここで直る — 開き直せば必ず入力できる状態から始まる。
    const nextDocument = ensureEditableBody(incomingDocument).document;
    const pendingAdoption = pendingAiApprovalAdoptionRef.current;
    if (pendingAdoption?.fileId === activeFileIdRef.current) {
      // 退避失敗後に別タブへ移る場合も、差し替え直前の最新入力を再試行用に保持する。
      pendingAdoption.userDocument = documentRef.current;
    }
    const selected = nextSelectedId ?? getDefaultDocumentSelectionId(nextDocument);
    documentHistory.clear();
    documentRef.current = nextDocument;
    if (nextObservedRevision !== undefined) {
      documentObservedRevisionRef.current = nextObservedRevision;
    }
    selectedIdRef.current = selected;
    textSelectionBookmarkRef.current = null;
    pendingTextHistorySelectionRef.current = undefined;
    materialBlockSelectionRef.current = null;
    measuredBodyBlockRectsRef.current = new Map();
    documentDirtyRevisionRef.current += 1;
    const nextDocumentStateStamp = documentDirtyRevisionRef.current;
    lastSavedDirtyRevisionRef.current = documentDirtyRevisionRef.current;
    lastSavedDocumentRef.current = nextDocument;
    lastSyncedDocumentRef.current = nextDocument;
    setDocument(nextDocument);
    setDocumentStateStamp(nextDocumentStateStamp);
    setSelectedId(selected);
    setSelectedInlineMath(null);
    // 文書まるごとの差し替えは documentInstanceRevision を進めて overlay ごと再マウントする。
    // 再マウント後は図形の選択が空へ戻り、パネルが握っているコールバックは破棄済み
    // インスタンスを指す (押しても何も起きないパネルが浮いたままになる)。開いたまま
    // 残す価値は無いので必ず閉じる。
    closeGraphSettings();
    setSelectedOverlayGraph(null);
    closeChartSettings();
    setSelectedOverlayChart(null);
    closeGraph3DSettings();
    setCommentAnchorCandidate(null);
    setPendingCommentAnchor(null);
    setPendingCommentDraft([]);
    clearCommentReplyDrafts();
    setActiveCommentThreadId(null);
    setHighlightedCommentThreadId(null);
    setCommentsPanelOpen(!isWhiteboardPageLayout(normalizePageLayout(nextDocument.pageLayout)));
    setHistoryRevision((current) => current + 1);
    // A full authoritative replacement (tab switch, external reload, AI
    // revert) must also discard editor-engine state. Reusing a focused Tiptap
    // instance can otherwise retain the previous content even though SigmaDoc
    // state has already changed.
    setDocumentInstanceRevision((current) => current + 1);
    // ドキュメント切替(別ファイルを開く/revert/外部変更の全文リロード)ではAI編集の
    // 参照状態も引き継がない — pin済み参照はブロックIDありきなので、別ドキュメントの
    // 同名IDに誤って解決したり、存在しないブロックを指したまま残ったりする。
    setAiEditReference(null);
    clearAiEditPinnedReferences();
  }, [clearAiEditPinnedReferences, closeChartSettings, closeGraph3DSettings, closeGraphSettings, documentHistory, clearCommentReplyDrafts, setActiveCommentThreadId, setCommentAnchorCandidate, setHighlightedCommentThreadId, setPendingCommentAnchor, setSelectedId, setSelectedInlineMath]);

  const rememberLeavingEditorTabViewState = useCallback((leavingFileId: string | null, nextFileId: string) => {
    if (!leavingFileId || leavingFileId === nextFileId) {
      return;
    }
    editorTabViewStateByFileIdRef.current.set(
      leavingFileId,
      captureEditorTabViewState({
        selectedId: selectedIdRef.current,
        textSelection: textSelectionBookmarkRef.current,
        scroller: editorCanvasRef.current,
      }),
    );
  }, []);

  const prepareIncomingEditorTabViewState = useCallback((
    nextDocument: SigmaDocument,
    nextFileId: string,
  ): ResolvedEditorTabViewState => {
    const resolved = resolveEditorTabViewState(
      nextDocument,
      editorTabViewStateByFileIdRef.current.get(nextFileId),
    );
    pendingEditorTabViewRestoreRef.current = resolved;
    return resolved;
  }, []);

  useEffect(() => {
    const pending = pendingEditorTabViewRestoreRef.current;
    if (!pending || !workspaceReady) {
      return;
    }
    pendingEditorTabViewRestoreRef.current = null;
    scheduleEditorTabViewRestore({
      getScroller: () => editorCanvasRef.current,
      scrollTop: pending.scrollTop,
      scrollLeft: pending.scrollLeft,
      textSelection: pending.textSelection,
      restoreTextSelection: deliverCaret,
    });
  }, [activeFileId, documentInstanceRevision, workspaceReady]);

  // 外部変更 (AI提案の自動承認などによる保存) を mergeExternalDocumentChange で人間の未保存編集と
  // 3-wayマージできた場合に使う、resetEditorDocument より軽量な反映経路。全文リロードではないため
  // undo/redoスタックや選択中ブロック以外のUI状態(コメント選択中アンカー等)は保持する — 通常の
  // commitDocumentChangeによる編集と同様、document状態だけを差し替える。マージ結果には人間の
  // 未保存編集がそのまま含まれているため、lastSavedDocumentRef は更新しない (=ドキュメントは
  // 保存前の状態と異なる「dirty」のままになり、既存の自動保存(450msデバウンス)がこの後で自然に
  // ディスクへ書き戻す)。lastSyncedDocumentRef だけは「ディスク上の最新状態」に合わせて更新し、
  // 次に外部変更が来たときの3-wayマージの base として使えるようにする。
  const applyMergedExternalDocument = useCallback((
    incomingMergedDocument: SigmaDocument,
    syncedDocument: SigmaDocument,
    syncedRevision: number,
  ) => {
    // 外部側が本文を空にしていても、こちらの画面はキャレットを置ける状態を保つ。
    const mergedDocument = ensureEditableBody(incomingMergedDocument).document;
    const currentSelectedId = selectedIdRef.current;
    const nextSelectedId = currentSelectedId && findBlock(mergedDocument, currentSelectedId)
      ? currentSelectedId
      : getDefaultDocumentSelectionId(mergedDocument);
    documentRef.current = mergedDocument;
    documentObservedRevisionRef.current = syncedRevision;
    selectedIdRef.current = nextSelectedId;
    documentDirtyRevisionRef.current += 1;
    const nextDocumentStateStamp = documentDirtyRevisionRef.current;
    lastSyncedDocumentRef.current = syncedDocument;
    setDocument(mergedDocument);
    setDocumentStateStamp(nextDocumentStateStamp);
    setSelectedId(nextSelectedId);
    // Tiptap keeps its own document state. An authoritative external update can
    // replace a block's content without changing its id, so a React prop update
    // alone is intentionally ignored while that editor is focused. Advance the
    // shared revision to force every mounted text-flow editor to consume the
    // merged SigmaDoc immediately instead of waiting for a tab remount.
    setHistoryRevision((current) => current + 1);
  }, [setDocument, setSelectedId]);

  // main側で自動承認されたAI提案は、一般の外部ファイル更新とは異なりユーザー操作として
  // undo可能でなければならない。resetEditorDocumentを通すと、それ以前の人手編集を含む履歴を
  // 全消去してしまうため、現在の文書を1手として積んでから承認済み正本（またはそのmerge結果）
  // を採用する。tldrawの履歴境界の設計を参考に、外部処理の完了を明示的な履歴境界にする。
  const applyAutoApprovedExternalDocument = useCallback((params: {
    nextDocument: SigmaDocument;
    syncedDocument: SigmaDocument;
    syncedRevision: number;
    proposalIds: string[];
  }) => {
    const currentDocument = documentRef.current;
    const currentSelectedId = selectedIdRef.current;
    // AI が本文を全消しした正本を採用しても、入力できる場所は残す。
    const nextDocument = ensureEditableBody(params.nextDocument).document;
    const nextSelectedId = currentSelectedId && findBlock(nextDocument, currentSelectedId)
      ? currentSelectedId
      : getDefaultDocumentSelectionId(nextDocument);
    documentHistory.record({
      document: currentDocument,
      selection: {
        selectedId: currentSelectedId,
        textSelection: textSelectionBookmarkRef.current,
      },
      metadata: {
        origin: "automation",
        correlationIds: params.proposalIds,
      },
    });
    documentRef.current = nextDocument;
    documentObservedRevisionRef.current = params.syncedRevision;
    selectedIdRef.current = nextSelectedId;
    materialBlockSelectionRef.current = null;
    documentDirtyRevisionRef.current += 1;
    const nextDocumentStateStamp = documentDirtyRevisionRef.current;
    lastSavedDocumentRef.current = params.syncedDocument;
    lastSyncedDocumentRef.current = params.syncedDocument;
    if (areSigmaDocumentsEquivalent(nextDocument, params.syncedDocument)) {
      lastSavedDirtyRevisionRef.current = documentDirtyRevisionRef.current;
    }
    setDocument(nextDocument);
    setDocumentStateStamp(nextDocumentStateStamp);
    setSelectedId(nextSelectedId);
    setSelectedInlineMath(null);
    setHistoryRevision((current) => current + 1);
  }, [documentHistory, setSelectedId, setSelectedInlineMath]);

  // AI承認待ち中の打鍵があれば、承認開始時点をbaseにAI結果と3-way mergeする。diskDocumentは
  // repair前の「実際にmainが保存した正本」で、保存済み判定と次回外部mergeのbaseは必ずこちらを
  // 使う。repair/normalize差分や人手編集を含む採用結果まで保存済み扱いにはしない。
  const applyAiApprovedDocument = useCallback((params: {
    diskDocument: SigmaDocument;
    normalizedApprovedDocument: SigmaDocument;
    documentAtApprovalStart: SigmaDocument;
    appliedProposalIds: string[];
    approvedRevision: number;
  }) => {
    const currentDocument = documentRef.current;
    const decision = decideAiApprovedDocument({
      documentAtApprovalStart: params.documentAtApprovalStart,
      currentDocument,
      diskDocument: params.diskDocument,
      normalizedApprovedDocument: params.normalizedApprovedDocument,
    });
    lastSavedDocumentRef.current = params.diskDocument;
    lastSyncedDocumentRef.current = params.diskDocument;

    if (decision.kind === "stay-dirty") {
      return decision;
    }

    // 採用する正本が本文を持たないときも、画面側はキャレットを置ける状態を保つ
    // (差分はディスク正本 = `params.diskDocument` 側の判定には混ぜない)。
    const nextDocument = ensureEditableBody(decision.document).document;
    const currentSelectedId = selectedIdRef.current;
    const nextSelectedId = currentSelectedId && findBlock(nextDocument, currentSelectedId)
      ? currentSelectedId
      : getDefaultDocumentSelectionId(nextDocument);
    documentHistory.record({
      // Ctrl+ZではAI適用だけを戻し、承認待ち中に入力された人手編集は残す。
      document: currentDocument,
      selection: {
        selectedId: currentSelectedId,
        textSelection: textSelectionBookmarkRef.current,
      },
      metadata: {
        origin: "automation",
        ...(params.appliedProposalIds.length > 0 ? { correlationIds: params.appliedProposalIds } : {}),
      },
    });
    documentRef.current = nextDocument;
    documentObservedRevisionRef.current = params.approvedRevision;
    selectedIdRef.current = nextSelectedId;
    materialBlockSelectionRef.current = null;
    documentDirtyRevisionRef.current += 1;
    const nextDocumentStateStamp = documentDirtyRevisionRef.current;
    if (decision.adoptedDocumentMatchesDisk) {
      lastSavedDirtyRevisionRef.current = documentDirtyRevisionRef.current;
    }
    setDocument(nextDocument);
    setDocumentStateStamp(nextDocumentStateStamp);
    setSelectedId(nextSelectedId);
    setSelectedInlineMath(null);
    setHistoryRevision((current) => current + 1);
    return decision;
  }, [documentHistory, setSelectedId, setSelectedInlineMath]);

  const refreshDocumentMetadatas = useCallback(async () => {
    // 一覧の取り直しは補助的な更新。ここで投げっぱなしにすると、保存先が使えない
    // 環境で unhandled rejection になって画面全体が落ちる。
    const metadatas = await listSavedDocuments().catch(() => null);
    if (!metadatas) {
      return;
    }
    // 保存のたびに読み直すので毎回新しい配列になる。中身が同じなら state を動かさない
    // (動かすと打鍵 1 回ごとに画面全体が再描画される)。
    setDocumentMetadatas((current) => sameDocumentMetadatas(current, metadatas) ? current : metadatas);
  }, []);

  // 承認/却下IPCが成功した proposalId の楽観的確定集合。IPC成功後も、watcher経由で遅れて届く
  // 再取得が (書き込み完了前に読んだ) 「まだ pending」のリストを返すことがあり、確定済みの
  // 提案カードが一瞬 pending に戻って見えるレースがあった。ここに載っているIDはプレビュー
  // 集合へ戻さず、ディスク上で pending でなくなったことを確認できた時点で自動的に掃除する。
  const locallyResolvedProposalIdsRef = useRef(new Set<string>());
  const mcpProposalRefreshTimerRef = useRef<number | null>(null);
  const mcpProposalRefreshBatchRef = useRef<McpProposalRefreshBatch | null>(null);
  const mcpProposalRefreshInFlightRef = useRef<Promise<void> | null>(null);

  const performMcpEditProposalsRefresh = useCallback(async () => {
    const storage = getDesktopBridge()?.storage;
    // pendingは全教材分を維持し、解決済み履歴だけ現在の教材に絞って一度に取得する。
    const all = await storage?.listMcpEditProposals({
      status: "all",
      fileId: activeFileIdRef.current,
    });
    const allList = all ?? [];
    const pendingList = allList.filter((proposal) => proposal.status === "pending");
    const locallyResolved = locallyResolvedProposalIdsRef.current;
    if (locallyResolved.size > 0) {
      for (const proposalId of [...locallyResolved]) {
        if (!pendingList.some((proposal) => proposal.proposalId === proposalId)) {
          locallyResolved.delete(proposalId);
        }
      }
    }
    setMcpEditProposals(
      locallyResolved.size > 0
        ? pendingList.filter((proposal) => !locallyResolved.has(proposal.proposalId))
        : pendingList,
    );
    setMcpProposalCitations(allList);
  }, []);

  // proposal書き込みはwatcher通知と明示refreshが近接して届く。75msのtrailing debounceで
  // 1回へまとめ、すでに取得中ならその完了後に最大1回だけ追従取得する。各呼び出しは自分を
  // 含むbatchの完了Promiseを共有するため、承認後のawaitも最新一覧の反映まで待機できる。
  const refreshMcpEditProposals = useCallback((): Promise<void> => {
    let batch = mcpProposalRefreshBatchRef.current;
    if (!batch) {
      let resolve!: () => void;
      let reject!: (reason: unknown) => void;
      const promise = new Promise<void>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      batch = { promise, resolve, reject };
      mcpProposalRefreshBatchRef.current = batch;
    }

    if (mcpProposalRefreshTimerRef.current !== null) {
      window.clearTimeout(mcpProposalRefreshTimerRef.current);
    }
    mcpProposalRefreshTimerRef.current = window.setTimeout(() => {
      mcpProposalRefreshTimerRef.current = null;
      const scheduledBatch = mcpProposalRefreshBatchRef.current;
      mcpProposalRefreshBatchRef.current = null;
      if (!scheduledBatch) {
        return;
      }

      const precedingRefresh = mcpProposalRefreshInFlightRef.current;
      const refresh = (async () => {
        await precedingRefresh?.catch(() => undefined);
        await performMcpEditProposalsRefresh();
      })();
      mcpProposalRefreshInFlightRef.current = refresh;
      void refresh.then(scheduledBatch.resolve, scheduledBatch.reject).finally(() => {
        if (mcpProposalRefreshInFlightRef.current === refresh) {
          mcpProposalRefreshInFlightRef.current = null;
        }
      });
    }, MCP_PROPOSAL_REFRESH_DEBOUNCE_MS);

    return batch.promise;
  }, [performMcpEditProposalsRefresh]);

  useEffect(() => () => {
    if (mcpProposalRefreshTimerRef.current !== null) {
      window.clearTimeout(mcpProposalRefreshTimerRef.current);
      mcpProposalRefreshTimerRef.current = null;
    }
    mcpProposalRefreshBatchRef.current?.resolve();
    mcpProposalRefreshBatchRef.current = null;
  }, []);

  const applyDocumentOpenFailure = useCallback((failure: DocumentOpenFailure | null) => {
    documentOpenFailureRef.current = failure;
    setDocumentOpenFailure(failure);
  }, []);

  /** 直前に記録した失敗を破棄する。同じ教材が読めるようになった時だけ呼ぶ。 */
  const clearDocumentOpenFailure = useCallback((fileId: string) => {
    if (documentOpenFailureRef.current?.fileId === fileId) {
      applyDocumentOpenFailure(null);
    }
    pendingDocumentOpenFailureRef.current = null;
  }, [applyDocumentOpenFailure]);

  /**
   * 読み込み失敗のうち「教材の中身が原因」のものだけを保留に置く。実際に画面へ
   * 出すかは呼び出し側 (その教材をアクティブにするかどうか) が決める。
   */
  const recordDocumentOpenFailure = useCallback((
    fileId: string,
    result: Extract<DocumentLoadResult, { ok: false }>,
    fallbackTitle?: string,
  ) => {
    pendingDocumentOpenFailureRef.current = toDocumentOpenFailure(
      fileId,
      result,
      fallbackTitle?.trim() || DEFAULT_DOCUMENT_TITLE,
    );
  }, []);

  /** 直前の読み込みで記録された失敗を、その教材のものに限り画面へ出す。 */
  const showRecordedDocumentOpenFailure = useCallback((fileId: string): DocumentOpenFailure | null => {
    const pending = pendingDocumentOpenFailureRef.current;
    if (!pending || pending.fileId !== fileId) {
      return null;
    }
    pendingDocumentOpenFailureRef.current = null;
    applyDocumentOpenFailure(pending);
    return pending;
  }, [applyDocumentOpenFailure]);

  /**
   * 開けなかった教材を「タブは開いたまま、本文の代わりに原因を中央へ出す」状態にする。
   * 本文は空の下書きへ差し替えるが resetEditorDocument が clean 扱いにするため
   * 自動保存は走らない。加えて documentOpenFailureRef を見る保存側のガードで、
   * この空の下書きが壊れた教材へ書き戻ることを二重に防いでいる。
   */
  const enterDocumentOpenFailureState = useCallback(async (
    failure: DocumentOpenFailure,
    nextOpenFileIds: string[],
  ) => {
    const blank = createEmptyEditorDocument();
    resetEditorDocument({
      ...blank,
      docId: `doc_open_failed_${failure.fileId}`,
      metadata: { ...blank.metadata, title: failure.title },
    }, undefined, null);
    setOpenFileIds(nextOpenFileIds);
    setActiveFileId(failure.fileId);
    await saveWorkspaceState({ openFileIds: nextOpenFileIds, activeFileId: failure.fileId });
    await refreshDocumentMetadatas();
    setSaveState("error");
    setStatusMessage(tEditor("status.openFailedWithReason"));
  }, [refreshDocumentMetadatas, resetEditorDocument, setSaveState, setStatusMessage]);

  const loadWorkspaceDocument = useCallback(async (fileId: string): Promise<{
    document: SigmaDocument;
    observedRevision: number;
  } | null> => {
    const localResult = await loadDocumentByFileIdWithRecovery(fileId);
    if (localResult.ok) {
      clearDocumentOpenFailure(fileId);
      if (localResult.recoveryIssues.length > 0) {
        window.setTimeout(() => announceRecovery(localResult.recoveryIssues, localResult.recoveryBackupPath), 0);
      }
      return { document: localResult.document, observedRevision: localResult.revision };
    }

    const metadata = await listSavedDocuments();
    const target = metadata.find((item) => item.fileId === fileId);
    // 教材の中身が原因で組み立てられなかった場合は、黙って別教材へ切り替えず
    // 「開いたまま原因を出す」ために失敗内容を記録しておく (呼び出し側が
    // openDocumentOpenFailure で拾う)。
    recordDocumentOpenFailure(fileId, localResult, target?.title);
    return null;
  }, [announceRecovery, clearDocumentOpenFailure, recordDocumentOpenFailure]);

  const isCurrentDocumentDirty = useCallback(() => {
    return !areSigmaDocumentsEquivalent(documentRef.current, lastSavedDocumentRef.current);
  }, []);

  const saveCurrentDocumentRecord = useCallback(async () => {
    // 開けなかった教材には何も書かない。画面上の document は原因表示用の空の
    // 下書きなので、保存すれば元の内容を空で上書きしてしまう。
    if (documentOpenFailureRef.current?.fileId === activeFileIdRef.current) {
      return { ok: true };
    }
    const saveRevision = documentDirtyRevisionRef.current;
    const host = embeddedHostRef.current;
    if (host) {
      try {
        await host.onSave?.(documentRef.current);
        lastSavedDocumentRef.current = documentRef.current;
        lastSavedDirtyRevisionRef.current = saveRevision;
        lastSyncedDocumentRef.current = documentRef.current;
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : tEditor("status.saveFailed"),
        };
      }
    }

    const nextDocument = {
      ...documentRef.current,
      updatedAt: new Date().toISOString(),
    };
    const fileId = activeFileIdRef.current;
    const observedRevision = documentObservedRevisionRef.current;
    if (observedRevision === null) {
      return {
        ok: false,
        error: tEditor("status.saveRevisionUnknown"),
      };
    }
    const write = createObservedDocumentWrite({
      fileId,
      document: nextDocument,
      observedRevision,
    });
    return trackInFlightSave(inFlightSavePromiseRef, (async () => {
      const result = await saveDocumentRecord(write);
      if (result.ok) {
        recordSuccessfulDocumentSave({
          savedByFileId: successfulDocumentSavesRef.current,
          save: {
            fileId,
            document: nextDocument,
            revision: result.revision ?? observedRevision + 1,
            dirtyRevision: saveRevision,
          },
          activeFileId: activeFileIdRef.current,
          observedRevisionRef: documentObservedRevisionRef,
          lastSavedDocumentRef,
          lastSavedDirtyRevisionRef,
          lastSyncedDocumentRef,
        });
      }
      return result;
    })());
  }, []);

  const createUnsavedEditBackup = useCallback(async (source: SigmaDocument) => {
    const backup = repairDuplicateTopLevelIds(ensurePageLayout({
      ...structuredClone(source),
      docId: createId("doc"),
      metadata: {
        ...source.metadata,
        title: createUnsavedEditBackupTitle(resolveDocumentTitle(source), tE),
      },
      updatedAt: new Date().toISOString(),
    }), DOCUMENT_BLOCK_OPERATION_PORTS);
    return createDocumentFromSigmaDocument(backup);
  }, [tE]);

  const saveUnsavedEditBackup = useCallback(async () => {
    if (!isCurrentDocumentDirty()) {
      return null;
    }
    return createUnsavedEditBackup(documentRef.current);
  }, [createUnsavedEditBackup, isCurrentDocumentDirty]);

  const performApprovedDocumentAdoption = useCallback(async (
    pending: PendingAiApprovalAdoption,
  ) => {
    return replaceDocumentAfterRequiredBackup({
      backupRequired: !!pending.backup
        || (pending.fileId === activeFileIdRef.current ? isCurrentDocumentDirty() : true),
      createBackup: async () => {
        // バックアップ作成中にも入力は進みうる。作成元dirty revisionが変わったら、その場で
        // 新しいスナップショットを退避し直し、古いバックアップで正本へ差し替えない。
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const isPendingFileActive = pending.fileId === activeFileIdRef.current;
          const source = isPendingFileActive ? documentRef.current : pending.userDocument;
          const sourceRevision = isPendingFileActive
            ? documentDirtyRevisionRef.current
            : pending.userDocumentDirtyRevision;
          const resolved = await resolveRevisionedBackup({
            cached: pending.backup && pending.backupSourceDirtyRevision !== undefined
              ? { backup: pending.backup, sourceRevision: pending.backupSourceDirtyRevision }
              : undefined,
            sourceRevision,
            createBackup: () => createUnsavedEditBackup(source),
          });
          if (!resolved) {
            return null;
          }
          pending.backup = resolved.backup;
          pending.backupSourceDirtyRevision = resolved.sourceRevision;
          if (
            pending.fileId !== activeFileIdRef.current
            || documentDirtyRevisionRef.current === resolved.sourceRevision
          ) {
            return resolved.backup;
          }
          pending.backup = undefined;
          pending.backupSourceDirtyRevision = undefined;
        }
        throw new Error(tEditor("status.setAsideRetry"));
      },
      replace: async (backup) => {
        if (!backup) {
          applyAiApprovalAdoptionIfFileActive({
            fileId: pending.fileId,
            getActiveFileId: () => activeFileIdRef.current,
            apply: () => {
              const currentSelectedId = selectedIdRef.current;
              resetEditorDocument(
                pending.document,
                currentSelectedId && findBlock(pending.document, currentSelectedId)
                  ? currentSelectedId
                  : getDefaultDocumentSelectionId(pending.document),
                pending.revision,
              );
            },
          });
          clearPendingAiApprovalAdoption();
          return;
        }
        pending.backup = backup;
        const nextOpenFileIds = uniqueStringIds([
          ...openFileIdsRef.current,
          backup.fileId,
          pending.fileId,
        ]);
        const workspaceResult = await persistWorkspaceBeforeAiApprovalAdoption({
          saveWorkspace: () => saveWorkspaceState({
            openFileIds: nextOpenFileIds,
            activeFileId: activeFileIdRef.current,
          }),
          onPersisted: () => {
            // workspace保存を待つ間にタブが変わっても、別タブのeditor stateへ旧文書をresetしない。
            applyAiApprovalAdoptionIfFileActive({
              fileId: pending.fileId,
              getActiveFileId: () => activeFileIdRef.current,
              apply: () => {
                const currentSelectedId = selectedIdRef.current;
                resetEditorDocument(
                  pending.document,
                  currentSelectedId && findBlock(pending.document, currentSelectedId)
                    ? currentSelectedId
                    : getDefaultDocumentSelectionId(pending.document),
                  pending.revision,
                );
              },
            });
            setOpenFileIds(nextOpenFileIds);
            clearPendingAiApprovalAdoption();
          },
        });
        if (!workspaceResult.ok) {
          throw new Error(workspaceResult.error ?? tEditor("status.setAsideTabsFailed"));
        }
      },
    });
  }, [clearPendingAiApprovalAdoption, createUnsavedEditBackup, isCurrentDocumentDirty, resetEditorDocument]);

  const adoptApprovedDocumentAfterBackup = useCallback((pending: PendingAiApprovalAdoption) => (
    runSingleFlight(aiApprovalAdoptionPromiseRef, () => performApprovedDocumentAdoption(pending))
  ), [performApprovedDocumentAdoption]);

  const saveCurrentDocumentBeforeReplacement = useCallback(async (): Promise<boolean> => {
    const pending = pendingAiApprovalAdoptionRef.current;
    if (pending && hasPendingAiApprovalForFile(pending, activeFileIdRef.current)) {
      setSaveState("saving");
      const replacement = await adoptApprovedDocumentAfterBackup(pending);
      if (!replacement.ok) {
        setSaveState("error");
        setStatusMessage(tEditor("status.keepOpenSetAsideFailed"));
        return false;
      }
      return true;
    }

    return saveBeforeDocumentReplacement({
      save: saveCurrentDocumentRecord,
      onFailure: (result) => {
        setSaveState("error");
        if (result.code === "revision-mismatch") {
          setStatusMessage(tEditor("status.keepOpenConflict"));
          dispatchDocumentStorageChange({
            type: "document",
            fileId: activeFileIdRef.current,
            change: "changed",
            timestamp: Date.now(),
          });
          return;
        }
        setStatusMessage(result.error ?? tEditor("status.keepOpenSaveFailed"));
      },
    });
  }, [adoptApprovedDocumentAfterBackup, dispatchDocumentStorageChange, saveCurrentDocumentRecord, setSaveState, setStatusMessage]);

  const switchAwayFromDeletedFile = useCallback(async (deletedFileId: string) => {
    const backup = await saveUnsavedEditBackup();
    const metadata = await listSavedDocuments();
    const availableFileIds = new Set(metadata.map((item) => item.fileId));
    let nextOpenFileIds = uniqueStringIds([
      ...openFileIdsRef.current.filter((fileId) => fileId !== deletedFileId && availableFileIds.has(fileId)),
      ...(backup ? [backup.fileId] : []),
    ]);
    let nextActiveFileId = backup?.fileId ?? nextOpenFileIds[0] ?? metadata[0]?.fileId;
    const loaded = nextActiveFileId ? await loadWorkspaceDocument(nextActiveFileId) : null;
    let nextDocument = loaded?.document ?? null;
    let nextObservedRevision = loaded?.observedRevision ?? null;

    if (!nextDocument) {
      const created = await createNewDocument();
      nextDocument = created.document;
      nextActiveFileId = created.fileId;
      nextOpenFileIds = [nextActiveFileId];
      nextObservedRevision = created.metadata.revision;
    } else if (nextActiveFileId && !nextOpenFileIds.includes(nextActiveFileId)) {
      nextOpenFileIds = uniqueStringIds([...nextOpenFileIds, nextActiveFileId]);
    }

    const migrated = repairDuplicateTopLevelIds(
      ensurePageLayout(nextDocument),
      DOCUMENT_BLOCK_OPERATION_PORTS,
    );
    resetEditorDocument(migrated, undefined, nextObservedRevision);
    setOpenFileIds(nextOpenFileIds);
    setActiveFileId(nextActiveFileId);
    await saveWorkspaceState({ openFileIds: nextOpenFileIds, activeFileId: nextActiveFileId });
    await refreshDocumentMetadatas();
    setSaveState("saved");
    setStatusMessage(backup
      ? tEditor("status.deletedDocSetAside")
      : tEditor("status.deletedDocSwitched"));
  }, [loadWorkspaceDocument, refreshDocumentMetadatas, resetEditorDocument, saveUnsavedEditBackup, setSaveState, setStatusMessage]);

  const openDocumentInWorkspace = useCallback(async (
    fileId: string,
    options?: { nextOpenFileIds?: string[]; status?: string; saveCurrent?: boolean },
  ) => {
    const nextOpenFileIds = uniqueStringIds([...(options?.nextOpenFileIds ?? openFileIds), fileId]);

    setLoadingFileId(fileId);
    try {
      if (workspaceReady && options?.saveCurrent !== false) {
        if (!(await saveCurrentDocumentBeforeReplacement())) {
          return;
        }
      }

      // 読み込み成否に関わらず、今の教材から離れる直前の位置を残す。
      rememberLeavingEditorTabViewState(activeFileIdRef.current, fileId);

      const loaded = await loadWorkspaceDocument(fileId);
      if (!loaded) {
        // 教材の中身が原因なら、別教材へ切り替えずタブを開いて原因を表示する。
        const failure = showRecordedDocumentOpenFailure(fileId);
        if (failure) {
          await enterDocumentOpenFailureState(failure, nextOpenFileIds);
          return;
        }
        setSaveState("error");
        setStatusMessage(tEditor("status.loadFailed"));
        await refreshDocumentMetadatas();
        return;
      }

      const migrated = repairDuplicateTopLevelIds(
        ensurePageLayout(loaded.document),
        DOCUMENT_BLOCK_OPERATION_PORTS,
      );
      const restoredView = prepareIncomingEditorTabViewState(migrated, fileId);
      resetEditorDocument(migrated, restoredView.selectedId, loaded.observedRevision);
      if (restoredView.textSelection) {
        textSelectionBookmarkRef.current = restoredView.textSelection;
      }
      setOpenFileIds(nextOpenFileIds);
      setActiveFileId(fileId);
      await saveWorkspaceState({ openFileIds: nextOpenFileIds, activeFileId: fileId });
      await refreshDocumentMetadatas();
      setSaveState("saved");
      setStatusMessage(options?.status ?? tEditor("status.opened"));
    } finally {
      setLoadingFileId(null);
    }
  }, [
    enterDocumentOpenFailureState,
    loadWorkspaceDocument,
    openFileIds,
    prepareIncomingEditorTabViewState,
    refreshDocumentMetadatas,
    rememberLeavingEditorTabViewState,
    resetEditorDocument,
    saveCurrentDocumentBeforeReplacement,
    setSaveState,
    setStatusMessage,
    showRecordedDocumentOpenFailure,
    workspaceReady,
  ]);

  const openSourceReferenceDocument = useCallback(async (params: { fileId: string; blockId?: string }) => {
    const { fileId, blockId } = params;

    const revealReferencedLocation = (doc: SigmaDocument) => {
      focusSourceReferenceInDocument(doc, blockId, {
        selectBlock: (selectionId) => {
          setSelectedInlineMath(null);
          selectedIdRef.current = selectionId;
          setSelectedId(selectionId);
        },
        focusEditableBlock: scheduleEditorBlockFocus,
      });
    };

    if (fileId === activeFileIdRef.current) {
      revealReferencedLocation(documentRef.current);
      setStatusMessage(blockId?.trim() ? tEditor("status.showingSourceSpot") : tEditor("status.showingSourceDoc"));
      return;
    }

    const nextOpenFileIds = uniqueStringIds([...openFileIds, fileId]);
    setLoadingFileId(fileId);
    try {
      if (workspaceReady) {
        if (!(await saveCurrentDocumentBeforeReplacement())) {
          return;
        }
      }

      rememberLeavingEditorTabViewState(activeFileIdRef.current, fileId);

      const loaded = await loadWorkspaceDocument(fileId);
      if (!loaded) {
        const failure = showRecordedDocumentOpenFailure(fileId);
        if (failure) {
          await enterDocumentOpenFailureState(failure, nextOpenFileIds);
          return;
        }
        setSaveState("error");
        setStatusMessage(tEditor("status.openSourceFailed"));
        await refreshDocumentMetadatas();
        return;
      }

      const migrated = repairDuplicateTopLevelIds(
        ensurePageLayout(loaded.document),
        DOCUMENT_BLOCK_OPERATION_PORTS,
      );
      const selectionId = resolveSourceReferenceNavigationTarget(migrated, blockId).selectionId;
      // 参照ジャンプ先は revealReferencedLocation が決める。保存済みビューは使わない。
      resetEditorDocument(
        migrated,
        selectionId ?? undefined,
        loaded.observedRevision,
      );
      setOpenFileIds(nextOpenFileIds);
      setActiveFileId(fileId);
      await saveWorkspaceState({ openFileIds: nextOpenFileIds, activeFileId: fileId });
      await refreshDocumentMetadatas();
      setSaveState("saved");
      setStatusMessage(blockId?.trim() ? tEditor("status.openedSourceSpot") : tEditor("status.openedSourceDoc"));
      revealReferencedLocation(migrated);
    } finally {
      setLoadingFileId(null);
    }
  }, [
    enterDocumentOpenFailureState,
    loadWorkspaceDocument,
    openFileIds,
    refreshDocumentMetadatas,
    rememberLeavingEditorTabViewState,
    resetEditorDocument,
    saveCurrentDocumentBeforeReplacement,
    setSaveState,
    setSelectedId,
    setSelectedInlineMath,
    setStatusMessage,
    showRecordedDocumentOpenFailure,
    workspaceReady,
  ]);

  /**
   * ズームの唯一の入口。リボンの ±/選択、⌘+/⌘-、ホイール、右下コントロールが全部ここを通る。
   *
   * ホワイトボードは transform のカメラ、紙はスクロール位置で錨を取る。「どちらの錨か」の分岐は
   * この 1 箇所だけに置く。入口ごとに実装を持つと、片方だけ左上原点で拡大する破綻に戻る。
   */
  const applyZoom = useCallback((
    nextZoomInput: number | ((current: number) => number),
    anchor?: { clientX: number; clientY: number },
  ) => {
    // ホイールは再レンダーより速く連続するので、render 時の値を読むと 1 発ぶん古い。
    // ストアから直接引く (set は同期反映なので、連打でも常に最新)。
    const store = editorStore.getState();
    const currentZoom = store.zoom;
    const nextZoom = resolveNextZoom(
      currentZoom,
      typeof nextZoomInput === "function" ? nextZoomInput(currentZoom) : nextZoomInput,
    );

    if (nextZoom === currentZoom) {
      return;
    }

    if (isWhiteboardDocument) {
      const viewportRect = whiteboardViewportRef.current?.getBoundingClientRect();
      if (!viewportRect || viewportRect.width <= 0 || viewportRect.height <= 0) {
        // 錨が測れないなら倍率も動かさない。倍率だけ変えると左上原点で拡大され、
        // 「錨の下のワールド点は動かない」という唯一の約束が破れる。
        return;
      }

      const anchorPoint = anchor
        ? { x: anchor.clientX - viewportRect.left, y: anchor.clientY - viewportRect.top }
        : { x: viewportRect.width / 2, y: viewportRect.height / 2 };
      const next = zoomCameraAt(
        { zoom: currentZoom, ...store.whiteboardPan },
        nextZoom,
        anchorPoint,
      );
      // 倍率とパンは 1 回の set で当てる。分けると commit が割れて 1 フレーム絵が飛ぶ。
      store.setWhiteboardCamera(next.zoom, { panX: next.panX, panY: next.panY });
      return;
    }

    const scroller = editorCanvasRef.current;
    if (scroller && anchor) {
      const rect = scroller.getBoundingClientRect();
      const nextScroll = getScrollForZoomAnchor({
        scrollLeft: scroller.scrollLeft,
        scrollTop: scroller.scrollTop,
        offsetX: anchor.clientX - rect.left,
        offsetY: anchor.clientY - rect.top,
        currentZoom,
        nextZoom,
      });

      window.requestAnimationFrame(() => {
        scroller.scrollLeft = nextScroll.scrollLeft;
        scroller.scrollTop = nextScroll.scrollTop;
      });
    }

    store.setZoom(nextZoom);
  }, [editorStore, isWhiteboardDocument]);

  /** ⌘0 / 右下「リセット」。ホワイトボードでは倍率だけでなくパンも原点へ戻す。 */
  const resetZoom = useCallback(() => {
    if (isWhiteboardDocument) {
      const camera = resetCamera();
      editorStore.getState().setWhiteboardCamera(camera.zoom, {
        panX: camera.panX,
        panY: camera.panY,
      });
      return;
    }

    applyZoom(100);
  }, [applyZoom, editorStore, isWhiteboardDocument]);

  /**
   * パンは常に「差分」で受ける。中ボタンドラッグは 1 フレームに何度も動くので、
   * 絶対値で受けると render 時の古いパンに毎回足し込んで最後の 1 回だけが残り、
   * 速いドラッグが置いていかれる。
   */
  const panWhiteboardBy = useCallback((dx: number, dy: number) => {
    if (dx === 0 && dy === 0) {
      return;
    }

    const store = editorStore.getState();
    store.setWhiteboardPan((currentPan) => {
      const next = panCamera({ zoom: store.zoom, ...currentPan }, dx, dy);
      return { panX: next.panX, panY: next.panY };
    });
  }, [editorStore]);

  useEffect(() => {
    const handleTextFormatState = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : null;
      if (!detail) {
        return;
      }

      if (detail.target === "document") {
        const nodeType = detail.nodeType;
        const blockId = typeof detail.blockId === "string" ? detail.blockId : null;
        const nextTarget =
          detail.enabled === true &&
          isTextFormatTargetNodeType(nodeType)
            ? { enabled: true as const, nodeType, blockId }
            : null;
        setDocumentTextFormatTarget((current) => (
          current?.enabled === nextTarget?.enabled &&
          current?.nodeType === nextTarget?.nodeType &&
          current?.blockId === nextTarget?.blockId
            ? current
            : nextTarget
        ));
      }
      setBoldActive(detail.bold === true);
      setItalicActive(detail.italic === true);
      setUnderlineActive(detail.underline === true);
      setBoxedTextActive(detail.boxed === true);
      setBoldActive(detail.bold === true);
      setItalicActive(detail.italic === true);
      setUnderlineActive(detail.underline === true);
      if (typeof detail.boxedPaddingY === "number" && Number.isFinite(detail.boxedPaddingY)) {
        setBoxedTextPaddingY(detail.boxedPaddingY);
      }
      setBoxedTextVariant(normalizeBoxedTextVariant(detail.boxedVariant) ?? "frame");
      setBlockStyleState((current) => nextBlockStyleToolbarState(current, detail));
      // The toolbar shows the font this position is actually drawn with. It used to fall back to
      // `preferredFontFamilyRef` — the last font picked from the dropdown, persisted in settings —
      // which is a different thing entirely the moment the caret moves somewhere the user did not
      // set by hand. That preference is still kept, just no longer used as the displayed value.
      if (detail.fontFamilyMixed === true) {
        setFontFamily("");
      } else if (typeof detail.fontFamily === "string") {
        setFontFamily(normalizeToolbarFontFamily(detail.fontFamily));
      }
      if (typeof detail.fontSize === "number" && Number.isFinite(detail.fontSize)) {
        setTextFontSize(detail.fontSize);
      } else if (detail.fontSize === null) {
        setTextFontSize(null);
      }
      if (typeof detail.color === "string") {
        setTextColor(detail.color);
      } else if (detail.color === null) {
        setTextColor(BASE_EDITOR_TEXT_COLOR);
      }
      if (typeof detail.backgroundColor === "string") {
        setTextBackgroundColor(detail.backgroundColor);
      } else if (detail.backgroundColor === null) {
        setTextBackgroundColor(null);
      }
      const nextLineHeight = normalizeLineHeight(detail.lineHeight);
      if (nextLineHeight) {
        setLineHeight(nextLineHeight);
      } else if (detail.lineHeight === null) {
        setLineHeight(BASE_EDITOR_LINE_HEIGHT);
      }
    };

    window.addEventListener(TEXT_FORMAT_STATE_EVENT, handleTextFormatState);
    return () => window.removeEventListener(TEXT_FORMAT_STATE_EVENT, handleTextFormatState);
  }, []);

  useEffect(() => {
    const scroller = editorCanvasRef.current;
    if (!scroller) {
      return;
    }

    /**
     * ホイールの唯一の受け口。React の `onWheel` には載せられない — React は `wheel` を
     * ルートコンテナへ **passive** で張るので `preventDefault()` が効かず、そもそもこの
     * capture リスナの `stopPropagation()` で bubble 段階まで届かない。
     */
    const handleNativeWheel = (event: WheelEvent) => {
      if (isWhiteboardDocument) {
        const viewport = whiteboardViewportRef.current;
        const target = event.target;
        // ビューポートの外 (AIタスクDock・コメントパネル) のホイールは自前で処理しない。
        if (!viewport || !(target instanceof Node) || !viewport.contains(target)) {
          return;
        }

        const rect = viewport.getBoundingClientRect();
        const scale = {
          lineHeightPx: WHEEL_LINE_HEIGHT_PX,
          pageWidthPx: rect.width,
          pageHeightPx: rect.height,
        };
        const intent = resolveWheelIntent(event, scale);

        if (intent.kind === "pan") {
          // 盤面の中にスクロールできるもの (数式のTeX入力欄など) があればそちらに譲る。
          // capture で全部止めると、それらが二度とスクロールできなくなる。
          // 見る軸は **intent の軸** (パン量の符号を戻したもの)。生の delta で見ると
          // shift 単独 (縦 delta を横パンへ振り替える) のとき、横だけスクロールできる
          // 要素に届かない。
          if (canScrollWithin(target, viewport, -intent.dx, -intent.dy)) {
            return;
          }
        }

        event.preventDefault();
        event.stopPropagation();

        if (intent.kind === "zoom") {
          applyZoom(
            (current) => current * intent.factor,
            { clientX: event.clientX, clientY: event.clientY },
          );
          return;
        }

        panWhiteboardBy(intent.dx, intent.dy);
        return;
      }

      if (!event.ctrlKey && !event.metaKey) {
        return;
      }

      const intent = resolveWheelIntent(event, {
        lineHeightPx: WHEEL_LINE_HEIGHT_PX,
        pageWidthPx: scroller.clientWidth,
        pageHeightPx: scroller.clientHeight,
      });
      if (intent.kind !== "zoom") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      applyZoom(
        (current) => current * intent.factor,
        { clientX: event.clientX, clientY: event.clientY },
      );
    };

    scroller.addEventListener("wheel", handleNativeWheel, { capture: true, passive: false });
    return () => scroller.removeEventListener("wheel", handleNativeWheel, { capture: true });
  }, [applyZoom, isWhiteboardDocument, panWhiteboardBy]);

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge?.settings) {
      return;
    }

    let canceled = false;
    void bridge.settings.get().then((settings) => {
      if (canceled) {
        return;
      }
      // settings.json が表示言語の正本。未設定 (null) の初回起動だけは、ストア側の
      // OSロケール検出結果を採用したうえで settings.json へ書き戻す。書き戻さないと
      // main / MCP プロセスが日本語、画面だけ英語という食い違いが残り続ける。
      const desktopLocale = normalizeLocale(settings.uiLocale ?? null);
      setAppLocale(desktopLocale ?? getAppLocale());
      if (!desktopLocale) {
        void bridge.settings?.setUiLocale?.(getAppLocale());
      }
      const storedShortcutOverrides = parseEditorShortcutOverrides(JSON.stringify(settings.commandShortcuts ?? {}));
      const storedCustomCommands = parseEditorCustomCommands(JSON.stringify(settings.customCommands ?? []));
      const legacyShortcutOverrides = settings.hasCommandShortcuts ? {} : loadEditorShortcutOverrides();
      const legacyCustomCommands = settings.hasCustomCommands ? [] : loadEditorCustomCommands();
      setShortcutOverrides(Object.keys(storedShortcutOverrides).length > 0 ? storedShortcutOverrides : legacyShortcutOverrides);
      setCustomCommands(storedCustomCommands.length > 0 ? storedCustomCommands : legacyCustomCommands);
      setCommandSettingsError(null);
      setCommandSettingsLoaded(true);
    }).catch(() => {
      if (!canceled) {
        setCommandSettingsError(tEditor("status.shortcutsLoadFailed"));
      }
    });

    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (!commandSettingsLoaded || commandSettingsError) {
      return;
    }

    const bridge = getDesktopBridge();
    if (bridge?.settings) {
      void bridge.settings.setCommandConfig({
        commandShortcuts: Object.keys(shortcutOverrides).length > 0 ? shortcutOverrides : null,
        customCommands,
      }).then((result) => {
        if (!result.ok) {
          setCommandSettingsError(result.error ?? tEditor("status.shortcutsSaveFailed"));
        }
      }).catch(() => {
        setCommandSettingsError(tEditor("status.shortcutsSaveFailed"));
      });
      return;
    }

    saveEditorShortcutOverrides(shortcutOverrides);
    saveEditorCustomCommands(customCommands);
  }, [commandSettingsError, commandSettingsLoaded, customCommands, shortcutOverrides]);

  useEffect(() => {
    if (workspaceReady) {
      window.dispatchEvent(new Event(APP_READY_EVENT));
    }
  }, [workspaceReady]);

  /** 開けたら true。パレットは開けたときだけ focus 対象を覚える。 */
  const openCommandSettings = useCallback(() => {
    if (!commandSettingsLoaded) {
      setStatusMessage(commandSettingsError ?? tEditor("status.shortcutsLoading"));
      return false;
    }
    if (commandSettingsError) {
      setStatusMessage(commandSettingsError);
      return false;
    }
    setCommandSettingsOpen(true);
    return true;
  }, [commandSettingsError, commandSettingsLoaded, setStatusMessage]);

  const refreshMaterials = useCallback(async () => {
    setMaterialsLoading(true);
    try {
      const nextMaterials = await getAppRuntime().materials.listMaterials();
      setMaterials(mergeOfficialMaterials(nextMaterials));
      setMaterialError(null);
    } catch (error) {
      setMaterialError(error instanceof Error ? error.message : tEditor("status.materialsLoadFailed"));
    } finally {
      setMaterialsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void refreshMaterials();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [refreshMaterials]);

  const commitDocumentChange = useCallback((change: DocumentChange, options?: DocumentChangeOptions) => measurePerformance("EditorShell.commitDocumentChange", () => {
    // AI 側の状態は ref から読む (上の `aiLockedTargetsRef` のコメント参照)。書き込み中は
    // state のミラーではなく、書き込み開始と同時に立つ `mcpPreviewBusyRef` を直接見る。
    const aiDocumentWriteInProgress = mcpPreviewBusyRef.current;
    const aiLockedTargets = aiLockedTargetsRef.current;
    if (aiDocumentWriteInProgress) {
      setStatusMessage(aiDocumentWriteInProgressMessage());
      return;
    }
    const current = documentRef.current;
    const proposed = typeof change === "function" ? change(current) : change;
    // 本文を空のままにはしない。ブロック削除・切り取り・AI 適用のどれで空になっても、
    // ここで空段落が 1 つ残るので「消したら二度と入力できない」状態にはならない。
    const next = ensureEditableBody(repairDuplicateTopLevelIds(
      proposed,
      DOCUMENT_BLOCK_OPERATION_PORTS,
    )).document;

    if (next === current) {
      pendingTextHistorySelectionRef.current = undefined;
      return;
    }

    // The single mutation choke point, and therefore the backstop for every
    // surface the ProseMirror edit guard cannot see (overlay drags, block moves
    // and deletions, table/graph edits): refuse exactly the changes that would
    // alter what AI is holding, and let everything else through.
    const touchedAiTargets = findAiLockedTargetsTouched(current, next, aiLockedTargets);
    if (hasAiLockedTargetsTouched(touchedAiTargets)) {
      setStatusMessage(describeAiLockedTargets(aiLockedTargets, touchedAiTargets));
      return;
    }

    // `coalesce` folds derived overlay geometry into the preceding user edit.
    // This keeps automatic re-anchors and text auto-size corrections in the
    // same undo step as the deletion or text edit that caused them.
    if (!options?.coalesce) {
      const pendingTextSelection = pendingTextHistorySelectionRef.current;
      documentHistory.record({
        document: current,
        selection: {
          selectedId: selectedIdRef.current,
          textSelection: pendingTextSelection === undefined
            ? textSelectionBookmarkRef.current
            : pendingTextSelection,
        },
        metadata: { origin: "user" },
      }, options?.historyGroup ? { coalescingKey: options.historyGroup } : undefined);
    }
    pendingTextHistorySelectionRef.current = undefined;
    documentRef.current = next;
    documentDirtyRevisionRef.current += 1;
    const nextDocumentStateStamp = documentDirtyRevisionRef.current;
    if (options?.deferRender) {
      startTransition(() => {
        setDocument(next);
        setDocumentStateStamp(nextDocumentStateStamp);
      });
    } else {
      setDocument(next);
      setDocumentStateStamp(nextDocumentStateStamp);
    }

    const deletedIds = diffDeletedContentIds(current, next);
    if (deletedIds.length > 0) {
      deletionSeqRef.current += 1;
      setPendingDeletion({ revision: deletionSeqRef.current, deletedIds });
    }
  }), [documentHistory, setStatusMessage]);

  // コメント内 @メンション (@codex/@chatgpt/@ai/@claude/@antigravity/@agy) で起動する AI 実行の状態。
  const aiConnection = useAiConnection();
  const claudeConnection = useClaudeConnection();
  const geminiConnection = useGeminiConnection();
  // 実行中スレッドの多重起動ガード (同期判定が必要なため state ではなく ref)。
  const commentAiRunningThreadsRef = useRef<Set<string>>(new Set());
  // addPendingCommentThread/replyToCommentThread から定義順に依存せず呼ぶための間接参照。
  const maybeTriggerCommentAiRunRef = useRef<(threadId: string, body: InlineNode[], anchor: SigmaCommentAnchor) => void>(() => {});

  const addPendingCommentThread = useCallback(() => {
    if (!pendingCommentAnchor || isInlineBodyEmpty(pendingCommentDraft)) {
      return;
    }

    const body = pendingCommentDraft;
    const result = createCommentThread(documentRef.current, {
      anchor: pendingCommentAnchor,
      authorName: commentAuthor.name,
      body,
      color: DEFAULT_COMMENT_COLOR,
    }, COMMENT_MUTATION_PORTS);
    commitDocumentChange(result.document);
    setPendingCommentAnchor(null);
    setPendingCommentDraft([]);
    setActiveCommentThreadId(result.threadId);
    setCommentsPanelOpen(true);
    const summary = inlineNodesToCommentText(body);
    setStatusMessage(summary ? tEditor("status.commentAddedWith", { summary: summary.slice(0, 24) }) : tEditor("status.commentAdded"));
    maybeTriggerCommentAiRunRef.current(result.threadId, body, pendingCommentAnchor);
  }, [commentAuthor.name, commitDocumentChange, pendingCommentAnchor, pendingCommentDraft, setActiveCommentThreadId, setPendingCommentAnchor, setStatusMessage]);

  const replyToCommentThread = useCallback((threadId: string) => {
    const draft = commentReplyDrafts[threadId] ?? [];
    if (isInlineBodyEmpty(draft)) {
      return;
    }

    const body = draft;
    const result = appendCommentMessage(documentRef.current, {
      threadId,
      authorName: commentAuthor.name,
      body,
    }, COMMENT_MUTATION_PORTS);
    commitDocumentChange(result.document);
    setCommentReplyDraft(threadId, null);
    setActiveCommentThreadId(threadId);
    setStatusMessage(tEditor("status.replyAdded"));
    if (result.anchor) {
      maybeTriggerCommentAiRunRef.current(threadId, body, result.anchor);
    }
  }, [commentAuthor.name, commentReplyDrafts, commitDocumentChange, setActiveCommentThreadId, setCommentReplyDraft, setStatusMessage]);

  const updateCommentResolved = useCallback((threadId: string, resolved: boolean) => {
    const result = setCommentThreadResolved(documentRef.current, {
      threadId,
      resolved,
    }, COMMENT_MUTATION_PORTS);
    commitDocumentChange(result.document);
    setActiveCommentThreadId(threadId);
    setStatusMessage(resolved ? tEditor("status.commentResolved") : tEditor("status.commentReopened"));
  }, [commitDocumentChange, setActiveCommentThreadId, setStatusMessage]);

  const editCommentThread = useCallback((threadId: string, body: InlineNode[]) => {
    if (isInlineBodyEmpty(body)) {
      return;
    }

    const result = updateCommentThreadBody(documentRef.current, {
      threadId,
      body,
    }, COMMENT_MUTATION_PORTS);
    commitDocumentChange(result.document);
    setActiveCommentThreadId(threadId);
    setStatusMessage(tEditor("status.commentEdited"));
  }, [commitDocumentChange, setActiveCommentThreadId, setStatusMessage]);

  const editCommentMessage = useCallback((threadId: string, messageId: string, body: InlineNode[]) => {
    if (isInlineBodyEmpty(body)) {
      return;
    }

    const result = updateCommentMessageBody(documentRef.current, {
      threadId,
      messageId,
      body,
    }, COMMENT_MUTATION_PORTS);
    commitDocumentChange(result.document);
    setActiveCommentThreadId(threadId);
    setStatusMessage(tEditor("status.commentEdited"));
  }, [commitDocumentChange, setActiveCommentThreadId, setStatusMessage]);

  // AI 名義の返信メッセージをスレッド末尾に追加する (返信ドラフトを参照しない点が replyToCommentThread と異なる)。
  const appendAiReplyMessage = useCallback((threadId: string, authorName: string, body: InlineNode[]): string => {
    const result = appendCommentMessage(documentRef.current, {
      threadId,
      authorName,
      body,
    }, COMMENT_MUTATION_PORTS);
    commitDocumentChange(result.document);
    return result.messageId;
  }, [commitDocumentChange]);

  // コメント本文に @メンションがあれば AI を起動し、編集は既存プレビュー/承認フローへ、要約はスレッド返信へ。
  const maybeTriggerCommentAiRun = useCallback((threadId: string, body: InlineNode[], anchor: SigmaCommentAnchor) => {
    const eligibility = deriveCommentAiRunEligibility({
      body,
      threadAlreadyRunning: commentAiRunningThreadsRef.current.has(threadId),
      connectedProviders: {
        chatgpt: aiConnection.state.kind === "loggedIn",
        claude: claudeConnection.state.kind === "loggedIn",
        antigravity: geminiConnection.state.kind === "loggedIn",
      },
      t: tAi,
    });
    if (eligibility.kind === "ignore") {
      return;
    }
    if (eligibility.kind === "disconnected") {
      appendAiReplyMessage(threadId, eligibility.match.authorName, [{
        type: "text",
        text: eligibility.message,
      }]);
      return;
    }
    const { match } = eligibility;

    const running = new Set(commentAiRunningThreadsRef.current);
    running.add(threadId);
    commentAiRunningThreadsRef.current = running;

    const placeholderId = appendAiReplyMessage(threadId, match.authorName, [{
      type: "text",
      text: tEditor("status.aiThinking", { name: match.authorName }),
    }]);

    void (async () => {
      try {
        const runDocument = documentRef.current;
        const requestPlan = buildCommentAiRunRequestPlan({
          document: runDocument,
          body,
          anchor,
          match,
          models: {
            chatgpt: DEFAULT_AI_EDIT_MODEL,
            claude: DEFAULT_CLAUDE_AI_EDIT_MODEL,
            antigravity: DEFAULT_GEMINI_AI_EDIT_MODEL,
          },
          reasoningEffort: DEFAULT_AI_EDIT_REASONING_EFFORT,
        });
        const result = await runAiEditViaDesktopRuntime({
          fileId: activeFileIdRef.current,
          ...requestPlan,
        });

        const operations = result.draft.operations ?? [];
        // すべてのプロバイダが pending proposal をディスクに書きうるため、無条件に再取得して
        // mcpPreview に反映させる (storage watcher でもいずれ拾えるが、ここでの再取得は無害)。
        await refreshMcpEditProposals();

        const summary = result.draft.summary?.trim()
          || (operations.length > 0
            ? tEditor("status.aiDraftReady")
            : tEditor("status.aiAnswerReady"));
        editCommentMessage(threadId, placeholderId, [{ type: "text", text: summary }]);
      } catch (error) {
        const message = error instanceof Error ? error.message : tEditor("status.aiRunFailed");
        editCommentMessage(threadId, placeholderId, [{ type: "text", text: tEditor("status.errorWith", { message: message }) }]);
      } finally {
        const next = new Set(commentAiRunningThreadsRef.current);
        next.delete(threadId);
        commentAiRunningThreadsRef.current = next;
      }
    })();
  }, [aiConnection.state.kind, claudeConnection.state.kind, geminiConnection.state.kind, appendAiReplyMessage, editCommentMessage, refreshMcpEditProposals]);

  useEffect(() => {
    maybeTriggerCommentAiRunRef.current = maybeTriggerCommentAiRun;
  }, [maybeTriggerCommentAiRun]);

  const toggleCommentReaction = useCallback((threadId: string, messageId: string, emoji: string) => {
    const result = toggleCommentMessageReaction(documentRef.current, {
      threadId,
      messageId,
      emoji,
      authorName: commentAuthor.name,
    }, COMMENT_MUTATION_PORTS);
    commitDocumentChange(result.document);
    setActiveCommentThreadId(threadId);
    setStatusMessage(tEditor("status.reactionUpdated"));
  }, [commentAuthor.name, commitDocumentChange, setActiveCommentThreadId, setStatusMessage]);

  const deleteCommentThread = useCallback((threadId: string) => {
    const result = removeCommentThread(documentRef.current, {
      threadId,
    }, COMMENT_MUTATION_PORTS);
    commitDocumentChange(result.document);
    setCommentReplyDraft(threadId, null);
    setActiveCommentThreadId((current) => current === threadId ? null : current);
    setStatusMessage(tEditor("status.commentDeleted"));
  }, [commitDocumentChange, setActiveCommentThreadId, setCommentReplyDraft, setStatusMessage]);

  const deleteCommentMessage = useCallback((threadId: string, messageId: string) => {
    const result = removeCommentReplyMessage(documentRef.current, {
      threadId,
      messageId,
    }, COMMENT_MUTATION_PORTS);
    commitDocumentChange(result.document);
    setActiveCommentThreadId(threadId);
    setStatusMessage(tEditor("status.replyDeleted"));
  }, [commitDocumentChange, setActiveCommentThreadId, setStatusMessage]);

  const restoreDocumentHistory = useCallback((direction: "undo" | "redo") => {
    if (aiDocumentWriteInProgress) {
      setStatusMessage(aiDocumentWriteInProgressMessage());
      return;
    }
    // Overlay edits reach the document on a short debounce. Undo pressed inside that window would
    // otherwise skip straight past the edit the user just made and swallow the previous one, so the
    // pending overlay change is committed first and becomes the step this undo takes back.
    window.dispatchEvent(new CustomEvent(FLUSH_OVERLAY_CHANGES_EVENT));
    // A restore swaps the whole document, so peek before either stack moves and
    // refuse only when the entry would alter what AI is holding. Undoing edits
    // elsewhere stays available during a run.
    const candidate = documentHistory.peek(direction);
    if (candidate) {
      const touchedAiTargets = findAiLockedTargetsTouched(
        documentRef.current,
        candidate.document,
        aiLockedTargets,
      );
      if (hasAiLockedTargetsTouched(touchedAiTargets)) {
        setStatusMessage(describeAiLockedTargets(aiLockedTargets, touchedAiTargets));
        return;
      }
    }
    const entry = direction === "undo"
      ? documentHistory.undo({
          document: documentRef.current,
          selection: {
            selectedId: selectedIdRef.current,
            textSelection: textSelectionBookmarkRef.current,
          },
        })
      : documentHistory.redo({
          document: documentRef.current,
          selection: {
            selectedId: selectedIdRef.current,
            textSelection: textSelectionBookmarkRef.current,
          },
        });

    if (!entry) {
      setStatusMessage(direction === "undo" ? tEditor("status.nothingToUndo") : tEditor("status.nothingToRedo"));
      return;
    }

    documentRef.current = entry.document;
    documentDirtyRevisionRef.current += 1;
    const nextDocumentStateStamp = documentDirtyRevisionRef.current;
    selectedIdRef.current = entry.selection.selectedId;
    textSelectionBookmarkRef.current = entry.selection.textSelection;
    pendingTextHistorySelectionRef.current = undefined;
    setDocument(entry.document);
    setDocumentStateStamp(nextDocumentStateStamp);
    setSelectedId(entry.selection.selectedId);
    setSelectedInlineMath(null);
    setCommentAnchorCandidate(null);
    setPendingCommentAnchor(null);
    setActiveCommentThreadId(null);
    setHistoryRevision((current) => current + 1);
    if (entry.selection.textSelection) {
      // 予約にする。同期で配ると `setDocument` が反映される前の ProseMirror doc に当たり、
      // 巻き戻し後の長さで clamp された選択がそのまま保存される。
      requestCaret(entry.selection.textSelection);
    }

    // AI適用エントリ: document の巻き戻し/やり直しに合わせて提案ストアの status も遷移させる
    // (undo: approved→reverted / redo: reverted→approved)。document 自体は上の通常undoと同じく
    // ローカル状態の差し替え + 既存の自動保存で永続化されるため、ここではstatus整合だけを取る。
    // ベストエフォート: IPCが失敗しても document の undo/redo 自体は成立させたままにする。
    const appliedProposalIds = entry.metadata?.correlationIds
      ? [...entry.metadata.correlationIds]
      : [];
    if (appliedProposalIds.length > 0) {
      const storage = getDesktopBridge()?.storage;
      const sync = direction === "undo"
        ? storage?.markMcpEditProposalsReverted
        : storage?.markMcpEditProposalsReapplied;
      if (sync) {
        sync(appliedProposalIds)
          .then(() => refreshMcpEditProposals())
          .catch((error) => {
            console.warn(tEditor("status.aiUndoStoreFailed"), error);
          });
      }
      setStatusMessage(direction === "undo" ? tEditor("status.aiUndone") : tEditor("status.aiRedone"));
      return;
    }
    setStatusMessage(direction === "undo" ? tEditor("status.undone") : tEditor("status.redone"));
  }, [aiDocumentWriteInProgress, aiLockedTargets, documentHistory, refreshMcpEditProposals, setActiveCommentThreadId, setCommentAnchorCandidate, setPendingCommentAnchor, setSelectedId, setSelectedInlineMath, setStatusMessage]);

  const undoDocumentChange = useCallback(() => {
    restoreDocumentHistory("undo");
  }, [restoreDocumentHistory]);

  const redoDocumentChange = useCallback(() => {
    restoreDocumentHistory("redo");
  }, [restoreDocumentHistory]);

  useEffect(() => {
    // A deferred document render can lag behind documentRef. Only let state write
    // back after its paired revision has caught up to the latest committed change.
    syncDocumentRefWhenStateIsCurrent(
      documentRef,
      document,
      documentStateStamp,
      documentDirtyRevisionRef.current,
    );
    selectedIdRef.current = selectedId;
    activeFileIdRef.current = activeFileId;
    openFileIdsRef.current = openFileIds;
    workspaceReadyRef.current = workspaceReady;
  }, [activeFileId, document, documentStateStamp, openFileIds, selectedId, workspaceReady]);

  const lastEmbeddedInputRef = useRef(embeddedHost?.document);
  const lastEmittedEmbeddedDocumentRef = useRef(document);
  // ホストのonSaveがawait後に古いスナップショットをonChange経由で送り返す(エコー)
  // ことがある。それを外部更新と誤認してresetEditorDocumentを呼ぶと、再度dirty化
  // →自動保存→再エコー…と自走するループになる(スピナーが止まらない/入力が
  // フリッカーする不具合の原因)。ここではエディタ自身がembeddedHost.onChangeへ
  // 渡した文書のdocumentHistoryKeyを直近MAX_EMBEDDED_ECHO_KEYS件だけ覚えておき、
  // 同じdocId内でそのキーが戻ってきたらエコーとして無視する。docIdが変わる本物の
  // ドキュメント切替はこの記録に関わらず常に受け入れる。
  const MAX_EMBEDDED_ECHO_KEYS = 50;
  const emittedEchoKeysRef = useRef<Set<string>>(
    new Set(embeddedHost ? [documentHistoryKey(initialDocument)] : []),
  );
  const rememberEmittedEchoKey = useCallback((key: string) => {
    const seen = emittedEchoKeysRef.current;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    if (seen.size > MAX_EMBEDDED_ECHO_KEYS) {
      const oldest = seen.values().next().value;
      if (oldest !== undefined) {
        seen.delete(oldest);
      }
    }
  }, []);

  useEffect(() => {
    const nextInput = embeddedHost?.document;
    if (!nextInput || nextInput === lastEmbeddedInputRef.current) {
      return;
    }
    lastEmbeddedInputRef.current = nextInput;

    // ホストが本文の空な文書を送り続けても往復しないよう、比較は「直したあと」で行う
    // (`ensureEditableBody` は冪等・id 固定なので、直した結果は毎回同じ値になる)。
    const nextDocument = ensureEditableBody(nextInput).document;
    if (
      nextDocument === documentRef.current
      || areSigmaDocumentsEquivalent(nextDocument, documentRef.current)
    ) {
      return;
    }

    const isGenuineDocumentSwitch = nextInput.docId !== documentRef.current.docId;
    if (!isGenuineDocumentSwitch && emittedEchoKeysRef.current.has(documentHistoryKey(nextInput))) {
      return;
    }

    lastEmittedEmbeddedDocumentRef.current = nextInput;
    resetEditorDocument(nextDocument, undefined, null);
    setOpenFileIds([nextDocument.docId]);
    setActiveFileId(nextDocument.docId);
    setStatusMessage(tEditor("status.hostUpdated"));
  }, [embeddedHost?.document, resetEditorDocument, setStatusMessage]);

  useEffect(() => {
    if (!embeddedHost || document === lastEmittedEmbeddedDocumentRef.current) {
      return;
    }
    lastEmittedEmbeddedDocumentRef.current = document;
    rememberEmittedEchoKey(documentHistoryKey(document));
    embeddedHost.onChange(document);
  }, [document, embeddedHost, rememberEmittedEchoKey]);

  useEffect(() => {
    if (isEmbedded) {
      return;
    }

    let cancelled = false;

    const timeoutId = window.setTimeout(() => {
      initializeDocumentWorkspace()
        .then(async (workspace) => {
          if (cancelled) {
            return;
          }
          if (!workspace.ok) {
            setLedgerFailure(workspace.ledgerError);
            setWorkspaceReady(true);
            return;
          }

          const metadata = await listSavedDocuments();
          const requestedFileId = getRequestedFileId();
          const availableFileIds = new Set(metadata.map((item) => item.fileId));
          const firstLocalFileId = metadata[0]?.fileId;
          const candidateFileIds = uniqueStringIds([
            ...(requestedFileId ? [requestedFileId] : []),
            ...(availableFileIds.has(workspace.state.activeFileId) ? [workspace.state.activeFileId] : []),
            ...(metadata[0] ? [metadata[0].fileId] : []),
            ...(firstLocalFileId ? [firstLocalFileId] : []),
          ]);
          if (candidateFileIds.length === 0) {
            throw new Error(tEditor("status.noSavedDocuments"));
          }

          // ローカルの候補を順に開き、読み込めない候補は読み飛ばす。
          let nextActiveFileId: string | null = null;
          let activeDocument: { document: SigmaDocument; observedRevision: number } | null = null;
          let openFailure: DocumentOpenFailure | null = null;
          for (const candidateFileId of candidateFileIds) {
            const candidate = await loadWorkspaceDocument(candidateFileId);
            if (cancelled) {
              return;
            }
            if (candidate) {
              nextActiveFileId = candidateFileId;
              activeDocument = candidate;
              break;
            }
            // 教材の中身 (壊れたJSON / スキーマ違反) が原因の失敗は読み飛ばさない。
            // 黙って別教材が開くと「Sigma Studioが開けない」ように見えるため、
            // その教材を開いたまま原因と修復プロンプトを出す。
            openFailure = showRecordedDocumentOpenFailure(candidateFileId);
            if (openFailure) {
              break;
            }
          }

          if (openFailure) {
            const nextOpenFileIds = uniqueStringIds([
              ...workspace.state.openFileIds.filter((fileId) => availableFileIds.has(fileId)),
              openFailure.fileId,
            ]);
            await refreshDocumentMetadatas();
            setWorkspaceReady(true);
            await enterDocumentOpenFailureState(openFailure, nextOpenFileIds);
            if (requestedFileId) {
              clearRequestedFileId();
            }
            return;
          }

          if (activeDocument && nextActiveFileId) {
            const migrated = repairDuplicateTopLevelIds(
              ensurePageLayout(activeDocument.document),
              DOCUMENT_BLOCK_OPERATION_PORTS,
            );
            const nextOpenFileIds = uniqueStringIds([
              ...workspace.state.openFileIds.filter((fileId) => availableFileIds.has(fileId)),
              nextActiveFileId,
            ]);
            resetEditorDocument(
              migrated,
              undefined,
              activeDocument.observedRevision,
            );
            setOpenFileIds(nextOpenFileIds);
            setActiveFileId(nextActiveFileId);
            await refreshDocumentMetadatas();
            setWorkspaceReady(true);
            await saveWorkspaceState({ openFileIds: nextOpenFileIds, activeFileId: nextActiveFileId });
            if (requestedFileId) {
              clearRequestedFileId();
            }
            setStatusMessage(storageWarningOrStatus(requestedFileId && nextActiveFileId !== requestedFileId
              ? tEditor("status.fallbackDocument")
              : tEditor("status.ready")));
            return;
          }

          const fallback = await createNewDocument();
          if (cancelled) {
            return;
          }

          resetEditorDocument(fallback.document, undefined, fallback.metadata.revision);
          setOpenFileIds([fallback.fileId]);
          setActiveFileId(fallback.fileId);
          await refreshDocumentMetadatas();
          setWorkspaceReady(true);
          if (requestedFileId) {
            clearRequestedFileId();
          }
          setStatusMessage(storageWarningOrStatus(tEditor("status.documentCreated")));
        })
        .catch((error) => {
          if (cancelled) {
            return;
          }
          setSaveState("error");
          setStatusMessage(error instanceof Error ? error.message : tEditor("status.restoreFailed"));
          setWorkspaceReady(true);
        });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [
    enterDocumentOpenFailureState,
    isEmbedded,
    loadWorkspaceDocument,
    refreshDocumentMetadatas,
    resetEditorDocument,
    setSaveState,
    setStatusMessage,
    showRecordedDocumentOpenFailure,
    workspaceReloadNonce,
  ]);

  useEffect(() => {
    if (!isDesktopApp || !workspaceReady) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void refreshMcpEditProposals();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [activeFileId, isDesktopApp, refreshMcpEditProposals, workspaceReady]);

  useEffect(() => {
    if (!workspaceReady || ledgerFailure) {
      return;
    }

    // 開けなかった教材がアクティブな間は自動保存しない (saveCurrentDocumentRecord と同じ理由)。
    if (documentOpenFailureRef.current?.fileId === activeFileId) {
      return;
    }

    // documentはeffectのデバウンス起点。保存時点ではdocumentRefから最新内容を取り直し、
    // 承認後に古いrender snapshotをIPCへ渡さない。
    void document;
    const saveRevision = documentDirtyRevisionRef.current;
    // A clean document has nothing to persist; skipping keeps the save indicator
    // quiet (no saving→saved flicker) when switching tabs or opening documents.
    // Use a numeric dirty revision here so typing does not stringify the whole
    // SigmaDoc on every document state update.
    if (saveRevision <= lastSavedDirtyRevisionRef.current) {
      return;
    }

    if (isEmbedded) {
      let cancelled = false;
      const timeoutId = window.setTimeout(() => {
        const host = embeddedHostRef.current;
        setSaveState("saving");
        Promise.resolve(host?.onSave?.(document))
          .then(() => {
            if (cancelled) {
              return;
            }
            lastSavedDocumentRef.current = document;
            lastSavedDirtyRevisionRef.current = saveRevision;
            lastSyncedDocumentRef.current = document;
            setSaveState("saved");
            setStatusMessage(host?.onSave ? tEditor("status.hostAutosaved") : tEditor("status.hostSynced"));
          })
          .catch((error) => {
            if (cancelled) {
              return;
            }
            setSaveState("error");
            setStatusMessage(error instanceof Error ? error.message : tEditor("status.saveFailed"));
          });
      }, 450);

      return () => {
        cancelled = true;
        window.clearTimeout(timeoutId);
      };
    }

    let cancelled = false;
    const savingTimeoutId = window.setTimeout(() => {
      if (
        externalChangeFileIdsRef.current.has(activeFileId)
        || mcpPreviewBusyRef.current
      ) {
        scheduleAutosaveRetry();
        return;
      }
      if (hasPendingAiApprovalForFile(pendingAiApprovalAdoptionRef.current, activeFileId)) {
        return;
      }
      setSaveState("saving");
    }, 0);
    const timeoutId = window.setTimeout(async () => {
      // 直列化: 進行中の保存が終わるまで次を送らない。
      //
      // 重ねて投げると 2 本目は 1 本目が確定させる前の observedRevision で CAS に入るため、
      // 中身が競合していなくても revision-mismatch になり「他の変更を読み込んでいます」に落ちる。
      // 待ってから下の判定と snapshot を作ることが重要 — 待った後に revision だけ取り直すと、
      // 古い document に新しい revision を貸すことになり `ObservedDocumentWrite` が
      // 防いでいる lost update そのものになる。ここでは本文も revision も待機後に読む。
      // 1 回待つだけでは足りない: 待っている間に明示保存 (AI 承認前の flush 等) が
      // 始まると `.current` が差し替わり、結局それと重なって走ってしまう。
      while (inFlightSavePromiseRef.current) {
        await inFlightSavePromiseRef.current.catch(() => undefined);
        if (cancelled) {
          return;
        }
      }
      // 明示save（AI提案承認前のflush/save等）がこのtimerより先に同revisionを保存した
      // 場合、古いdocument snapshotで後から上書きしない。timer作成時の判定だけでは、
      // 承認IPC中に450msを跨いだときstale autosaveがAI適用結果の後へ並ぶraceが残る。
      if (saveRevision <= lastSavedDirtyRevisionRef.current) {
        return;
      }
      if (
        externalChangeFileIdsRef.current.has(activeFileId)
        || mcpPreviewBusyRef.current
      ) {
        scheduleAutosaveRetry();
        return;
      }
      if (hasPendingAiApprovalForFile(pendingAiApprovalAdoptionRef.current, activeFileId)) {
        return;
      }
      const revisionToSave = documentDirtyRevisionRef.current;
      if (revisionToSave <= lastSavedDirtyRevisionRef.current) {
        return;
      }
      const nextDocument = {
        ...documentRef.current,
        updatedAt: new Date().toISOString(),
      };
      const observedRevision = documentObservedRevisionRef.current;
      if (observedRevision === null) {
        setSaveState("error");
        setStatusMessage(tEditor("status.saveRevisionUnknown"));
        return;
      }
      const write = createObservedDocumentWrite({
        fileId: activeFileId,
        document: nextDocument,
        observedRevision,
      });
      const saveTask = saveDocumentRecord(write)
        .then(async (result) => {
          if (result.ok) {
            const savedFileIsActive = recordSuccessfulDocumentSave({
              savedByFileId: successfulDocumentSavesRef.current,
              save: {
                fileId: activeFileId,
                document: nextDocument,
                revision: result.revision ?? observedRevision + 1,
                dirtyRevision: revisionToSave,
              },
              activeFileId: activeFileIdRef.current,
              observedRevisionRef: documentObservedRevisionRef,
              lastSavedDocumentRef,
              lastSavedDirtyRevisionRef,
              lastSyncedDocumentRef,
            });
            // Effect cleanup means its UI snapshot is stale, not that the completed
            // write did not happen. Same-file refs above must advance even when a
            // newer keystroke has already created the next autosave effect.
            if (cancelled || !savedFileIsActive) {
              return;
            }
            if (!openFileIds.includes(activeFileId)) {
              const nextOpenFileIds = uniqueStringIds([...openFileIds, activeFileId]);
              setOpenFileIds(nextOpenFileIds);
              await saveWorkspaceState({ openFileIds: nextOpenFileIds, activeFileId });
            }
            await refreshDocumentMetadatas();
            if (cancelled) {
              return;
            }
            setSaveState("saved");
            setStatusMessage(result.error
              ? tEditor("status.localAutosavedWith", { reason: result.error })
              : isDesktopApp
                ? tEditor("status.localAutosavedThisPc")
                : tEditor("status.localAutosaved"));
          } else if (result.code === "revision-mismatch") {
            // queued済みの古いpayloadは一切mergeせず破棄する。metadataだけを読み直して
            // revisionを進めると同じstale payloadがCASを通るため、documentRefを外部変更
            // 取り込みで更新できるまでは再保存しない。
            if (activeFileIdRef.current === activeFileId) {
              dispatchDocumentStorageChange({
                type: "document",
                fileId: activeFileId,
                change: "changed",
                timestamp: Date.now(),
              });
              if (!cancelled) {
                setSaveState("error");
                setStatusMessage(tEditor("status.reloadingOtherChanges"));
              }
            }
          } else {
            if (!cancelled && activeFileIdRef.current === activeFileId) {
              setSaveState("error");
              setStatusMessage(result.error ?? tEditor("status.saveFailedShort"));
            }
          }
        })
        .catch((error) => {
          if (cancelled) {
            return;
          }
          setSaveState("error");
          setStatusMessage(error instanceof Error ? error.message : tEditor("status.saveFailedShort"));
        });
      void trackInFlightSave(inFlightSavePromiseRef, saveTask);
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(savingTimeoutId);
      window.clearTimeout(timeoutId);
    };
  }, [
    activeFileId,
    autosaveRetry,
    dispatchDocumentStorageChange,
    document,
    isDesktopApp,
    isEmbedded,
    ledgerFailure,
    openFileIds,
    refreshDocumentMetadatas,
    scheduleAutosaveRetry,
    setSaveState,
    setStatusMessage,
    workspaceReady,
  ]);

  useEffect(() => {
    // これから生まれるエディタが初期 state に使う「現在の検索語」はシェルが宣言する
    // (マウント時の空文字も含めて必ず通るので、前のシェルの検索語を引きずらない)。
    setLatestSearchQuery(searchQuery);

    // 通知は検索語が変わった時だけ。文書は deps に入れない — ハイライトは各エディタの
    // プラグイン state に入った検索語と doc から毎回導出されるので、打鍵のたびに通知し直すと
    // 本文ユニット数だけ ProseMirror の transaction が増えるだけで表示は変わらない。
    if (!shouldDispatchSearchQuery(lastDispatchedSearchQueryRef.current, searchQuery)) {
      return;
    }

    // Debounced so per-keystroke highlight updates don't re-render the document.
    const timeoutId = window.setTimeout(() => {
      lastDispatchedSearchQueryRef.current = searchQuery;
      window.dispatchEvent(new CustomEvent(SEARCH_QUERY_EVENT, { detail: { query: searchQuery } }));
    }, searchQuery ? 150 : 0);
    return () => window.clearTimeout(timeoutId);
  }, [searchQuery]);

  useEffect(() => {
    const selectInlineMath = (event: Event) => {
      if (!(event instanceof CustomEvent)) {
        return;
      }

      const detail = event.detail as Partial<SelectedInlineMath> | null;
      if (!detail || typeof detail.id !== "string" || typeof detail.tex !== "string" || typeof detail.updateTex !== "function") {
        return;
      }

      const id = detail.id;
      const updateTex = detail.updateTex;
      const setCursor = typeof detail.setCursor === "function" ? detail.setCursor : undefined;
      const cursor = typeof detail.cursor === "number" ? detail.cursor : detail.tex.length;
      const blockId =
        typeof detail.blockId === "string"
          ? detail.blockId
          : getInlineMathBlockIdFromDom(id);

      setSelectedInlineMath({
        id,
        tex: detail.tex,
        cursor,
        blockId,
        setCursor: setCursor
          ? (nextCursor) => {
              setCursor(nextCursor);
              setSelectedInlineMath((current) => (current?.id === id ? { ...current, cursor: nextCursor } : current));
            }
          : undefined,
        updateTex: (tex, nextCursor) => {
          updateTex(tex);
          if (typeof nextCursor === "number") {
            setCursor?.(nextCursor);
          }
          setSelectedInlineMath((current) => (
            current?.id === id
              ? { ...current, tex, cursor: typeof nextCursor === "number" ? nextCursor : current.cursor }
              : current
          ));
        },
      });
      if (blockId) {
        selectedIdRef.current = blockId;
        setSelectedId(blockId);
      }
    };

    window.addEventListener(SELECT_INLINE_MATH_EVENT, selectInlineMath);
    return () => window.removeEventListener(SELECT_INLINE_MATH_EVENT, selectInlineMath);
  }, [setSelectedId, setSelectedInlineMath]);

  useEffect(() => {
    const handleOverlayGraphSelect = (event: Event) => {
      const detail = event instanceof CustomEvent ? (event.detail as SelectedOverlayGraph | null) : null;
      if (!detail) {
        pendingOverlayGraphEditsRef.current = null;
      }
      if (!detail && graphSettingsShapeIdRef.current) {
        // パネル自体は非モーダルなので、その内部を操作してもグラフ選択は維持される。
        // 本文・空白・別図形へ選択が移り detail が null になった時だけ閉じる。
        closeGraphSettings();
      }
      if (detail && graphSettingsShapeIdRef.current && detail.shapeId !== graphSettingsShapeIdRef.current) {
        // 別のグラフへ選択が移ったら閉じる。閉じないと state だけ残り、
        // 元のグラフを選び直したときにパネルが独りでに復活する。
        closeGraphSettings();
      }

      const merged = detail
        ? mergeOverlayGraphDetailWithPending(detail, pendingOverlayGraphEditsRef.current)
        : { detail: null, pending: null };
      pendingOverlayGraphEditsRef.current = merged.pending;
      setSelectedOverlayGraph((current) => (
        areSelectedOverlayGraphsEqual(current, merged.detail) ? current : merged.detail
      ));
    };

    window.addEventListener(SELECT_OVERLAY_GRAPH_EVENT, handleOverlayGraphSelect);
    return () => window.removeEventListener(SELECT_OVERLAY_GRAPH_EVENT, handleOverlayGraphSelect);
  }, [closeGraphSettings]);

  useEffect(() => {
    const handleOverlayChartSelect = (event: Event) => {
      const detail = event instanceof CustomEvent ? (event.detail as SelectedOverlayChart | null) : null;
      if (chartSettingsShapeIdRef.current && (!detail || detail.shapeId !== chartSettingsShapeIdRef.current)) {
        // Selection left this chart: close, or the panel state lingers and the panel reappears by
        // itself the next time the same chart is selected.
        closeChartSettings();
      }
      // The canvas re-dispatches on every commit, so an equal payload must not call `setState` —
      // that is the shell/canvas re-render loop the graph panel already guards against.
      setSelectedOverlayChart((current) => (
        areSelectedOverlayChartsEqual(current, detail) ? current : detail
      ));
    };

    window.addEventListener(SELECT_OVERLAY_CHART_EVENT, handleOverlayChartSelect);
    return () => window.removeEventListener(SELECT_OVERLAY_CHART_EVENT, handleOverlayChartSelect);
  }, [closeChartSettings]);

  useEffect(() => {
    const handleOpenOverlayChartSettings = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail as { shapeId?: unknown } | null : null;
      if (typeof detail?.shapeId === "string") {
        openChartSettings(detail.shapeId);
      }
    };

    window.addEventListener(OPEN_OVERLAY_CHART_SETTINGS_EVENT, handleOpenOverlayChartSettings);
    return () => window.removeEventListener(OPEN_OVERLAY_CHART_SETTINGS_EVENT, handleOpenOverlayChartSettings);
  }, [openChartSettings]);

  useEffect(() => {
    const handleOpenOverlayGraphSettings = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail as { shapeId?: unknown } | null : null;
      if (typeof detail?.shapeId === "string") {
        openGraphSettings(detail.shapeId);
      }
    };

    window.addEventListener(OPEN_OVERLAY_GRAPH_SETTINGS_EVENT, handleOpenOverlayGraphSettings);
    return () => window.removeEventListener(OPEN_OVERLAY_GRAPH_SETTINGS_EVENT, handleOpenOverlayGraphSettings);
  }, [openGraphSettings]);

  useEffect(() => {
    const handleOpenOverlayGraph3DSettings = (event: Event) => {
      const detail = event instanceof CustomEvent
        ? event.detail as { shapeId?: unknown } | null
        : null;
      if (typeof detail?.shapeId === "string") openGraph3DSettings(detail.shapeId);
    };
    window.addEventListener(OPEN_OVERLAY_GRAPH3D_SETTINGS_EVENT, handleOpenOverlayGraph3DSettings);
    return () => window.removeEventListener(OPEN_OVERLAY_GRAPH3D_SETTINGS_EVENT, handleOpenOverlayGraph3DSettings);
  }, [openGraph3DSettings]);

  useEffect(() => {
    const closeTransientUi = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      setActiveMenu(null);
      setExportMenuOpen(false);
      setShapeMenuOpen(false);
      setLineToolMenuOpen(false);
      setFontFamilyMenuOpen(false);
      setBlockStyleMenuOpen(false);
      setFontSizeMenuOpen(false);
      setBoxedTextMenuOpen(false);
      setLineHeightMenuOpen(false);
      setTextAlignMenuOpen(false);
      setLineDashMenuOpen(false);
      setLineWidthMenuOpen(false);
      setLineEndpointMenu(null);
      setColorStylePanel(null);
      setSearchOpen(false);
      setMaterialActionMenu(null);
      // Word風の Backstage も Esc で閉じる（capture ガードは Escape だけ通す）。
      setRibbonBackstage((current) => closeBackstageState(current));
      // 折りたたみ中に浮かせているリボン本体も畳む（折りたたみ自体は解除しない）。
      setRibbonOverlayOpen(false);
    };

    window.addEventListener("keydown", closeTransientUi);
    return () => window.removeEventListener("keydown", closeTransientUi);
  }, []);

  useEffect(() => {
    if (!materialActionMenu) {
      return;
    }

    const closeMenu = () => setMaterialActionMenu(null);
    const closeMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    window.addEventListener("click", closeMenu);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("keydown", closeMenuOnEscape);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("keydown", closeMenuOnEscape);
    };
  }, [materialActionMenu]);

  useEffect(() => {
    const handleCopy = (event: ClipboardEvent) => {
      if (
        !overlayEditing &&
        selectedInlineMath &&
        event.clipboardData &&
        isInlineMathClipboardTarget(event.target) &&
        !isNativeClipboardTarget(event.target)
      ) {
        event.preventDefault();
        writeEditorClipboardData(event.clipboardData, createInlineMathClipboardPayload(selectedInlineMath.tex));
        setStatusMessage(tEditor("status.mathCopied"));
        return;
      }

      if (overlayEditing || isNativeClipboardTarget(event.target) || hasActiveDomSelection()) {
        return;
      }

      const block = getSelectedTopLevelBlock(documentRef.current, selectedIdRef.current);
      if (!block || !event.clipboardData) {
        return;
      }

      // 問題のように本文の連なりに入らないブロックは文書ブロックの payload で運ぶ。
      // 右クリックメニューの「問題をコピー」と同じ荷姿なので、貼り付け先も同じ経路になる。
      event.preventDefault();
      writeEditorClipboardData(
        event.clipboardData,
        isTextFlowClipboardBlock(block)
          ? createTextFlowClipboardPayload([block])
          : createDocumentBlocksClipboardPayload([block]),
      );
      setCanPasteProblem(block.type === "problem");
      setStatusMessage(block.type === "problem" ? tEditor("status.problemCopied") : tEditor("status.bodyBlockCopied"));
    };

    const handlePaste = (event: ClipboardEvent) => {
      if (overlayEditing || !event.clipboardData) {
        return;
      }

      const payload = readEditorClipboardPayload(event.clipboardData) ?? getLocalEditorClipboardPayload();
      const nativeClipboardTarget = isNativeClipboardTarget(event.target);

      // Shapes copied in another material tab. The overlay editor only exists while overlay
      // editing is on, so nothing here can receive them — and the caret sits in the body right
      // after a tab switch, which would otherwise paste the plain-text flavour ("図形 N個") into
      // the text. Requesting the action mounts the overlay and pastes there.
      //
      // Read straight from this event rather than `payload`: the module-level fallback keeps the
      // last sigma copy forever, so after copying shapes any later copy from another app (which
      // writes no sigma payload) would still land here and swallow the user's real paste.
      const pastedShapes = readEditorClipboardPayload(event.clipboardData);
      if (pastedShapes?.kind === "overlayShapes") {
        // The material editor mounts its own overlay canvas whose editing state the shell does not
        // see, so `overlayEditing` is false there. This listener is on the capture phase and would
        // otherwise take the paste away from that canvas and drop the shapes into the document
        // behind the dialog.
        if (materialEditingOpenRef.current) {
          return;
        }

        // A paste into a title/search/composer field or a math editor can only mean text, and this
        // listener cancels the event — without this the field would silently receive nothing after
        // any earlier shape copy. The body editor is deliberately *not* excluded: it is
        // contenteditable, but it is also where a cross-tab shape paste is supposed to land.
        if (isPlainTextClipboardTarget(event.target)) {
          return;
        }

        if (pastedShapes.shapes.length === 0) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        // Built inline rather than through `requestOverlayAction`, which is declared further down
        // and would be a use-before-declaration from this listener.
        overlayActionRequestIdRef.current += 1;
        setOverlayActionRequest({
          id: overlayActionRequestIdRef.current,
          type: "pasteShapes",
          payload: pastedShapes,
        });
        setStatusMessage(pastedShapes.shapes.length === 1
          ? tEditor("status.shapesPasted")
          : tEditor("status.shapesPastedCount", { shapes: pastedShapes.shapes.length }));
        return;
      }

      if (pastedShapes?.kind === "textAndShapes") {
        if (materialEditingOpenRef.current || isPlainTextClipboardTarget(event.target)) {
          return;
        }
        // 本文では TextFlowEditor がテキストを入れ、図形は要求イベントで戻す。
        if (isNativeClipboardTarget(event.target) || pastedShapes.shapes.length === 0) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        overlayActionRequestIdRef.current += 1;
        setOverlayActionRequest({
          id: overlayActionRequestIdRef.current,
          type: "pasteShapes",
          payload: toOverlayShapesClipboardPayload(pastedShapes),
        });
        setStatusMessage(tEditor("status.shapesPastedBodyHint"));
        return;
      }

      if (payload?.kind === "inlineMath") {
        if (overlayEditing || nativeClipboardTarget) {
          return;
        }

        event.preventDefault();
        window.dispatchEvent(new CustomEvent(INSERT_INLINE_MATH_EVENT, { detail: { tex: payload.tex, target: "document" } }));
        setStatusMessage(tEditor("status.mathPasted"));
        return;
      }

      if (payload?.kind === "documentBlocks") {
        event.preventDefault();
        event.stopPropagation();

        const pastedBlocks = cloneDocumentBlocksForPaste(payload.blocks);
        if (pastedBlocks.length === 0) {
          return;
        }

        const insertPastedBlocks = () => {
          commitDocumentChange((current) => insertTopLevelDocumentBlocks(
            current,
            selectedIdRef.current,
            pastedBlocks,
            DOCUMENT_BLOCK_OPERATION_PORTS,
          ));
          const nextSelectedId = pastedBlocks[pastedBlocks.length - 1]?.id ?? null;
          selectedIdRef.current = nextSelectedId;
          setSelectedId(nextSelectedId);
          setSelectedInlineMath(null);
          setStatusMessage(pastedBlocks.length === 1 && pastedBlocks[0]?.type === "problem"
            ? tEditor("status.problemPasted")
            : tEditor("status.blockPasted"));
        };

        if (isMultiEditorTextRunSpan()) {
          // 跨ぎ選択への貼り付け。文書ブロックは PM の doc へ入れられないので、先に選択を
          // 消して (ユニットごとの onChange を通る書き込み)、挿入はその commit が
          // `documentRef` へ着いたあとのイベントへ回す。
          replaceActiveTextRunSpan([]);
          window.setTimeout(insertPastedBlocks, 0);
          return;
        }

        insertPastedBlocks();
        return;
      }

      if (nativeClipboardTarget) {
        return;
      }

      if (payload?.kind !== "textFlowBlocks") {
        return;
      }

      const pastedBlocks = cloneTextFlowBlocksForPaste(payload.blocks);
      if (pastedBlocks.length === 0) {
        return;
      }

      event.preventDefault();
      commitDocumentChange((current) => insertTopLevelTextFlowBlocks(current, selectedIdRef.current, pastedBlocks));
      const nextSelectedId = pastedBlocks[pastedBlocks.length - 1]?.id ?? null;
      selectedIdRef.current = nextSelectedId;
      setSelectedId(nextSelectedId);
      setSelectedInlineMath(null);
      setStatusMessage(tEditor("status.bodyBlockPasted"));
    };

    window.addEventListener("copy", handleCopy);
    window.addEventListener("paste", handlePaste, true);
    return () => {
      window.removeEventListener("copy", handleCopy);
      window.removeEventListener("paste", handlePaste, true);
    };
  }, [commitDocumentChange, overlayEditing, selectedInlineMath, setSelectedId, setSelectedInlineMath, setStatusMessage]);

  // 画面のアウトラインは表示言語で引く (`t` を省略すると `collectOutline` の既定 =
  // 日本語になる。既定が日本語なのは AI / MCP の呼び出しを固定するため)。
  // 画面のアウトラインは表示言語で引く (`t` を省略すると `collectOutline` の既定 =
  // 日本語になる。既定が日本語なのは AI / MCP の呼び出しを固定するため)。
  const outline = useMemo(
    () => collectOutline(document, { t: tE, includeLayoutHeadings: true }),
    [document, tE],
  );
  const outlineHeadingNumbers = useMemo(
    () => getHeadingNumberMap(document.content, document.metadata.headingNumbering),
    [document.content, document.metadata.headingNumbering],
  );
  // コメント装飾は本文ユニットごとの effect で更新されるので、コメントの無い文書で
  // 毎回新しい空配列を渡すと打鍵のたびにユニット数だけ無駄な更新が走る。
  const commentThreads = document.comments ?? EMPTY_COMMENT_THREADS;
  const updateActivePageFromScroll = useCallback(() => {
    const nextPageNumber = getVisibleEditorPageNumber(editorCanvasRef.current, documentRef.current, zoom);
    if (!nextPageNumber) {
      return;
    }

    setActivePageNumber((current) => current === nextPageNumber ? current : nextPageNumber);
  }, [zoom]);
  const scrollToPage = useCallback((pageNumber: number) => {
    if (!scrollEditorCanvasToPage(editorCanvasRef.current, documentRef.current, zoom, pageNumber)) {
      return;
    }

    setActivePageNumber(pageNumber);
  }, [zoom]);
  const selectOutlineItem = useCallback((blockId: string) => {
    setSelectedInlineMath(null);
    if (blockId !== selectedIdRef.current) {
      setAiEditReference(null);
    }
    selectedIdRef.current = blockId;
    materialBlockSelectionRef.current = blockId;
    setSelectedId(blockId);
    setOutlineDialogOpen(false);
    window.document.getElementById(blockId)?.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
  }, [setSelectedId, setSelectedInlineMath]);

  useEffect(() => {
    if (!workspaceReady) {
      return;
    }

    const scroller = editorCanvasRef.current;
    if (!scroller) {
      return;
    }

    let frame = 0;
    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updateActivePageFromScroll);
    };

    scheduleUpdate();
    scroller.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      window.cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [
    activeFileId,
    document.content.length,
    document.pageLayout,
    updateActivePageFromScroll,
    workspaceReady,
  ]);

  const selectedBlock = useMemo(() => {
    return selectedId ? findBlock(document, selectedId) : null;
  }, [document, selectedId]);
  const isBoxTitleTextTarget =
    selectedBlock?.type === "boxBlock" &&
    documentTextFormatTarget?.enabled === true &&
    documentTextFormatTarget.nodeType === "boxBlockTitle" &&
    documentTextFormatTarget.blockId === selectedBlock.id;
  const isCodeBlockTextTarget =
    selectedBlock?.type === "codeBlock" &&
    documentTextFormatTarget?.enabled === true &&
    documentTextFormatTarget.nodeType === "codeBlock" &&
    documentTextFormatTarget.blockId === selectedBlock.id;
  const visibleMaterials = useMemo(() => {
    return materials.filter((material) => materialMatchesQuery(material, materialSearch));
  }, [materialSearch, materials]);
  const materialActionMenuItem = useMemo(
    () => materialActionMenu ? materials.find((candidate) => candidate.id === materialActionMenu.materialId) ?? null : null,
    [materialActionMenu, materials],
  );
  const materialEditingItem = useMemo(
    () => materialEditingId ? materials.find((candidate) => candidate.id === materialEditingId) ?? null : null,
    [materialEditingId, materials],
  );
  const canFormatSelectedText =
    selectedBlock?.type === "section" ||
    selectedBlock?.type === "paragraph" ||
    selectedBlock?.type === "heading" ||
    selectedBlock?.type === "listItem" ||
    // コードブロックも run 単位の書式を持つ。ここに無いとキャレットを入れた瞬間に
    // **ツールバーが丸ごと無効**になり、コードを解除するボタンすら押せなくなる。
    selectedBlock?.type === "codeBlock" ||
    isBoxTitleTextTarget ||
    // チャンクを跨ぐ選択中は、selectedId がどのブロックを指していても本文の書式適用先が
    // 確実にある (適用は FORMAT_TEXT_EVENT → applyTextRunSpanFormat の span 経路)。
    hasMultiEditorTextRunSpan;
  const selectedTextStyle =
    selectedBlock?.type === "section"
      ? "h1"
      : selectedBlock?.type === "heading"
      ? `h${selectedBlock.level}`
      : selectedBlock?.type === "paragraph" || selectedBlock?.type === "listItem"
        ? "paragraph"
        : "";
  const canAlignSelectedText =
    selectedBlock?.type === "section" ||
    selectedBlock?.type === "paragraph" ||
    selectedBlock?.type === "heading" ||
    selectedBlock?.type === "listItem";
  const selectedTextAlign = canAlignSelectedText ? selectedBlock.align ?? "left" : "left";
  const activeTextAlignOption = TEXT_ALIGN_OPTIONS.find((option) => option.value === selectedTextAlign) ?? TEXT_ALIGN_OPTIONS[0];
  const ActiveTextAlignIcon = activeTextAlignOption.icon;
  const customFontOptions = useMemo(
    () => customFonts.map((font) => ({ label: font.displayName, value: font.cssFamily })),
    [customFonts],
  );
  const visibleFontFamilyGroups = useMemo(
    () => filterFontFamilyGroups(fontFamilyQuery, (group) => t(`format.font.group.${group.id}`)),
    [fontFamilyQuery, t],
  );
  const visibleCustomFontOptions = useMemo(() => {
    const query = fontFamilyQuery.trim().toLocaleLowerCase("ja");
    if (!query) {
      return customFontOptions;
    }
    return customFontOptions.filter((option) => (
      `${option.label} ${option.value}`.toLocaleLowerCase("ja").includes(query)
    ));
  }, [customFontOptions, fontFamilyQuery]);
  const activeFontFamilyLabel = getFontFamilyLabel(fontFamily, customFontOptions);
  // Empty = the selection mixes fonts, so there is no "current font" to show. Without this the
  // dropdown would render a nameless row marked as the checked option.
  const fontFamilyIsMixed = fontFamily === "";
  const fontFamilyIsKnownOption = fontFamilyIsMixed
    || FONT_FAMILY_OPTION_VALUES.has(fontFamily)
    || customFontOptions.some((option) => option.value === fontFamily);
  const hasOverlaySelection = overlaySelection.selectedCount > 0;
  const hasSingleOverlayTextSelection = overlaySelection.selectedShapes.length === 1 && (
    overlaySelection.selectedShapes[0]?.type === "text" ||
    overlaySelection.selectedShapes[0]?.type === "callout"
  );
  // ツールバーは「いま選んでいる対象がAIに握られているか」で出し分ける。教材のどこかで
  // AIが動いていても、ロック対象外を選んでいる限り書式や図形スタイルは操作できる。
  const aiLockedBodySelection = isAiLockedBlock(aiLockedTargets, selectedId);
  const aiLockedOverlaySelection = isAiLockedShapeSelection(
    aiLockedTargets,
    overlaySelection.selectedShapeIds,
  );
  const bodyToolbarLockedByAi = aiDocumentWriteInProgress || aiLockedBodySelection;
  const overlayToolbarLockedByAi = aiDocumentWriteInProgress || aiLockedOverlaySelection;
  const canUseDocumentTextToolbar = !bodyToolbarLockedByAi && (canFormatSelectedText || !!runningRegionEditingKind);
  const canUseOverlayTextToolbar = !overlayToolbarLockedByAi && overlayEditing && hasSingleOverlayTextSelection;
  const canUseTextToolbar = canUseDocumentTextToolbar || canUseOverlayTextToolbar;
  const canUseLineHeight = canUseOverlayTextToolbar
    || (canUseDocumentTextToolbar && !isBoxTitleTextTarget && !isCodeBlockTextTarget);
  const activeTextFontSize = canUseOverlayTextToolbar && (
    overlaySelection.selectedShapes[0]?.type === "text" ||
    overlaySelection.selectedShapes[0]?.type === "callout"
  )
    ? getTextShapeFontSizePt(overlaySelection.selectedShapes[0])
    : textFontSize;
  const canUseTextBlockStyle = !overlayEditing && canUseDocumentTextToolbar && !isBoxTitleTextTarget;
  /**
   * ブロックのボタン (箇条書き・番号付き・引用・コード・区切り線) を押せるか。
   *
   * **いま居るブロックを解除するのも、このボタンの仕事**。だから「文章の書式が使える対象か」
   * (`canUseTextBlockStyle`) だけで閉じてはいけない — 区切り線そのものを選んでいるときのように、
   * 文字書式の対象ではないが解除はしたい状態がある。ブロックの中に居ることが分かっていれば通す。
   */
  const canUseBlockStructure = canUseOverlayTextToolbar
    || canUseTextBlockStyle
    || (!overlayEditing && !bodyToolbarLockedByAi && (
      blockStyleState.onDivider
      || blockStyleState.inQuoteBlock
      || blockStyleState.inCodeBlock
      || blockStyleState.listType !== null
    ));
  const canUseTextAlign = overlayEditing
    ? canUseOverlayTextToolbar
    : !bodyToolbarLockedByAi && (canAlignSelectedText || !!runningRegionEditingKind);
  const canUseStrokeStyleControls = !overlayToolbarLockedByAi && hasOverlaySelection && overlaySelection.canStyleStroke;
  const canArrangeOverlayShapes = !overlayToolbarLockedByAi && hasOverlaySelection && !overlaySelection.locked;
  const canUseFillStyleControls = !overlayToolbarLockedByAi && hasOverlaySelection && overlaySelection.canStyleFill;
  // The selection's own fill, not the last value the toolbar applied: reopening the palette on a
  // saved figure has to show what that figure stores, and a disagreeing selection has to show
  // nothing rather than one shape's value.
  const selectionFill = overlaySelection.fill;
  const selectionFillColor = selectionFill.kind === "solid" ? selectionFill.fillColor : null;
  const selectionFillOpacity = selectionFill.kind === "solid" ? selectionFill.fillOpacity : DEFAULT_FILL_OPACITY;
  /**
   * A colour-only change (a swatch, a shortcut, a custom command).
   *
   * `fillOpacity` is deliberately omitted so the figure keeps the transparency it already has —
   * except when that transparency is 0, where keeping it would answer a colour choice with no
   * visible change at all and no way to find out why.
   */
  const fillColorPatch = (color: string): OverlaySelectionStylePatch => (
    selectionFill.kind === "solid" && selectionFill.fillOpacity === 0
      ? { fill: "solid", fillColor: color, fillOpacity: DEFAULT_FILL_OPACITY }
      : { fill: "solid", fillColor: color }
  );
  const canUseLineStyleControls = !overlayToolbarLockedByAi && hasOverlaySelection && overlaySelection.canStyleLine;
  const canUseLineEndpointControls = !overlayToolbarLockedByAi && hasOverlaySelection && overlaySelection.canStyleLineEndpoints;

  const selectedOverlayLineDash = useMemo(
    () => getSharedOverlayLineDash(overlaySelection.selectedShapes),
    [overlaySelection.selectedShapes],
  );
  const selectedOverlayLineSize = useMemo(
    () => getSharedOverlayLineSize(overlaySelection.selectedShapes),
    [overlaySelection.selectedShapes],
  );
  // 打鍵ごとに走る `renderEditorChrome` へ渡るので、言語が変わったときだけ組み直す。
  const lineToolItems = useMemo(() => buildLineToolItems(tShapeChrome), [tShapeChrome]);
  const shapeGallerySections = useMemo(() => buildShapeGallerySections(tShapeChrome), [tShapeChrome]);
  const activeLineToolItem =
    activeOverlayTool.kind === "insert" && isLineToolCommand(activeOverlayTool.command)
      ? lineToolItems.find((item) => item.command === activeOverlayTool.command) ?? lineToolItems[0]
      : lineToolItems[0];
  const ActiveLineToolIcon = activeLineToolItem.icon;
  const zoomOptions = useMemo(() => {
    return ZOOM_PRESETS.includes(zoom as (typeof ZOOM_PRESETS)[number])
      ? ZOOM_PRESETS
      : [...ZOOM_PRESETS, zoom].sort((a, b) => a - b);
  }, [zoom]);

  const effectiveLineEndpointMenu = canUseLineEndpointControls ? lineEndpointMenu : null;
  const effectiveLineDashMenuOpen = canUseLineStyleControls && lineDashMenuOpen;
  const effectiveLineWidthMenuOpen = canUseLineStyleControls && lineWidthMenuOpen;
  const updateInlineMathTexFromDetails = useCallback((mathInlineId: string, tex: string, cursor?: number) => {
    if (!mathInlineId) {
      return;
    }

    commitDocumentChange((current) => updateInlineMathTexInDocument(current, mathInlineId, tex));
    setSelectedInlineMath((current) => (
      current?.id === mathInlineId
        ? { ...current, tex, cursor: typeof cursor === "number" ? cursor : current.cursor }
        : current
    ));
  }, [commitDocumentChange, setSelectedInlineMath]);
  const selectedInlineMathDetails = useMemo((): SelectedInlineMath | null => {
    if (!selectedInlineMath) {
      return null;
    }

    return {
      ...selectedInlineMath,
      updateTex: (tex, cursor) => {
        const restoredSelection: SelectedInlineMath = {
          ...selectedInlineMath,
          tex,
          cursor: typeof cursor === "number" ? cursor : selectedInlineMath.cursor,
        };
        updateInlineMathDraft(selectedInlineMath.id, tex, cursor);
        updateInlineMathTexFromDetails(selectedInlineMath.id, tex, cursor);
        window.setTimeout(() => {
          setSelectedInlineMath((current) => (
            current?.id === selectedInlineMath.id
              ? { ...current, tex, cursor: typeof cursor === "number" ? cursor : current.cursor }
              : restoredSelection
          ));
        }, 0);
      },
    };
  }, [selectedInlineMath, setSelectedInlineMath, updateInlineMathTexFromDetails]);

  useEffect(() => {
    if (selectedInlineMath) {
      return;
    }

    const timeoutId = window.setTimeout(() => setInlineMathMenuOpen(false), 0);
    return () => window.clearTimeout(timeoutId);
  }, [selectedInlineMath]);
  const selectedOverlayGraphForSettings = useMemo((): SelectedOverlayGraph | null => {
    if (!selectedOverlayGraph) {
      return null;
    }

    return {
      ...selectedOverlayGraph,
      onAxisLabelChange: (key, visible) => {
        recordPendingAxisLabelEdit(
          selectedOverlayGraph.shapeId,
          key,
          { visible },
        );
        setSelectedOverlayGraph((current) => {
          if (!current || current.shapeId !== selectedOverlayGraph.shapeId) {
            return current;
          }

          return applyOverlayGraphAxisLabelEdit(current, key, { visible });
        });
        selectedOverlayGraph.onAxisLabelChange(key, visible);
      },
      onAxisLabelTextChange: (key, text) => {
        const edit = {
          visible: Boolean(text.trim()),
          text,
        };
        recordPendingAxisLabelEdit(
          selectedOverlayGraph.shapeId,
          key,
          edit,
        );
        setSelectedOverlayGraph((current) => {
          if (!current || current.shapeId !== selectedOverlayGraph.shapeId) {
            return current;
          }

          return applyOverlayGraphAxisLabelEdit(current, key, edit);
        });
        selectedOverlayGraph.onAxisLabelTextChange(key, text);
      },
      onSpecChange: (nextSpec) => {
        recordPendingSpecEdit(
          selectedOverlayGraph.shapeId,
          nextSpec,
        );
        setSelectedOverlayGraph((current) => {
          if (!current || current.shapeId !== selectedOverlayGraph.shapeId) {
            return current;
          }

          return areGraphSpecsEqual(current.spec, nextSpec) ? current : { ...current, spec: nextSpec };
        });
        selectedOverlayGraph.onSpecChange(nextSpec);
      },
    };
  }, [recordPendingAxisLabelEdit, recordPendingSpecEdit, selectedOverlayGraph]);
  // The ref-backed callbacks on this value run only from panel events, never while rendering.
  const overlayGraphSettingsDialog = graphSettingsShapeId
    // eslint-disable-next-line react-hooks/refs
    && selectedOverlayGraphForSettings?.shapeId === graphSettingsShapeId
    ? (
        <GraphSettingsPanel
          selectedOverlayGraph={selectedOverlayGraphForSettings}
          onClose={closeGraphSettings}
        />
      )
    : null;
  const overlayChartSettingsDialog = chartSettingsShapeId
    && selectedOverlayChart?.shapeId === chartSettingsShapeId
    ? (
        <ChartSettingsPanel
          chart={selectedOverlayChart}
          onClose={closeChartSettings}
          onSpecChange={(_shapeId, spec) => selectedOverlayChart.onSpecChange(spec)}
        />
      )
    : null;
  // spec の購読はホスト側に閉じている。ここで持つとリボンごと再レンダーされる。
  const overlayGraph3DSettingsDialog = (
    <Graph3DSettingsPanelHost
      shapeId={graph3DSettingsShapeId}
      onClose={closeGraph3DSettings}
      onUndo={undoDocumentChange}
      onRedo={redoDocumentChange}
    />
  );

  const writeOverlay = (overlay: PageOverlay, options?: OverlayChangeOptions) => {
    commitDocumentChange((current) => {
      const withLayout = ensurePageLayout(current);
      const layout = withLayout.pageLayout!;

      return {
        ...withLayout,
        pageLayout: {
          ...layout,
          overlay,
        },
        updatedAt: new Date().toISOString(),
      };
    }, options?.history === "coalesce" ? { coalesce: true } : undefined);
  };

  const updateOverlay = (overlay: PageOverlay, options?: OverlayChangeOptions) => writeOverlay(overlay, options);
  // Automatic re-anchor after a deletion: coalesce into the deletion's undo entry.
  const reanchorOverlay = (overlay: PageOverlay) => writeOverlay(overlay, { history: "coalesce" });

  const flushOverlayChanges = () => {
    window.dispatchEvent(new CustomEvent(FLUSH_OVERLAY_CHANGES_EVENT));
  };

  const openPrintPreview = () => {
    flushOverlayChanges();
    setPreviewOpen(true);
  };

  const printEmbeddedPreview = async () => {
    try {
      setSaveState("saving");
      setStatusMessage(tEditor("status.preparingPrint"));
      const saveResult = await saveCurrentDocumentRecord();
      if (!saveResult.ok) {
        setSaveState("error");
        setStatusMessage(saveResult.error ?? tEditor("status.saveFailed"));
        return;
      }
      setSaveState("saved");
      setStatusMessage(tEditor("status.browserPrintOpened"));
      window.print();
    } catch (error) {
      setSaveState("error");
      setStatusMessage(error instanceof Error ? error.message : tEditor("status.printOpenFailed"));
    }
  };

  const exportPdf = async () => {
    setPdfExporting(true);
    if (isEmbedded) {
      await printEmbeddedPreview();
      setPdfExporting(false);
      return;
    }

    const bridge = getDesktopBridge();
    if (!isDesktopApp || !bridge?.file.exportPdf) {
      openPrintPreview();
      setStatusMessage(tEditor("status.pdfDesktopOnly"));
      setPdfExporting(false);
      return;
    }

    try {
      if (printPreviewRenderState.state !== "ready") {
        setStatusMessage(tEditor("status.pdfPreviewNotReady"));
        return;
      }
      setSaveState("saving");
      setStatusMessage(tEditor("status.pdfExporting"));
      const saveResult = await saveCurrentDocumentRecord();
      if (!saveResult.ok) {
        setSaveState("error");
        setStatusMessage(saveResult.error ?? tEditor("status.saveFailed"));
        return;
      }

      const result = await bridge.file.exportPdf({
        suggestedName: suggestedPdfFileName(resolveDocumentTitle(documentRef.current)),
        surfaceId: printPreviewRenderState.surfaceId,
        revision: printPreviewRenderState.revision,
        pageCount: printPreviewRenderState.pageCount,
        pageWidthMm: printPreviewRenderState.pageWidthMm,
        pageHeightMm: printPreviewRenderState.pageHeightMm,
      });
      if (result) {
        setSaveState("saved");
        setStatusMessage(tEditor("status.pdfExported", { path: result.filePath }));
        setExportedPdfPath(result.filePath);
      } else {
        setSaveState("saved");
        setStatusMessage(tEditor("status.pdfExportCancelled"));
      }
    } catch (error) {
      setSaveState("error");
      setStatusMessage(error instanceof Error ? error.message : tEditor("status.pdfExportFailed"));
    } finally {
      setPdfExporting(false);
    }
  };

  const openPrintWindow = async () => {
    flushOverlayChanges();
    if (isEmbedded) {
      await printEmbeddedPreview();
      return;
    }

    if (isDesktopApp) {
      setPreviewOpen(true);
      setStatusMessage(tEditor("status.pdfPreviewOpened"));
      return;
    }
    await saveCurrentDocumentRecord();
    window.open(
      getAppRouteHref("/print", { fileId: activeFileIdRef.current, profile: "teacher" }),
      "_blank",
      "noopener,noreferrer",
    );
  };

  const addBlock = (type: SigmaBlock["type"]) => {
    // 箱は「前に決めた見た目」で入る (設定ダイアログで変えた色や罫がそのまま次にも効く)。
    const block = applyRememberedBoxFrame(createBlock(type, tEditor));
    let insertedBodyBlockId: string | null = null;
    commitDocumentChange((current) => {
      const next = block.type === "problem"
        ? insertTopLevelBlockReplacingEmptySelection(current, block, selectedId)
        : insertTopLevelBlock(current, block, selectedId);
      if (block.type !== "problem") {
        return next;
      }

      const result = ensureBodyBlockAfterProblem(next, block.id);
      insertedBodyBlockId = result.bodyBlock?.id ?? null;
      return result.document;
    });
    setSelectedInlineMath(null);
    const nextSelectedId = insertedBodyBlockId ?? block.id;
    selectedIdRef.current = nextSelectedId;
    setSelectedId(nextSelectedId);
    if (insertedBodyBlockId) {
      scheduleEditorBlockFocus(insertedBodyBlockId);
      return;
    }
    if (block.type === "heading" || block.type === "paragraph" || block.type === "section") {
      scheduleEditorBlockFocus(block.id);
    }
  };

  // 本文の /problem コマンドから問題を差し込む。memo 済みユニットへ渡るコールバックの
  // 依存に入るので、識別子を安定させる (中身は documentRef / 安定コールバックしか読まない)。
  const insertProblemFromTextFlowCommand = useCallback((triggerBlockId: string): boolean => {
    if (!findBlock(documentRef.current, triggerBlockId)) {
      return false;
    }

    const problem = createBlock("problem", tEditor);
    window.setTimeout(() => {
      let insertedBodyBlockId: string | null = null;
      commitDocumentChange((current) => {
        if (!findBlock(current, triggerBlockId)) {
          return current;
        }
        const next = insertTopLevelBlockReplacingEmptySelection(current, problem, triggerBlockId);
        const result = ensureBodyBlockAfterProblem(next, problem.id);
        insertedBodyBlockId = result.bodyBlock?.id ?? null;
        return result.document;
      });
      setSelectedInlineMath(null);
      const nextSelectedId = insertedBodyBlockId ?? problem.id;
      selectedIdRef.current = nextSelectedId;
      setSelectedId(nextSelectedId);
      if (insertedBodyBlockId) {
        scheduleEditorBlockFocus(insertedBodyBlockId);
      }
      setStatusMessage(tEditor("status.problemInserted"));
    }, 0);
    return true;
  }, [commitDocumentChange, setSelectedId, setSelectedInlineMath, setStatusMessage]);

  const wrapBlockInColumns = (blockIds: string[], columnCount: number) => {
    const focusBlockId = blockIds[0] ?? null;
    if (!focusBlockId) {
      return;
    }
    commitDocumentChange((current) => wrapTextFlowBlocksInLayoutSection(current, blockIds, columnCount));
    setSelectedInlineMath(null);
    selectedIdRef.current = focusBlockId;
    setSelectedId(focusBlockId);
    scheduleEditorBlockFocus(focusBlockId);
  };

  const unwrapColumns = (sectionId: string) => {
    const section = findContainingLayoutSection(documentRef.current, sectionId);
    const focusBlockId = section?.children[0]?.id ?? selectedIdRef.current;
    commitDocumentChange((current) => unwrapLayoutSection(current, sectionId));
    setSelectedInlineMath(null);
    selectedIdRef.current = focusBlockId;
    setSelectedId(focusBlockId);
    if (focusBlockId) {
      scheduleEditorBlockFocus(focusBlockId);
    }
  };

  const getActiveTextTarget = (): "document" | "overlay" | "comment" => {
    if (typeof window !== "undefined" && window.document.activeElement?.closest(".comment-thread-panel")) {
      return "comment";
    }
    return overlayEditing ? "overlay" : "document";
  };

  const insertInlineMath = (tex: string, target: "document" | "overlay" | "comment" = "document", edit = true) => {
    window.dispatchEvent(new CustomEvent(INSERT_INLINE_MATH_EVENT, { detail: { tex, target, edit } }));
  };

  const cancelInlineMathMenuClose = () => {
    if (inlineMathMenuCloseTimeoutRef.current !== null) {
      window.clearTimeout(inlineMathMenuCloseTimeoutRef.current);
      inlineMathMenuCloseTimeoutRef.current = null;
    }
  };

  const openInlineMathMenu = () => {
    cancelInlineMathMenuClose();
    setInlineMathMenuOpen(true);
  };

  const scheduleInlineMathMenuClose = () => {
    cancelInlineMathMenuClose();
    inlineMathMenuCloseTimeoutRef.current = window.setTimeout(() => {
      inlineMathMenuCloseTimeoutRef.current = null;
      setInlineMathMenuOpen(false);
    }, 120);
  };

  const startInlineMathFromToolbar = () => {
    cancelInlineMathMenuClose();
    setShapeMenuOpen(false);
    setLineToolMenuOpen(false);
    setFontFamilyMenuOpen(false);
    setBlockStyleMenuOpen(false);
    setFontSizeMenuOpen(false);
    setBoxedTextMenuOpen(false);
    setLineHeightMenuOpen(false);
    setTextAlignMenuOpen(false);
    setLineDashMenuOpen(false);
    setLineWidthMenuOpen(false);
    setColorStylePanel(null);
    setLineEndpointMenu(null);

    setInlineMathMenuOpen(false);
    insertInlineMath("", getActiveTextTarget());
    setStatusMessage(tEditor("status.mathAdded"));
  };

  // memo 済みの本文ユニットへ渡るので識別子を固定する (中身は commitDocumentChange だけを読む)。
  const updateBlock = useCallback((
    blockId: string,
    updater: (block: SigmaBlock | RichBlock) => SigmaBlock | RichBlock,
    context?: TextFlowChangeContext,
  ) => {
    commitDocumentChange(
      (current) => updateBlockInDocument(
        current,
        blockId,
        (block: EditableBlock) => block.type === "listItem" ? block : updater(block),
      ),
      context?.historyGroup ? { historyGroup: context.historyGroup } : undefined,
    );
  }, [commitDocumentChange]);

  /**
   * 本文を空にした削除は、補われた空段落へキャレットを連れて行く。空段落があっても焦点が
   * 無ければ「消したら打っても何も出ない」ままなので、削除の続きにそのまま書ける Word と
   * 同じ手触りにする。書き込みが AI ロックで弾かれたときは補いも起きないので、実際に文書へ
   * 入ったことを確かめてから焦点を移す。
   */
  const focusBodyFallback = (fallbackBlockId: string | null) => {
    if (!fallbackBlockId || !findBlock(documentRef.current, fallbackBlockId)) {
      return;
    }
    selectedIdRef.current = fallbackBlockId;
    setSelectedId(fallbackBlockId);
    scheduleEditorBlockFocus(fallbackBlockId);
  };

  const removeBlock = (blockId: string) => {
    let fallbackBlockId: string | null = null;
    commitDocumentChange((current) => {
      const ensured = ensureEditableBody(removeBlockFromDocument(current, blockId));
      fallbackBlockId = ensured.bodyBlock?.id ?? null;
      return ensured.document;
    });
    setSelectedId((current) => (current === blockId ? null : current));
    focusBodyFallback(fallbackBlockId);
  };

  /**
   * Deletes body blocks outright, without first emptying their text. Anything the user can
   * point at is fair game — top-level blocks, blocks inside a column section or a box, and
   * the blocks of a problem area — so the caller does not have to know where a block lives.
   */
  const removeBlocks = (blockIds: string[]) => {
    const removableIds = blockIds.filter((id) => {
      const block = findBlock(documentRef.current, id);
      return !!block && block.type !== "listItem";
    });
    if (removableIds.length === 0) {
      return;
    }

    let fallbackBlockId: string | null = null;
    commitDocumentChange((current) => {
      const ensured = ensureEditableBody(deleteBlocksFromDocument(current, removableIds));
      fallbackBlockId = ensured.bodyBlock?.id ?? null;
      return ensured.document;
    });
    setSelectedInlineMath(null);
    setSelectedId((current) => (current && removableIds.includes(current) ? null : current));
    focusBodyFallback(fallbackBlockId);
    setStatusMessage(removableIds.length > 1 ? tEditor("status.bodyDeleted") : tEditor("status.blockDeleted"));
  };

  /** Adds an empty paragraph next to `anchorBlockId`, or at the end when it is null. */
  const insertBodyBlockAt = (anchorBlockId: string | null, position: "before" | "after") => {
    // Clicking the blank strip under the text repeatedly must not stack empty paragraphs:
    // if the document already ends in one, that is the spot the user is asking for.
    if (anchorBlockId === null && position === "after") {
      const lastBlock = documentRef.current.content.at(-1);
      if (lastBlock && isEmptyTopLevelTextFlowBlock(lastBlock)) {
        selectedIdRef.current = lastBlock.id;
        setSelectedId(lastBlock.id);
        scheduleEditorBlockFocus(lastBlock.id);
        return;
      }
    }

    const block = createBlock("paragraph", tEditor);
    commitDocumentChange((current) => (
      position === "before"
        ? insertTopLevelDocumentBlocksBefore(current, anchorBlockId, [block], DOCUMENT_BLOCK_OPERATION_PORTS)
        : insertTopLevelDocumentBlocks(current, anchorBlockId, [block], DOCUMENT_BLOCK_OPERATION_PORTS)
    ));
    setSelectedInlineMath(null);
    selectedIdRef.current = block.id;
    setSelectedId(block.id);
    scheduleEditorBlockFocus(block.id);
  };

  const copyBlockToClipboard = (blockId: string) => {
    const block = findBlock(documentRef.current, blockId);
    if (!block || block.type === "listItem") {
      return;
    }

    void writeEditorPayloadToSystemClipboard(createDocumentBlocksClipboardPayload([block])).then((copied) => {
      setCanPasteProblem(copied && block.type === "problem");
      setStatusMessage(copied
        ? block.type === "problem"
          ? tEditor("status.problemCopied")
          : block.type === "boxBlock" ? tEditor("status.boxCopied") : tEditor("status.blockCopied")
        : tEditor("status.copyFailed"));
    });
  };

  const pasteBlockFromClipboard = useCallback((blockId: string, position: "before" | "after") => {
    const payload = getLocalEditorClipboardPayload();
    if (payload?.kind !== "documentBlocks") {
      setStatusMessage(tEditor("status.nothingToPaste"));
      return;
    }

    const pastedBlocks = cloneDocumentBlocksForPaste(payload.blocks);
    if (pastedBlocks.length === 0) {
      setStatusMessage(tEditor("status.nothingToPaste"));
      return;
    }

    commitDocumentChange((current) => (
      position === "before"
        ? insertTopLevelDocumentBlocksBefore(
            current,
            blockId,
            pastedBlocks,
            DOCUMENT_BLOCK_OPERATION_PORTS,
          )
        : insertTopLevelDocumentBlocks(
            current,
            blockId,
            pastedBlocks,
            DOCUMENT_BLOCK_OPERATION_PORTS,
          )
    ));
    const nextSelectedId = pastedBlocks[pastedBlocks.length - 1]?.id ?? null;
    selectedIdRef.current = nextSelectedId;
    setSelectedId(nextSelectedId);
    setSelectedInlineMath(null);
    setStatusMessage(pastedBlocks.length === 1 && pastedBlocks[0]?.type === "problem"
      ? tEditor("status.problemPasted")
      : tEditor("status.blockPasted"));
  }, [commitDocumentChange, setSelectedId, setSelectedInlineMath, setStatusMessage]);

  const captureMaterialBlockSelectionFromDom = useCallback(() => {
    const selection = window.getSelection();
    const anchorElement = selection?.anchorNode
      ? selection.anchorNode.nodeType === Node.ELEMENT_NODE
        ? selection.anchorNode as Element
        : selection.anchorNode.parentElement
      : null;
    const blockId = anchorElement?.closest<HTMLElement>("[data-sigma-doc-id]")?.getAttribute("data-sigma-doc-id") ?? null;
    const block = blockId ? findBlock(documentRef.current, blockId) : null;
    if (block && block.type !== "listItem") {
      materialBlockSelectionRef.current = blockId;
    }
    return materialBlockSelectionRef.current;
  }, []);

  const getSelectedMaterialContent = useCallback((
    targetBlockId?: string | null,
    targetBlockIds?: readonly string[],
  ): MaterialContent | null => {
    const currentDocument = documentRef.current;
    // `overlaySelection` の state はグラフの spec 差し替えでは進めない (シェルの再レンダーを
    // 避けるため)。素材にはその瞬間の spec が要るので、必ず ref 側を読む。
    const currentSelection = overlaySelectionRef.current;
    const selectedBlockId = targetBlockId === undefined
      ? currentSelection.selectedShapes.length > 0
        ? materialBlockSelectionRef.current
        : selectedIdRef.current ?? materialBlockSelectionRef.current
      : targetBlockId;
    return buildSelectedMaterialContent(
      currentDocument,
      selectedBlockId,
      currentSelection.selectedShapes,
      currentSelection.selectedAssets,
      targetBlockIds,
    );
  }, []);

  const createMaterialFromContent = useCallback(async (content: MaterialContent, requestedName: string, metadataDraft?: MaterialMetadataDraft) => {
    const fallbackName = content.blocks[0] ? getMaterialNameFromBlock(content.blocks[0], tWorkspace) : tEditor("material.shapeMaterial");
    const name = requestedName.trim() || fallbackName;
    setMaterialsLoading(true);
    try {
      const metadata = normalizeMaterialMetadata({
        ...materialMetadataDraftToInput(metadataDraft ?? createEmptyMaterialMetadataDraft()),
        transformPolicy: content.overlaySnapshot.shapes.length > 0 ? { scale: true, rotate: false } : undefined,
        ports: content.overlaySnapshot.shapes.length > 0 ? inferDefaultMaterialPorts(content) : undefined,
      });
      const material = await getAppRuntime().materials.createMaterial({ name, ...metadata, content });
      setMaterials((current) => mergeOfficialMaterials([
        material,
        ...current.filter((item) => !isOfficialMaterial(item) && item.id !== material.id),
      ]));
      setMaterialError(null);
      setStatusMessage(tEditor("status.materialSaved"));
      return material;
    } catch (error) {
      setMaterialError(error instanceof Error ? error.message : tEditor("status.materialSaveFailed"));
      return null;
    } finally {
      setMaterialsLoading(false);
    }
  }, [setStatusMessage]);

  const saveSelectedMaterial = useCallback(async () => {
    const content = getSelectedMaterialContent();
    if (!content || (content.blocks.length === 0 && content.overlaySnapshot.shapes.length === 0)) {
      setMaterialError(tEditor("status.selectMaterialSource"));
      return;
    }

    const material = await createMaterialFromContent(content, materialNameDraft, {
      ...createEmptyMaterialMetadataDraft(),
      description: materialDescriptionDraft,
    });
    if (material) {
      setMaterialNameDraft("");
      setMaterialDescriptionDraft("");
    }
  }, [createMaterialFromContent, getSelectedMaterialContent, materialDescriptionDraft, materialNameDraft]);

  const openMaterialAddDialog = useCallback((
    targetBlockId?: string | null,
    targetBlockIds?: readonly string[],
  ) => {
    const content = getSelectedMaterialContent(targetBlockId, targetBlockIds);
    if (!content || (content.blocks.length === 0 && content.overlaySnapshot.shapes.length === 0)) {
      const message = tEditor("status.selectMaterialSource");
      setMaterialError(message);
      setStatusMessage(message);
      return;
    }

    const fallbackName = content.blocks[0] ? getMaterialNameFromBlock(content.blocks[0], tWorkspace) : tEditor("material.shapeMaterial");
    setMaterialAddContent(content);
    setMaterialAddName(fallbackName);
    setMaterialAddDraft({
      ...createEmptyMaterialMetadataDraft(),
      visualConcepts: suggestVisualConceptsForMaterialContent(content).join(", "),
    });
    setMaterialError(null);
    setMaterialAddDialogOpen(true);
  }, [getSelectedMaterialContent, setStatusMessage]);

  const closeMaterialAddDialog = useCallback(() => {
    setMaterialAddDialogOpen(false);
    setMaterialAddContent(null);
    setMaterialAddName("");
    setMaterialAddDraft(createEmptyMaterialMetadataDraft());
  }, []);

  const confirmMaterialAddDialog = useCallback(async () => {
    if (!materialAddContent) {
      return;
    }

    const material = await createMaterialFromContent(materialAddContent, materialAddName, materialAddDraft);
    if (material) {
      closeMaterialAddDialog();
    }
  }, [closeMaterialAddDialog, createMaterialFromContent, materialAddContent, materialAddDraft, materialAddName]);

  const insertContentAt = useCallback((
    content: MaterialContent,
    triggerBlockId: string | null,
    origin: OverlayPoint,
    statusMessage = tEditor("status.materialInserted"),
  ) => {
    const inserted = cloneMaterialContentForInsert(content, {
      origin,
    });
    let nextSelectedId: string | null = null;
    commitDocumentChange((current) => {
      let nextDocument = current;
      if (triggerBlockId && inserted.blocks.length > 0) {
        const replacement = replaceMaterialTriggerWithBlocks(nextDocument, triggerBlockId, inserted.blocks);
        nextDocument = replacement.document;
        nextSelectedId = replacement.selectedId;
      } else if (triggerBlockId && inserted.blocks.length === 0) {
        nextSelectedId = triggerBlockId;
      } else if (inserted.blocks.length > 0) {
        nextDocument = insertTopLevelDocumentBlocks(
          nextDocument,
          selectedIdRef.current,
          inserted.blocks,
          DOCUMENT_BLOCK_OPERATION_PORTS,
        );
        nextSelectedId = inserted.blocks[inserted.blocks.length - 1]?.id ?? null;
      }

      nextDocument = mergeMaterialOverlayIntoDocument(nextDocument, inserted.overlaySnapshot);
      return nextDocument;
    });

    if (nextSelectedId) {
      selectedIdRef.current = nextSelectedId;
      setSelectedId(nextSelectedId);
    }
    setSelectedInlineMath(null);
    setStatusMessage(statusMessage);
  }, [commitDocumentChange, setSelectedId, setSelectedInlineMath, setStatusMessage]);

  const insertMaterialAt = useCallback((material: MaterialItem, triggerBlockId: string | null, origin: OverlayPoint) => {
    let content = material.content;
    let insertOrigin = origin;
    if (isOfficialMaterial(material)) {
      const columnWidthPx = getPageMetrics(normalizePageLayout(documentRef.current.pageLayout)).flow.columnWidthPx;
      content = fitOfficialBoxToColumnWidth(content, columnWidthPx);
      // Boxes are authored in block-relative coordinates where the body text sits at
      // (0, 0) and headers/frames extend into negative space above/left of it. Shift the
      // insertion origin by the box bounds top-left so the body region (not the bounding
      // box top) lands on the trigger, keeping the frame wrapped around the body text.
      const bounds = getShapesSelectionBounds(content.overlaySnapshot.shapes);
      if (bounds) {
        insertOrigin = { x: origin.x + bounds.x, y: origin.y + bounds.y };
      }
    }
    insertContentAt(content, triggerBlockId, insertOrigin);
  }, [insertContentAt]);

  const insertMaterialFromDialog = useCallback((material: MaterialItem) => {
    insertMaterialAt(material, null, { x: 24, y: 24 });
    setMaterialActionMenu(null);
    setMaterialLibraryOpen(false);
  }, [insertMaterialAt]);

  const openMaterialActionMenu = useCallback((event: MouseEvent<HTMLButtonElement>, material: MaterialItem) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = 188;
    const menuHeight = 124;
    const maxX = Math.max(12, window.innerWidth - menuWidth - 12);
    const maxY = Math.max(12, window.innerHeight - menuHeight - 12);
    setMaterialActionMenu((current) => current?.materialId === material.id ? null : {
      materialId: material.id,
      x: Math.min(Math.max(rect.right - menuWidth, 12), maxX),
      y: Math.min(rect.bottom + 6, maxY),
    });
  }, []);

  const startEditingMaterial = useCallback((material: MaterialItem) => {
    setMaterialActionMenu(null);
    setMaterialMetadataInfoOpen(false);
    if (isOfficialMaterial(material)) {
      setMaterialError(tEditor("status.officialMaterialRename"));
      return;
    }
    materialEditingOpenRef.current = true;
    setMaterialEditingId(material.id);
    setMaterialEditingDraft(materialToMetadataDraft(material));
    updateMaterialEditingContent(cloneMaterialContentForEditing(material.content));
  }, [updateMaterialEditingContent]);

  const insertTemplate = useCallback((template: TemplateItem) => {
    insertContentAt(templateInsertContent(template), null, { x: 24, y: 24 }, tEditor("status.templateInserted"));
    setTemplateGalleryOpen(false);
  }, [insertContentAt]);

  const openNewDocMenu = useCallback(() => {
    if (newDocMenuCloseTimerRef.current !== null) {
      window.clearTimeout(newDocMenuCloseTimerRef.current);
      newDocMenuCloseTimerRef.current = null;
    }
    setNewDocMenuOpen(true);
  }, []);

  const scheduleCloseNewDocMenu = useCallback(() => {
    if (newDocMenuCloseTimerRef.current !== null) {
      window.clearTimeout(newDocMenuCloseTimerRef.current);
    }
    newDocMenuCloseTimerRef.current = window.setTimeout(() => {
      setNewDocMenuOpen(false);
      newDocMenuCloseTimerRef.current = null;
    }, 140);
  }, []);

  const renameMaterial = useCallback(async (material: MaterialItem) => {
    if (isOfficialMaterial(material)) {
      setMaterialError(tEditor("status.officialMaterialRename"));
      materialEditingOpenRef.current = false;
      setMaterialEditingId(null);
      setMaterialEditingDraft(createEmptyMaterialMetadataDraft());
      updateMaterialEditingContent(null);
      setMaterialMetadataInfoOpen(false);
      setMaterialActionMenu(null);
      return;
    }
    window.dispatchEvent(new Event(FLUSH_OVERLAY_CHANGES_EVENT));
    const name = materialEditingDraft.name.trim();
    const content = materialEditingContentRef.current ?? materialEditingContent ?? material.content;
    if (!name) {
      return;
    }
    if (content.blocks.length === 0 && content.overlaySnapshot.shapes.length === 0) {
      setMaterialError(tEditor("status.materialNeedsContent"));
      return;
    }

    setMaterialsLoading(true);
    try {
      const nextMaterial = await getAppRuntime().materials.updateMaterialMetadata(material.id, {
        name,
        ...materialMetadataDraftToInput(materialEditingDraft),
        content,
      });
      setMaterials((current) => current.map((item) => item.id === nextMaterial.id ? nextMaterial : item));
      closeMaterialEditing();
      setMaterialActionMenu(null);
      setMaterialError(null);
      setStatusMessage(tEditor("status.materialUpdated"));
    } catch (error) {
      setMaterialError(error instanceof Error ? error.message : tEditor("status.materialSaveFailed"));
    } finally {
      setMaterialsLoading(false);
    }
  }, [closeMaterialEditing, materialEditingContent, materialEditingDraft, setStatusMessage, updateMaterialEditingContent]);

  const deleteMaterial = useCallback(async (material: MaterialItem) => {
    if (isOfficialMaterial(material)) {
      setMaterialError(tEditor("status.officialMaterialDelete"));
      setMaterialActionMenu(null);
      return;
    }
    setMaterialsLoading(true);
    try {
      const result = await getAppRuntime().materials.deleteMaterial(material.id);
      if (!result.ok) {
        throw new Error(result.error ?? tEditor("status.materialDeleteFailed"));
      }
      setMaterials((current) => current.filter((item) => item.id !== material.id));
      setMaterialActionMenu(null);
      setMaterialError(null);
    } catch (error) {
      setMaterialError(error instanceof Error ? error.message : tEditor("status.materialDeleteFailed"));
    } finally {
      setMaterialsLoading(false);
    }
  }, []);

  const applyTextStyle = (style: string) => {
    if (!canUseTextBlockStyle) {
      return;
    }

    if (runningRegionEditingKind) {
      window.dispatchEvent(new CustomEvent(FORMAT_TEXT_EVENT, {
        detail: { command: "blockStyle", value: style, target: "document" },
      }));
      return;
    }

    if (!selectedId || !canFormatSelectedText) {
      return;
    }

    commitDocumentChange((current) =>
      updateBlockInDocument(current, selectedId, (node) => convertBlockStyle(node, style)),
    );
  };

  const blockStructureCommandRef = useRef<{
    canUse: boolean;
    apply: (value: BlockStyleCommandValue) => void;
  }>({ canUse: false, apply: () => undefined });

  /**
   * リスト化・引用・コード・区切り線。段落スタイル (`applyTextStyle`) と違って ProseMirror
   * 経由で送る。入れ子・分割・結合の規則を SigmaDoc 側で書き直すと、PM のコマンドが既に
   * 持っているものを二重に持つことになるため。
   *
   * ボタンを押した後にキャレットがどこに居るかは、**どのボタンでも同じ規則**で決める:
   *
   *   1. PM のコマンドが置いた位置がそのまま正しい (コードの中・引用の中・線の次の段落)。
   *   2. その位置のブロック id をエディタが `detail.focusBlockId` で返す。
   *   3. 焦点が失われていたときだけ、その id へ当て直す。
   *
   * 3 が要るのは、入れ物を作る操作 (引用・リスト) が本文ランの **先頭ブロック id** を変え、
   * ランの React キーがその id なので (`render-units.ts` の `id: chunk[0].id`) エディタごと
   * unmount → remount されるから。逆に失われていないときに触ってはいけない — `setNode` で
   * 済むコマンドで焦点をいじったら、打っている最中にキャレットを奪って文字が落ちた。
   */
  const applyBlockStructure = (value: BlockStyleCommandValue) => {
    if (!canUseBlockStructure) {
      return;
    }
    const target = overlayEditing ? "overlay" : "document";
    const detail: { command: string; value: string; target: string; focusBlockId?: string | null } = {
      command: "blockStyle",
      value,
      target,
    };
    window.dispatchEvent(new CustomEvent(FORMAT_TEXT_EVENT, { detail }));

    // Overlay text stays inside one editor when its block structure changes, so the body-only
    // block-id handoff below would target an unrelated SigmaDoc block and steal focus.
    if (target === "overlay") {
      return;
    }

    const focusBlockId = detail.focusBlockId ?? selectedIdRef.current;
    if (focusBlockId) {
      selectedIdRef.current = focusBlockId;
      setSelectedId(focusBlockId);
      scheduleEditorBlockFocus(focusBlockId, { collapseToEnd: true, onlyIfLost: true });
    }
  };

  // `/` から来るブロック要求へ渡すための最新値。**毎レンダー**書き換える (依存配列を持たない
  // effect) ので、キャンバスへ渡すハンドラは識別子を変えずに最新の可否と関数を読める。
  useEffect(() => {
    blockStructureCommandRef.current = { canUse: canUseBlockStructure, apply: applyBlockStructure };
  });

  const applyTextAlign = (align: TextAlign) => {
    if (!canUseTextAlign) {
      return;
    }

    const target = overlayEditing ? "overlay" : "document";
    window.dispatchEvent(new CustomEvent(FORMAT_TEXT_EVENT, { detail: { command: "textAlign", value: align, target } }));
  };

  const runEditCommand = (command: "bold" | "italic" | "underline" | "boxed" | "undo" | "redo") => {
    if (command === "undo") {
      undoDocumentChange();
      return;
    }

    if (command === "redo") {
      redoDocumentChange();
      return;
    }

    if (!canUseTextToolbar) {
      return;
    }

    window.dispatchEvent(new CustomEvent(FORMAT_TEXT_EVENT, { detail: { command, target: overlayEditing ? "overlay" : "document" } }));
  };

  const toggleMenu = (menu: NonNullable<EditorMenu>) => {
    setExportMenuOpen(false);
    setShapeMenuOpen(false);
    setLineToolMenuOpen(false);
    setFontFamilyMenuOpen(false);
    setBlockStyleMenuOpen(false);
    setFontSizeMenuOpen(false);
    setBoxedTextMenuOpen(false);
    setLineHeightMenuOpen(false);
    setTextAlignMenuOpen(false);
    setOrderedListMenuOpen(false);
    setMoreBlocksMenuOpen(false);
    setLineDashMenuOpen(false);
    setLineWidthMenuOpen(false);
    setColorStylePanel(null);
    setLineEndpointMenu(null);
    setActiveMenu((current) => (current === menu ? null : menu));
  };

  // --- Word風リボン ---------------------------------------------------------
  // 状態の所有者は変えない。リボンは EditorShell が持つこの state と既存ハンドラを読むだけ。

  // 図形が「選択されている」ことだけを条件にする。overlayEditing まで含めると、
  // 図形ツールを選んだ瞬間 (まだ図形が無い) にタブを奪われ、しかもそのタブは
  // 全コントロールが disabled (canUseStrokeStyleControls 等はすべて
  // hasOverlaySelection を要求する) という行き止まりになる。選択解除で消えて
  // 直前のタブへ戻る、という仕様ともこちらの条件でしか両立しない。
  const ribbonContextualTabVisible = hasOverlaySelection;

  useEffect(() => {
    const justAppeared = ribbonContextualTabVisible && !ribbonContextualWasVisibleRef.current;
    ribbonContextualWasVisibleRef.current = ribbonContextualTabVisible;
    // resolveRibbonTabState は変化が無ければ同じオブジェクトを返すので、ここで
    // 無駄な再レンダーは起きない（アイドル時のループ防止）。
    setRibbonTabState((current) => resolveRibbonTabState(current, {
      contextualVisible: ribbonContextualTabVisible,
      contextualJustAppeared: justAppeared,
    }));
  }, [ribbonContextualTabVisible]);

  // タブを切り替えるとポップオーバーのアンカーになっているボタンが unmount し、
  // ToolbarPopover は anchorRef.current === null で top:-9999px へ飛んで見えなくなる。
  // 先に全部閉じる。閉じる集合は toggleMenu と揃え、リボンのタブ内にしか
  // アンカーが無いもの（検索置換・数式・新規教材）も含める。Backstage の開閉でも
  // リボン本体ごと unmount するので、同じ集合を閉じる。
  const closeRibbonAnchoredPopovers = () => {
    setExportMenuOpen(false);
    setShapeMenuOpen(false);
    setLineToolMenuOpen(false);
    setFontFamilyMenuOpen(false);
    setBlockStyleMenuOpen(false);
    setFontSizeMenuOpen(false);
    setBoxedTextMenuOpen(false);
    setLineHeightMenuOpen(false);
    setTextAlignMenuOpen(false);
    setOrderedListMenuOpen(false);
    setMoreBlocksMenuOpen(false);
    setLineDashMenuOpen(false);
    setLineWidthMenuOpen(false);
    setColorStylePanel(null);
    setLineEndpointMenu(null);
    setActiveMenu(null);
    setSearchOpen(false);
    setInlineMathMenuOpen(false);
    setNewDocMenuOpen(false);
  };

  // collapsed は永続 (ui-layout-preference)、overlayOpen は一時。純関数へ渡すために組で作る。
  // docs では折りたたみの概念が無いので必ず展開扱いにする。
  const ribbonCollapsed = uiLayoutPreference.mode === "word" && uiLayoutPreference.ribbonCollapsed;
  // 浮かせた本体は折りたたみ中にしか存在しない。展開したり docs へ移ったりしたら
  // 一時状態を畳む — 残しておくと「docs へ行って word に戻ったら、何も押していないのに
  // 本体が浮いている」になる。effect ではなくレンダー中に補正する (Backstage と同じ形)。
  const resolvedRibbonOverlayOpen = ribbonCollapsed && ribbonOverlayOpen;
  if (resolvedRibbonOverlayOpen !== ribbonOverlayOpen) {
    setRibbonOverlayOpen(resolvedRibbonOverlayOpen);
  }
  const ribbonCollapse: RibbonCollapseState = {
    collapsed: ribbonCollapsed,
    overlayOpen: resolvedRibbonOverlayOpen,
  };

  const selectRibbonTab = (tab: RibbonPanelTabId) => {
    closeRibbonAnchoredPopovers();
    // Backstage を開いたままタブを押したら、そのタブを開いて Backstage を閉じる
    // （Word と同じ）。閉じないとタブ行だけが反応しない行き止まりになる。
    setRibbonBackstage((current) => closeBackstageState(current));
    // 折りたたみ中は本体を «浮かせて» 出す。同じタブをもう一度押したら閉じる。
    // 比較先は «実際に選択として描かれているタブ»。コンテキストタブが消えた直後の
    // 1レンダーだけ state の active は不可視の shapeFormat のままで、クロームは
    // lastExplicit を選択として描いている（editor-chrome.tsx の activeRibbonTab と同じ導出）。
    const renderedActiveTab = ribbonTabState.active === "shapeFormat" && !ribbonContextualTabVisible
      ? ribbonTabState.lastExplicit
      : ribbonTabState.active;
    const nextCollapse = resolveTabClickWhileCollapsed(ribbonCollapse, {
      sameTab: renderedActiveTab === tab,
    });
    setRibbonOverlayOpen(nextCollapse.overlayOpen);
    setRibbonTabState((current) => selectRibbonTabState(current, tab));
  };

  const toggleRibbonCollapse = () => {
    closeRibbonAnchoredPopovers();
    const next = toggleRibbonCollapseState(ribbonCollapse);
    // collapsed だけ永続する。overlayOpen を永続すると、次回起動時に本体が
    // 浮いたまま出てしまう。
    updateUiLayoutPreference({ ribbonCollapsed: next.collapsed });
    setRibbonOverlayOpen(next.overlayOpen);
  };

  const closeRibbonOverlayNow = () => {
    setRibbonOverlayOpen((current) => closeRibbonOverlay({
      collapsed: true,
      overlayOpen: current,
    }).overlayOpen);
  };

  const toggleRibbonBackstage = () => {
    closeRibbonAnchoredPopovers();
    // Backstage は本文もリボンも覆うので、浮かせた本体は畳んでおく。残すと
    // Backstage を閉じた先に、誰も呼んでいない本体が浮いたまま出てくる
    // （キーボードだけで操作すると pointerdown が出ないのでこの経路に入る）。
    setRibbonOverlayOpen(false);
    setRibbonBackstage((current) => toggleBackstageState(current));
  };

  const closeRibbonBackstage = () => {
    setRibbonBackstage((current) => closeBackstageState(current));
  };

  const selectRibbonBackstageSection = (section: BackstageSectionId) => {
    setRibbonBackstage((current) => selectBackstageSectionState(current, section));
  };

  // レイアウトが Word風を離れたら Backstage を畳む。これが無いと docs へ切り替えて
  // 戻ってきた瞬間に全画面が残ったまま出る。
  // effect ではなくレンダー中に補正する（React 公式の「変化に合わせて state を調整する」形）。
  // resolveBackstageStateForLayout は変化が無ければ同じ参照を返すので、通常のレンダーでは
  // 何も起きない。以降は補正後の値だけを読む。
  const ribbonBackstageState = resolveBackstageStateForLayout(ribbonBackstage, uiLayoutPreference.mode);
  if (ribbonBackstageState !== ribbonBackstage) {
    setRibbonBackstage(ribbonBackstageState);
  }

  const ribbonBackstageOpen = ribbonBackstageState.open;

  // Backstage 表示中は本文・図形へキーを届かせない。
  // OverlayCanvasEditorClient の handleOverlayKeyboard は window の bubble リスナーで、
  // 「入力欄かどうか」しか見ない = Backstage のボタンにフォーカスがあると Delete や
  // 矢印キーが図形へ素通りする。window の capture で止めれば bubble まで降りない。
  // preventDefault はしないので Tab によるフォーカス移動は生きる。Escape だけは
  // 通して closeTransientUi に閉じさせる。
  useEffect(() => {
    if (!ribbonBackstageOpen) {
      return;
    }
    const guardBackstageKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        return;
      }
      event.stopPropagation();
    };
    window.addEventListener("keydown", guardBackstageKeys, true);
    return () => window.removeEventListener("keydown", guardBackstageKeys, true);
  }, [ribbonBackstageOpen]);

  // Ctrl+F1 のリスナーは毎レンダー張り替えたくないので、最新のハンドラを ref に写す
  // (runShortcutCommandRef と同じ手。レンダー中の ref 書き換えは禁止なので effect で)。
  useEffect(() => {
    toggleRibbonCollapseRef.current = toggleRibbonCollapse;
  });

  // 浮かせたリボン本体は外側クリックで閉じる（ToolbarPopover と同じ形: document の
  // pointerdown + contains 判定）。タブ行の中は「外側」に含めない — タブを押したときの
  // 開閉は resolveTabClickWhileCollapsed が決めるので、ここで先に閉じると打ち消し合う。
  useEffect(() => {
    if (!ribbonOverlayOpen) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      // SDK は1ページに EditorShell を2つ載せうるので、querySelector(".app-shell") で
      // «最初の» シェルを掴まない。自分のタブ行 (useId 由来の id) から辿る。
      const root = window.document
        .getElementById(ribbonTabElementId(ribbonIdPrefix, "file"))
        ?.closest(".app-shell");
      if (!root?.contains(target)) {
        return;
      }
      // 「外側」から外すのはタブそのものだけ。タブ行右端のコメント / AIチャット /
      // 展開ボタンを押したら、その結果が浮いた本体に隠れないよう畳む。
      if (target instanceof Element && target.closest(".ribbon-body, .ribbon-tabs")) {
        return;
      }
      closeRibbonOverlayNow();
    };
    window.document.addEventListener("pointerdown", handlePointerDown);
    return () => window.document.removeEventListener("pointerdown", handlePointerDown);
    // closeRibbonOverlayNow は setter しか呼ばないので、識別子が毎レンダー変わっても
    // 張り替える必要が無い（張り替えると pointerdown を取りこぼす）。
  }, [ribbonOverlayOpen, ribbonIdPrefix]);

  // 開いたら Backstage の先頭要素へ、閉じたらファイルタブへフォーカスを戻す。
  // クロームの JSX は1関数・1 render pass で作る規約なので ref を配れない。
  // id は ribbon-tabs.ts / ribbon-backstage.ts が組み立てを持っている（useId 由来の
  // 接頭辞なので、SDK が1ページに2つ埋め込んでも他方を掴まない）。
  useEffect(() => {
    if (!ribbonBackstageOpen) {
      return;
    }
    const panel = window.document.getElementById(ribbonBackstagePanelId(ribbonIdPrefix));
    panel?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
    return () => {
      window.document.getElementById(ribbonTabElementId(ribbonIdPrefix, "file"))?.focus();
    };
  }, [ribbonBackstageOpen, ribbonIdPrefix]);

  // 文書を1本走査するので、実際にボタンが描かれるレイアウトタブを開いている
  // ときだけ計算する。docs では段組みコマンドが画面に無く、word でも他のタブでは
  // 読まれないため、毎キーストロークの走査を丸ごと省ける。
  const ribbonRibbonBodyVisible = !ribbonCollapse.collapsed || ribbonCollapse.overlayOpen;
  const ribbonColumnCommand = uiLayoutPreference.mode === "word" && ribbonTabState.active === "layout" && !ribbonBackstageOpen && ribbonRibbonBodyVisible
    ? resolveColumnCommandState(document, selectedId)
    : NO_COLUMN_COMMAND;

  /**
   * 選択ブロックを columnCount 段にする。すでに段組の中なら段数を変え、
   * columnCount が 1 なら段組を解除する（どちらも右クリックメニューにある操作）。
   */
  const applyColumnCommand = (columnCount: number) => {
    if (!selectedId) {
      return;
    }
    // 描画用の値は開いているタブによって計算を省いているので、押された時点で取り直す。
    const state = resolveColumnCommandState(documentRef.current, selectedId);
    if (!state.enabled) {
      return;
    }
    if (!state.sectionId) {
      if (columnCount > 1) {
        wrapBlockInColumns([selectedId], columnCount);
      }
      return;
    }
    if (columnCount <= 1) {
      unwrapColumns(state.sectionId);
      return;
    }
    if (state.currentColumnCount === columnCount) {
      // 押されている段数をもう一度押しても文書は変わらない。setLayoutSectionColumnCount は
      // 常に新しいオブジェクトを返すので、素通しすると空の更新履歴と保存が積まれる。
      return;
    }
    updateBlock(state.sectionId, (block) => setLayoutSectionColumnCount(block, columnCount));
  };

  // AI実行中でも図形の新規挿入・整列などは通す。ロック図形そのものへの変更は overlay canvas の
  // transitionMode (lockedShapeIds) と commitDocumentChange の対象判定で弾かれるため、ここで
  // 選択内容まで見て一律禁止する必要はない。
  const runOverlayCommand = (command: OverlayCommand, graphPreset?: Graph2DPreset, options?: Pick<OverlayCommandRequest, "anchorRect">) => {
    if (aiDocumentWriteInProgress) {
      setStatusMessage(aiDocumentWriteInProgressMessage());
      return;
    }
    captureMaterialBlockSelectionFromDom();
    overlayCommandRequestIdRef.current += 1;
    setShapeMenuOpen(false);
    setLineToolMenuOpen(false);
    setFontFamilyMenuOpen(false);
    setBlockStyleMenuOpen(false);
    setFontSizeMenuOpen(false);
    setBoxedTextMenuOpen(false);
    setLineHeightMenuOpen(false);
    setTextAlignMenuOpen(false);
    setLineDashMenuOpen(false);
    setLineWidthMenuOpen(false);
    setColorStylePanel(null);
    setLineEndpointMenu(null);
    setOverlayCommandRequest({
      id: overlayCommandRequestIdRef.current,
      command,
      graphPreset,
      ...options,
    });
    if (command !== "select") {
      setStatusMessage(command === "graph"
        ? tEditor("status.graphDragHint")
        : command === "graph3d"
          ? tEditor("status.graph3dDragHint")
          : command === "circle" || command === "arc" || command === "sector"
            ? tEditor("status.centerDragHint")
            : tEditor("status.shapeDragHint"));
    }
  };

  const requestOverlayImages = useCallback((files: ArrayLike<File> | Iterable<File>, point?: OverlayPoint) => {
    captureMaterialBlockSelectionFromDom();
    const imageFiles = getSupportedOverlayImageFiles(files);
    if (imageFiles.length === 0) {
      setStatusMessage(tEditor("status.imageFormatsOnly"));
      setSaveState("error");
      return;
    }

    overlayImageRequestIdRef.current += 1;
    setShapeMenuOpen(false);
    setLineToolMenuOpen(false);
    setLineDashMenuOpen(false);
    setLineWidthMenuOpen(false);
    setOverlayImageRequest({
      id: overlayImageRequestIdRef.current,
      files: imageFiles,
      point,
    });
    setStatusMessage(imageFiles.length === 1
      ? tEditor("status.addImageToPage")
      : tEditor("status.addImagesToPage", { images: imageFiles.length }));
  }, [captureMaterialBlockSelectionFromDom, setSaveState, setStatusMessage]);

  // Turn a URL detected in the flow editor into a QR code, inserted on the page
  // as an overlay image (the same pipeline as pasted/imported images).
  useEffect(() => {
    const handleQrCodeRequest = (event: Event) => {
      const detail = event instanceof CustomEvent ? (event.detail as QrCodeRequestDetail | null) : null;
      const url = detail?.url?.trim();
      if (!url) {
        return;
      }
      void (async () => {
        try {
          const file = await generateQrPngFile(url);
          requestOverlayImages([file]);
          setStatusMessage(tEditor("status.qrAdded"));
        } catch {
          setStatusMessage(tEditor("status.qrFailed"));
          setSaveState("error");
        }
      })();
    };

    window.addEventListener(QR_CODE_REQUEST_EVENT, handleQrCodeRequest);
    return () => window.removeEventListener(QR_CODE_REQUEST_EVENT, handleQrCodeRequest);
  }, [requestOverlayImages, setSaveState, setStatusMessage]);

  const requestOverlayAction = useCallback((request: OverlayActionRequestInput) => {
    overlayActionRequestIdRef.current += 1;
    setOverlayActionRequest({
      id: overlayActionRequestIdRef.current,
      ...request,
    } as OverlayActionRequest);
  }, []);

  useEffect(() => {
    const handleOverlayShapesPasteRequest = (event: Event) => {
      const detail = (event as CustomEvent<OverlayShapesPasteRequestDetail>).detail;
      if (
        materialEditingOpenRef.current
        || !detail?.source.closest(".page-flow")
        || detail.payload.shapes.length === 0
      ) {
        return;
      }
      requestOverlayAction({
        type: "pasteShapes",
        payload: detail.payload,
        anchorBlockIdMap: detail.anchorBlockIdMap,
      });
      setStatusMessage(tEditor("status.bodyAndShapesPasted"));
    };
    window.addEventListener(OVERLAY_SHAPES_PASTE_REQUEST_EVENT, handleOverlayShapesPasteRequest);
    return () => window.removeEventListener(OVERLAY_SHAPES_PASTE_REQUEST_EVENT, handleOverlayShapesPasteRequest);
  }, [requestOverlayAction, setStatusMessage]);

  useEffect(() => {
    const handleBodySelectionShapesRequest = (event: Event) => {
      const detail = (event as CustomEvent<BodySelectionShapesRequestDetail>).detail;
      if (materialEditingOpenRef.current || !detail?.source.closest(".page-flow")) {
        return;
      }
      requestOverlayAction({
        type: "selectShapesForBlocks",
        blockIds: detail.blockIds,
        allShapes: detail.wholeDocument === true,
      });
    };
    window.addEventListener(BODY_SELECTION_SHAPES_REQUEST_EVENT, handleBodySelectionShapesRequest);
    return () => window.removeEventListener(BODY_SELECTION_SHAPES_REQUEST_EVENT, handleBodySelectionShapesRequest);
  }, [requestOverlayAction]);

  const applyOverlayStyle = (style: OverlaySelectionStylePatch) => {
    if (!hasOverlaySelection) {
      return;
    }

    requestOverlayAction({ type: "style", style });
  };
  const arrangeOverlayShapes = (action: OverlayArrangeAction) => {
    if (canArrangeOverlayShapes) {
      requestOverlayAction({ type: "arrange", action });
    }
  };

  const handleOverlaySelectionSummaryChange = useCallback((summary: OverlaySelectionSummary) => {
    // state はシェルの見た目が変わるときだけ進める。図形そのものが要る素材化は ref を読む。
    overlaySelectionRef.current = summary;
    setOverlaySelection((current) => sameOverlaySelectionSummary(current, summary) ? current : summary);
    if (summary.selectedCount === 0 || !summary.canStyleLine) {
      setLineDashMenuOpen(false);
      setLineWidthMenuOpen(false);
    }
    if (summary.selectedCount === 0 || !summary.canStyleFill) {
      // Closing the panel unmounts the palette, and the palette drops its own preview on unmount —
      // so this is also what stops an unconfirmed preview from outliving the selection it was
      // started on.
      setColorStylePanel((current) => (current === "fill" ? null : current));
    }
  }, []);

  const applyInlineFormat = (command: "color" | "backgroundColor" | "fontFamily" | "fontSize" | "lineHeight" | "boxedPaddingY" | "boxedVariant", value: string) => {
    if (!canUseTextToolbar) {
      return;
    }

    window.dispatchEvent(new CustomEvent(FORMAT_TEXT_EVENT, { detail: { command, value, target: overlayEditing ? "overlay" : "document" } }));
  };

  const applyLineHeight = (nextLineHeightValue: string, options: { updateInput?: boolean } = {}): boolean => {
    if (!canUseLineHeight) {
      return false;
    }

    const nextLineHeight = normalizeLineHeight(nextLineHeightValue);
    if (!nextLineHeight) {
      setLineHeightInputError(t("format.lineHeight.inputError", { min: MIN_LINE_HEIGHT, max: MAX_LINE_HEIGHT }));
      return false;
    }

    setLineHeight(nextLineHeight);
    if (options.updateInput !== false) {
      setLineHeightInput(nextLineHeight);
    }
    setLineHeightInputError(null);
    applyInlineFormat("lineHeight", nextLineHeight);
    return true;
  };

  const stopLineHeightStepping = useCallback(() => {
    if (lineHeightStepDelayTimerRef.current !== null) {
      window.clearTimeout(lineHeightStepDelayTimerRef.current);
      lineHeightStepDelayTimerRef.current = null;
    }
    if (lineHeightStepRepeatTimerRef.current !== null) {
      window.clearInterval(lineHeightStepRepeatTimerRef.current);
      lineHeightStepRepeatTimerRef.current = null;
    }
    lineHeightStepCurrentRef.current = null;
  }, []);

  const applyLineHeightStep = (direction: "increase" | "decrease"): boolean => {
    const currentLineHeight = lineHeightStepCurrentRef.current ?? lineHeight;
    const nextLineHeight = stepLineHeight(currentLineHeight, direction);
    if (nextLineHeight === currentLineHeight) {
      stopLineHeightStepping();
      return false;
    }
    lineHeightStepCurrentRef.current = nextLineHeight;
    return applyLineHeight(nextLineHeight);
  };

  const startLineHeightStepping = (event: ReactPointerEvent<HTMLButtonElement>, direction: "increase" | "decrease") => {
    if (!event.isPrimary || event.button !== 0) {
      return;
    }
    event.preventDefault();
    stopLineHeightStepping();
    if (!applyLineHeightStep(direction)) {
      return;
    }
    lineHeightStepDelayTimerRef.current = window.setTimeout(() => {
      lineHeightStepDelayTimerRef.current = null;
      if (!applyLineHeightStep(direction)) {
        return;
      }
      lineHeightStepRepeatTimerRef.current = window.setInterval(() => {
        applyLineHeightStep(direction);
      }, LINE_HEIGHT_LONG_PRESS_INTERVAL_MS);
    }, LINE_HEIGHT_LONG_PRESS_DELAY_MS);
  };

  const handleLineHeightStepClick = (event: MouseEvent<HTMLButtonElement>, direction: "increase" | "decrease") => {
    if (event.detail === 0) {
      applyLineHeightStep(direction);
    }
  };

  useEffect(() => stopLineHeightStepping, [stopLineHeightStepping]);

  useEffect(() => {
    if (!lineHeightMenuOpen || !lineHeightCustomOpen) {
      stopLineHeightStepping();
    }
  }, [lineHeightCustomOpen, lineHeightMenuOpen, stopLineHeightStepping]);

  const executeCustomCommandAction = (action: EditorCustomCommandAction) => {
    if (action.type === "textFormat") {
      if (action.command === "boxed") {
        toggleBoxedText();
      } else {
        runEditCommand(action.command);
      }
      return;
    }
    if (action.type === "fontFamily") {
      setFontFamily(normalizeToolbarFontFamily(action.value || DEFAULT_FONT_FAMILY_VALUE));
      applyInlineFormat("fontFamily", action.value);
      setFontFamilyMenuOpen(false);
      return;
    }
    if (action.type === "fontSize") {
      setTextFontSize(action.value);
      applyInlineFormat("fontSize", String(action.value));
      return;
    }
    if (action.type === "lineHeight") {
      applyLineHeight(action.value);
      setLineHeightMenuOpen(false);
      setLineHeightCustomOpen(false);
      return;
    }
    if (action.type === "textAlign") {
      applyTextAlign(action.value);
      setTextAlignMenuOpen(false);
      return;
    }
    if (action.type === "blockStyle") {
      applyTextStyle(action.value);
      return;
    }
    if (action.type === "textColor") {
      setTextColor(action.value);
      applyInlineFormat("color", action.value);
      return;
    }
    if (action.type === "textBackgroundColor") {
      setTextBackgroundColor(action.value);
      applyInlineFormat("backgroundColor", action.value);
      return;
    }
    if (action.type === "overlayStrokeColor") {
      if (action.value === null) {
        setStrokeColor(null);
        applyOverlayStyle({ strokeOpacity: 0 });
      } else {
        setStrokeColor(action.value);
        applyOverlayStyle({ color: action.value, strokeOpacity: 1 });
      }
      return;
    }
    if (action.type === "overlayFillColor") {
      if (action.value === null) {
        applyOverlayStyle({ fill: "none" });
      } else {
        applyOverlayStyle(fillColorPatch(action.value));
      }
      return;
    }
    if (action.type === "overlayLineDash") {
      applyOverlayStyle({ dash: action.value });
      setLineDashMenuOpen(false);
      return;
    }
    if (action.type === "overlayLineWidth") {
      applyOverlayStyle({ size: action.value });
      setLineWidthMenuOpen(false);
    }
  };

  const applyBoxedTextPaddingY = (paddingY: number) => {
    const nextPaddingY = clampBoxedTextPaddingY(paddingY);
    setBoxedTextPaddingY(nextPaddingY);
    lastBoxedFormatRef.current = { ...lastBoxedFormatRef.current, paddingY: nextPaddingY };
    applyInlineFormat("boxedPaddingY", String(nextPaddingY));
  };

  const toggleBoxedText = () => {
    if (!canUseTextToolbar) {
      return;
    }

    if (boxedTextActive) {
      runEditCommand("boxed");
    } else {
      // Insert reusing the last applied format + padding (not a reset to a plain 0pt
      // frame). boxedVariant/boxedPaddingY both use "set" mode, which adds the boxed
      // mark and merges the attrs, so the new box matches the previous insert.
      const variant = normalizeBoxedTextVariant(lastBoxedFormatRef.current.variant) ?? "frame";
      if (variant !== "frame") {
        applyInlineFormat("boxedVariant", variant);
      }
      applyInlineFormat("boxedPaddingY", String(clampBoxedTextPaddingY(lastBoxedFormatRef.current.paddingY)));
    }
    setBoxedTextMenuOpen(false);
  };

  const selectBoxedTextVariant = (variant: BoxedVariant) => {
    if (!canUseTextToolbar) {
      return;
    }

    const nextVariant = normalizeBoxedTextVariant(variant) ?? "frame";
    setBoxedTextVariant(nextVariant);
    if (boxedTextActive && boxedTextVariant === nextVariant) {
      runEditCommand("boxed");
      setBoxedTextMenuOpen(false);
      return;
    }

    lastBoxedFormatRef.current = { ...lastBoxedFormatRef.current, variant: nextVariant };
    applyInlineFormat("boxedVariant", nextVariant);
  };

  const findNext = () => {
    const match = findFirstBlockWithText(document.content, searchQuery, selectedId, "next");
    if (!match) {
      setStatusMessage(tEditor("status.noSearchResults"));
      return;
    }

    setSelectedId(match.id);
    window.document.getElementById(match.id)?.scrollIntoView({ block: "center", behavior: "smooth" });
    setStatusMessage(tEditor("status.searchResultSelected"));
  };

  const findPrevious = () => {
    const match = findFirstBlockWithText(document.content, searchQuery, selectedId, "previous");
    if (!match) {
      setStatusMessage(tEditor("status.noSearchResults"));
      return;
    }

    setSelectedId(match.id);
    window.document.getElementById(match.id)?.scrollIntoView({ block: "center", behavior: "smooth" });
    setStatusMessage(tEditor("status.searchResultSelected"));
  };

  const replaceNext = () => {
    const match = findFirstBlockWithText(document.content, searchQuery, selectedId, "next");
    if (!match) {
      setStatusMessage(tEditor("status.nothingToReplace"));
      return;
    }

    commitDocumentChange((current) => replaceInDocument(current, searchQuery, replaceText, false));
    setSelectedId(match.id);
    setStatusMessage(tEditor("status.replacedOne"));
  };

  const replaceAll = () => {
    const count = countTextMatches(document.content, searchQuery);
    if (count === 0) {
      setStatusMessage(tEditor("status.nothingToReplace"));
      return;
    }

    commitDocumentChange((current) => replaceInDocument(current, searchQuery, replaceText, true));
    setStatusMessage(tEditor("status.replacedMany", { matches: count }));
  };

  const searchMatchCount = useMemo(() => countTextMatches(document.content, searchQuery), [document.content, searchQuery]);

  const replaceTextFlow = useCallback((
    previousIds: string[],
    nextBlocks: TextFlowBlock[],
    context?: TextFlowChangeContext,
    options?: TextFlowReplaceOptions,
  ) => {
    commitDocumentChange((current) => {
      const content = replaceTopLevelTextFlowBlocks(current.content, previousIds, nextBlocks);
      if (content === current.content) {
        return current;
      }

      return {
        ...current,
        content,
        updatedAt: new Date().toISOString(),
      };
    }, {
      // ページを跨いで分割されたブロックへの編集だけは遅らせない (`PageCanvasEditor` が
      // 同じタスクの中でページ割りを取り直す)。
      deferRender: options?.immediateRender !== true,
      ...(context?.historyGroup ? { historyGroup: context.historyGroup } : {}),
    });
  }, [commitDocumentChange]);

  const reportIssue = () => {
    window.open(REPORT_ISSUE_FORM_URL, "_blank", "noopener,noreferrer");
  };

  const openWorkspaceScreen = async () => {
    setActiveMenu(null);
    if (embeddedHostRef.current) {
      setStatusMessage(tEditor("status.embeddedHostOwnsDocuments"));
      return;
    }
    if (workspaceReady) {
      setSaveState("saving");
      setStatusMessage(tEditor("status.openingWorkspace"));
      const result = await saveCurrentDocumentRecord();
      if (!result.ok) {
        setSaveState("error");
        setStatusMessage(result.error ?? tEditor("status.saveFailed"));
        return;
      }
    }

    navigateToAppRoute("/workspace");
  };

  const exportJson = async () => {
    const data = JSON.stringify(document, null, 2);
    const suggestedName = `${resolveDocumentTitle(document, "lesson")}.sigmadoc.json`;
    const bridge = getDesktopBridge();
    if (bridge) {
      try {
        const result = await bridge.file.saveSigmaDoc({ suggestedName, data });
        if (result) {
          setStatusMessage(tEditor("status.savedTo", { path: result.filePath }));
        }
      } catch (error) {
        setSaveState("error");
        setStatusMessage(error instanceof Error ? error.message : tEditor("status.saveFailed"));
      }
      return;
    }
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = suggestedName;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const openDocumentViaDesktop = async () => {
    const bridge = getDesktopBridge();
    // Web 版にはネイティブのファイルピッカーが無い。取り込みと同じ隠しinputへ回す
    // (何も起きないままだと「開く」が壊れているようにしか見えない)。
    if (!bridge) {
      importInputRef.current?.click();
      return;
    }
    try {
      const result = await bridge.file.openSigmaDoc();
      if (!result) {
        return;
      }
      const baseName = result.filePath.split(/[\\/]/).pop() ?? "document.sigmadoc.json";
      const file = new File([result.data], baseName, { type: "application/json" });
      await importDocumentFile(file);
    } catch (error) {
      setSaveState("error");
      setStatusMessage(error instanceof Error ? error.message : tEditor("status.fileOpenFailed"));
    }
  };

  const openImportDocumentViaDesktop = async () => {
    const bridge = getDesktopBridge();
    if (!bridge?.file.openImportDocument) {
      importInputRef.current?.click();
      return;
    }
    try {
      const result = await bridge.file.openImportDocument();
      if (!result) {
        return;
      }
      const baseName = result.filePath.split(/[\\/]/).pop() ?? "document.sigmadoc.json";
      const binary = window.atob(result.dataBase64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      await importDocumentFile(new File([bytes], baseName));
    } catch (error) {
      setSaveState("error");
      setStatusMessage(error instanceof Error ? error.message : tEditor("status.fileReadFailed"));
    }
  };

  const openDocumentAsTab = async (record: DocumentFileRecord, status: string) => {
    const nextOpenFileIds = uniqueStringIds([...openFileIds, record.fileId]);
    rememberLeavingEditorTabViewState(activeFileIdRef.current, record.fileId);
    const restoredView = prepareIncomingEditorTabViewState(record.document, record.fileId);
    resetEditorDocument(record.document, restoredView.selectedId, record.metadata.revision);
    if (restoredView.textSelection) {
      textSelectionBookmarkRef.current = restoredView.textSelection;
    }
    setOpenFileIds(nextOpenFileIds);
    setActiveFileId(record.fileId);
    await saveWorkspaceState({ openFileIds: nextOpenFileIds, activeFileId: record.fileId });
    await refreshDocumentMetadatas();
    setSaveState("saved");
    setStatusMessage(status);
  };

  const createDocumentTab = async () => {
    setActiveMenu(null);
    setDocumentListOpen(false);
    if (embeddedHostRef.current) {
      setStatusMessage(tEditor("status.embeddedHostOwnsCreate"));
      return;
    }
    try {
      if (workspaceReady) {
        if (!(await saveCurrentDocumentBeforeReplacement())) {
          return;
        }
      }
      const created = await createNewDocument();
      await openDocumentAsTab(created, tEditor("status.documentCreated"));
    } catch (error) {
      setSaveState("error");
      setStatusMessage(error instanceof Error ? error.message : tEditor("status.createFailed"));
    }
  };

  const createWhiteboardDocumentTab = async () => {
    setActiveMenu(null);
    setDocumentListOpen(false);
    if (embeddedHostRef.current) {
      setStatusMessage(tEditor("status.embeddedHostOwnsWhiteboardCreate"));
      return;
    }
    try {
      if (workspaceReady && !(await saveCurrentDocumentBeforeReplacement())) {
        return;
      }
      const whiteboard = createBlankDocument(t("tabs.untitledWhiteboard"));
      const created = await createDocumentFromSigmaDocument({
        ...whiteboard,
        content: [],
        pageLayout: getDefaultPageLayout("whiteboard"),
      });
      await openDocumentAsTab(created, tEditor("status.whiteboardCreated"));
    } catch (error) {
      setSaveState("error");
      setStatusMessage(error instanceof Error ? error.message : tEditor("status.whiteboardCreateFailed"));
    }
  };

  const duplicateActiveDocument = async () => {
    setActiveMenu(null);
    if (embeddedHostRef.current) {
      setStatusMessage(tEditor("status.embeddedHostOwnsDuplicate"));
      return;
    }
    try {
      if (!(await saveCurrentDocumentBeforeReplacement())) {
        return;
      }
      const duplicated = await duplicateDocument(activeFileIdRef.current);
      await openDocumentAsTab(duplicated, tEditor("status.duplicated"));
    } catch (error) {
      setSaveState("error");
      setStatusMessage(error instanceof Error ? error.message : tEditor("status.duplicateFailed"));
    }
  };

  const openDocumentListDialog = async () => {
    setActiveMenu(null);
    if (embeddedHostRef.current) {
      setStatusMessage(tEditor("status.embeddedHostOwnsList"));
      return;
    }
    if (workspaceReady) {
      await saveCurrentDocumentRecord();
    }
    await refreshDocumentMetadatas();
    setDocumentListOpen(true);
  };

  const closeDocumentTab = async (fileId: string) => {
    if (openFileIds.length <= 1) {
      setStatusMessage(tEditor("status.lastTabStays"));
      return;
    }

    const closingIndex = openFileIds.indexOf(fileId);
    const nextOpenFileIds = openFileIds.filter((id) => id !== fileId);
    editorTabViewStateByFileIdRef.current.delete(fileId);
    if (fileId !== activeFileId) {
      setOpenFileIds(nextOpenFileIds);
      await saveWorkspaceState({ openFileIds: nextOpenFileIds, activeFileId });
      setStatusMessage(tEditor("status.tabClosed"));
      return;
    }

    const nextActiveId = nextOpenFileIds[Math.max(0, closingIndex - 1)] ?? nextOpenFileIds[0];
    await openDocumentInWorkspace(nextActiveId, {
      nextOpenFileIds,
      status: tEditor("status.tabClosed"),
    });
  };

  const openDocumentFromList = async (fileId: string) => {
    setDocumentListOpen(false);
    await openDocumentInWorkspace(fileId, { status: tEditor("status.opened") });
  };

  const duplicateDocumentFromList = async (fileId: string) => {
    try {
      if (!(await saveCurrentDocumentBeforeReplacement())) {
        return;
      }
      const duplicated = await duplicateDocument(fileId);
      setDocumentListOpen(false);
      await openDocumentAsTab(duplicated, tEditor("status.duplicated"));
    } catch (error) {
      setSaveState("error");
      setStatusMessage(error instanceof Error ? error.message : tEditor("status.duplicateFailed"));
    }
  };

  const deleteDocumentFromList = async (fileId: string) => {
    if (documentMetadatas.length <= 1) {
      setStatusMessage(tEditor("status.lastDocumentStays"));
      return;
    }

    const nextOpenFileIds = openFileIds.filter((id) => id !== fileId);
    const nextMetadata = documentMetadatas.filter((item) => item.fileId !== fileId);
    const nextActiveId = fileId === activeFileId
      ? nextOpenFileIds[0] ?? nextMetadata[0]?.fileId
      : activeFileId;
    if (!nextActiveId) {
      setSaveState("error");
      setStatusMessage(tEditor("status.noDocumentToSwitchTo"));
      return;
    }

    const result = await deleteDocument(fileId);
    if (!result.ok) {
      setSaveState("error");
      setStatusMessage(result.error ?? tEditor("status.deleteFailed"));
      return;
    }

    await refreshDocumentMetadatas();
    if (nextActiveId && fileId === activeFileId) {
      await openDocumentInWorkspace(nextActiveId, {
        nextOpenFileIds: nextOpenFileIds.length > 0 ? nextOpenFileIds : [nextActiveId],
        status: tEditor("status.deleted"),
        saveCurrent: false,
      });
      return;
    }

    const normalizedOpenFileIds = nextOpenFileIds.length > 0 ? nextOpenFileIds : [nextActiveId];
    setOpenFileIds(normalizedOpenFileIds);
    await saveWorkspaceState({ openFileIds: normalizedOpenFileIds, activeFileId: nextActiveId });
    setStatusMessage(tEditor("status.deleted"));
  };

  const deleteActiveDocument = async () => {
    setActiveMenu(null);
    if (embeddedHostRef.current) {
      setStatusMessage(tEditor("status.embeddedHostOwnsDelete"));
      return;
    }
    await deleteDocumentFromList(activeFileId);
  };

  const importDocumentFile = async (file: File, options: { editorMathPassword?: string } = {}) => {
    try {
      const isPrt = isEditorMathPrtFilename(file.name);
      const isSpr = isEditorMathSprFilename(file.name);
      const isEditorMath = isPrt || isSpr;
      const isTex = isTexFilename(file.name);
      const isSlides = isPresentationSlidesFilename(file.name);
      if (isEditorMath && options.editorMathPassword === undefined) {
        setEditorMathPassword("");
        setEditorMathPasswordError(null);
        setEditorMathPasswordRequest(file);
        return;
      }
      let recoveryIssues: SigmaDocumentRecoveryIssue[] = [];
      let imported: SigmaDocument;
      if (isEditorMath) {
        imported = await importEditorMathProtectedBuffer(await file.arrayBuffer(), file.name, options.editorMathPassword ?? "");
      } else if (isTex) {
        imported = importTexDocument(await file.text(), file.name);
      } else if (isSlides) {
        imported = await importPresentationSlidesBuffer(await file.arrayBuffer(), file.name, {
          locale: getAppLocale(),
        });
      } else {
        const recovered = recoverSigmaDocument(JSON.parse(await file.text()));
        if (!recovered.ok) {
          throw new Error(recovered.error);
        }
        recoveryIssues = recovered.issues;
        imported = repairDuplicateTopLevelIds(
          ensurePageLayout(recovered.document),
          DOCUMENT_BLOCK_OPERATION_PORTS,
        );
      }
      const now = new Date().toISOString();
      const importedDocument = repairDuplicateTopLevelIds(ensurePageLayout({
        ...imported,
        docId: createId("doc"),
        metadata: {
          ...imported.metadata,
          title: imported.metadata.title || file.name.replace(/\.[^.]+$/, "") || tEditor("status.importedDocumentTitle"),
        },
        updatedAt: now,
      }), DOCUMENT_BLOCK_OPERATION_PORTS);
      if (embeddedHostRef.current) {
        resetEditorDocument(importedDocument, undefined, null);
        setOpenFileIds([importedDocument.docId]);
        setActiveFileId(importedDocument.docId);
        setSaveState("saved");
        setStatusMessage(isPrt ? tEditor("status.legacyImported") : isSpr ? tEditor("status.archiveImported") : isTex ? tEditor("status.texConverted") : isSlides ? tEditor("status.presentationConverted") : tEditor("status.jsonImported"));
        announceRecovery(recoveryIssues);
        return;
      }
      if (workspaceReady && !(await saveCurrentDocumentBeforeReplacement())) {
        return;
      }
      const importedRecord = await createDocumentFromSigmaDocument(importedDocument);
      await openDocumentAsTab(importedRecord, isPrt ? tEditor("status.legacyImported") : isSpr ? tEditor("status.archiveImported") : isTex ? tEditor("status.texConverted") : isSlides ? tEditor("status.presentationConverted") : tEditor("status.jsonImported"));
      announceRecovery(recoveryIssues);
    } catch (error) {
      if (error instanceof EditorMathPrtPasswordError && options.editorMathPassword !== undefined) {
        throw error;
      }
      setSaveState("error");
      setStatusMessage(error instanceof Error ? error.message : tEditor("status.fileReadFailed"));
    }
  };

  const openImportDialog = () => {
    setActiveMenu(null);
    if (isDesktopApp) {
      void openImportDocumentViaDesktop();
      return;
    }
    importInputRef.current?.click();
  };

  const openOtherImportDialog = EDITOR_MATH_IMPORT_AVAILABLE ? () => {
    setActiveMenu(null);
    const bridge = getDesktopBridge();
    if (isDesktopApp && bridge?.file.openImportOtherDocument) {
      void (async () => {
        try {
          const result = await bridge.file.openImportOtherDocument!();
          if (!result) {
            return;
          }
          const baseName = result.filePath.split(/[\\/]/).pop() ?? DEFAULT_EDITOR_MATH_IMPORT_FILENAME;
          const binary = window.atob(result.dataBase64);
          const bytes = new Uint8Array(binary.length);
          for (let index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.charCodeAt(index);
          }
          await importDocumentFile(new File([bytes], baseName));
        } catch (error) {
          setSaveState("error");
          setStatusMessage(error instanceof Error ? error.message : tEditor("status.fileReadFailed"));
        }
      })();
      return;
    }
    otherImportInputRef.current?.click();
  } : () => undefined;

  const cancelEditorMathImport = () => {
    setEditorMathPasswordRequest(null);
    setEditorMathPassword("");
    setEditorMathPasswordError(null);
    setEditorMathImporting(false);
  };

  const submitEditorMathPassword = async () => {
    if (!editorMathPasswordRequest || editorMathImporting) {
      return;
    }
    if (!editorMathPassword) {
      setEditorMathPasswordError(tEditor("status.passwordRequired"));
      return;
    }
    setEditorMathImporting(true);
    setEditorMathPasswordError(null);
    try {
      await importDocumentFile(editorMathPasswordRequest, { editorMathPassword });
      cancelEditorMathImport();
    } catch (error) {
      if (error instanceof EditorMathPrtPasswordError) {
        setEditorMathPasswordError(error.message);
      } else {
        cancelEditorMathImport();
      }
    } finally {
      setEditorMathImporting(false);
    }
  };

  const desktopMenuHandlersRef = useRef({
    newDocument: () => undefined as unknown,
    openDocument: () => undefined as unknown,
    saveDocument: () => undefined as unknown,
    printDocument: () => undefined as unknown,
    openSettings: () => undefined as unknown,
    checkUpdates: () => undefined as unknown,
  });

  useEffect(() => {
    desktopMenuHandlersRef.current = {
      newDocument: createDocumentTab,
      openDocument: openDocumentViaDesktop,
      saveDocument: exportJson,
      printDocument: openPrintPreview,
      openSettings: () => {
        setDesktopSettingsUpdateCheckRequest(0);
        setDesktopSettingsOpen(true);
      },
      checkUpdates: () => {
        setDesktopSettingsUpdateCheckRequest((current) => current + 1);
        setDesktopSettingsOpen(true);
      },
    };
  });

  useEffect(() => {
    if (!isDesktopApp) {
      return;
    }
    const bridge = getDesktopBridge();
    if (!bridge) {
      return;
    }
    return bridge.onMenuAction((action) => {
      const h = desktopMenuHandlersRef.current;
      if (action === "new-document") {
        void h.newDocument();
      } else if (action === "open-document") {
        void h.openDocument();
      } else if (action === "save-document") {
        void h.saveDocument();
      } else if (action === "print-document") {
        h.printDocument();
      } else if (action === "open-settings") {
        h.openSettings();
      } else if (action === "check-updates") {
        h.checkUpdates();
      }
    });
  }, [isDesktopApp]);

  useEffect(() => {
    if (!isDesktopApp) {
      return;
    }

    const bridge = getDesktopBridge();
    if (!bridge?.updater) {
      return;
    }
    const { updater } = bridge;

    let cancelled = false;
    const applyUpdateState = (state: DesktopUpdateState) => {
      if (!cancelled) {
        setAppUpdateState(state);
      }
    };

    updater.getStatus().then((state) => {
      applyUpdateState(state);
      if (!state.supported || state.phase !== "idle" || appUpdateAutoCheckStartedRef.current) {
        return;
      }

      appUpdateAutoCheckStartedRef.current = true;
      void updater.checkForUpdates().then(applyUpdateState).catch(() => undefined);
    }).catch(() => undefined);

    const unsubscribe = updater.onStatusChange(applyUpdateState);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [isDesktopApp]);

  useEffect(() => {
    if (isEmbedded) {
      return;
    }

    let cancelled = false;
    let reloadRevision = 0;
    const processDocumentChange = (event: DocumentStorageChangeEvent) => {
      const eventFileId = event.fileId;
      const revision = ++reloadRevision;
      if (eventFileId === activeFileIdRef.current) {
        externalChangeFileIdsRef.current.add(eventFileId);
      }

      void (async () => {
        try {
          await refreshDocumentMetadatas();

          if (cancelled || revision !== reloadRevision || eventFileId !== activeFileIdRef.current) {
            return;
          }

          if (event.change === "deleted") {
            await switchAwayFromDeletedFile(eventFileId);
            return;
          }

          if (hasPendingAiApprovalForFile(pendingAiApprovalAdoptionRef.current, eventFileId)) {
            // The approval IPC already returned the authoritative payload and
            // revision held by the pending guard. Its delayed watcher event must
            // not lend that revision to the still-unbacked user payload or route
            // it through generic external merge. Autosave remains blocked until
            // explicit backup + adoption succeeds.
            return;
          }

          const loaded = await loadWorkspaceDocument(eventFileId);
          if (cancelled || revision !== reloadRevision || eventFileId !== activeFileIdRef.current) {
            return;
          }

          if (!loaded) {
            setSaveState("error");
            setStatusMessage(tEditor("status.externalLoadFailed"));
            return;
          }

          const migrated = repairDuplicateTopLevelIds(
            ensurePageLayout(loaded.document),
            DOCUMENT_BLOCK_OPERATION_PORTS,
          );
          if (areSigmaDocumentsEquivalent(migrated, documentRef.current)) {
            // Payloadが正本と構造的に同一だと確認できた場合だけ、新しいrevisionを採用する。
            // approve/revert自身の通知はここでno-opになり、reject/rebase中の外部writerが
            // 同一内容を再保存したケースでも、次の人手編集はstale revisionを使わない。
            documentObservedRevisionRef.current = loaded.observedRevision;
            lastSyncedDocumentRef.current = migrated;
            pendingAutoAppliedProposalIdsByFileRef.current.delete(eventFileId);
            return;
          }

          const autoAppliedProposalIds = pendingAutoAppliedProposalIdsByFileRef.current.get(eventFileId)
            ?? event.autoAppliedProposalIds
            ?? [];

          // タイピング中(dirty)にAI提案の自動承認などで外部変更が来た場合、従来は教材全体を
          // リロードし人間の未保存編集を別教材へ退避していた。ブロック単位で安全にマージできる
          // なら (同じ対象を両方が触っていなければ)、退避せずその場で取り込む — 人間の未保存編集
          // はマージ結果にそのまま残るので、その後の自動保存(450msデバウンス)で自然に永続化される。
          if (isCurrentDocumentDirty()) {
            const mergeResult = mergeExternalDocumentChange(lastSyncedDocumentRef.current, documentRef.current, migrated);
            if (mergeResult.ok) {
              if (autoAppliedProposalIds.length > 0) {
                applyAutoApprovedExternalDocument({
                  nextDocument: mergeResult.merged,
                  syncedDocument: migrated,
                  syncedRevision: loaded.observedRevision,
                  proposalIds: autoAppliedProposalIds,
                });
              } else {
                applyMergedExternalDocument(mergeResult.merged, migrated, loaded.observedRevision);
              }
              await refreshDocumentMetadatas();
              pendingAutoAppliedProposalIdsByFileRef.current.delete(eventFileId);
              setSaveState("saved");
              setStatusMessage(tEditor("status.aiMerged"));
              return;
            }
            // マージできなかった場合は、以降の従来どおりの退避フローにフォールバックする。
          }

          const backup = await saveUnsavedEditBackup();
          if (cancelled || revision !== reloadRevision || eventFileId !== activeFileIdRef.current) {
            return;
          }

          const currentSelectedId = selectedIdRef.current;
          const nextSelectedId = currentSelectedId && findBlock(migrated, currentSelectedId)
            ? currentSelectedId
            : getDefaultDocumentSelectionId(migrated);
          const nextOpenFileIds = uniqueStringIds([
            ...openFileIdsRef.current,
            ...(backup ? [backup.fileId] : []),
            eventFileId,
          ]);

          if (autoAppliedProposalIds.length > 0) {
            applyAutoApprovedExternalDocument({
              nextDocument: migrated,
              syncedDocument: migrated,
              syncedRevision: loaded.observedRevision,
              proposalIds: autoAppliedProposalIds,
            });
          } else {
            resetEditorDocument(migrated, nextSelectedId, loaded.observedRevision);
          }
          setOpenFileIds(nextOpenFileIds);
          setActiveFileId(eventFileId);
          pendingAutoAppliedProposalIdsByFileRef.current.delete(eventFileId);
          await saveWorkspaceState({ openFileIds: nextOpenFileIds, activeFileId: eventFileId });
          await refreshDocumentMetadatas();
          setSaveState("saved");
          setStatusMessage(backup
            ? tEditor("status.externalLoadedSetAside")
            : tEditor("status.externalLoaded"));
        } finally {
          externalChangeFileIdsRef.current.delete(eventFileId);
        }
      })().catch((error) => {
        if (cancelled) {
          return;
        }
        setSaveState("error");
        setStatusMessage(error instanceof Error ? error.message : tEditor("status.externalLoadFailed"));
      });
    };
    documentStorageChangeProcessorRef.current = processDocumentChange;

    // desktop は fs.watch、web は他タブからの BroadcastChannel。どちらも同じ形の
    // 変更イベントで届くので、購読側は保存先を意識しない。
    const unsubscribe = getAppRuntime().library.onChange((event) => {
      if (!isDesktopStorageChangeEvent(event) || !workspaceReadyRef.current) {
        return;
      }

      if (event.type === "workspace" || event.type === "library") {
        void refreshDocumentMetadatas();
        return;
      }

      if (event.type === "mcpProposal") {
        void refreshMcpEditProposals();
        return;
      }

      if (event.type === "watcher") {
        setDegradedWatcherScopes((current) => updateDegradedWatcherScopes(current, event));
        return;
      }

      // approve/revertだけでなく、正本文書を返さないreject/rebase中にも通知は届き得る。
      // active fileの最新1件を保留し、busy解除後に通常のload/merge経路へ必ず流す。
      // approve/revert自身の通知は、返却済み正本と構造的に同一なら下の比較で自然にno-opになる。
      dispatchDocumentStorageChange(event);
    });

    return () => {
      cancelled = true;
      if (documentStorageChangeProcessorRef.current === processDocumentChange) {
        documentStorageChangeProcessorRef.current = null;
      }
      unsubscribe();
    };
  }, [
    applyAutoApprovedExternalDocument,
    applyMergedExternalDocument,
    dispatchDocumentStorageChange,
    isCurrentDocumentDirty,
    isEmbedded,
    loadWorkspaceDocument,
    refreshDocumentMetadatas,
    refreshMcpEditProposals,
    resetEditorDocument,
    saveUnsavedEditBackup,
    setSaveState,
    setStatusMessage,
    switchAwayFromDeletedFile,
  ]);

  const updateMetadata = (metadata: SigmaDocument["metadata"]) => {
    commitDocumentChange((current) => ({
      ...current,
      metadata,
      updatedAt: new Date().toISOString(),
    }));
  };

  const updatePageLayoutAndMetadata = (pageLayout: PageLayout, metadata: SigmaDocument["metadata"]) => {
    const normalizedLayout = expandMarginsForRunningRegions(normalizePageLayout(pageLayout));
    const issues = getPageLayoutIssues(normalizedLayout);
    if (issues.length > 0) {
      // コードで返るので、表示は `shape` 辞書で行う。
      setStatusMessage(formatSigmaValidationCode(issues[0], { min: MIN_PAGE_BODY_HEIGHT_MM }, tShape));
      return;
    }

    commitDocumentChange((current) => {
      const withLayout = ensurePageLayout(current);
      const switchingToWhiteboard = isWhiteboardPageLayout(normalizedLayout)
        && !isWhiteboardPageLayout(withLayout.pageLayout);
      const preparedDocument = switchingToWhiteboard
        ? convertOverlayToWhiteboard(withLayout, measuredBodyBlockRectsRef.current)
        : ensureOverlayAnchorOffsets(withLayout);
      const overlay = preparedDocument.pageLayout?.overlay ?? normalizedLayout.overlay;
      return {
        ...preparedDocument,
        pageLayout: {
          ...normalizedLayout,
          overlay,
        },
        metadata,
        updatedAt: new Date().toISOString(),
      };
    });
    if (isWhiteboardPageLayout(normalizedLayout) && !isWhiteboardDocument) {
      setCommentsPanelOpen(false);
    }
  };

  const handleCanvasHeadingCommand = useStableCallback((request: TextFlowHeadingCommandRequest): boolean =>
    handleHeadingCommandAutoNumbering(documentRef.current, updatePageLayoutAndMetadata, request));

  // Apply feedback is derived from the document that was actually returned by
  // the approval IPC. The old content is never held on screen for a pre-apply
  // exit animation; after the authoritative swap, the written nodes briefly
  // flash to show exactly what landed.
  const [aiApplyAnimation, setAiApplyAnimation] = useState<AiApplyAnimationState | null>(null);
  const aiApplyAnimationClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (aiApplyAnimationClearTimerRef.current) {
      clearTimeout(aiApplyAnimationClearTimerRef.current);
    }
  }, []);

  const clearAiEditPreview = useCallback((
    outcome: "applied" | "dismissed" = "dismissed",
    targets?: Array<{ roomId?: string; turnId?: string }>,
    includeResolved = false,
  ) => {
    setAiEditPreviewClearRequest((current) => ({ seq: current.seq + 1, outcome, targets, includeResolved }));
  }, []);

  // W2: `options.force` は「AIの提案で上書き」(競合stale提案の強制承認) から使う。承認IPC
  // 自体が force:true のとき鮮度確認(baseRevision一致・conflict無し)を丸ごとスキップするため、
  // 呼び出し元にはこの関数の戻り値 (ok/reason) を返し、AiStaleProposalNotice が group単位の
  // busy/エラー表示をできるようにする (rebaseStaleProposals と同じ形)。
  // `options.skipBusyGuard` は「復元→即承認」の1クリック合成フロー (restoreProposalFromHistory)
  // 専用: 呼び出し元がすでに busy を握っている (復元IPC実行中) 状態から続けて承認まで進めるため、
  // ここで busy を一旦解除→再取得する隙間 (他操作が割り込める窓) を作らないようにする。
  const handleMcpEditPreview = async (
    proposalIds: string[],
    options?: {
      force?: boolean;
      skipBusyGuard?: boolean;
      resolutionTargets?: Array<{ roomId?: string; turnId?: string }>;
      includeResolvedTurns?: boolean;
      disableLegacyResolutionFallback?: boolean;
    },
  ): Promise<{ ok: true } | { ok: false; reason: string }> => {
    const bridge = getDesktopBridge();
    if (!bridge?.storage.approveMcpEditProposals || proposalIds.length === 0) {
      setStatusMessage(tEditor("status.applyFailed"));
      return { ok: false, reason: tEditor("status.applyFailed") };
    }
    // Capture the tab that owned the clicked proposal. Some compatible desktop
    // bridges omit the optional `file` metadata even though they return the
    // approved document. The proposal surface is already scoped to this tab,
    // so this id is the safe fallback; the second equality below still prevents
    // a slow approval from being painted into a tab the user switched to.
    const requestedFileId = activeFileIdRef.current;
    if (!options?.skipBusyGuard) {
      const busyFeedback = deriveAiProposalBusyGuardFeedback(
        mcpPreviewBusyRef.current,
        aiDocumentWriteInProgressMessage(),
        setStatusMessage,
        tAi,
      );
      if (busyFeedback) {
        return busyFeedback.outcome;
      }
      mcpPreviewBusyRef.current = true;
      setMcpPreviewBusy(true);
    }
    if (aiApplyAnimationClearTimerRef.current) {
      clearTimeout(aiApplyAnimationClearTimerRef.current);
      aiApplyAnimationClearTimerRef.current = null;
    }
    // 決定B: 1プレビュー単位 = 1 apply/dismiss。ここで対応する AiEditPreviewState を
    // 引き当てられれば、その提案が実際に変更する id からアニメーション対象を導ける
    // (dismissAiEditPreviewGroup と同じ proposalIds 一致判定)。見つからなくても
    // apply自体は続行し、アニメーションだけスキップする。
    const applyContext = buildAiProposalApplyContext(
      proposalIds,
      aiEditPreviewGroups,
      staleProposalGroups,
    );
    const group = applyContext.previewGroup;
    // 削除/置換されるブロック・図形の「消える」アニメーションは、下の
    // resetEditorDocument による同期的な全文書差し替えより前に、まだ画面に
    // 残っている旧内容に対して再生する必要がある — 差し替え後では対象がもう存在しない。
    if (group) {
      const diff = deriveAiEditPreviewDiff([group]);
      const removingBlockIds = [...diff.removedBlockIds];
      const removingShapeIds = [...diff.removedShapeIds];
      if (removingBlockIds.length > 0 || removingShapeIds.length > 0) {
        setAiApplyAnimation({ removingBlockIds, removingShapeIds, addedBlockIds: [], addedShapeIds: [] });
        await new Promise((resolve) => setTimeout(resolve, AI_APPLY_REMOVE_ANIMATION_MS));
      }
    }
    try {
      const serializedApply = await runSerializedMcpEditPreview({
        // overlay canvasは250ms debounceでEditorShellへ反映するため、承認直前に同期flushする。
        // 直後に既存autosaveを待ってからdirty save→承認IPCの順に固定する。
        flushOverlayChanges,
        inFlightSaveRef: inFlightSavePromiseRef,
        isCurrentDocumentDirty,
        saveCurrentDocumentRecord,
        onBeforeSave: () => setSaveState("saving"),
        getDocumentAtApprovalStart: () => lastSyncedDocumentRef.current,
        approve: () => bridge.storage.approveMcpEditProposals!(
          proposalIds,
          options?.force ? { force: true } : undefined,
        ),
      });
      if (!serializedApply.ok) {
        if (serializedApply.saveResult.code === "revision-mismatch") {
          await refreshDocumentMetadatas();
          const message = tEditor("status.saveInFlight");
          setStatusMessage(message);
          setAiApplyAnimation(null);
          dispatchDocumentStorageChange({
            type: "document",
            fileId: requestedFileId,
            change: "changed",
            timestamp: Date.now(),
          });
          return { ok: false, reason: message };
        }
        const saveResult = serializedApply.saveResult;
        const message = saveResult.error ?? tEditor("status.preApprovalSaveFailed");
        setSaveState("error");
        setStatusMessage(message);
        setAiApplyAnimation(null);
        return { ok: false, reason: message };
      }
      const { approvalResult: result, documentAtApprovalStart } = serializedApply;
      if (!result.ok) {
        setSaveState("error");
        // 競合(強制上書き失敗)は「対象ブロックが承認前に変更されている」といった生の
        // エラー文言をそのまま出さず、競合UI(AiStaleProposalNotice)へ誘導する文言にする —
        // refreshMcpEditProposals() 後もこの提案は pending のまま (conflict付きで) 残り、
        // 下の競合バナーから引き続き選択できる。
        const message = options?.force
          ? tEditor("status.aiOverwriteFailed")
          : result.error;
        setStatusMessage(message);
        await refreshMcpEditProposals();
        setAiApplyAnimation(null);
        return { ok: false, reason: message };
      }
      // 一部が failed で pending に残った場合、それらは確定していない — 楽観的除去(Issue 2)と
      // undoエントリ(Issue 3)には実際に適用されたIDだけを記録する。
      const applyDecision = deriveAiProposalApplyDecision(
        proposalIds,
        result.failed ?? [],
        applyContext,
        {
          force: options?.force,
          resolutionTargets: options?.resolutionTargets,
          disableLegacyResolutionFallback: options?.disableLegacyResolutionFallback,
        },
        tAi,
      );
      const appliedIds = applyDecision.appliedProposalIds;
      appliedIds.forEach((proposalId) => locallyResolvedProposalIdsRef.current.add(proposalId));
      const approvedFileId = result.file?.fileId ?? requestedFileId;
      let approvedDocument = result.document;
      let approvedRevision = result.file?.revision ?? null;
      if (
        (!approvedDocument || approvedRevision === null)
        && approvedFileId === requestedFileId
        && requestedFileId === activeFileIdRef.current
      ) {
        // Never pair an approval payload with a revision inferred from an old
        // renderer cache. Recovery load returns document + observed revision as
        // one authoritative snapshot.
        const recoveryLoad = await bridge.storage.loadDocumentWithRecovery?.(approvedFileId);
        if (recoveryLoad?.ok) {
          approvedDocument = recoveryLoad.document;
          approvedRevision = recoveryLoad.revision;
        }
      }
      const approvedDocumentTitle = result.file?.title
        ?? metadataByFileId.get(approvedFileId)?.title
        ?? mcpProposalCitations.find((proposal) => (
          proposal.fileId === approvedFileId && proposalIds.includes(proposal.proposalId)
      ))?.title;
      let approvedDocumentStayedDirty = false;
      let approvedDocumentWarning: string | null = null;
      let approvedDocumentAdoptionBlocked = false;
      if (
        approvedDocument
        && approvedRevision !== null
        && approvedFileId === requestedFileId
        && requestedFileId === activeFileIdRef.current
      ) {
        // diskDocumentはrepair前の承認IPC保存内容。正本基準をrepair後へずらすと、
        // normalizeで生じた差分を保存済み扱いして二度とディスクへ書けなくなる。
        const diskDocument = parseSigmaDocument(approvedDocument);
        const normalizedApprovedDocument = repairDuplicateTopLevelIds(
          ensurePageLayout(diskDocument),
          DOCUMENT_BLOCK_OPERATION_PORTS,
        );
        // Issue 3: resetEditorDocument (undo/redoスタック全消し) ではなく、undo可能な1手として反映する。
        const adoption = applyAiApprovedDocument({
          diskDocument,
          normalizedApprovedDocument,
          documentAtApprovalStart,
          appliedProposalIds: appliedIds,
          approvedRevision,
        });
        approvedDocumentStayedDirty = !adoption.adoptedDocumentMatchesDisk;
        if (adoption.kind === "stay-dirty") {
          // currentDocumentはapprovedRevisionから派生していないため、そのrevisionを借りて
          // 保存してはいけない。先に別教材へ退避できた場合だけ、承認済み正本へ差し替える。
          // 失敗時は承認結果をrefへ残し、現在のin-memory入力を保持したまま再試行可能にする。
          const pendingAdoption: PendingAiApprovalAdoption = {
            fileId: approvedFileId,
            document: normalizedApprovedDocument,
            revision: approvedRevision,
            userDocument: documentRef.current,
            userDocumentDirtyRevision: documentDirtyRevisionRef.current,
          };
          // 最初のbackup await中もautosave停止・beforeunload警告を有効にする。成功した場合だけ
          // performApprovedDocumentAdoption内のclearPendingAiApprovalAdoptionで解除する。
          beginPendingAiApprovalAdoption(
            pendingAiApprovalAdoptionRef,
            pendingAdoption,
            setHasPendingAiApprovalAdoption,
          );
          const replacement = await adoptApprovedDocumentAfterBackup(pendingAdoption);
          if (!replacement.ok) {
            console.warn(tEditor("status.approvalSetAsideFailed"), replacement.error);
            approvedDocumentAdoptionBlocked = true;
            approvedDocumentWarning = tEditor("status.approvalKeptNotMerged");
          } else {
            approvedDocumentStayedDirty = false;
            approvedDocumentWarning = replacement.backup
              ? tEditor("status.aiMergedInputSetAside")
              : tEditor("status.aiMergedDone");
          }
        }
        if (adoption.kind !== "stay-dirty" && approvedDocumentStayedDirty) {
          scheduleAutosaveRetry();
        }
      }
      await refreshDocumentMetadatas();
      await refreshMcpEditProposals();
      if (applyDecision.resolvedTargets.length > 0) {
        clearAiEditPreview(
          "applied",
          applyDecision.resolvedTargets,
          options?.includeResolvedTurns ?? true,
        );
      } else if (applyDecision.shouldUseLegacyResolutionFallback) {
        // 帰属情報を持たない旧提案だけはactive room全体へfallbackする。
        clearAiEditPreview("applied");
      }
      setSaveState(approvedDocumentAdoptionBlocked
        ? "error"
        : approvedDocumentStayedDirty ? "saving" : "saved");
      const approvedFileFeedback = deriveAiProposalApprovedFileFeedback({
        approvedFileId,
        currentFileId: activeFileIdRef.current,
        approvedDocumentTitle,
        activeDocumentStatusMessage: approvedDocumentWarning ?? applyDecision.statusMessage,
        t: tAi,
        tEditor,
      });
      setStatusMessage(approvedFileFeedback.statusMessage);
      // Now that the new content actually exists in the (just swapped-in)
      // document, flash it green briefly instead of leaving the removal state on.
      const highlight = (
        approvedFileFeedback.kind === "paint-active-document"
        && approvedFileId === requestedFileId
        && !approvedDocumentAdoptionBlocked
        && group
      )
        ? derivePostApplyHighlightIds(group)
        : null;
      if (highlight && (highlight.blockIds.length > 0 || highlight.shapeIds.length > 0)) {
        setAiApplyAnimation({
          removingBlockIds: [],
          removingShapeIds: [],
          addedBlockIds: highlight.blockIds,
          addedShapeIds: highlight.shapeIds,
        });
        aiApplyAnimationClearTimerRef.current = setTimeout(() => {
          setAiApplyAnimation(null);
          aiApplyAnimationClearTimerRef.current = null;
        }, AI_APPLY_ADD_FLASH_MS);
      } else {
        setAiApplyAnimation(null);
      }
      if (approvedDocumentAdoptionBlocked) {
        return { ok: false, reason: approvedDocumentWarning ?? tEditor("status.aiMergeFailed") };
      }
      return applyDecision.outcome;
    } catch (error) {
      const reason = error instanceof Error ? error.message : tEditor("status.applyFailed");
      setSaveState("error");
      setStatusMessage(reason);
      setAiApplyAnimation(null);
      return { ok: false, reason };
    } finally {
      if (!options?.skipBusyGuard) {
        finishMcpPreviewBusy();
      }
    }
  };

  const retryPendingAiApprovalAdoption = async () => {
    const pending = pendingAiApprovalAdoptionRef.current;
    if (!pending || mcpPreviewBusyRef.current) {
      return;
    }
    mcpPreviewBusyRef.current = true;
    setMcpPreviewBusy(true);
    setSaveState("saving");
    try {
      const replacement = await adoptApprovedDocumentAfterBackup(pending);
      if (!replacement.ok) {
        console.warn(tEditor("status.approvalSetAsideFailed"), replacement.error);
        setSaveState("error");
        setStatusMessage(tEditor("status.approvalNoSetAsideTarget"));
        return;
      }
      await refreshDocumentMetadatas();
      setSaveState("saved");
      setStatusMessage(replacement.backup
        ? tEditor("status.aiMergedInputSetAside")
        : tEditor("status.aiMergedDone"));
    } finally {
      finishMcpPreviewBusy();
    }
  };

  // 決定B: N個のプレビュー単位それぞれが自分の proposalIds で適用/破棄する。
  const applyAiEditPreviewGroup = (proposalIds: string[]) => handleMcpEditPreview(proposalIds);

  // W2: 競合stale提案の「AIの提案で上書き」。承認IPCへforce:trueを渡し、鮮度確認(選択範囲の
  // 内容一致・conflict無し)を丸ごとスキップして人間の編集を上書きする。破壊的操作なので、
  // AiStaleProposalNoticeの二次アクション(誤クリックしにくいスタイル)からしか呼ばない。
  const forceApplyStaleProposals = (proposalIds: string[]) => handleMcpEditPreview(proposalIds, { force: true });

  // 「すべて適用」: この教材の pending 提案 (全run) を1操作でまとめて承認する。run跨ぎでも
  // batch承認IPCが現在docへ順にreplayして適用し、衝突した提案だけが failed (pendingのまま
  // stale notice行き) として残る (partial success)。
  const applyAllAiEditPreviewGroups = async () => {
    const allProposalIds = aiProposalPresentation.allVisibleProposalIds;
    if (allProposalIds.length === 0) {
      return;
    }
    await handleMcpEditPreview(allProposalIds);
  };

  // 却下の結果。呼び出し側はこれを見て正しいメッセージ選択・状態更新をする責任を持つ:
  // - "empty": 却下対象がそもそも無かった (no-op)。
  // - "busy": 別のapply/dismissが進行中で何も実行しなかった (no-op)。
  // - { rejectedCount, failedCount }: 実行結果。1件の失敗で残りを取りこぼさないよう、
  //   各提案を独立に却下しており、部分失敗もあり得る。
  const rejectProposals = async (proposalIds: string[], reason?: string): Promise<RejectProposalsOutcome> => {
    if (proposalIds.length === 0) {
      return "empty";
    }
    const bridge = getDesktopBridge();
    if (!bridge) {
      return "busy";
    }
    const busyFeedback = deriveAiProposalBusyGuardFeedback(
      mcpPreviewBusyRef.current,
      aiDocumentWriteInProgressMessage(),
      setStatusMessage,
      tAi,
    );
    if (busyFeedback) {
      return "busy";
    }
    mcpPreviewBusyRef.current = true;
    setMcpPreviewBusy(true);
    try {
      // 新API (理由つき・一括) を優先し、古いpreloadビルドでは単体版にフォールバックする。
      if (bridge.storage.rejectMcpEditProposals) {
        const result = await bridge.storage.rejectMcpEditProposals(proposalIds, reason);
        if (result.ok) {
          // Issue 2: 却下も承認と同様に楽観的に確定させ、watcherの遅延再取得で復活して見えるレースを潰す。
          const failedIds = new Set(result.failed.map((failure) => failure.proposalId));
          proposalIds
            .filter((proposalId) => !failedIds.has(proposalId))
            .forEach((proposalId) => locallyResolvedProposalIdsRef.current.add(proposalId));
        }
        await refreshMcpEditProposals();
        if (!result.ok) {
          return { rejectedCount: 0, failedCount: proposalIds.length };
        }
        return { rejectedCount: result.proposals.length, failedCount: result.failed.length };
      }
      if (!bridge.storage.rejectMcpEditProposal) {
        return "busy";
      }
      const results = await Promise.allSettled(
        proposalIds.map((proposalId) => bridge.storage.rejectMcpEditProposal(proposalId)),
      );
      proposalIds
        .filter((_, index) => results[index]?.status === "fulfilled")
        .forEach((proposalId) => locallyResolvedProposalIdsRef.current.add(proposalId));
      const failedCount = results.filter((result) => result.status === "rejected").length;
      await refreshMcpEditProposals();
      return { rejectedCount: results.length - failedCount, failedCount };
    } finally {
      finishMcpPreviewBusy();
    }
  };

  const applyAiProposalRejectEffects = (effects: AiProposalRejectEffect[]) => {
    for (const effect of effects) {
      if (effect.type === "status") {
        setStatusMessage(effect.message);
        continue;
      }
      if (effect.type === "clearPreview") {
        clearAiEditPreview(effect.outcome, effect.targets);
        continue;
      }
      submitRejectionFeedback({
        roomId: effect.roomId,
        turnId: effect.turnId,
        reason: effect.reason,
        proposalSummaries: effect.proposalSummaries,
        documentIdentityKey: activeFileId,
        document,
      });
    }
  };

  const dismissAiEditPreviewGroup = async (proposalIds: string[], reason?: string) => {
    const group = findAiProposalGroupByIds(aiEditPreviewGroups, proposalIds);
    const outcome = proposalIds.length > 0 ? await rejectProposals(proposalIds, reason) : "empty";
    applyAiProposalRejectEffects(
      deriveAiProposalDismissEffects(group, outcome, reason, tAi),
    );
  };

  const discardStaleProposals = async (proposalIds: string[]) => {
    const group = findAiProposalGroupByIds(staleProposalGroups, proposalIds);
    const outcome = await rejectProposals(proposalIds);
    applyAiProposalRejectEffects(
      deriveAiStaleProposalDiscardEffects(group, outcome, tAi),
    );
  };

  const rebaseStaleProposals = async (proposalIds: string[]): Promise<{ ok: true } | { ok: false; reason: string }> => {
    const bridge = getDesktopBridge();
    if (!bridge?.storage.rebaseMcpEditProposal || proposalIds.length === 0) {
      return { ok: false, reason: tEditor("status.regenerateUnsupported") };
    }
    if (mcpPreviewBusyRef.current) {
      return { ok: false, reason: tEditor("status.otherOperationRunning") };
    }
    mcpPreviewBusyRef.current = true;
    setMcpPreviewBusy(true);
    try {
      const results = await Promise.all(proposalIds.map((proposalId) => bridge.storage.rebaseMcpEditProposal!(proposalId)));
      await refreshMcpEditProposals();
      const failure = results.find((result): result is { ok: false; reason: string } => !result.ok);
      if (failure) {
        return { ok: false, reason: failure.reason };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : tEditor("status.regenerateFailed") };
    } finally {
      finishMcpPreviewBusy();
    }
  };

  // AIチャット履歴 / AIタスクDockの「復元」ボタン共通の1クリック合成フロー: 却下・差し戻し
  // 済みの提案を承認可否に関わらずワンクリックで本文へ戻す。復元IPC (pendingへ戻す) が成功
  // したら、そのままこの提案だけを承認IPC (handleMcpEditPreview、既存の承認導線と共通) に
  // 渡して適用まで進める。承認側で鮮度衝突が検出された場合は復元自体は成功済み(pendingに
  // 戻っている)なのでレコードはそのまま残し、既存のstale提案UIが後続で表面化するのに任せ、
  // ここでは理由だけ呼び出し元に返す。busyは復元→承認の間ずっと1つのガードで保持し続ける
  // (handleMcpEditPreviewにはskipBusyGuardを渡し、二重ガード/隙間を作らない)。
  const restoreProposalFromHistory = async (
    proposalIdsInput: string | string[],
  ): Promise<{ ok: true } | { ok: false; reason: string }> => {
    const bridge = getDesktopBridge();
    if (!bridge?.storage.restoreMcpEditProposal) {
      return { ok: false, reason: tEditor("status.reproposeUnsupported") };
    }
    const busyFeedback = deriveAiProposalBusyGuardFeedback(
      mcpPreviewBusyRef.current,
      aiDocumentWriteInProgressMessage(),
      setStatusMessage,
      tAi,
    );
    if (busyFeedback) {
      return busyFeedback.outcome;
    }
    mcpPreviewBusyRef.current = true;
    setMcpPreviewBusy(true);
    try {
      const proposalIds = normalizeAiProposalIds(proposalIdsInput);
      if (proposalIds.length === 0) {
        return { ok: false, reason: tEditor("status.noEditToRestore") };
      }
      const resolutionTargets = deriveAiProposalResolutionTargets(
        mcpProposalCitations,
        proposalIds,
      );
      const restoredProposalIds: string[] = [];
      for (const proposalId of proposalIds) {
        const restored = await bridge.storage.restoreMcpEditProposal(proposalId);
        if (!restored.ok) {
          if (restoredProposalIds.length > 0) {
            if (bridge.storage.rejectMcpEditProposals) {
              await bridge.storage.rejectMcpEditProposals(restoredProposalIds);
            } else if (bridge.storage.rejectMcpEditProposal) {
              await Promise.all(restoredProposalIds.map((restoredId) => (
                bridge.storage.rejectMcpEditProposal!(restoredId)
              )));
            }
          }
          await refreshMcpEditProposals();
          return { ok: false, reason: restored.error };
        }
        restoredProposalIds.push(proposalId);
      }
      const approved = await handleMcpEditPreview(proposalIds, {
        skipBusyGuard: true,
        resolutionTargets,
        includeResolvedTurns: true,
        disableLegacyResolutionFallback: true,
      });
      if (!approved.ok) {
        return { ok: false, reason: approved.reason };
      }
      setStatusMessage(tEditor("status.editRestored"));
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : tEditor("status.reproposeFailed") };
    } finally {
      finishMcpPreviewBusy();
    }
  };

  // AIチャットの適用済みウィジェット / AIタスクDock共通の「元に戻す」。提案群は一括承認時に
  // 同じrevertDocumentとappliedRevisionを共有するため、main側は1件のIDからそのバッチ全体を
  // 引いて巻き戻す (getRevertPlan)。1つのturnが複数回の保存にまたがっている場合は、バッチを
  // 新しい保存revisionから順に巻き戻す — buildSelectiveRevertDocument は「後から積んだ変更を
  // 先に剥がす」合成でしか元の教材へ戻らないため、この順序は必須。
  const revertAppliedProposals = async (
    proposalIdsInput: string | string[],
  ): Promise<{ ok: true } | { ok: false; reason: string }> => {
    const bridge = getDesktopBridge();
    if (!bridge?.storage.revertMcpEditProposal) {
      const reason = tEditor("status.revertUnsupported");
      setStatusMessage(reason);
      return { ok: false, reason };
    }
    if (mcpPreviewBusyRef.current) {
      return { ok: false, reason: tEditor("status.otherOperationRunning") };
    }
    const proposalIds = normalizeAiProposalIds(proposalIdsInput);
    if (proposalIds.length === 0) {
      return { ok: false, reason: tEditor("status.noEditToRevert") };
    }
    // revert no longer requires the document to still be at the exact appliedRevision —
    // main resolves the actual revert plan (full vs. selective) and the shared batch itself
    // (see getRevertPlan). We only pick one still-approved entry point per saved batch.
    const revertTargets = selectSequentialAiRevertProposalIds(
      mcpProposalCitations,
      proposalIds,
      activeDocumentRevision,
    );
    // 排他は run 全体に一度だけ取る (反復ごとに取り直すと、途中で別の適用が割り込んで
    // 部分的に巻き戻した教材の上に保存されうる)。
    mcpPreviewBusyRef.current = true;
    setMcpPreviewBusy(true);
    try {
      let revertedBatches = 0;
      let failureReason: string | null = null;
      for (const targetProposalId of revertTargets) {
        const result = await bridge.storage.revertMcpEditProposal(targetProposalId);
        if (!result.ok) {
          failureReason = result.reason;
          break;
        }
        revertedBatches += 1;
      }
      // 多重防御: main側は巻き戻した保存バッチ全員を reverted にしているので通常は no-op
      // だが、要求IDにグループの一部だけが含まれていた場合の取りこぼしをここで揃える
      // (markMcpEditProposalsReverted は group を展開する)。全バッチを戻せたときだけ実行する
      // — 途中で失敗した状態で全IDをrevertedにすると、本文が戻っていない提案まで終端状態へ
      // 落としてしまう。
      if (failureReason === null && bridge.storage.markMcpEditProposalsReverted) {
        await bridge.storage.markMcpEditProposalsReverted(proposalIds);
      }
      const recoveryLoad = revertedBatches > 0
        ? await bridge.storage.loadDocumentWithRecovery?.(activeFileIdRef.current)
        : undefined;
      if (revertedBatches > 0) {
        const reloaded = recoveryLoad
          ? recoveryLoad.ok ? recoveryLoad.document : null
          : await bridge.storage.loadDocument(activeFileIdRef.current);
        const reloadedRevision = recoveryLoad?.ok
          ? recoveryLoad.revision
          : (await bridge.storage.listFiles())
            .find((file) => file.fileId === activeFileIdRef.current)?.revision ?? null;
        if (reloaded) {
          const nextDocument = repairDuplicateTopLevelIds(
            ensurePageLayout(parseSigmaDocument(reloaded)),
            DOCUMENT_BLOCK_OPERATION_PORTS,
          );
          const currentSelectedId = selectedIdRef.current;
          resetEditorDocument(
            nextDocument,
            currentSelectedId && findBlock(nextDocument, currentSelectedId)
              ? currentSelectedId
              : getDefaultDocumentSelectionId(nextDocument),
            reloadedRevision,
          );
        }
        await refreshDocumentMetadatas();
        setSaveState("saved");
      }
      await refreshMcpEditProposals();
      // 復旧のお知らせは、途中で失敗していても必ず出す (バックアップが取られたことを
      // 失敗メッセージで押し流さない)。announceRecovery 自身が statusMessage を上書きする
      // ので、通常メッセージを設定した「後」に呼ぶ順序は変えない。
      const announceRecoveryIfNeeded = () => {
        if (recoveryLoad?.ok) {
          announceRecovery(recoveryLoad.recoveryIssues, recoveryLoad.recoveryBackupPath);
        }
      };
      if (failureReason !== null) {
        const reason = revertedBatches > 0
          ? tEditor("status.revertPartial", { reason: failureReason, batches: revertedBatches })
          : failureReason;
        setStatusMessage(reason);
        announceRecoveryIfNeeded();
        return { ok: false, reason };
      }
      setStatusMessage(tEditor("status.editReverted"));
      announceRecoveryIfNeeded();
      return { ok: true };
    } catch (error) {
      const reason = error instanceof Error ? error.message : tEditor("status.revertFailed");
      setStatusMessage(reason);
      return { ok: false, reason };
    } finally {
      finishMcpPreviewBusy();
    }
  };

  const applyAiSurface = useCallback((next: AiSurfaceState) => {
    setAiDisplayMode(next.displayMode);
    setAiSidebarOpen(next.aiSidebarOpen);
    setAiInlineOpen(next.aiInlineOpen);
  }, []);

  const openAiInline = useCallback((anchor: { left: number; top: number } | null) => {
    // Reset the anchor unconditionally: a null anchor (⌘K with no selection) must
    // fall back to the CSS default position rather than reuse a stale selection rect.
    setAiInlineAnchor(anchor);
    // A fresh open re-anchors to the selection, dropping any earlier drag offset.
    setAiInlineDragPosition(null);
    // Bump the session id so the inline editor starts on a fresh input (rather than
    // re-showing a prior turn's result) each time it is opened.
    setAiInlineSessionId((current) => current + 1);
    applyAiSurface(openInline());
  }, [applyAiSurface]);

  const promoteAiToSidebar = useCallback(() => {
    setAiInlineRunAnchor(null);
    setAiInlineRunAnchorCanvas(null);
    applyAiSurface(promoteToSidebar());
  }, [applyAiSurface]);

  // R2: clicking an in-body AI run-anchor widget for a background room should
  // bring that room's log into view — promote to the docked sidebar (works
  // regardless of whichever surface/room is currently showing) and tell
  // AiEditPanel which room to select once it (re)mounts in sidebar mode.
  const [aiFocusRoomRequest, setAiFocusRoomRequest] = useState<{ roomId: string; seq: number } | null>(null);
  const focusAiSession = useCallback((roomId: string) => {
    setAiFocusRoomRequest({ roomId, seq: Date.now() });
    applyAiSurface(promoteToSidebar());
  }, [applyAiSurface]);

  const closeAiSurface = useCallback(() => {
    // Closing the inline editor discards a single-shot result, so drop the floating
    // body preview it left behind (clearAiEditPreview also dismisses the pending
    // turn) and the references pinned during that inline session. Closing the
    // docked sidebar must stay non-destructive: just hide the panel and leave any
    // unapplied proposal AND pinned references recoverable on reopen.
    if (aiDisplayMode === "inline" && aiInlineOpen) {
      setAiInlineClosing(true);
      window.setTimeout(() => {
        const closingInline = aiDisplayMode === "inline";
        applyAiSurface(closeSurface());
        setAiInlineClosing(false);
        if (closingInline) {
          clearAiEditPinnedReferences();
          if (!aiInlineRunAnchorRef.current) {
            clearAiEditPreview();
          }
        }
      }, 140);
      return;
    }

    const closingInline = aiDisplayMode === "inline";
    applyAiSurface(closeSurface());
    if (closingInline) {
      clearAiEditPinnedReferences();
      if (!aiInlineRunAnchorRef.current) {
        clearAiEditPreview();
      }
    }
  }, [aiDisplayMode, aiInlineOpen, applyAiSurface, clearAiEditPinnedReferences, clearAiEditPreview]);

  // AIパネル(inline/sidebar)が参照ハイライトを表示すべき状態か。
  const aiReferenceHighlightActive = useMemo(
    () =>
      (aiDisplayMode === "inline" && (aiInlineOpen || aiInlineRunAnchor !== null)) ||
      (aiDisplayMode === "sidebar" && aiSidebarOpen),
    [aiDisplayMode, aiInlineOpen, aiInlineRunAnchor, aiSidebarOpen],
  );

  const pinAiTextSelectionReference = useMemo(
    () => aiEditReference?.kind === "textSelection" &&
      !!aiEditReference.textRange &&
      aiReferenceHighlightActive,
    [aiEditReference, aiReferenceHighlightActive],
  );

  useEffect(() => {
    // 永続ハイライトが必要な pinned textSelection だけを通知する。暗黙のライブ選択は
    // ブラウザの通常の青い selection が示すため、Decoration を重ねない。
    const anchors: SigmaTextRangeCommentAnchor[] = [];
    if (aiReferenceHighlightActive) {
      for (const pinned of aiEditPinnedReferences) {
        if (pinned.kind === "textSelection" && pinned.textRange) {
          anchors.push(pinned.textRange);
        }
      }
    }
    window.dispatchEvent(new CustomEvent(AI_REFERENCE_TEXT_RANGE_EVENT, { detail: { anchors } }));
    return () => {
      window.dispatchEvent(new CustomEvent(AI_REFERENCE_TEXT_RANGE_EVENT, { detail: { anchors: [] } }));
    };
  }, [aiEditPinnedReferences, aiReferenceHighlightActive]);

  // ピン留めした textSelection の textRange は、pinした時点のブロック内容に対する文字
  // オフセットのスナップショット。このコードベースには、編集トランザクションに合わせて
  // コメントの textRange オフセットを追従させる仕組みは存在しない (コメント自体も
  // isCommentAnchorOrphan でブロックの有無だけを見ており、オフセットのズレは検出しない
  // — 再利用できる「リマップ機構」はない)。そのため、pin後にブロック内容が変わって
  // オフセットの意味が変わってしまった場合は、ハイライト/送信内容がズレたまま古い
  // textRange を使い続けるより安全側に倒し、その textRange だけを破棄する
  // (selectedText/mathTexはpin時点の内容としてそのまま送り続けられる)。
  useEffect(() => {
    reconcileAiEditPinnedReferenceTextRanges(document, aiEditPinnedReferences);
  }, [
    aiEditPinnedReferences,
    document,
    reconcileAiEditPinnedReferenceTextRanges,
  ]);

  // useCallback 必須。素の関数だと毎描画で identity が変わり、PageCanvasEditor へ渡る
  // selection 拡張が作り直され、その選択 effect の state 更新がまた EditorShell を描画する
  // — 何もしていなくても回り続けるループの起点になる (WI-2)。
  const requestAiEditWithReference = useCallback((
    reference: AiEditReference,
    anchor?: { left: number; top: number } | null,
    overlayPreview?: AiEditShapeOnlyPreview,
  ) => {
    const pinResult = pinAiEditPinnedReference(reference, overlayPreview);
    const requestPlan = deriveAiReferenceRequestPlan({
      reference,
      pinOutcome: pinResult.outcome,
      displayMode: aiDisplayMode,
      inlineOpen: aiInlineOpen,
      sidebarOpen: aiSidebarOpen,
      anchor,
      selectedId: selectedIdRef.current,
      t: tAi,
    });
    // 既にAI面 (inline/sidebarのどちらか) が開いていれば、そこへ追加pinするだけに留める。
    // openAiInline は毎回 aiInlineSessionId をbumpしてAiEditPanelを作り直す(=composerが
    // 消える)ため、2件目以降のピン留めでこれを呼ぶと「入力中の指示文が消える」事故になる。
    // 面がまだ何も開いていないときだけ、新規セッションとして inline を開く。
    if (requestPlan.surfaceAction === "openInline") {
      openAiInline(requestPlan.inlineAnchor);
    }
    // 図形参照をpinしたときはoverlay選択を維持する。本文ブロックを選択し直すと
    // overlay snapshotの元になった図形選択が解除され、直後の追加操作も失われる。
    if (requestPlan.selectionAction.type === "selectBlock") {
      selectedIdRef.current = requestPlan.selectionAction.targetId;
      setSelectedId(requestPlan.selectionAction.targetId);
    }
    setStatusMessage(requestPlan.statusMessage);
  }, [aiDisplayMode, aiInlineOpen, aiSidebarOpen, openAiInline, pinAiEditPinnedReference, setSelectedId, setStatusMessage]);

  const updateAiEditReferenceCandidate = useCallback((reference: AiEditReference | null) => {
    if (!reference && pinAiTextSelectionReference) {
      return;
    }
    setAiEditReference(reference);
  }, [pinAiTextSelectionReference]);

  const updatePageLayout = (pageLayout: PageLayout, options?: PageLayoutChangeOptions) => {
    const normalizedLayout = expandMarginsForRunningRegions(normalizePageLayout(pageLayout));
    const issues = getPageLayoutIssues(normalizedLayout);
    if (issues.length > 0) {
      // コードで返るので、表示は `shape` 辞書で行う。
      setStatusMessage(formatSigmaValidationCode(issues[0], { min: MIN_PAGE_BODY_HEIGHT_MM }, tShape));
      return;
    }

    commitDocumentChange((current) => {
      const withLayout = ensurePageLayout(current);
      const switchingToWhiteboard = isWhiteboardPageLayout(normalizedLayout) && !isWhiteboardPageLayout(normalizePageLayout(withLayout.pageLayout));
      const preparedDocument = switchingToWhiteboard
        ? convertOverlayToWhiteboard(withLayout, measuredBodyBlockRectsRef.current)
        : ensureOverlayAnchorOffsets(withLayout);
      const overlay = preparedDocument.pageLayout?.overlay ?? normalizedLayout.overlay;
      return {
        ...preparedDocument,
        pageLayout: {
          ...normalizedLayout,
          overlay,
        },
        updatedAt: new Date().toISOString(),
      };
    }, options?.history === "coalesce" ? { coalesce: true } : undefined);
    if (isWhiteboardPageLayout(normalizedLayout) && !isWhiteboardDocument) {
      setCommentsPanelOpen(false);
    }
    if (options?.silent) {
      return;
    }
    setStatusMessage(tEditor("status.pageSetupUpdated"));
  };

  const resizeOutline = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setOutlineOpen(true);

    const startX = event.clientX;
    const startWidth = outlineWidth;

    const clampWidth = (width: number) => {
      const reservedWidth = MIN_EDITOR_WIDTH_WHILE_RESIZING_OUTLINE
        + (aiSidebarOpen ? AI_SIDEBAR_WIDTH : 0);
      const availableWidth = window.innerWidth - reservedWidth;
      const maxWidth = Math.min(MAX_OUTLINE_WIDTH, Math.max(MIN_OUTLINE_WIDTH, availableWidth));
      return Math.min(maxWidth, Math.max(MIN_OUTLINE_WIDTH, width));
    };

    const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
      setOutlineWidth(clampWidth(startWidth + moveEvent.clientX - startX));
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.document.body.classList.remove("is-resizing-outline");
    };

    window.document.body.classList.add("is-resizing-outline");
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  useEffect(() => {
    runShortcutCommandRef.current = (commandId: EditorCommandId) => {
      setActiveMenu(null);
      setExportMenuOpen(false);
      setShapeMenuOpen(false);
      setLineToolMenuOpen(false);
      setFontFamilyMenuOpen(false);
      setBlockStyleMenuOpen(false);
      setFontSizeMenuOpen(false);
      setBoxedTextMenuOpen(false);
      setLineHeightMenuOpen(false);
      setTextAlignMenuOpen(false);
      setColorStylePanel(null);
      setLineEndpointMenu(null);

      const customCommand = customCommands.find((command) => command.id === commandId);
      if (customCommand) {
        executeCustomCommandAction(customCommand.action);
        return;
      }

      if (commandId === "edit.undo") {
        undoDocumentChange();
        return;
      }
      if (commandId === "edit.redo") {
        redoDocumentChange();
        return;
      }
      if (commandId === "edit.search") {
        setSearchOpen(true);
        return;
      }
      if (commandId === "edit.selectAllWithShapes") {
        window.dispatchEvent(new CustomEvent(SELECT_BODY_WITH_SHAPES_EVENT));
        return;
      }
      if (commandId === "edit.bold") {
        runEditCommand("bold");
        return;
      }
      if (commandId === "edit.italic") {
        runEditCommand("italic");
        return;
      }
      if (commandId === "edit.underline") {
        runEditCommand("underline");
        return;
      }
      if (commandId === "edit.boxedText") {
        toggleBoxedText();
        return;
      }
      if (commandId === "view.toggleOutline") {
        setOutlineOpen((current) => !current);
        return;
      }
      if (commandId === "view.zoomIn") {
        applyZoom((current) => current + KEYBOARD_ZOOM_STEP);
        return;
      }
      if (commandId === "view.zoomOut") {
        applyZoom((current) => current - KEYBOARD_ZOOM_STEP);
        return;
      }
      if (commandId === "view.zoomReset") {
        resetZoom();
        return;
      }
      if (commandId === "view.commandPalette") {
        setSettingsFocusEntryId(undefined);
        setCommandPaletteOpen(true);
        return;
      }
      if (commandId === "view.printPreview") {
        openPrintPreview();
        return;
      }
      if (commandId === "view.comments") {
        toggleCommentsPanel();
        return;
      }
      if (commandId === "view.outlineDialog") {
        setOutlineDialogOpen(true);
        return;
      }
      if (commandId === "document.new") {
        void createDocumentTab();
        return;
      }
      if (commandId === "document.library") {
        void openDocumentListDialog();
        return;
      }
      if (commandId === "document.duplicate") {
        void duplicateActiveDocument();
        return;
      }
      if (commandId === "ai.chat") {
        promoteAiToSidebar();
        return;
      }
      if (commandId === "ai.resources") {
        setAiSettingsOpen(true);
        return;
      }
      if (commandId === "settings.aiAccount") {
        setAiSettingsOpen(true);
        return;
      }
      if (commandId === "settings.page") {
        setPageSettingsOpen(true);
        return;
      }
      if (commandId === "settings.commands") {
        openCommandSettings();
        return;
      }
      if (commandId === "insert.material") {
        setMaterialLibraryOpen(true);
        return;
      }
      if (commandId === "insert.paragraph") {
        addBlock("paragraph");
        return;
      }
      if (commandId === "insert.heading") {
        addBlock("heading");
        return;
      }
      if (commandId === "insert.problem") {
        addBlock("problem");
        return;
      }
      if (commandId === "insert.inlineMath") {
        insertInlineMath("", getActiveTextTarget());
        setStatusMessage(tEditor("status.mathAdded"));
        return;
      }

      const blockStyle = SHORTCUT_BLOCK_STYLES[commandId];
      if (blockStyle) {
        applyTextStyle(blockStyle);
        return;
      }

      const textAlign = SHORTCUT_TEXT_ALIGNS[commandId];
      if (textAlign) {
        applyTextAlign(textAlign);
        setTextAlignMenuOpen(false);
        return;
      }

      const lineHeightValue = SHORTCUT_LINE_HEIGHTS[commandId];
      if (lineHeightValue) {
        applyLineHeight(lineHeightValue);
        setLineHeightMenuOpen(false);
        setLineHeightCustomOpen(false);
        return;
      }

      if (Object.prototype.hasOwnProperty.call(SHORTCUT_FONT_FAMILIES, commandId)) {
        const fontValue = SHORTCUT_FONT_FAMILIES[commandId];
        setFontFamily(normalizeToolbarFontFamily(fontValue || DEFAULT_FONT_FAMILY_VALUE));
        applyInlineFormat("fontFamily", fontValue);
        setFontFamilyMenuOpen(false);
        return;
      }

      const fontSizeValue = SHORTCUT_FONT_SIZES[commandId];
      if (fontSizeValue) {
        setTextFontSize(fontSizeValue);
        applyInlineFormat("fontSize", String(fontSizeValue));
        return;
      }

      if (commandId === "overlay.image") {
        imageInputRef.current?.click();
        return;
      }
      if (commandId === "overlay.duplicate") {
        requestOverlayAction({ type: "duplicate" });
        return;
      }
      if (commandId === "overlay.delete") {
        requestOverlayAction({ type: "delete" });
        return;
      }
      if (commandId === "overlay.group") {
        requestOverlayAction({ type: "group" });
        return;
      }
      if (commandId === "overlay.ungroup") {
        requestOverlayAction({ type: "ungroup" });
        return;
      }
      if (commandId === "overlay.toggleLock") {
        requestOverlayAction({ type: "toggleLock" });
        return;
      }
      if (commandId === "overlay.toggleHidden") {
        requestOverlayAction({ type: "toggleHidden" });
        return;
      }

      const arrangeAction = SHORTCUT_OVERLAY_ARRANGE_ACTIONS[commandId];
      if (arrangeAction) {
        requestOverlayAction({ type: "arrange", action: arrangeAction });
        return;
      }

      const alignAction = SHORTCUT_OVERLAY_ALIGN_ACTIONS[commandId];
      if (alignAction) {
        requestOverlayAction({ type: "align", action: alignAction });
        return;
      }

      const distributeAxis = SHORTCUT_OVERLAY_DISTRIBUTE_ACTIONS[commandId];
      if (distributeAxis) {
        requestOverlayAction({ type: "distribute", axis: distributeAxis });
        return;
      }

      if (Object.prototype.hasOwnProperty.call(SHORTCUT_STROKE_COLORS, commandId)) {
        const color = SHORTCUT_STROKE_COLORS[commandId];
        if (color === null) {
          setStrokeColor(null);
          applyOverlayStyle({ strokeOpacity: 0 });
        } else {
          setStrokeColor(color);
          applyOverlayStyle({ color, strokeOpacity: 1 });
        }
        return;
      }

      if (Object.prototype.hasOwnProperty.call(SHORTCUT_FILL_COLORS, commandId)) {
        const color = SHORTCUT_FILL_COLORS[commandId];
        if (color === null) {
          applyOverlayStyle({ fill: "none" });
        } else {
          applyOverlayStyle(fillColorPatch(color));
        }
        return;
      }

      const lineDash = SHORTCUT_LINE_DASHES[commandId];
      if (lineDash) {
        applyOverlayStyle({ dash: lineDash });
        setLineDashMenuOpen(false);
        return;
      }

      const lineWidth = SHORTCUT_LINE_WIDTHS[commandId];
      if (lineWidth) {
        applyOverlayStyle({ size: lineWidth });
        setLineWidthMenuOpen(false);
        return;
      }

      const arrowheadValue = SHORTCUT_ARROWHEAD_VALUES[commandId];
      if (arrowheadValue) {
        if (commandId.startsWith("overlay.arrowhead.start.")) {
          applyOverlayStyle({ arrowheadStart: arrowheadValue });
        } else {
          applyOverlayStyle({ arrowheadEnd: arrowheadValue });
        }
        setLineEndpointMenu(null);
        return;
      }

      const overlayCommand = commandId.replace("overlay.", "") as OverlayCommand;
      runOverlayCommand(overlayCommand);
    };
  });

  useEffect(() => {
    const handleCommandShortcut = (event: KeyboardEvent) => {
      // 「いま他の面が前に出ているか」の抑止。ここは設定の読み込み状況とは無関係。
      if (
        event.isComposing ||
        commandSettingsOpen ||
        texCommandReferenceOpen ||
        pageSettingsOpen ||
        documentListOpen ||
        previewOpen ||
        aiSettingsOpen ||
        desktopSettingsOpen ||
        materialLibraryOpen ||
        templateGalleryOpen ||
        materialAddDialogOpen ||
        ribbonBackstageOpen ||
        commandPaletteOpen
      ) {
        return;
      }

      // Word の Ctrl+F1 (リボンの開閉)。docs には無い操作なので
      // EDITOR_COMMAND_SHORTCUTS には登録せず、word 限定の固定キーとして扱う
      // （登録するとショートカット設定に「押しても何も起きないコマンド」が並ぶ）。
      // ユーザー設定のショートカット表とは無関係な固定キーなので、設定の読み込み
      // (commandSettingsLoaded) を待たない — 待つと、デスクトップで設定の読み込みが
      // 終わるまでリボンを開閉できない。
      // Word と同じ Ctrl+F1 だけを見る（⌘F1 は Word のバインドではないし、macOS の
      // 既存コマンドは ⌘ 側に寄せてあるので取り合いになる）。
      const wantsRibbonToggle = uiLayoutPreference.mode === "word"
        && event.key === "F1"
        && event.ctrlKey
        && !event.metaKey
        && !event.altKey
        && !event.shiftKey;
      // ユーザーが Ctrl+F1 を自分のコマンドへ割り当てていたらそちらを優先する。
      // 設定がまだ読めていないときは «割り当ては無い» とみなして先にリボンを開閉する
      // — ここで待つと、デスクトップでは設定が読めるまでリボンを開閉できない。
      const settingsReady = commandSettingsLoaded && !commandSettingsError;
      if (wantsRibbonToggle && !(settingsReady && findCommandByShortcut(event, shortcutOverrides, customCommands))) {
        event.preventDefault();
        event.stopPropagation();
        toggleRibbonCollapseRef.current();
        return;
      }

      // ここから先はユーザー設定のショートカット表を引くので、読めていないと引けない。
      if (!settingsReady) {
        return;
      }

      const match = findCommandByShortcut(event, shortcutOverrides, customCommands);
      if (!match || isCommandShortcutBlockedByTarget(event.target, match.binding)) {
        return;
      }

      const editingOverlayTextOrTable = overlayModeStatus?.id === "overlay.textEditing"
        || overlayModeStatus?.id === "overlay.tableEditing";
      if (!shouldDispatchOverlayArrangeShortcut(match.commandId, {
        hasUnlockedOverlaySelection: hasOverlaySelection
          && !overlaySelection.locked
          && !aiLockedOverlaySelection,
        editingOverlayTextOrTable,
        editingTextTarget: isTextEntryTarget(event.target),
      })) {
        return;
      }

      if (
        event.repeat
        && match.commandId !== "view.zoomIn"
        && match.commandId !== "view.zoomOut"
        && match.commandId !== "overlay.arrange.forward"
        && match.commandId !== "overlay.arrange.backward"
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      runShortcutCommandRef.current(match.commandId);
    };

    window.addEventListener("keydown", handleCommandShortcut, true);
    return () => window.removeEventListener("keydown", handleCommandShortcut, true);
  }, [
    commandSettingsOpen,
    texCommandReferenceOpen,
    commandSettingsError,
    commandSettingsLoaded,
    documentListOpen,
    pageSettingsOpen,
    previewOpen,
    aiSettingsOpen,
    desktopSettingsOpen,
    materialLibraryOpen,
    templateGalleryOpen,
    materialAddDialogOpen,
    ribbonBackstageOpen,
    commandPaletteOpen,
    uiLayoutPreference.mode,
    aiLockedOverlaySelection,
    customCommands,
    hasOverlaySelection,
    overlayModeStatus,
    overlaySelection.locked,
    shortcutOverrides,
  ]);

  useEffect(() => {
    const handleInlineShortcut = (event: KeyboardEvent) => {
      if (!isInlineToggleShortcut(event) || event.repeat) {
        return;
      }
      if (
        commandSettingsOpen ||
        texCommandReferenceOpen ||
        !commandSettingsLoaded ||
        commandSettingsError ||
        pageSettingsOpen ||
        documentListOpen ||
        previewOpen ||
        aiSettingsOpen ||
        desktopSettingsOpen ||
        materialLibraryOpen ||
        ribbonBackstageOpen ||
        commandPaletteOpen
      ) {
        return;
      }
      // Defer to a user-rebound command on ⌘K/Ctrl+K: the command-shortcut listener
      // shares this capture phase and stopPropagation won't stop a sibling listener,
      // so without this the same keystroke would both run the command and toggle.
      if (findCommandByShortcut(event, shortcutOverrides, customCommands)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const next = toggleSurface({ displayMode: aiDisplayMode, aiSidebarOpen, aiInlineOpen });
      if (!next.aiInlineOpen && !next.aiSidebarOpen) {
        closeAiSurface();
      } else if (next.displayMode === "inline") {
        openAiInline(null);
      } else {
        applyAiSurface(next);
      }
    };
    window.addEventListener("keydown", handleInlineShortcut, true);
    return () => window.removeEventListener("keydown", handleInlineShortcut, true);
  }, [
    aiDisplayMode,
    aiSidebarOpen,
    aiInlineOpen,
    applyAiSurface,
    closeAiSurface,
    openAiInline,
    commandSettingsOpen,
    texCommandReferenceOpen,
    commandSettingsError,
    commandSettingsLoaded,
    pageSettingsOpen,
    documentListOpen,
    previewOpen,
    aiSettingsOpen,
    desktopSettingsOpen,
    materialLibraryOpen,
    ribbonBackstageOpen,
    commandPaletteOpen,
    customCommands,
    shortcutOverrides,
  ]);

  // 導出は毎回新しい配列を作るので、useMemo の中で 1 回だけ呼ぶ。裸で呼ぶと本文と無関係な
  // 再レンダー (メニュー・選択・フォーカス) のたびに nodes の参照が変わり、タイトル・タブ・
  // アウトラインの DocumentTitleText の memo が全部外れる。
  const documentTitle = useMemo(() => resolveDocumentTitleContent(document), [document]);
  const resolvedDocumentTitle = documentTitle.text;
  const titleInputValue = documentTitleInputValue(document.metadata.title) || resolvedDocumentTitle;
  // 数式を含むタイトルは、非フォーカス時だけリッチ表示を入力欄に重ねる。この state は JSX でしか
  // 読まない — effect の依存に入力まわりの state を置くと「1 文字しか打てない」事故を再発させる。
  const [titleInputFocused, setTitleInputFocused] = useState(false);
  // 明示タイトルの入力欄には保存値がそのまま出る (正規化前) ので、重ねる側も同じ文字列から
  // 読む。派生タイトルは入力欄の値が導出結果そのものなので、潰していないノード列を使う。
  // 条件を 2 箇所に書くと必ずずれるので 1 変数に畳んでいる。
  const titleRichNodes = isDocumentTitleExplicit(document.metadata.title)
    ? parseDocumentTitleInlineNodes(titleInputValue)
    : documentTitle.nodes;
  const showRichTitle = !titleInputFocused && titleRichNodes !== null;

  // 記録済みの失敗は、その教材がアクティブな間だけ画面に出す (他の教材を開いている
  // 間は残っていても無害。次にその教材を開こうとした時点で読み直して更新される)。
  const activeDocumentOpenFailure = documentOpenFailure?.fileId === activeFileId ? documentOpenFailure : null;
  // ページ編集面が実際に描かれる条件。ステータスバーのページ数もこれを見る
  // （描かれていないのに前の教材のページ数を出さないため。onPageCountChange は
  // アンマウントでは呼ばれない）。
  const pageEditorMounted = workspaceReady && !activeDocumentOpenFailure;

  const reloadFailedDocument = useCallback(async () => {
    const failure = documentOpenFailureRef.current;
    if (!failure) {
      return;
    }
    await openDocumentInWorkspace(failure.fileId, {
      saveCurrent: false,
      status: tEditor("status.reopened"),
    });
  }, [openDocumentInWorkspace]);

  const openDocumentTabs = useMemo(() => {
    return openFileIds.map((fileId) => {
      const metadata = metadataByFileId.get(fileId);
      if (fileId === activeFileId) {
        return {
          fileId,
          title: resolvedDocumentTitle,
          updatedAt: document.updatedAt ?? metadata?.updatedAt ?? "",
        };
      }

      return {
        fileId,
        title: metadata?.title || tE("shell.untitledDocument"),
        updatedAt: metadata?.updatedAt ?? "",
      };
    });
  }, [activeFileId, document, metadataByFileId, openFileIds, resolvedDocumentTitle, tE]);
  const pageNavigatorScale = Math.min(
    PAGE_NAVIGATOR_MAX_SCALE,
    Math.max(
      PAGE_NAVIGATOR_MIN_SCALE,
      (outlineWidth - PAGE_NAVIGATOR_SCALE_GUTTER_PX) / PAGE_NAVIGATOR_PRINT_PAGE_WIDTH_PX,
    ),
  );
  const pageNavigatorViewportHeight = Math.round(PAGE_NAVIGATOR_PRINT_PAGE_HEIGHT_PX * pageNavigatorScale) + 8;
  const pageNavigatorItemHeight = pageNavigatorViewportHeight + 4;
  const pageNavigatorStyle = {
    "--page-nav-thumbnail-scale": String(pageNavigatorScale),
    "--page-nav-viewport-height": `${pageNavigatorViewportHeight}px`,
    "--page-nav-item-height": `${pageNavigatorItemHeight}px`,
  } as CSSProperties;
  const aiSurface = resolveAiSurface({ displayMode: aiDisplayMode, aiSidebarOpen, aiInlineOpen });
  const aiInlineHostVisible = aiSurface.hostVisible
    || aiInlineClosing
    || (aiDisplayMode === "inline" && aiInlineRunAnchor !== null && !aiInlineOpen);
  const aiInlineHostAnchor = aiInlineOpen ? aiInlineAnchor : aiInlineRunAnchor;

  // The inline box can be dragged to a new spot by grabbing an empty part of the
  // field (chrome, or the textarea while it holds no text). Once dragged, the box
  // sticks at the dropped position until the editor is reopened.
  const aiInlineHostRef = useRef<HTMLElement | null>(null);
  const aiInlineDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originLeft: number;
    originTop: number;
    active: boolean;
    textarea: HTMLTextAreaElement | null;
  } | null>(null);

  const handleAiInlinePointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (aiDisplayMode !== "inline" || event.button !== 0) {
      return;
    }
    const target = event.target as HTMLElement;
    // Interactive controls keep their own behaviour; never start a drag from them.
    if (target.closest("button, a, select, [role='button'], .ai-chat-chip, [data-no-drag]")) {
      return;
    }
    const textarea = target.closest("textarea") as HTMLTextAreaElement | null;
    // Inside the textarea, only the empty (no-text) state is a drag handle so that
    // typing and text selection still work once an instruction has been entered.
    if (textarea && textarea.value.trim().length > 0) {
      return;
    }
    const host = aiInlineHostRef.current;
    if (!host) {
      return;
    }
    const rect = host.getBoundingClientRect();
    aiInlineDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originLeft: rect.left,
      originTop: rect.top,
      active: false,
      textarea,
    };
  }, [aiDisplayMode]);

  const handleAiInlinePointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = aiInlineDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.active) {
      // Tell a click (focus the field) apart from a drag with a small threshold.
      if (Math.hypot(dx, dy) < 4) {
        return;
      }
      drag.active = true;
      aiInlineHostRef.current?.setPointerCapture(event.pointerId);
      drag.textarea?.blur();
      window.document.body.style.cursor = "grabbing";
    }
    const host = aiInlineHostRef.current;
    const width = host?.offsetWidth ?? 440;
    const { left, top } = getAiInlineDragPosition(
      { left: drag.originLeft + dx, top: drag.originTop + dy },
      { width: window.innerWidth, height: window.innerHeight },
      { hostWidth: width, topBoundary: getAiInlineTopBoundary() },
    );
    setAiInlineDragPosition({ left, top });
  }, []);

  const handleAiInlinePointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = aiInlineDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    aiInlineDragRef.current = null;
    if (drag.active) {
      aiInlineHostRef.current?.releasePointerCapture(event.pointerId);
      window.document.body.style.cursor = "";
      // Return focus to the field so the user can keep typing after repositioning.
      drag.textarea?.focus();
    }
  }, []);

  const renderAiHost = () => {
    if (isEmbedded) {
      return null;
    }

    const isInlineHost = aiDisplayMode === "inline";
    const inlineViewport = isInlineHost && aiInlineHostVisible && typeof window !== "undefined"
      ? { width: window.innerWidth, height: window.innerHeight }
      : null;
    const inlineTopBoundary = inlineViewport ? getAiInlineTopBoundary() : null;
    const autoPosition = inlineViewport && inlineTopBoundary !== null
      ? aiInlineHostAnchor
        ? getAiInlineHostPosition(
            aiInlineHostAnchor,
            inlineViewport,
            { topBoundary: inlineTopBoundary },
          )
        : getAiInlineDragPosition(
            { left: AI_INLINE_DEFAULT_LEFT_PX, top: AI_INLINE_DEFAULT_TOP_PX },
            inlineViewport,
            { topBoundary: inlineTopBoundary },
          )
      : null;
    const renderPosition = aiInlineDragPosition ?? autoPosition;
    const host = (
      <>
        {(aiSurface.catcherVisible || aiInlineClosing) && (
          <div
            className={`ai-inline-catcher${aiInlineClosing ? " ai-inline-catcher--closing" : ""}`.trim()}
            role="presentation"
            onMouseDown={closeAiSurface}
            // Keep the body scrollable behind the inline text field: forward wheel
            // gestures to the editor canvas instead of swallowing them.
            onWheel={(event) => {
              const scroller = editorCanvasRef.current;
              if (!scroller) {
                return;
              }
              const factor = event.deltaMode === 1
                ? 16
                : event.deltaMode === 2
                  ? scroller.clientHeight
                  : 1;
              scroller.scrollBy({ top: event.deltaY * factor, left: event.deltaX * factor });
            }}
          />
        )}
        <aside
          ref={aiInlineHostRef}
          className={[
            "ai-sidebar-panel",
            aiSurface.hostClassName,
            aiInlineHostVisible ? "" : "is-hidden",
            aiInlineClosing ? "ai-chat-host--closing" : "",
          ].filter(Boolean).join(" ")}
          aria-label="AI"
          aria-hidden={!aiInlineHostVisible}
          onPointerDown={isInlineHost ? handleAiInlinePointerDown : undefined}
          onPointerMove={isInlineHost ? handleAiInlinePointerMove : undefined}
          onPointerUp={isInlineHost ? handleAiInlinePointerUp : undefined}
          onPointerCancel={isInlineHost ? handleAiInlinePointerUp : undefined}
          style={isInlineHost && renderPosition
            ? { left: `${renderPosition.left}px`, top: `${renderPosition.top}px` }
            : undefined}
        >
          {aiDisplayMode === "sidebar" && (
            <div className="sidebar-panel-header">
              <span>AI</span>
              <button
                type="button"
                className="panel-icon-button sidebar-close-button"
                aria-label={tEditor("aria.closeAiChat")}
                title={tEditor("aria.closeAiChat")}
                onClick={closeAiSurface}
              >
                <X size={14} />
              </button>
            </div>
          )}
          {isDesktopApp ? (
            <AiEditPanel
              document={document}
              documentIdentityKey={activeFileId}
              documentWorkspaceId={activeDocumentMetadata?.workspaceId ?? null}
              selectedId={selectedId}
              selectedBlock={selectedBlock}
              reference={aiEditReference}
              pinnedReferences={aiEditPinnedReferences}
              pinnedReferencePreviews={aiEditPinnedReferencePreviews}
              onRemovePinnedReference={removeAiPinnedReference}
              overlaySelection={overlaySelection}
              variant={aiDisplayMode}
              inlineSessionId={aiInlineSessionId}
              inlineOpen={aiInlineOpen}
              inlineAnchor={aiInlineAnchor}
              inlineRunAnchor={aiInlineRunAnchor}
              inlineRunAnchorCanvas={aiInlineRunAnchorCanvas}
              inlineRunPortalTarget={aiInlineRunPortal}
              previewClearRequest={aiEditPreviewClearRequest}
              previewGroups={aiEditPreviewGroups}
              busy={mcpPreviewBusy}
              onApplyGroup={applyAiEditPreviewGroup}
              onDismissGroup={dismissAiEditPreviewGroup}
              staleProposalGroups={staleProposalGroups}
              sourceReferencesByTurnId={sourceReferencesByTurnId}
              insertedShapePreviewsByTurnId={insertedShapePreviewsByTurnId}
              appliedChangesByTurnId={appliedChangesByTurnId}
              onRevertAppliedChange={revertAppliedProposals}
              restorableProposalsByTurnId={restorableProposalsByTurnId}
              onRestoreProposal={restoreProposalFromHistory}
              onOpenSourceDocument={openSourceReferenceDocument}
              onDiscardStaleProposals={discardStaleProposals}
              onRebaseStaleProposals={rebaseStaleProposals}
              onForceApplyStaleProposals={forceApplyStaleProposals}
              onOpenAiSettings={() => setAiSettingsOpen(true)}
              onCloseInline={closeAiSurface}
              onPromoteToSidebar={promoteAiToSidebar}
              onInlineRunAnchorChange={handleInlineRunAnchorChange}
              focusRoomRequest={aiFocusRoomRequest}
            />
          ) : (
            <AiEditWebPlaceholder key={document.docId} instructionScopeId={document.docId} proposalSurfaceRef={setWebMcpPanelTarget} />
          )}
        </aside>
      </>
    );

    // The inline host is a fixed overlay anchored to the selection. Portal it to
    // <body> so it escapes the workspace's `isolation: isolate` stacking context
    // and paints above the top menu bar. The docked sidebar stays in the grid.
    return isInlineHost && typeof window !== "undefined"
      ? createPortal(host, window.document.body)
      : host;
  };

  const workspaceClassName = [
    "workspace",
    showPageNavigator ? "" : "outline-hidden",
    outlineOpen ? "" : "outline-collapsed",
    aiSurface.gridHasAiColumn ? "ai-sidebar-open" : "",
  ].filter(Boolean).join(" ");

  const renderMenuShortcut = (commandId: EditorCommandId) => {
    const label = formatShortcutText(getShortcutForCommand(shortcutOverrides, commandId), shortcutPlatform);
    return label ? <kbd>{label}</kbd> : null;
  };
  // パレットの候補。`t` を持ち込むのは **描画のときだけ** で、打鍵ごとに走る
  // `findCommandByShortcut` はこの解決を通らない (罠 6)。
  // 開くまで作らないのは、155 件の解決 (t() 約 600 回) を初回描画から外すため。
  const paletteEntries = useMemo(() => (commandPaletteOpen ? buildPaletteEntries({
    commands: resolveEditorCommandCatalog(getEditorCommandCatalog(customCommands), tCommand),
    resolveShortcut: (commandId) => getShortcutForCommand(shortcutOverrides, commandId, customCommands),
    formatShortcut: (binding) => formatShortcutText(binding, shortcutPlatform),
    translateSetting: (key) => tSettings(key as never) as string,
    settingsGroupLabel: tCommand("palette.groupSetting"),
    // 開いている状態でもう一度出しても意味がない。
    hiddenCommandIds: ["view.commandPalette"],
    // 埋め込み (SDK web) にはデスクトップブリッジも AI 設定も無く、選んでも
    // 何も描かれない。死に行を並べない。
    isSettingsSurfaceAvailable: (surface) => !isEmbedded
      || (surface !== "desktopApp" && surface !== "desktopAi" && surface !== "aiResources"),
  }) : []), [commandPaletteOpen, customCommands, isEmbedded, shortcutOverrides, shortcutPlatform, tCommand, tSettings]);

  const runPaletteEntry = useCallback((entry: PaletteEntry) => {
    setCommandPaletteOpen(false);
    if (entry.kind === "command") {
      // パレットが閉じてから実行する。閉じる前は本文側にまだ `inert` が付いていて
      // (Modal の隔離)、フォーカスを本文へ戻すコマンドが inert 配下に入れない。
      const commandId = entry.id as EditorCommandId;
      requestAnimationFrame(() => runShortcutCommandRef.current(commandId));
      return;
    }
    // 設定項目は WI-3 が用意した配線をそのまま使う: surface でダイアログを決め、
    // `focusEntryId` を渡すとダイアログ側がスクロールとハイライトを担当する。
    // アプリ設定モーダルは同じ実装を mode で 2 面に出し分けているので、どちらの面かは
    // カタログ側の `SETTINGS_SURFACE_DESKTOP_MODE` から引く。
    const desktopMode = SETTINGS_SURFACE_DESKTOP_MODE[entry.surface];
    switch (entry.surface) {
      case "desktopApp":
        setSettingsFocusEntryId(entry.id);
        setDesktopSettingsOpen(true);
        return;
      case "desktopAi":
      case "aiResources":
        // mode="ai" の面は単独では出ず、AI 設定ダイアログの「接続・動作」セクションに
        // 埋め込まれている (`AiSettingsDialog` が `focusEntryId` を中へ渡す)。
        void desktopMode;
        setSettingsFocusEntryId(entry.id);
        setAiSettingsOpen(true);
        return;
      case "page":
        setSettingsFocusEntryId(entry.id);
        setPageSettingsOpen(true);
        return;
      case "texEnvironment":
        setTexEnvironmentSettingsOpen(true);
        return;
      case "commands":
        // 読み込み中/エラーだと開かないことがある。開かないのに focus id を残すと
        // 次に別の設定を開いたときに 120 フレーム空振りする。
        if (openCommandSettings()) {
          setSettingsFocusEntryId(entry.id);
        }
        return;
      default: {
        // 面が増えたら**コンパイルで**気付く (黙って別のダイアログが開かない)。
        const exhaustive: never = entry.surface;
        void exhaustive;
      }
    }
  }, [openCommandSettings]);

  const commandTooltip = (label: string, commandId: EditorCommandId): TooltipContent => {
    const shortcut = formatShortcutText(getShortcutForCommand(shortcutOverrides, commandId), shortcutPlatform);
    return { label, shortcut: shortcut || null };
  };
  const overlayArrangeShortcutLabels = {
    front: formatShortcutText(getShortcutForCommand(shortcutOverrides, "overlay.arrange.front"), shortcutPlatform) || undefined,
    forward: formatShortcutText(getShortcutForCommand(shortcutOverrides, "overlay.arrange.forward"), shortcutPlatform) || undefined,
    backward: formatShortcutText(getShortcutForCommand(shortcutOverrides, "overlay.arrange.backward"), shortcutPlatform) || undefined,
    back: formatShortcutText(getShortcutForCommand(shortcutOverrides, "overlay.arrange.back"), shortcutPlatform) || undefined,
  };
  const titleUpdatePhase = appUpdateState?.phase;
  const showTitleUpdateButton = titleUpdatePhase === "available" || titleUpdatePhase === "downloading" || titleUpdatePhase === "downloaded";
  const titleUpdateButtonDisabled = appUpdateActionBusy || titleUpdatePhase === "downloading";
  const handleTitleUpdateAction = async () => {
    const bridge = getDesktopBridge();
    if (!bridge?.updater || !appUpdateState) {
      return;
    }

    setAppUpdateActionBusy(true);
    try {
      if (appUpdateState.phase === "downloaded") {
        const result = await bridge.updater.quitAndInstall();
        if (!result.ok) {
          setStatusMessage(result.error);
        }
        return;
      }

      setStatusMessage(tEditor("status.updateDownloading"));
      const result = await bridge.updater.downloadUpdate();
      setAppUpdateState(result);
      if (result.phase === "downloaded") {
        setStatusMessage(tEditor("status.updateReady"));
      } else if (result.phase === "error") {
        setStatusMessage(result.error ?? tEditor("status.updateDownloadFailed"));
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : tEditor("status.updateStartFailed"));
    } finally {
      setAppUpdateActionBusy(false);
    }
  };
  // AI 提案の適用/破棄は文書・提案・実行状態を跨いで書き換える処理なので、依存を全部
  // useCallback へ畳み込むのは現実的でない。呼び出し口だけ identity を固定する
  // (紙面の AI 拡張オブジェクトがこの 2 つを掴んでおり、動くと紙面が毎打鍵で描き直される)。
  // キャンバスへ渡すコールバックは全て安定させる。本文ユニット (memo 済み) の props に
  // そのまま流れるので、ここでインライン arrow を書くと打鍵のたびに全ユニットが描き直される。
  const applyVisibleAiEditPreviewGroup = async (proposalIds: string[]): Promise<AiProposalApplyOutcome> => {
    const webMcpOutcome = await webMcpBridgeRef.current?.applyProposalIds(proposalIds);
    if (webMcpOutcome) {
      return webMcpOutcome;
    }
    return applyAiEditPreviewGroup(proposalIds);
  };
  const dismissVisibleAiEditPreviewGroup = async (proposalIds: string[], reason?: string) => {
    if (webMcpBridgeRef.current?.dismissProposalIds(proposalIds)) {
      return;
    }
    await dismissAiEditPreviewGroup(proposalIds, reason);
  };
  const stableApplyVisibleAiEditPreviewGroup = useStableCallback(applyVisibleAiEditPreviewGroup);
  const stableDismissVisibleAiEditPreviewGroup = useStableCallback(dismissVisibleAiEditPreviewGroup);
  const handleCanvasSelect = useCallback((blockId: string | null) => {
    setSelectedInlineMath(null);
    if (blockId !== selectedIdRef.current) {
      setAiEditReference(null);
    }
    selectedIdRef.current = blockId;
    if (blockId) {
      materialBlockSelectionRef.current = blockId;
    }
    setSelectedId(blockId);
  }, [setAiEditReference, setSelectedId, setSelectedInlineMath]);
  const getWebMcpDocument = useCallback(() => documentRef.current, []);
  const getWebMcpRevision = useCallback(() => documentDirtyRevisionRef.current, []);
  const getWebMcpSelectedBlockId = useCallback(() => selectedIdRef.current, []);
  const webMcpSelectionRef = useRef({ selectedInlineMath, overlaySelection });
  useLayoutEffect(() => {
    webMcpSelectionRef.current = { selectedInlineMath, overlaySelection };
  }, [overlaySelection, selectedInlineMath]);
  const getWebMcpSelection = useCallback(() => {
    const selection = webMcpSelectionRef.current;
    const bookmark = textSelectionBookmarkRef.current;
    const textRange = bookmark
      && bookmark.anchor.kind === "text"
      && bookmark.head.kind === "text"
      && bookmark.anchor.blockId === bookmark.head.blockId
      ? (() => {
          const block = findBlock(documentRef.current, bookmark.anchor.blockId);
          if (!block || (block.type !== "paragraph" && block.type !== "heading")) {
            return null;
          }
          const from = Math.min(bookmark.anchor.offset, bookmark.head.offset);
          const to = Math.max(bookmark.anchor.offset, bookmark.head.offset);
          const text = inlineNodesToPlainText(block.children);
          if (to > text.length) {
            return null;
          }
          return { blockId: block.id, from, to, quote: text.slice(from, to) };
        })()
      : null;
    return {
      blockId: selectedIdRef.current,
      textRange,
      inlineMath: selection.selectedInlineMath
        ? {
            id: selection.selectedInlineMath.id,
            tex: selection.selectedInlineMath.tex,
            ...(selection.selectedInlineMath.blockId ? { blockId: selection.selectedInlineMath.blockId } : {}),
          }
        : null,
      overlayShapes: selection.overlaySelection.selectedShapes.map((shape) => ({
        id: shape.id,
        type: shape.type,
        shape,
      })),
    };
  }, []);
  const navigateToWebMcpTarget = useCallback((target: { kind: "block" | "shape"; id: string }) => {
    if (target.kind === "block") {
      handleCanvasSelect(target.id);
      scheduleEditorBlockFocus(target.id);
      return;
    }
    window.requestAnimationFrame(() => {
      const element = window.document.querySelector<HTMLElement>(
        `[data-overlay-shape-id="${CSS.escape(target.id)}"]`,
      );
      element?.scrollIntoView({ block: "center", inline: "center" });
    });
  }, [handleCanvasSelect]);
  const handleDuplicateBlock = useCallback((blockId: string) => {
    commitDocumentChange((current) => duplicateTopLevelBlock(current, blockId));
  }, [commitDocumentChange]);
  const handleMoveBlock = useCallback((blockId: string, direction: "up" | "down") => {
    commitDocumentChange((current) => moveTopLevelBlock(current, blockId, direction));
  }, [commitDocumentChange]);
  const handleAddProblemBlock = useCallback((
    problemId: string,
    area: ProblemAreaKind,
    blockToAdd: RichBlock,
  ) => {
    commitDocumentChange((current) => addRichBlockToProblem(current, problemId, area, blockToAdd));
  }, [commitDocumentChange]);
  const handleCanvasMaterialInsert = useCallback((request: TextFlowMaterialInsertRequest & { origin: OverlayPoint }) => {
    insertMaterialAt(request.material, request.triggerBlockId, request.origin);
  }, [insertMaterialAt]);
  const handleSelectionMaterialSaveRequest = useCallback((blockIds: string[]) => {
    openMaterialAddDialog(null, blockIds);
  }, [openMaterialAddDialog]);
  const handleCanvasProblemCommand = useCallback(({ triggerBlockId }: TextFlowProblemCommandRequest) => (
    insertProblemFromTextFlowCommand(triggerBlockId)
  ), [insertProblemFromTextFlowCommand]);
  /**
   * `/引用` `/コード` `/区切り線`。作るのは ProseMirror のコマンドなので、ここはツールバーの
   * ブロックボタンと**同じ関数**へ渡すだけ — 押した後にキャレットをどこへ戻すかの規則
   * (`applyBlockStructure`) を 1 箇所に保つ。
   *
   * ボタンが押せない状態 (`canUseBlockStructure` が false) では受けない。false を返すと
   * エディタが自分でコマンドだけ実行するので、`/` から何も起きないことにはならない。
   *
   * 識別子は memo 済みのキャンバスへ渡るので固定し、そのときの関数と可否は ref から読む。
   */
  const handleCanvasBodyBlockCommand = useCallback(({ kind }: TextFlowBodyBlockCommandRequest) => {
    const { canUse, apply } = blockStructureCommandRef.current;
    if (!canUse) {
      return false;
    }
    apply(kind === "quote" ? "quote" : kind === "codeBlock" ? "code" : "divider");
    return true;
  }, []);
  const handleOverlayCommandHandled = useCallback((requestId: number) => {
    setOverlayCommandRequest((current) => current?.id === requestId ? null : current);
  }, []);
  const handleOverlayImageHandled = useCallback((requestId: number) => {
    setOverlayImageRequest((current) => current?.id === requestId ? null : current);
  }, []);
  const handleOverlayActionHandled = useCallback((requestId: number) => {
    setOverlayActionRequest((current) => current?.id === requestId ? null : current);
  }, []);
  const handleOverlayEditingChange = useCallback((editing: boolean) => {
    setOverlayEditing(editing);
    if (!editing) {
      setOverlaySelection(EMPTY_OVERLAY_SELECTION);
      setLineDashMenuOpen(false);
      setLineWidthMenuOpen(false);
      setActiveOverlayTool({ kind: "select" });
    }
  }, []);
  const handleReloadFailedDocument = useCallback(() => {
    void reloadFailedDocument();
  }, [reloadFailedDocument]);

  const commentPanelProps = useMemo(() => ({
    activeThreadId: activeCommentThreadId,
    author: commentAuthor,
    candidateAnchor: currentCommentAnchor,
    pendingAnchor: pendingCommentAnchor,
    pendingDraft: pendingCommentDraft,
    replyDrafts: commentReplyDrafts,
    showResolved: showResolvedComments,
    threads: visibleCommentThreadsForPanel,
    onAddThread: addPendingCommentThread,
    onCancelPending: () => {
      setPendingCommentAnchor(null);
      setPendingCommentDraft([]);
    },
    onDeleteMessage: deleteCommentMessage,
    onDeleteThread: deleteCommentThread,
    onEditMessage: editCommentMessage,
    onEditThread: editCommentThread,
    onPendingDraftChange: setPendingCommentDraft,
    onReply: replyToCommentThread,
    onReplyDraftChange: setCommentReplyDraft,
    onResolveThread: (threadId: string) => updateCommentResolved(threadId, true),
    onReopenThread: (threadId: string) => updateCommentResolved(threadId, false),
    onSelectThread: selectCommentThread,
    onShowResolvedChange: setShowResolvedComments,
    onStartThread: openCommentComposer,
    onThreadHoverChange: setHighlightedCommentThreadId,
    onToggleReaction: toggleCommentReaction,
  }), [
    activeCommentThreadId,
    addPendingCommentThread,
    commentAuthor,
    commentReplyDrafts,
    currentCommentAnchor,
    deleteCommentMessage,
    deleteCommentThread,
    editCommentMessage,
    editCommentThread,
    openCommentComposer,
    pendingCommentAnchor,
    pendingCommentDraft,
    replyToCommentThread,
    selectCommentThread,
    setCommentReplyDraft,
    setHighlightedCommentThreadId,
    setPendingCommentAnchor,
    showResolvedComments,
    toggleCommentReaction,
    updateCommentResolved,
    visibleCommentThreadsForPanel,
  ]);

  if (ledgerFailure) {
    return (
      <div className="app-shell">
        <LedgerSchemaFailurePanel
          failure={ledgerFailure}
          onReload={() => {
            setLedgerFailure(null);
            setWorkspaceReady(false);
            setWorkspaceReloadNonce((current) => current + 1);
          }}
        />
      </div>
    );
  }

  // クロームへ渡す値。**useMemo は使わない**: 依存配列が200個近くになり、1つ漏らすだけで
  // 「押しても光らないボタン」という無音の腐敗になる。EditorShell はもともと毎レンダー全体が
  // 再構築されるので、素の object literal なら挙動は現行と厳密に同一。同じ理由でグループ部品に
  // React.memo も付けない（参照が毎回変わるので無意味なうえ、付け方次第で腐敗を招く）。
  const chrome: EditorChromeValue = {
    commands: {
      commandTooltip, renderMenuShortcut,
    },
    toolbarMenus: {
      setActiveMenu, setBoxedTextMenuOpen, setColorStylePanel, setFontFamilyMenuOpen,
      setBlockStyleMenuOpen, setFontSizeMenuOpen,
      setLineDashMenuOpen, setLineEndpointMenu, setLineHeightMenuOpen, setLineToolMenuOpen,
      setLineWidthMenuOpen, setShapeMenuOpen, setTextAlignMenuOpen,
    },
    shared: {
      activeMenu, aiDocumentWriteInProgress, colorStylePanel, document, getActiveTextTarget,
      imageInputRef, insertInlineMath, isDesktopApp, isEmbedded, runEditCommand, runOverlayCommand,
      // `saveState` / `statusMessage` は渡さない。打鍵のたびに動く値なので、
      // 購読は葉 (`SaveStatusIndicators`) に閉じ込めてある。
      setStatusMessage, shapeGallerySections, lineToolItems, t, toggleMenu,
    },
    editing: {
      setMaterialLibraryOpen,
    },
    format: {
      ActiveTextAlignIcon, activeFontFamilyLabel, activeTextAlignOption,
      activeTextFontSize, applyBoxedTextPaddingY, applyInlineFormat, applyLineHeight,
      applyBlockStructure, applyTextAlign, applyTextStyle, blockStyleState, boldActive, boxedTextActive, boxedTextButtonRef,
      canUseBlockStructure,
      moreBlocksMenuButtonRef, moreBlocksMenuOpen, setMoreBlocksMenuOpen,
      orderedListMenuButtonRef, orderedListMenuOpen, setOrderedListMenuOpen,
      boxedTextMenuOpen, boxedTextPaddingY, boxedTextVariant, canUseLineHeight, canUseTextAlign,
      blockStyleButtonRef, blockStyleMenuOpen,
      canUseTextBlockStyle, canUseTextToolbar, fontFamily, fontFamilyButtonRef,
      fontFamilyIsKnownOption, fontFamilyIsMixed, fontFamilyMenuOpen, fontFamilyQuery,
      fontSizeButtonRef, fontSizeMenuOpen,
      handleLineHeightStepClick, italicActive, lineHeight, lineHeightButtonRef,
      lineHeightCustomOpen, lineHeightInput, lineHeightInputError, lineHeightMenuOpen,
      saveEditorFontFamilyPreference, selectBoxedTextVariant, selectedTextAlign, selectedTextStyle,
      setFontFamily, setFontFamilyQuery, setLineHeightCustomOpen, setLineHeightInput,
      setLineHeightInputError, setTextBackgroundColor, setTextColor, setTextFontSize,
      startLineHeightStepping, stopLineHeightStepping, textAlignButtonRef, textAlignMenuOpen,
      textBackgroundColor, textBackgroundColorButtonRef, textColor, textColorButtonRef,
      toggleBoxedText, underlineActive, visibleCustomFontOptions, visibleFontFamilyGroups,
    },
    insert: {
      ActiveLineToolIcon, activeLineToolItem, activeOverlayTool, bodyToolbarLockedByAi,
      cancelInlineMathMenuClose, inlineMathButtonRef, inlineMathMenuOpen, lineToolMenuButtonRef,
      lineToolMenuOpen, openInlineMathMenu, scheduleInlineMathMenuClose, selectedInlineMath,
      selectedInlineMathDetails, setInlineMathMenuOpen, shapeMenuButtonRef, shapeMenuOpen,
      startInlineMathFromToolbar,
    },
    shapeStyle: {
      applyOverlayStyle, arrangeOverlayShapes, canArrangeOverlayShapes, canUseFillStyleControls, canUseLineEndpointControls,
      canUseLineStyleControls, canUseStrokeStyleControls, effectiveLineDashMenuOpen,
      effectiveLineEndpointMenu, effectiveLineWidthMenuOpen, fillColorButtonRef, fillColorPatch,
      lineDashButtonRef, lineWidthButtonRef, overlaySelection, selectedOverlayLineDash,
      selectedOverlayLineSize, selectionFill, selectionFillColor, selectionFillOpacity,
      setStrokeColor, strokeColor, strokeColorButtonRef,
    },
    search: {
      findNext, findPrevious, overlayEditing, replaceAll, replaceNext, replaceOpen, replaceText,
      searchButtonRef, searchMatchCount, searchOpen, searchQuery, setReplaceOpen, setReplaceText,
      setSearchOpen, setSearchQuery,
    },
    view: {
      activePageNumber,
      applyZoom,
      // ページ編集面が描かれていない間 (ワークスペース再読込中・教材が開けなかったとき)
      // は、直前の教材のページ数が残らないようにする。onPageCountChange は
      // アンマウントでは呼ばれないので、ここで «描かれているか» を見て畳む。
      pageCount: pageEditorMounted ? editorPageCount : 1,
      zoom,
      zoomOptions,
    },
    appMenu: {
      activeDocumentOpenFailure, activeFileId, addBlock, aiMenuButtonRef, appUpdateState,
      closeDocumentTab, commentsPanelOpen, createDocumentTab, createWhiteboardDocumentTab, degradedWatcherScopes,
      deleteActiveDocument, documentMetadatas, documentTitle, duplicateActiveDocument, exportJson,
      exportMenuOpen, fileMenuButtonRef, handleTitleUpdateAction, hasPendingAiApprovalAdoption,
      importDocumentFile, importInputRef, insertMenuButtonRef, loadingFileId, mcpPreviewBusy,
      newDocButtonRef, newDocMenuOpen, openCommandSettings, openDocumentInWorkspace,
      openDocumentListDialog, openDocumentTabs, openImportDialog, openNewDocMenu, openOtherImportDialog,
      openPrintPreview, otherImportInputRef,
      openWorkspaceScreen, promoteAiToSidebar, reportIssue, requestOverlayImages,
      resolvedDocumentTitle, retryPendingAiApprovalAdoption, scheduleCloseNewDocMenu,
      setAiSettingsOpen, setDesktopSettingsOpen: openDesktopSettingsFromChrome, setExportMenuOpen, setNewDocMenuOpen,
      setOutlineDialogOpen, setOverlayEditing, setPageSettingsOpen, setTemplateGalleryOpen,
      setTexCommandReferenceOpen, setTexEnvironmentSettingsOpen, setTitleInputFocused,
      settingsMenuButtonRef, showRichTitle,
      showTitleUpdateButton, titleInputValue, titleRichNodes,
      titleUpdateButtonDisabled, toggleCommentsPanel, uiLayoutPreference, updateMetadata,
      updateUiLayoutPreference,
    },
    ribbon: {
      applyColumnCommand,
      backstage: ribbonBackstageState,
      closeBackstage: closeRibbonBackstage,
      columnCommand: ribbonColumnCommand,
      contextualTabVisible: ribbonContextualTabVisible,
      ribbonIdPrefix,
      ribbonTabState,
      ribbonCollapse,
      selectBackstageSection: selectRibbonBackstageSection,
      selectRibbonTab,
      toggleBackstage: toggleRibbonBackstage,
      toggleRibbonCollapse,
    },
  };

  return (
    <MathEnvironmentProvider
      mathFractionSizing={document.metadata.mathFractionSizing}
      preamble={document.metadata.texPreamble}
    >
    {/* ribbon-chrome.css のセレクタはすべてこの属性から始まる。docs では "docs"。 */}
    <div
      className="app-shell"
      data-ui-layout={uiLayoutPreference.mode}
      data-backstage-open={ribbonBackstageOpen ? "true" : undefined}
      data-ribbon-collapsed={ribbonCollapse.collapsed ? "true" : undefined}
      data-ai-sidebar-open={aiDisplayMode === "sidebar" && aiSidebarOpen ? "true" : undefined}
      style={{ "--ai-sidebar-width": `${AI_SIDEBAR_WIDTH}px` } as CSSProperties}
    >
      <WebMcpBridge
        ref={webMcpBridgeRef}
        enabled={!isDesktopApp && !isEmbedded}
        instructionScopeId={document.docId}
        getDocument={getWebMcpDocument}
        getRevision={getWebMcpRevision}
        getSelectedBlockId={getWebMcpSelectedBlockId}
        getSelection={getWebMcpSelection}
        commitDocumentChange={commitDocumentChange}
        navigateToTarget={navigateToWebMcpTarget}
        onPreviewGroupsChange={setWebMcpPreviewGroups}
        sidebarOpen={aiDisplayMode === "sidebar" && aiSidebarOpen}
        sidebarTarget={webMcpPanelTarget}
      />
      {/* 図形を選んでいる間、フォーカスを失った本文の選択を描き直す帯。
          「本文も図形も同時に選ばれている」ことが画面から読めないと混在コピーは事故になる。 */}
      <HeldBodySelectionOverlay active={overlaySelection.selectedCount > 0} />
      <CommandPalette
        open={commandPaletteOpen}
        entries={paletteEntries}
        onClose={() => setCommandPaletteOpen(false)}
        onSelect={runPaletteEntry}
      />

      <DesktopSettingsModal
        open={desktopSettingsOpen}
        onClose={() => {
          setDesktopSettingsOpen(false);
          setDesktopSettingsUpdateCheckRequest(0);
          setSettingsFocusEntryId(undefined);
        }}
        onFontsChanged={reloadCustomFonts}
        requestUpdateCheck={desktopSettingsUpdateCheckRequest}
        focusEntryId={settingsFocusEntryId}
      />
      {!isEmbedded && (
        <AiSettingsDialog
          open={aiSettingsOpen}
          onClose={() => {
            setAiSettingsOpen(false);
            setSettingsFocusEntryId(undefined);
          }}
          activeWorkspaceId={documentMetadatas.find((meta) => meta.fileId === activeFileId)?.workspaceId ?? null}
          focusEntryId={settingsFocusEntryId}
        />
      )}
      {/* 複数runの編集案がたまっているとき、1操作でまとめて承認できる一括ボタン (Issue 4)。
          衝突するrunがあればそれだけ stale notice に残り、他は適用される。 */}
      {isDesktopApp && workspaceReady && aiEditPreviewGroups.length >= 2 && (
        <div className="ai-apply-all-bar" role="region" aria-label={tE("aria.applyAllAiEdits")}>
          <span className="ai-apply-all-count">{tE("aiApplyAll.count", { edits: aiEditPreviewGroups.length })}</span>
          <button
            type="button"
            className="ai-apply-all-button"
            disabled={mcpPreviewBusy}
            onClick={() => void applyAllAiEditPreviewGroups()}
          >
            {tE("aiApplyAll.applyAll")}
          </button>
        </div>
      )}
      {/* ヘッダーはリボン UI (`editor-shell/chrome`) が描く。保存状態のバッジとタブの点は
          リボンの中で葉が購読するので、ここで saveState を読む必要はない。 */}
      {renderEditorChrome(chrome)}

      <main
        className={workspaceClassName}
        // Backstage は本文を覆うので、覆っている間は本文を丸ごと不活性にする。
        // capture の keydown ガードだけでは Tab で裏へ抜けられ、beforeinput 経由で
        // 見えない本文を編集できてしまう（inert はフォーカスも入力もまとめて塞ぐ）。
        inert={ribbonBackstageOpen}
        style={{
          "--outline-width": `${outlineWidth}px`,
        } as CSSProperties}
      >
        {showPageNavigator && (
          <aside className="outline-panel page-navigator-panel" aria-label={tE("aria.pagePreview")}>
          <div className="panel-header page-navigator-panel-header">
            <Tooltip {...commandTooltip(outlineOpen ? tE("aria.closePageList") : tE("aria.openPageList"), "view.toggleOutline")}>
              <button
                type="button"
                className="panel-icon-button outline-rail-toggle"
                aria-label={outlineOpen ? tE("aria.closePagePreview") : tE("aria.openPagePreview")}
                aria-pressed={outlineOpen}
                onClick={() => setOutlineOpen((current) => !current)}
              >
                <PanelLeft size={16} />
              </button>
            </Tooltip>
            <button type="button" className="panel-icon-button outline-close-button" title={tE("common.close")} aria-label={tE("aria.closePagePreview")} onClick={() => setOutlineOpen(false)}>
              <X size={15} />
            </button>
          </div>
          <div className="page-navigator-body">
            {!workspaceReady && (
              <div className="page-navigator-skeleton" aria-hidden="true">
                {[1, 2, 3].map((item) => (
                  <div key={item} className="page-navigator-skeleton-item">
                    <span className="shimmer-line" />
                    <span className="shimmer-block" />
                  </div>
                ))}
              </div>
            )}
            {workspaceReady && (
              <PrintPreviewPageNavigator
                // ページナビゲータは常に非表示 (showPageNavigator)。復活させるときは、
                // 打鍵ごとの再描画を避けるためここでデバウンスし直すこと。
                document={document}
                profile="teacher"
                activePageNumber={activePageNumber}
                onPageSelect={scrollToPage}
                style={pageNavigatorStyle}
              />
            )}
          </div>
          {outlineOpen && (
            <button
              type="button"
              className="outline-resize-handle"
              aria-label={tE("aria.resizeLeftSidebar")}
              title={tE("aria.resizeLeftSidebar")}
              onMouseDown={resizeOutline}
              onDoubleClick={() => setOutlineWidth(DEFAULT_OUTLINE_WIDTH)}
            />
          )}
          </aside>
        )}

        <section
          className={`editor-canvas ${loadingFileId ? "is-switching" : ""}`}
          data-whiteboard={isWhiteboardDocument ? "true" : undefined}
          ref={editorCanvasRef}
          onClick={(event) => {
            const target = event.target instanceof Element ? event.target : null;
            if (target?.closest("[data-sigma-doc-id], [data-overlay-shape-id], .overlay-canvas-bleed-surface, .overlay-canvas-editor, .page-overlay-preview, [data-problem-area]")) {
              return;
            }
            setSelectedInlineMath(null);
            selectedIdRef.current = null;
            materialBlockSelectionRef.current = null;
            setSelectedId(null);
          }}
        >
          {/* 「AIが今何をやっているか」を常時確認できるcockpitの入口。折りたたみ時は
              canvas左上のアイコン1つだけ (バッジで実行中/要対応を示す)。開閉はUIローカル
              stateなので、旧: メニューの開閉トグルは廃止した (redundant)。 */}
          {isDesktopApp && workspaceReady && !activeDocumentOpenFailure && (
            <AiTaskDock
              documentIdentityKey={activeFileId}
              document={document}
              previewGroups={aiEditPreviewGroups}
              staleGroups={staleProposalGroups}
              activeDocumentRevision={activeDocumentRevision}
              busy={mcpPreviewBusy}
              onApplyGroup={applyAiEditPreviewGroup}
              onDismissGroup={dismissAiEditPreviewGroup}
              onRebaseGroup={rebaseStaleProposals}
              onForceApplyGroup={forceApplyStaleProposals}
              onRevertProposal={revertAppliedProposals}
              onRestoreProposal={restoreProposalFromHistory}
              onFocusSession={focusAiSession}
              resolvedProposals={resolvedMcpEditProposals}
            />
          )}
          {workspaceReady && isWhiteboardDocument && (
            <CommentDock
              document={document}
              open={commentsPanelOpen}
              panel={commentPanelProps}
              onOpenChange={setCommentsPanelOpen}
            />
          )}
          {!workspaceReady && (
            <div className="editor-canvas-skeleton" aria-hidden="true">
              <div className="editor-canvas-skeleton-page">
                <span className="shimmer-line" style={{ width: "42%", height: "18px" }} />
                {[88, 96, 72, 90, 64, 84, 92, 58].map((width, index) => (
                  <span key={index} className="shimmer-line" style={{ width: `${width}%` }} />
                ))}
              </div>
            </div>
          )}
          {workspaceReady && activeDocumentOpenFailure && (
            <DocumentOpenFailurePanel
              failure={activeDocumentOpenFailure}
              reloading={loadingFileId === activeDocumentOpenFailure.fileId}
              onReload={handleReloadFailedDocument}
            />
          )}
          {pageEditorMounted && <AiPageCanvasEditor
            key={`${activeFileId}:${documentInstanceRevision}`}
            aiEnabled={!isEmbedded}
            onPageCountChange={setEditorPageCount}
            onMeasuredBlockRectsChange={captureMeasuredBodyBlockRects}
            // Backstage は本文を覆うので、その間は本文側の window ショートカットも降ろす。
            // capture の stopPropagation も <main inert> も window リスナーには効かない
            // （どちらも「window より下」しか止められない）ので、フラグで渡すしかない。
            shortcutsSuppressed={ribbonBackstageOpen}
            document={document}
            selectedId={selectedId}
            selectedInlineMath={selectedInlineMath}
            commentThreads={commentThreads}
            activeCommentThreadId={activeCommentThreadId}
            highlightedCommentThreadId={highlightedCommentThreadId}
            showComments={commentsPanelOpen}
            commentPanel={isWhiteboardDocument ? undefined : commentPanelProps}
            overlaySelection={overlaySelection}
            overlayCommentAnchor={currentOverlayCommentAnchor}
            aiDocumentWriteInProgress={aiDocumentWriteInProgress}
            aiEditPreviewGroups={visibleAiEditPreviewGroups}
            aiEditPreviewApplying={mcpPreviewBusy}
            aiApplyAnimation={aiApplyAnimation}
            fontSize={BASE_EDITOR_FONT_SIZE}
            zoom={zoom}
            whiteboardPanX={whiteboardPan.panX}
            whiteboardPanY={whiteboardPan.panY}
            onWhiteboardViewportChange={handleWhiteboardViewportChange}
            onWhiteboardPanBy={panWhiteboardBy}
            onWhiteboardZoomRequest={applyZoom}
            onWhiteboardCameraReset={resetZoom}
            historyRevision={historyRevision}
            onSelect={handleCanvasSelect}
            onChange={updateBlock}
            onDelete={removeBlock}
            onDeleteBlocks={removeBlocks}
            onInsertBodyBlock={insertBodyBlockAt}
            onCopyBlock={copyBlockToClipboard}
            onPasteBlock={pasteBlockFromClipboard}
            canPasteProblem={canPasteProblem}
            onWrapBlockInColumns={wrapBlockInColumns}
            onUnwrapColumns={unwrapColumns}
            onDuplicate={handleDuplicateBlock}
            onMove={handleMoveBlock}
            onAddProblemBlock={handleAddProblemBlock}
            onReplaceTextFlow={replaceTextFlow}
            onPageLayoutChange={updatePageLayout}
            onOverlayChange={updateOverlay}
            onOverlayImagesRequest={requestOverlayImages}
            materials={materials}
            onMaterialInsert={handleCanvasMaterialInsert}
            onMaterialSaveRequest={openMaterialAddDialog}
            onSelectionMaterialSaveRequest={handleSelectionMaterialSaveRequest}
            onProblemCommand={handleCanvasProblemCommand}
            onBodyBlockCommand={handleCanvasBodyBlockCommand}
            onHeadingCommand={handleCanvasHeadingCommand}
            pendingDeletion={pendingDeletion}
            onReanchorOverlay={reanchorOverlay}
            overlayCommandRequest={overlayCommandRequest}
            overlayImageRequest={overlayImageRequest}
            overlayActionRequest={overlayActionRequest}
            overlayArrangeShortcutLabels={overlayArrangeShortcutLabels}
            onOverlayCommandHandled={handleOverlayCommandHandled}
            onOverlayImageHandled={handleOverlayImageHandled}
            onOverlayActionHandled={handleOverlayActionHandled}
            onOverlayEditingChange={handleOverlayEditingChange}
            onOverlayModeStatusChange={setOverlayModeStatus}
            onOverlaySelectionSummaryChange={handleOverlaySelectionSummaryChange}
            onOverlayActiveToolChange={setActiveOverlayTool}
            onRunningRegionEditingChange={setRunningRegionEditingKind}
            onCommentAnchorRequest={openCommentComposer}
            onCommentAnchorCandidateChange={setCommentAnchorCandidate}
            onCommentThreadSelect={selectCommentThread}
            onAiReferenceRequest={isDesktopApp ? requestAiEditWithReference : undefined}
            onAiReferenceCandidateChange={isDesktopApp ? updateAiEditReferenceCandidate : undefined}
            onAiEditPreviewApply={stableApplyVisibleAiEditPreviewGroup}
            onAiEditPreviewDismiss={stableDismissVisibleAiEditPreviewGroup}
            onOpenSourceDocument={openSourceReferenceDocument}
            suppressSelectionActions={aiDisplayMode === "inline" && aiInlineOpen}
            pinAiTextSelectionReference={isDesktopApp && pinAiTextSelectionReference}
            onInlineRunPortalReady={handleInlineRunPortalReady}
            documentIdentityKey={activeFileId}
            documentWorkspaceId={activeDocumentMetadata?.workspaceId ?? null}
            onFocusAiSession={focusAiSession}
          />}
        </section>

        {renderAiHost()}
      </main>

      {overlayGraphSettingsDialog}
      {overlayChartSettingsDialog}
      {overlayGraph3DSettingsDialog}

      {materialLibraryOpen && (
        <div className="material-library-backdrop" data-modal-backdrop="" role="presentation" onPointerDown={() => setMaterialLibraryOpen(false)}>
          <section
            className="material-library-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={tE("material.title")}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <header className="material-library-header">
              <div>
                <h2>{tE("material.title")}</h2>
                <p>{tE("material.libraryDescription")}</p>
              </div>
              <button type="button" className="icon-button" title={tE("common.close")} aria-label={tE("common.close")} onClick={() => setMaterialLibraryOpen(false)}>
                <X size={16} />
              </button>
            </header>
            <div className="material-library-create">
              <input
                type="text"
                value={materialNameDraft}
                placeholder={tE("material.name")}
                aria-label={tE("material.name")}
                onChange={(event) => setMaterialNameDraft(event.target.value)}
              />
              <input
                type="text"
                value={materialDescriptionDraft}
                placeholder={tE("material.usage")}
                aria-label={tE("material.usageAria")}
                onChange={(event) => setMaterialDescriptionDraft(event.target.value)}
              />
              <button type="button" className="button primary" disabled={materialsLoading} onClick={() => void saveSelectedMaterial()}>
                {materialsLoading ? <Loader2 className="save-state-spinner" size={14} /> : <PlusCircle size={15} />}
                {tE("material.saveSelection")}
              </button>
            </div>
            <div className="material-library-search">
              <Search size={15} />
              <input
                type="search"
                value={materialSearch}
                placeholder={tE("material.search")}
                aria-label={tE("material.search")}
                onChange={(event) => setMaterialSearch(event.target.value)}
              />
            </div>
            {materialError && <p className="material-library-error" role="alert">{materialError}</p>}
            <div className="material-library-list">
              {materialsLoading && materials.length === 0 ? (
                <div className="material-library-empty">{tE("material.loading")}</div>
              ) : visibleMaterials.length === 0 ? (
                <div className="material-library-empty">{tE("material.empty")}</div>
              ) : (
	                visibleMaterials.map((material) => (
	                  <article className="material-library-item" key={material.id}>
	                    <MaterialPreview material={material} />
	                    <div className="material-library-item-main">
	                      <div className="material-library-item-title">
	                        <strong>{material.name}</strong>
	                        {isOfficialMaterial(material) && <span className="material-library-official-badge">{tE("material.official")}</span>}
	                      </div>
	                      {material.description && (
	                        <p className="material-library-item-desc">{material.description}</p>
	                      )}
	                      {material.tags && material.tags.length > 0 && (
	                        <div className="material-library-item-tags">
	                          {material.tags.slice(0, 4).map((tag) => (
	                            <span className="material-library-tag" key={tag}>{tag}</span>
	                          ))}
	                        </div>
	                      )}
	                      {material.visualConcepts && material.visualConcepts.length > 0 && (
	                        <div className="material-library-item-tags">
	                          {material.visualConcepts.slice(0, 4).map((concept) => (
	                            <span className="material-library-tag semantic" key={concept}>{concept}</span>
	                          ))}
	                        </div>
	                      )}
	                    </div>
	                    <div className="material-library-item-actions">
	                      <button
	                        type="button"
	                        className="icon-button small"
	                        title={tE("material.actions")}
	                        aria-label={tE("material.actionsFor", { name: material.name })}
	                        aria-haspopup="menu"
	                        aria-expanded={materialActionMenu?.materialId === material.id}
	                        onClick={(event) => openMaterialActionMenu(event, material)}
	                      >
	                        <MoreHorizontal size={14} />
	                      </button>
	                    </div>
	                  </article>
	                ))
              )}
            </div>
          </section>
        </div>
      )}

      {materialLibraryOpen && materialActionMenu && materialActionMenuItem && (
        <MaterialActionMenu
          material={materialActionMenuItem}
          x={materialActionMenu.x}
          y={materialActionMenu.y}
          onInsert={insertMaterialFromDialog}
          onRename={startEditingMaterial}
          onDelete={deleteMaterial}
        />
      )}

      {materialLibraryOpen && materialEditingItem && materialEditingContent && !isOfficialMaterial(materialEditingItem) && (
        <MaterialEditDialog
          material={materialEditingItem}
          content={materialEditingContent}
          draft={materialEditingDraft}
          saving={materialsLoading}
          onContentChange={updateMaterialEditingContent}
          onDraftChange={setMaterialEditingDraft}
          onSave={() => void renameMaterial(materialEditingItem)}
          onClose={closeMaterialEditing}
          onOpenInfo={() => setMaterialMetadataInfoOpen(true)}
        />
      )}

      {materialMetadataInfoOpen && (
        <InfoDialog
          title={tE("material.aiInfo")}
          onClose={() => setMaterialMetadataInfoOpen(false)}
        >
          <p>{tE("material.aiInfoRead")}</p>
          <p>{tE("material.aiInfoExample")}</p>
          <p>{tE("material.aiInfoContent")}</p>
        </InfoDialog>
      )}

      {materialAddDialogOpen && materialAddContent && (
        <div className="material-add-backdrop" data-modal-backdrop="" role="presentation" onPointerDown={closeMaterialAddDialog}>
          <section
            className="material-add-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={tE("material.add")}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <header className="material-add-header">
              <div>
                <h2>{tE("material.add")}</h2>
                <p>{tE("material.addDescription")}</p>
              </div>
              <button type="button" className="icon-button" title={tE("common.close")} aria-label={tE("common.close")} onClick={closeMaterialAddDialog}>
                <X size={16} />
              </button>
            </header>
            <div className="material-add-body">
              <MaterialContentPreview content={materialAddContent} title={materialAddName || tE("material.title")} />
              <label className="material-add-name-field">
                <span>{tE("material.name")}</span>
                <input
                  type="text"
                  value={materialAddName}
                  aria-label={tE("material.name")}
                  autoFocus
                  onChange={(event) => setMaterialAddName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void confirmMaterialAddDialog();
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      closeMaterialAddDialog();
                    }
                  }}
                />
              </label>
              <MaterialMetadataDraftFields
                value={{ ...materialAddDraft, name: materialAddName }}
                onChange={(nextDraft) => {
                  setMaterialAddName(nextDraft.name);
                  setMaterialAddDraft(nextDraft);
                }}
                hideName
              />
              {materialError && <p className="material-library-error" role="alert">{materialError}</p>}
            </div>
            <footer className="material-add-actions">
              <button type="button" className="button secondary" onClick={closeMaterialAddDialog}>
                {tE("common.cancel")}
              </button>
              <button type="button" className="button primary" disabled={materialsLoading} onClick={() => void confirmMaterialAddDialog()}>
                {materialsLoading ? <Loader2 className="save-state-spinner" size={14} /> : <PlusCircle size={15} />}
                {tE("material.add")}
              </button>
            </footer>
          </section>
        </div>
      )}

      <TemplateGallery
        open={templateGalleryOpen}
        onClose={() => setTemplateGalleryOpen(false)}
        mode="insert"
        activeWorkspaceId={documentMetadatas.find((meta) => meta.fileId === activeFileId)?.workspaceId ?? null}
        currentDocument={document}
        onInsert={insertTemplate}
      />

      {editorMathPasswordRequest && (
        <div className="classic-password-backdrop" data-modal-backdrop="" role="presentation" onPointerDown={cancelEditorMathImport}>
          <section
            className="classic-password-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={tE("password.title")}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <header className="classic-password-header">
              <h2>{tE("password.heading")}</h2>
              <button type="button" className="icon-button" title={tE("common.close")} aria-label={tE("common.close")} onClick={cancelEditorMathImport}>
                <X size={16} />
              </button>
            </header>
            <p className="classic-password-file" title={editorMathPasswordRequest.name}>{editorMathPasswordRequest.name}</p>
            <p className="classic-password-note">{tE("password.note")}</p>
            <form
              className="classic-password-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submitEditorMathPassword();
              }}
            >
              <input
                type="password"
                value={editorMathPassword}
                placeholder={tE("password.label")}
                aria-label={tE("password.label")}
                autoFocus
                disabled={editorMathImporting}
                onChange={(event) => {
                  setEditorMathPassword(event.target.value);
                  setEditorMathPasswordError(null);
                }}
              />
              {editorMathPasswordError && <p className="classic-password-error" role="alert">{editorMathPasswordError}</p>}
              <div className="classic-password-actions">
                <button type="button" onClick={cancelEditorMathImport} disabled={editorMathImporting}>{tE("common.cancel")}</button>
                <button type="submit" className="primary" disabled={editorMathImporting || editorMathPassword.length === 0}>
                  {editorMathImporting ? tE("password.importing") : tE("password.import")}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {outlineDialogOpen && (
        <div className="outline-dialog-backdrop" data-modal-backdrop="" role="presentation" onPointerDown={() => setOutlineDialogOpen(false)}>
          <section
            className="outline-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={tE("outline.title")}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <header className="outline-dialog-header">
              <div>
                <h2>{tE("outline.title")}</h2>
                <p title={resolvedDocumentTitle}><DocumentTitleText title={resolvedDocumentTitle} nodes={documentTitle.nodes} /></p>
              </div>
              <button type="button" className="icon-button" title={tE("common.close")} aria-label={tE("common.close")} onClick={() => setOutlineDialogOpen(false)}>
                <X size={16} />
              </button>
            </header>
            <nav className="outline-dialog-list">
              {outline.length === 0 ? (
                <p className="outline-dialog-empty">{tE("outline.empty")}</p>
              ) : outline.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={selectedId === item.id ? "selected" : ""}
                  onClick={() => selectOutlineItem(item.id)}
                >
                  <span>
                    {(item.type === "section" || item.type === "heading") && outlineHeadingNumbers.get(item.id) ? (
                      <span className="heading-number-prefix">
                        {outlineHeadingNumbers.get(item.id)}{" "}
                      </span>
                    ) : null}
                    {item.title}
                  </span>
                  <code>{item.type}</code>
                </button>
              ))}
            </nav>
          </section>
        </div>
      )}

      {previewOpen && (
        <div className="preview-drawer" role="dialog" aria-modal="true" aria-label={tE("aria.pdfPreview")}>
          <PrintPreviewToolbar
            renderState={printPreviewRenderState.state}
            pageCount={printPreviewRenderState.pageCount}
            isExporting={pdfExporting}
            exportUnavailableReason={resolveDrawerExportUnavailableReason({
              isDesktopApp,
              isEmbedded,
              hasDesktopExportBridge: Boolean(getDesktopBridge()?.file.exportPdf),
            })}
            onOpenExternal={shouldOfferExternalPrintWindow({ isDesktopApp, isEmbedded })
              ? () => void openPrintWindow()
              : undefined}
            onExport={() => void exportPdf()}
            onClose={() => setPreviewOpen(false)}
          />
          <div className="preview-scroll">
            <PagedRenderSurface
              document={document}
              profile="teacher"
              onRenderStateChange={setPrintPreviewRenderState}
            />
          </div>
        </div>
      )}

      {exportedPdfPath && <PdfExportSuccessDialog filePath={exportedPdfPath} onClose={() => setExportedPdfPath(null)} />}

      <DocumentLibraryDialog
        open={documentListOpen}
        documents={documentMetadatas}
        activeFileId={activeFileId}
        activeDocumentTitle={resolvedDocumentTitle}
        openFileIds={openFileIds}
        onClose={() => setDocumentListOpen(false)}
        onCreate={createDocumentTab}
        onOpen={openDocumentFromList}
        onDuplicate={duplicateDocumentFromList}
        onDelete={deleteDocumentFromList}
      />

      {pageSettingsOpen && (
        <PageSettingsDialog
          layout={document.pageLayout}
          mathFractionSizing={document.metadata.mathFractionSizing}
          headingNumbering={document.metadata.headingNumbering}
          focusEntryId={settingsFocusEntryId}
          hasContent={hasMeaningfulBodyContent(document.content)}
          onClose={() => {
            setPageSettingsOpen(false);
            setSettingsFocusEntryId(undefined);
          }}
          onChange={(layout, mathFractionSizing, headingNumbering) => {
            updatePageLayoutAndMetadata(layout, {
              ...document.metadata,
              mathFractionSizing,
              headingNumbering,
            });
          }}
        />
      )}

      {commandSettingsOpen && (
        <CommandSettingsDialog
          overrides={shortcutOverrides}
          customCommands={customCommands}
          fontFamilyOptions={FONT_FAMILY_OPTIONS}
          platform={shortcutPlatform}
          onChange={setShortcutOverrides}
          onCustomCommandsChange={setCustomCommands}
          onClose={() => {
            setCommandSettingsOpen(false);
            setSettingsFocusEntryId(undefined);
          }}
          focusEntryId={settingsFocusEntryId}
        />
      )}

      {texCommandReferenceOpen && (
        <TexCommandReferenceDialog onClose={() => setTexCommandReferenceOpen(false)} />
      )}
      {texEnvironmentSettingsOpen && (
        <TexEnvironmentSettingsDialog
          preamble={document.metadata.texPreamble}
          onChange={(texPreamble) => {
            updateMetadata({ ...document.metadata, texPreamble });
            setStatusMessage(tE("status.texEnvUpdated"));
          }}
          onClose={() => setTexEnvironmentSettingsOpen(false)}
        />
      )}
    </div>
    </MathEnvironmentProvider>
  );
}

interface EditorBlockFocusOptions {
  /**
   * ブロック全体を選ぶのではなく、末尾へキャレットを畳む。
   *
   * 既定 (false) は「いま作った空ブロックへ入る」向き。既にある文章のブロックへ焦点を戻す
   * ときに全選択のままにすると、次の 1 打鍵でその文章が消える (引用ボタンで実際に踏んだ)。
   */
  collapseToEnd?: boolean;
  /**
   * 焦点がどこにも無いときだけ当てる。
   *
   * ブロック操作の後始末に使う。remount で焦点が飛んだときは戻したいが、飛んでいないなら
   * PM のコマンドが置いたキャレットがそのまま正しいので、触ってはいけない。
   */
  onlyIfLost?: boolean;
}

function scheduleEditorBlockFocus(
  blockId: string,
  options: EditorBlockFocusOptions = {},
  attempt = 0,
) {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      if (options.onlyIfLost && !hasLostEditorFocus()) {
        // まだどこかが焦点を持っている。remount は次のフレームには間に合わないことがあるので、
        // すぐ諦めずに「失われたか」をもう一度だけ見に行く。
        if (attempt < FOCUS_RESTORE_ATTEMPTS) {
          window.setTimeout(
            () => scheduleEditorBlockFocus(blockId, options, attempt + 1),
            FOCUS_RESTORE_VERIFY_MS,
          );
        }
        return;
      }

      const selector = `[data-sigma-doc-id="${CSS.escape(blockId)}"], #${CSS.escape(blockId)}`;
      const blockElement = window.document.querySelector<HTMLElement>(selector);
      const editorElement = blockElement?.closest<HTMLElement>("[contenteditable='true']");
      const selection = window.getSelection();
      if (!blockElement || !editorElement || !selection) {
        if (attempt < 8) {
          window.setTimeout(() => scheduleEditorBlockFocus(blockId, options, attempt + 1), 30);
        }
        return;
      }

      editorElement.focus({ preventScroll: true });
      const range = window.document.createRange();
      range.selectNodeContents(blockElement);
      // **畳んでから**張る。全選択のまま残すと、次に打った文字がブロックごと置き換わる
      // (`docs/caret-behavior-spec.md` が禁止する回帰そのもの)。`collapseToEnd` の指定が
      // 無ければ先頭へ畳む。
      range.collapse(!options.collapseToEnd);
      selection.removeAllRanges();
      selection.addRange(range);
      // `scrollIntoView` は祖先のスクロール可能な箱 (断片の viewport) まで動かしてしまう。
      // 動かすのは紙面のスクローラーだけにする。
      scrollElementIntoCanvasView(blockElement);

      // 当てた焦点が定着したかを、少し置いてから確かめる。
      //
      // ブロックの入れ物を作り替える操作 (引用でくるむ・段組にする・リストにする) は本文ランの
      // **先頭ブロック id** を変える。ランの React キーはその id なので (`render-units.ts` の
      // `id: chunk[0].id`)、React がランごと unmount → remount し、ここで当てた焦点はその
      // commit で外れる。実機では「引用ボタンを押した直後に打った文字が引用の外へ行く」という
      // 形で出た。remount は次のフレームには間に合わないことがあるので、rAF ではなく待つ。
      //
      // 焦点が **どこにも無い** ときだけ戻す。ユーザーが自分で別のコントロールへ移ったなら、
      // それを奪い返してはいけない。
      if (attempt < FOCUS_RESTORE_ATTEMPTS) {
        window.setTimeout(() => {
          if (hasLostEditorFocus()) {
            scheduleEditorBlockFocus(blockId, options, attempt + 1);
          }
        }, FOCUS_RESTORE_VERIFY_MS);
      }
    });
  });
}

/**
 * 本文ランの先頭ブロック id を変えうるコマンド。押した後に焦点を当て直す必要がある。
 * (`render-units.ts` がランの id を `chunk[0].id` にしているため、React キーが変わる)
 */
/**
 * 焦点が「どこにも無い」か。
 *
 * ユーザーが自分で別のコントロールへ移ったのなら、それを奪い返してはいけない。だから
 * body (＝誰も持っていない) のときだけを「失われた」とみなす。
 */
function hasLostEditorFocus(): boolean {
  const active = window.document.activeElement;
  return !active || active === window.document.body;
}

/** 焦点が外れていたら当て直す回数と間隔。remount 1 回ぶんを吸収できれば十分。 */
const FOCUS_RESTORE_ATTEMPTS = 3;
const FOCUS_RESTORE_VERIFY_MS = 120;

function comparableDocumentValue(document: SigmaDocument) {
  return {
    version: document.version,
    docId: document.docId,
    metadata: document.metadata,
    content: document.content,
    comments: document.comments,
    outputProfiles: document.outputProfiles,
    pageLayout: document.pageLayout,
  };
}

function areSigmaDocumentsEquivalent(left: SigmaDocument, right: SigmaDocument): boolean {
  return areStructurallyEqual(comparableDocumentValue(left), comparableDocumentValue(right));
}

/**
 * 埋め込みホストのエコー判定用に「文書の内容そのもの」をキー化する。
 * (使い方は emittedEchoKeysRef のコメントを参照)
 *
 * sigma-doc-block-hash.ts の hashSigmaNode は使えない: あれは node:crypto 依存で
 * main process / mcp 専用であり、このファイルは renderer と npm SDK の両方で
 * ブラウザにバンドルされる。そのためハッシュではなく正規化JSON文字列をキーにする。
 *
 * キーを再帰的にソートし undefined を落とすのは hashSigmaNode と同じ規約。内容が
 * 同じでも Tiptap を往復するとキー順が入れ替わるため、素の JSON.stringify では
 * エコーを取り逃がし、無視したいはずのループが再発する。
 */
function documentHistoryKey(document: SigmaDocument): string {
  return JSON.stringify(canonicalizeDocumentValue(comparableDocumentValue(document)));
}

function canonicalizeDocumentValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalizeDocumentValue);
  }
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => [key, canonicalizeDocumentValue(record[key])]),
  );
}

function isCommandShortcutBlockedByTarget(target: EventTarget | null, binding: EditorShortcutBinding): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  const blockingSurface = target.closest<HTMLElement>(
    "[role='dialog'], .find-widget, .command-settings-dialog, .page-settings-dialog, .document-library-dialog, .file-access-dialog, .preview-drawer",
  );
  // 非モーダルの浮遊サーフェス (グラフ設定パネル) は本文の編集を止めない。
  // モーダルではないので、開いたままでも Undo / Delete / ズームが効かなければならない。
  // 中の入力欄は後段の input / math-field / contenteditable 判定が引き続き守る。
  if (blockingSurface && !blockingSurface.hasAttribute("data-non-modal-surface")) {
    return true;
  }

  const textInput = target.closest("input, textarea, select, math-field");
  if (textInput) {
    return true;
  }

  const editable = target.closest("[contenteditable='true']");
  if (!editable) {
    return false;
  }

  return isSingleCharacterShortcut(binding);
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  return target instanceof Element
    && target.closest("input, textarea, select, math-field, [contenteditable='true']") !== null;
}

/**
 * A field where a paste can only sensibly mean text.
 *
 * Deliberately narrower than `isNativeClipboardTarget`: that one also covers the body editor
 * (`contenteditable`), which *is* a valid destination for pasted shapes.
 */
function isPlainTextClipboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  if (tagName === "input" || tagName === "textarea" || tagName === "select") {
    return true;
  }
  if (target.closest("math-field")) {
    return true;
  }

  const editable = target.closest("[contenteditable='true']");
  return editable !== null && editable.closest(".page-flow, .text-flow-editor") === null;
}

function isNativeClipboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    target.closest("[contenteditable='true'], math-field") !== null
  );
}

function isInlineMathClipboardTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(".inline-math-node, .inline-math-tex-field, math-field.inline-math-field") !== null;
}

function hasActiveDomSelection(): boolean {
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString());
}

function getSelectedTopLevelBlock(
  document: SigmaDocument,
  selectedId: string | null,
): SigmaBlock | null {
  if (!selectedId) {
    return null;
  }

  return document.content.find((item) => item.id === selectedId) ?? null;
}

function hasMeaningfulBodyContent(content: SigmaBlock[]): boolean {
  if (content.length !== 1) {
    return content.length > 0;
  }
  const only = content[0];
  return only.type !== "paragraph"
    || only.children.some((child) => child.type === "mathInline" || child.text.trim().length > 0);
}

function getInlineMathBlockIdFromDom(mathInlineId: string): string | undefined {
  if (typeof window === "undefined" || !mathInlineId) {
    return undefined;
  }

  const element = window.document.querySelector<HTMLElement>(
    `.inline-math-node[data-id="${CSS.escape(mathInlineId)}"]`,
  );
  const blockElement = element?.closest<HTMLElement>("[data-sigma-doc-id], .editor-block[id], [data-page-block]");
  const dataId = blockElement?.getAttribute("data-sigma-doc-id");
  return dataId || blockElement?.id || undefined;
}
