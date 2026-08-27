# Claude MCP セッション並列化計画

## 状況

`ClaudeClientManager` / `claudeSessionId` によるセッション並列化そのものは未実装で、この計画は引き続き有効。ただし実装ステップ8〜11(MCP write の revision safety 部分)は、Claude専用ではなく全プロバイダ共通のMCP統一実装として先行して landed 済み: `expectedRevision` 必須化(`sigma-doc-mcp-server-core.ts:885`)、`commit`省略時のpending proposal化とprompt文言(`MCP_EDIT_EXPECTED_REVISION_RULE`)、visual edit sessionのbaseRevision保持とcommit時のrevision照合。ステップ11の `fileId + baseRevision` grouping とstale proposal表示も実装済みで、landed名は計画時点の `coalesceMcpProposalsToPreview()` ではなく `groupMcpProposalsForPreview()`(`src/components/editor/ai-edit-preview-types.ts`)、stale表示は `AiStaleProposalNotice.tsx`。

## 目的

Sigma Studio の AI チャットで、複数のチャットルームから Claude MCP 編集を同時に実行できるようにする。

現在の `ClaudeStreamClient` は Claude Code の `stream-json` プロセスを1つだけ保持し、その中で未完了 turn を1つだけ扱う設計になっている。`stream-json` の `result` はこの実装内で turn ID と相関していないため、1プロセスに複数 turn を混ぜない。並列性は、チャットセッションごとに独立した Claude クライアントと Claude Code 子プロセスを立ち上げることで実現する。

## 現状

- `apps/desktop/electron/main.ts` はアプリ全体で1つの `claudeStreamClient` を生成している。
- `apps/desktop/electron/claude-stream-client.ts` は `activeTurn` を1つだけ持ち、実行中に次の `runTurn()` が来ると `別のClaude turnが実行中です。` を投げる。
- `apps/desktop/src/components/editor/AiEditPanel.tsx` の実行状態は panel global な `isRunning` / `activeRunSeqRef` / `isCurrentRun()` に依存している。
- 現在の `isCurrentRun()` は active room が変わると false になるため、実行中に別 room へ切り替えられるようにするだけでは、background run の完了結果や error が捨てられる。
- Claude の書き込みは MCP proposal として保存されるため、Claude の実行並列化と proposal の承認順序は分けて扱う必要がある。

## 方針

1つの `ClaudeStreamClient` を多重化しない。AI チャットの session 単位で `ClaudeStreamClient` を生成し、各クライアントが1つの Claude Code 子プロセスと1つの MCP stdio server を所有する。

session ID は、まず `AiEditChatRoom.id` を基準にする。チャットルームがない経路や comment mention からの実行では、呼び出し側で `comment:<commentId>:<runId>` のような一時 session ID を発行する。

初期実装では Claude の会話文脈は live process scoped とする。idle dispose やアプリ再起動後に Claude 会話を resume することは目標にしない。`agentThreadId` を Claude resume に使う対応は別計画に分ける。

## 目標アーキテクチャ

### ClaudeClientManager

Electron main process に `ClaudeClientManager` を追加する。

責務:

- `sessionId` ごとに `ClaudeStreamClient` を作成、取得、破棄する。
- Claude CLI パス、MCP config、既定モデル、許可ツール設定を全クライアントへ一貫して渡す。
- 同じ `sessionId` の turn は従来通り逐次実行にする。
- 別 `sessionId` の turn は別 Claude Code プロセスで並列実行できるようにする。
- 同時実行数の上限を管理する。初期値は2から3程度にし、超えた場合は明示的な error を返す。
- `getStatus()` はグローバルな利用可否と、集約された session 状態を返す。
- `setClaudeBin()`、`restartAiRuntimes()`、アプリ終了時に全セッションクライアントを dispose する。
- アイドル状態のクライアントを一定時間後に dispose する。
- per-client の `statusChanged` listener を attach / detach し、manager から aggregate status を emit する。

