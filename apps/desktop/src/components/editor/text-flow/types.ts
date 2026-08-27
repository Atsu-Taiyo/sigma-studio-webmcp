import type {
  TextFlowBlock,
  TextFlowSelectionBookmark,
} from "@/features/text-editing";
import type {
  CaretFragmentSourceLayout as TextFlowBoxFragmentSourceLayout,
  TextFlowColumnBlockLayout,
} from "@/features/rendering/core";
import type { TextRunScopeContainer } from "./text-run-span";
import type { MaterialItem } from "@/types/material";
import type {
  MathFractionSizing,
  SigmaCommentThread,
} from "@/features/document";

export type {
  ManualTextPageBreakResult,
  ManualTextPageBreakSelection,
  TextFlowBlock,
  TextPageBreakRequestDetail,
} from "@/features/text-editing";
export type {
  CaretFragmentSourceLayout as TextFlowBoxFragmentSourceLayout,
  TextFlowColumnBlockLayout,
} from "@/features/rendering/core";

export interface TextFlowBoundaryDeleteRequest {
  direction: "backward" | "forward";
  blockId: string;
  emptyBlock: boolean;
}

export interface TextFlowChangeContext {
  /** Consecutive Tiptap changes that should restore as one SigmaDoc undo event. */
  historyGroup: string;
  /** Selection after the change, used to preserve caret state across nested flow fragments. */
  selection?: TextFlowSelectionBookmark | null;
  /**
   * Mutation assembled outside the editors (cross-editor span replacement). Hosts must
   * schedule the `selection` restore even when the caret block id already existed.
   */
  crossEditor?: boolean;
}

export interface TextFlowBoxCommandRequest {
  styleId: string;
  commandName: string;
  displayName: string;
  triggerBlockId: string;
}

export interface TextFlowProblemCommandRequest {
  triggerBlockId: string;
}

export interface TextFlowMaterialInsertRequest {
  material: MaterialItem;
  triggerBlockId: string;
  screenPoint: {
    x: number;
    y: number;
  };
}

export interface TextFlowEditorProps {
  blocks: TextFlowBlock[];
  selectedId: string | null;
  mathFractionSizing?: MathFractionSizing | null;
  placeholder?: string;
  showPlaceholder?: boolean;
  singleBlock?: boolean;
  historyRevision: number;
  /** Map of block sigmaDocId -> margin-top px applied to the block that starts a new page. */
  breakGaps?: Record<string, number>;
  paginationBeforeIds?: string[];
  /** 区切りの**種別**。表示文言はエディタ側が表示言語に応じて解決する。 */
  paginationMarkerKind?: import("@/features/text-editing/model").PageBreakMarkerKind;
  paginationMarkerKinds?: Record<string, import("@/features/text-editing/model").PageBreakMarkerKind>;
  paginationMarkerLayouts?: Record<string, import("@/components/tiptap/page-break-gap-extension").PageBreakMarkerLayout>;
  columnFlowBlockLayouts?: Record<string, TextFlowColumnBlockLayout>;
  boxFragmentSourceLayouts?: Record<string, TextFlowBoxFragmentSourceLayout>;
  /** Continuation preview's logical source box; all replicas share one selection range. */
  boxFragmentReplicaId?: string;
  /** Which continuation fragment this replica shows (the source is 0). */
  boxFragmentReplicaIndex?: number;
  syncFocusedContent?: boolean;
  commentThreads?: SigmaCommentThread[];
  activeCommentThreadId?: string | null;
  highlightedCommentThreadId?: string | null;
  onCommentThreadSelect?: (threadId: string) => void;
  onFocusChange?: (
    focused: boolean,
    blockIds: string[],
    activeBlockId?: string | null,
    selection?: TextFlowSelectionBookmark | null,
  ) => void;
  onSelect: (blockId: string) => void;
  onChange: (
    previousIds: string[],
    nextBlocks: TextFlowBlock[],
    activeBlockId?: string | null,
    context?: TextFlowChangeContext,
  ) => void;
  onBoundaryDelete?: (request: TextFlowBoundaryDeleteRequest) => boolean;
  materials?: MaterialItem[];
  onMaterialInsert?: (request: TextFlowMaterialInsertRequest) => void;
  enableSelectionFormatMenu?: boolean;
  enableBoxCommands?: boolean;
  boxCommandStyleIds?: readonly string[];
  onBoxCommand?: (request: TextFlowBoxCommandRequest) => boolean;
  enableProblemCommands?: boolean;
  onProblemCommand?: (request: TextFlowProblemCommandRequest) => boolean;
  formatTarget?: string;
  /** Optional host-owned change markers; absent means no diff decoration. */
  changeDecorationState?: import("@/components/tiptap/change-decoration").TextFlowChangeDecorationState;
  /** Optional feature-neutral read-only/highlight policy. */
  editPolicy?: import("@/components/tiptap/edit-guard-extension").TextFlowEditPolicy;
  /** Continuation fragments render the duplicated title as read-only. */
  readOnlyBoxTitle?: boolean;
  /**
   * 同じ文書に属する本文系 TextFlowEditor を 1 つの選択対象として束ねる印。
   */
  textRunGroupId?: string;
  /** PageCanvasEditor の units 配列を基準にした文書順。 */
  textRunOrder?: number;
  /** レジストリ上のユニット id。inline content で分割された部分は part key。 */
  textRunUnitId?: string;
  /** 同じ onChange でまとめて置換できる SigmaDoc コンテナ。 */
  textRunScopeId?: string;
  /**
   * このユニットが中身を編集している SigmaDoc の入れ物。段組セクションのユニットは
   * 段落しか doc に持たないので、跨ぎコピーで段組ごと運ぶにはこれが要る。
   */
  textRunScopeContainer?: TextRunScopeContainer;
  /** 問題エリア・段組みなど、全選択時にも空段落を残す構造内の本文。 */
  textRunPreserveEmpty?: boolean;
}
