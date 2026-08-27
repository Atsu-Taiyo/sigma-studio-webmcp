import type {
  DesktopMcpEditProposalActionResult,
  DesktopMcpEditProposalStatus,
  DesktopMcpEditProposalSummary,
  DesktopStorageChangeEvent,
} from "@/types/desktop";
import type { SigmaDocument } from "@/features/document";
import type { LedgerSchemaFailure } from "@/lib/library-schema";
import type { SigmaDocumentRecoveryIssue, SigmaDocumentSchemaFailure } from "@/lib/sigma-doc-schema";

export type RuntimeTarget = "desktop";

export interface RuntimeCapabilities {
  desktopStorage: true;
  localFolders: true;
  localFileWatch: true;
  mcpProposals: true;
  codexAppServerAi: true;
  hostedAiApi: false;
  publicWeb: false;
}

export interface StorageResult {
  ok: boolean;
  error?: string;
  code?: "revision-mismatch";
  currentRevision?: number;
  revision?: number;
}

export interface DocumentMetadata {
  fileId: string;
  workspaceId: string;
  folderId: string | null;
  docId: string;
  title: string;
  documentPath?: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceState {
  openFileIds: string[];
  activeFileId: string;
}

export type WorkspaceInitializationResult =
  | { ok: true; state: WorkspaceState }
  | { ok: false; ledgerError: LedgerSchemaFailure };

export interface DocumentFileRecord {
  fileId: string;
  document: SigmaDocument;
  metadata: DocumentMetadata;
  recoveryIssues?: SigmaDocumentRecoveryIssue[];
  recoveryBackupPath?: string;
}

/**
 * 読み込み失敗の分類。"json" / "schema" は教材そのものの中身が原因なので、
 * UI は別教材へ黙って切り替えず、原因を表示したまま開いておく。
 */
export type DocumentLoadFailureKind = "missing" | "json" | "schema" | "io";

export type DocumentLoadResult =
  | {
      ok: true;
      document: SigmaDocument;
      revision: number;
      recoveryIssues: SigmaDocumentRecoveryIssue[];
      recoveryBackupPath?: string;
    }
  | {
      ok: false;
      error: string;
      failureKind?: DocumentLoadFailureKind;
      failures?: SigmaDocumentSchemaFailure[];
      documentPath?: string;
      title?: string;
    };

export interface CreateDocumentInput {
  title?: string;
  workspaceId?: string | null;
  folderId?: string | null;
}

export interface CreateFileFromDocumentInput {
  document: SigmaDocument;
  workspaceId?: string | null;
  folderId?: string | null;
}


export interface WorkspaceSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceFolderSummary {
  id: string;
  workspaceId: string;
  parentFolderId: string | null;
  name: string;
  fileCount: number;
  createdAt: string;
  updatedAt: string;
}

export type WorkspaceFileSummary = DocumentMetadata;

export interface WorkspaceOverview {
  activeWorkspaceId: string;
  workspaces: WorkspaceSummary[];
  folders: WorkspaceFolderSummary[];
  files: WorkspaceFileSummary[];
}

export type WorkspaceOverviewResult =
  | { state: "unavailable"; error?: string }
  | { state: "error"; error: string }
  | { state: "ledger-schema-error"; failure: LedgerSchemaFailure }
  | { state: "ready"; overview: WorkspaceOverview };

export interface FolderPatch {
  name?: string;
  parentFolderId?: string | null;
}

export type ListMcpEditProposalsOptions = {
  status?: DesktopMcpEditProposalStatus | "all";
  fileId?: string;
  resolvedLimit?: number;
};

export interface LocalLibraryRepository {
  initializeWorkspace(): Promise<WorkspaceInitializationResult>;
  listFiles(): Promise<DocumentMetadata[]>;
  loadDocument(fileId: string): Promise<SigmaDocument | null>;
  loadDocumentWithRecovery(fileId: string): Promise<DocumentLoadResult>;
  saveDocument(
    fileId: string,
    document: SigmaDocument,
    options: { expectedRevision: number },
  ): Promise<StorageResult>;
  createDocument(input?: CreateDocumentInput): Promise<DocumentFileRecord>;
  createFileFromDocument(input: CreateFileFromDocumentInput): Promise<DocumentFileRecord>;
  duplicateFile(fileId: string): Promise<DocumentFileRecord>;
  deleteFile(fileId: string): Promise<StorageResult>;
  saveWorkspace(state: WorkspaceState): Promise<StorageResult>;
  getDataDir(): Promise<{ path: string }>;
  listMcpEditProposals(options?: ListMcpEditProposalsOptions): Promise<DesktopMcpEditProposalSummary[]>;
  approveMcpEditProposal(proposalId: string): Promise<DesktopMcpEditProposalActionResult>;
  rejectMcpEditProposal(proposalId: string): Promise<DesktopMcpEditProposalActionResult>;
  onChange(handler: (event: DesktopStorageChangeEvent) => void): () => void;
}

export interface LocalWorkspaceRepository {
  listOverview(workspaceId?: string | null): Promise<WorkspaceOverviewResult>;
  createWorkspace(name: string): Promise<WorkspaceOverviewResult>;
  renameWorkspace(workspaceId: string, name: string): Promise<WorkspaceOverviewResult>;
  deleteWorkspace(workspaceId: string): Promise<WorkspaceOverviewResult>;
  createFolder(workspaceId: string, name: string, parentFolderId?: string | null): Promise<WorkspaceOverviewResult>;
  updateFolder(workspaceId: string, folderId: string, patch: FolderPatch): Promise<WorkspaceOverviewResult>;
  deleteFolder(workspaceId: string, folderId: string): Promise<WorkspaceOverviewResult>;
  moveFileToFolder(workspaceId: string, fileId: string, folderId?: string | null): Promise<WorkspaceOverviewResult>;
  moveFileToWorkspace(fileId: string, targetWorkspaceId: string, folderId?: string | null): Promise<WorkspaceOverviewResult>;
}

export interface DesktopAiRuntime {
  run(payload: unknown, onEvent: (event: unknown) => void): Promise<unknown>;
}

export interface AppRuntime {
  target: RuntimeTarget;
  capabilities: RuntimeCapabilities;
  library: LocalLibraryRepository;
  workspace: LocalWorkspaceRepository;
  ai: DesktopAiRuntime;
}