想定 API:

```ts
class ClaudeClientManager {
  getStatus(): Promise<ClaudeManagerStatus>;
  runTurn(sessionId: string, params: ClaudeRunTurnParams): Promise<ClaudeTurnResult>;
  setClaudeBin(claudeBin: string | null): void;
  disposeSession(sessionId: string): void;
  disposeAll(reason?: string): void;
}
```

`ClaudeStreamClient` は基本的に「1クライアント内では逐次」という現在の制約を維持する。並列性は manager が複数クライアントを持つことで実現する。

### Lifecycle

manager は次のタイミングで全 session を破棄する。

- Claude CLI path が変更されたとき。
- AI resource / instruction runtime target の同期後に `restartAiRuntimes()` が呼ばれるとき。
- アプリ終了時。
- 認証状態や CLI availability が変化し、既存プロセスを再利用できないと判断したとき。

active turn を持つ client を破棄する場合は、その turn を error として完了させ、対応する room の assistant turn へ error を書く。dispose だけして UI を pending のまま残さない。

`ClaudeStreamClient.dispose()` は現在それ自体では `statusChanged` を emit しないため、manager 側で aggregate status を必ず broadcast する。

### IPC payload

`ai-edit:run` の payload に Claude session key を渡す。

- AI チャットからの通常実行: `chatRoomId`
- comment mention からの実行: `comment:<commentId>:<runId>` などの一時 session
- 将来の外部実行: 呼び出し側が明示した session ID

型は `apps/desktop/src/types/desktop.d.ts` と `apps/desktop/src/lib/ai/codex-ai-edit-client.ts` に追加する。

```ts
interface CodexAiEditRequest {
  claudeSessionId?: string | null;
}
```

Electron 側では `provider === "claude"` のときだけ使い、未指定なら `runId` を fallback にする。`runClaudeEditForIpc()` には singleton client ではなく、manager から session に対応する client または `runTurn()` 関数を渡す。

### AiEditPanel

`runAiEditViaDesktopRuntime()` に `activeRoom.id` を `claudeSessionId` として渡す。

ただし、これだけでは不十分。UI 側も panel global の実行状態から room / turn 単位の実行状態へ変更する。

必要な変更:

- `isRunning` を panel 全体の実行フラグとして使わない。
- `activeRunSeqRef` / `isCurrentRun()` を、`roomId + assistantTurnId + runSeq` の run token へ置き換える。
- event / stream / result / error は、active room かどうかに関係なく、capture した `roomId + assistantTurnId` の assistant turn へ書き込む。
- background room の run が完了しても、現在表示中の room の composer state を壊さない。
- 表示中 room に running assistant turn がある場合だけ、その room の送信ボタンを止める。
- 実行中でも別 room へ切り替えられるようにする。
- room 一覧に running state を表示する。

同じ chat room 内では二重送信を防ぐ。別 chat room では別 `claudeSessionId` になるため同時実行できる。

### Claude status

現在の `DesktopClaudeStatus.running` は「turn が実行中」ではなく「Claude process が存在する」に近い。並列化後にこの意味を曖昧にしない。

初期対応:

- `running` は互換のため残し、「いずれかの Claude session が active turn を持つ」意味に寄せる。
- `activeTurnCount` を追加する。
- `runningSessionIds` を追加する。
- 必要なら `processCount` を別に追加し、idle process の存在と active turn を分ける。

AI チャット UI の送信可否は Claude status ではなく、room の assistant turn state を正とする。Claude status は接続状態と aggregate diagnostics に集中させる。

## MCP write と revision safety

実装済み: 以下の必要ルールは、Claudeセッション並列化を待たず、全プロバイダ共通のMCPサーバー側の制約として先に入っている。

Claude MCP の書き込みは引き続き pending proposal を作る。複数 session が同じ教材を同時に編集する場合、proposal 作成時点の `baseRevision` は同じになりうる。

並列化では proposal 作成時点の revision safety を強める。

必要なルール:

- Claude route から使う write-capable MCP tool では `expectedRevision` を必須にする。
- MCP server 側でも、Claude write tool schema または write request validation で `expectedRevision` 未指定を拒否する。
- `read_local_document` / `list_local_documents` で取得した revision を write tool に渡すことを Claude prompt に明記する。
- `writeMode` は通常省略して pending proposal を作る、と明記する。
- 教材本体へ直接commitするMCP経路は提供しない。
- `writeMode:"dryRun"` は保存なしの検証として許可するが、UI の実行完了と proposal 作成完了を混同しない。

visual edit session について:

- `begin_visual_edit_session` で `expectedRevision` を要求するか、session 開始時点の `baseRevision` を必ず保持する。
- `propose_visual_edit_session` は保持した `baseRevision` と現在 revision を照合し、不一致なら proposal 作成を拒否する。
- `propose_visual_edit_session` は pending proposal の作成だけを行う。

## Proposal preview と承認

実装済み: `fileId + baseRevision` grouping と stale proposal 分離表示は landed 済み。関数名は計画時点の `coalesceMcpProposalsToPreview()` から `groupMcpProposalsForPreview()` に変わっている。

proposal 作成は並列許可する。承認時は既存通り `baseRevision` と現在 revision を照合する。

UI preview は、同じ fileId の proposal を無条件に合体しない。`fileId + baseRevision` で grouping し、現在開いている教材の current revision と一致する pending proposal だけを通常の apply preview に出す。

必要なルール:

- `groupMcpProposalsForPreview()` は current file revision を受け取るか、呼び出し側で current revision に合う proposal だけを渡す。
- stale proposal は通常 preview へ混ぜず、別表示で「教材のrevisionが変わったため作り直しが必要」と示す。
- 複数 proposal の一括承認は、同一 fileId かつ同一 baseRevision の pending proposal だけを対象にする。
- 先に1つを承認して revision が進んだ場合、残りの proposal はそのまま承認せず、再生成を促す。
- UI では「Claude 実行が完了した」ことと「教材へ反映済み」を混同しない。

この方針により、Claude の実行並列化は許可しつつ、SigmaDoc JSON の正本更新は revision gate で守る。

## 実装ステップ

1. `ClaudeClientManager` を追加し、既存 singleton `claudeStreamClient` を manager 経由に置き換える。
2. `claude:get-status` / `claude:set-bin` / `claude:select-bin` / `restartAiRuntimes()` / app shutdown を manager 対応にする。
3. `ai-edit:run` payload に `claudeSessionId` を追加し、Claude 実行時に manager の session client を使う。
4. `AiEditPanel` から `activeRoom.id` を `claudeSessionId` として渡す。
5. `AiEditPanel` の実行状態を panel global から room / turn 単位へ変更する。
6. `isCurrentRun()` を active room 依存から外し、background room の event / result / error を保持できるようにする。
7. 実行中でも chat room を切り替えられるようにし、room 一覧に running state を表示する。
8. (実装済み) Claude prompt を修正し、`expectedRevision` 必須、通常は `writeMode` 省略、検証だけは `writeMode:"dryRun"` と明記する。→ 全プロバイダ共通の `mcp-edit-prompt.ts` / `MCP_EDIT_EXPECTED_REVISION_RULE` として実装済み。
9. (実装済み) MCP write validation を修正し、Claude route の write tool で `expectedRevision` 未指定を拒否する。→ プロバイダ共通で `sigma-doc-mcp-server-core.ts` のtool input schemaが強制する。
10. (実装済み) visual edit session の baseRevision 保持と提案化時の revision check を明確化する。
11. (実装済み) MCP proposal preview を `fileId + baseRevision` grouping に変更し、stale proposal 表示を追加する。→ `groupMcpProposalsForPreview()` + `AiStaleProposalNotice.tsx`。
12. idle dispose を追加する。初期値は最後の turn 終了から10分程度にする。
13. 同時実行数の上限を入れる。初期値は2から3程度にし、超えた場合は「Claude の同時実行数が上限です」と表示する。

## テスト計画

### Unit

- `ClaudeClientManager` が同じ `sessionId` では同じ client を返し、別 `sessionId` では別 client を返す。
- 同じ session の二重 `runTurn()` は従来通り拒否される。
- 別 session の `runTurn()` は同時に進行できる。
- 同時実行数の上限に達したとき、明示的な error を返す。
- `setClaudeBin()` が全 session を dispose する。
- `restartAiRuntimes()` が全 session を dispose する。
- idle timeout で未使用 client が dispose される。
- manager が per-client listener を detach し、dispose 後に status event が漏れない。
- manager の `activeTurnCount` / `runningSessionIds` / `processCount` が正しく集約される。

### IPC

- `ai-edit:run` が `claudeSessionId` を Claude route に渡す。
- `claudeSessionId` 未指定時は `runId` fallback になり、既存呼び出しが壊れない。
- Claude 以外の provider では `claudeSessionId` を無視する。
- active turn 中の manager dispose が、該当 run を error として UI に返す。

### UI

- room A の Claude 実行中に room B へ切り替えられる。
- room B から別の Claude 実行を開始できる。
- room A と room B の stream / event が混ざらない。
- room A を表示していない間に完了しても、room A の assistant turn に result / error が残る。
- background room の完了が、現在表示中 room の composer / attachment / selected resources を壊さない。
- 表示中 room に running assistant turn がある場合だけ送信が disabled になる。
- room 一覧に running state が出る。
- 同じ教材への proposal が複数できた場合、current revision と一致する proposal だけが通常 preview に出る。
- stale proposal は通常 apply preview に混ざらず、再生成が必要な状態として表示される。

### MCP / proposal

- Claude write tool は `expectedRevision` 未指定を拒否する。
- `expectedRevision` が stale の場合、proposal を作らず error を返す。
- Claude prompt がMCPからの直接commitを案内しない。
- `writeMode` 省略時は pending proposal が作られ、教材本体は更新されない。
- visual edit session は baseRevision を保持し、提案化時に revision 不一致を拒否する。
- 一括承認は同一 fileId / 同一 baseRevision の proposal だけを適用する。

## リスク

- Claude Code プロセスと MCP server が session 数だけ増えるため、CPU、メモリ、ファイル watcher、MCP 起動コストが増える。
- Claude CLI 側のアカウント状態やレート制限は共有されるため、並列数を無制限にすると失敗率が上がる。
- 複数 session の proposal が同じ教材へ集中すると、承認順による revision conflict が増える。
- background run の結果更新と現在表示中 room の UI state を混ぜると、結果消失や composer 破壊が起きる。
- `statusChanged` が session ごとに発火すると UI 更新が増えるため、manager 側で集約する。

## 非目標

- 1つの `ClaudeStreamClient` / 1つの `stream-json` プロセス内で複数 turn を多重化しない。
- MCP proposal を自動マージしない。
- revision conflict を自動解決しない。
- Claude と Codex の会話履歴を統合しない。
- idle dispose や app restart 後の Claude 会話 resume は初期実装に含めない。

## 完了条件

- 別々の AI チャットルームから Claude MCP 編集を同時に開始できる。
- 同じ room 内では二重送信が防止される。
- 実行イベント、stream、結果、error が正しい room にだけ入る。
- 実行中に別 room へ切り替えても background run の完了が保持される。
- Claude の設定変更、AI resource 更新、アプリ終了時に全 Claude 子プロセスが確実に終了する。
- `expectedRevision` なしの Claude write が拒否される。
- proposal の承認、却下、一括承認、revision conflict が従来通り安全に動く。
