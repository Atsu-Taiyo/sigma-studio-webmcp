# AI提案承認まわりの改修仕様 (Fable 実装用)

作業ブランチ/worktree: `AI提案承認` (このworktreeでそのまま実装 → PR)。
実装は最初から最後まで一気通貫で行い、途中確認は不要。完了後にビルド/型チェック/関連テストを通してからPRを出す。

対象アプリ: `apps/desktop`。SigmaDoc JSONが正本。実装スタイルは周辺コードに合わせる。
互換シムは入れない (既存docが再オープンで変わってよい / no backward-compat)。

---

## 全体像 (2 concurrency layers の現状)

- 描画側スケジューラ: `apps/desktop/src/lib/ai/ai-run-anchor-queue.ts` の `AiRunAnchorQueue`。
  key = `${documentId}::${blockId}`。同一ブロックのrunだけ直列、別ブロックは並列。
  `blockId: null` のrunは直列化されない。wire: `ai-run-controller.ts:504,515,650-657,524-539`。
- electron側 per-file mutex: `local-sigma-doc-store.ts:321` `runExclusive(fileId, fn)` (+ AsyncLocalStorage 再入バイパス :293)。
- ブロック粒度CAS: MCP write は `expectedRevision` 必須 (`sigma-doc-mcp-server-core.ts:377`)。
  ミスマッチ時 `reconcileStaleExpectedRevision` (:1341) が touched ブロックの hash 比較で判定。
- 提案の正本: **ディスク上のファイル** `<userData>/data/proposals/<id>.proposal.json`
  (`local-sigma-doc-proposal-store.ts:290` `LocalMcpEditProposalStore`)。メモリmapは無い。
  status: `pending|approved|rejected|reverted` (:23)。確定しても**削除されず** approved に書き換わるだけ (`resolveProposal` :356)。

---

## 決定事項 (ユーザー回答)

1. 衝突判定 = **提案が実際に上書き・削除・更新する対象が変わったか**。revision番号や、追加操作のアンカー／依頼時の選択範囲の変化だけでは競合にしない。
2. Ctrl+Z = **1手でAI適用を取消し、提案ストアも取り消し済み(reverted)に戻して整合させる**。
3. 確認集約 = **1依頼(run)=1確認カード**。さらに**「すべて適用」一括ボタン**も用意。
4. 同時編集 = **別箇所は並列・独立確定**(以前の並列動作を復活)。同一箇所は直列でよい。

---

## Issue 6 (最重要・他の土台): 衝突判定を「実際の上書き対象の変化」ベースに

> 現行実装ではこの設計をさらに絞り込み、`draft + touchedBlocks` から実際の上書き対象を求める。
> `insertAfter` / overlay挿入などの追加操作は、選択範囲や挿入アンカーの文章が変わっていても
> 競合にはせず、最新SigmaDocへreplayする。`requestSelection` は精密判定できない旧提案の
> フォールバックと監査情報として保持する。

### 現状
- `collectTouchedBlockIds` は追加操作のアンカーや新規IDまで含むため、その全件を衝突判定に使うと
  「既存内容を上書きしない挿入」まで本文編集を理由に拒否してしまう。
- `requestSelection` だけを基準にすると、選択内容を参照して別の場所へ追記する提案を誤って拒否する一方、
  選択外にある実際の置換対象の変更を見落とす。

### あるべき姿
- draftから**実際に既存内容を上書き・削除・更新する対象**だけを求め、その対象の現在hashと提案作成時hashを
  比較する。revision番号、依頼時の選択範囲、追加操作のアンカー本文の変化だけでは衝突にしない。
- `insertAfter` / `insertTableShape` / `insertOverlayShape` は最新SigmaDocへreplayする。アンカー削除やID重複は
  replay時の適用エラーとして正確に検出する。
- 空の問題領域へoverlayを置く場合も、本文に空段落を作らずProblemへanchorする。旧提案に残る
  anchor用空段落はreplay時に現在のProblemへ意味的に合成し、現在の本文を丸ごと置換しない。

### 実装方針
- `collectConflictSensitiveBlockIds(draft)` で置換、削除、既存overlay更新、整列、layout section更新の対象を抽出する。
- `findProposalFreshnessConflictIds` は上記IDに対応する `touchedBlocks` のhashだけを比較する。
- 既存の問題エリアへの本文追加はProblem全体のreplaceではなく、対象ブロックからの`insertAfter`列として記録する。
- 精密判定できない旧提案は `requestSelection`、さらに従来の `touchedBlocks` の順でフォールバックする。
- 単体承認、一括承認、自動rebase、却下済み提案の復元で同じ判定関数を使う。

### 検証
- 依頼→別の無関係ブロックを人手編集→承認: **衝突にならず**そのまま適用できること。
- 依頼→挿入アンカーや選択した本文を人手編集→overlay/本文挿入を承認: **衝突にならず**replayできること。
- 依頼→提案が実際に置換するブロックを人手編集→承認: **衝突として** stale notice が出ること。

---

## Issue 2: 確定後も提案がメモリ(ディスク)に残り、後から急にコンフリクト/未確定扱いになる

### 現状
- 提案は確定後も approved ファイルとして永続。UIのグルーピング `groupMcpProposalsForPreview`
  (`ai-edit-preview-types.ts:185`) は pending だけ拾う (:194) が、
  「後から急にコンフリクト」は revision ゲート + 亡霊 pending が原因と推定。
- filesystem watcher (`local-sigma-doc-proposal-store.ts:560`) が変更をbroadcastし、
  renderer が `storage:list-mcp-edit-proposals` (`storage.ts:162`) で再構築する。

### あるべき姿 / 実装方針
- Issue 6 の selection ベース判定にすることで「無関係な変更での亡霊コンフリクト」を根絶する。
- approved/rejected/reverted に遷移した提案は**プレビュー対象から確実に除外**されることを再確認
  (`groupMcpProposalsForPreview` が status:pending only であることの担保 + 承認直後の
   楽観的除去)。承認IPC成功後、renderer側で該当 proposalId を即座にプレビュー集合から除去し、
  watcher 再通知との二重管理で「一瞬 pending に戻って見える」レースを潰す。
- 確定済み提案がリロードで pending に戻らないこと (status永続) を確認するテストを追加。

### 検証
- 依頼→承認→数分後に別編集→**確定済み提案が再度コンフリクト/未確定として現れない**こと。

---

## Issue 3: 確定後 Ctrl+Z で戻せない → 1手取消 + ストア整合

### 現状
- undo/redoは独自スタック (`EditorShell.tsx:636-637` `undoStackRef`/`redoStackRef`,
  `pushDocumentHistory` :7180, `restoreDocumentHistory` :1662)。ProseMirrorのundoは無効
  (`rich-text-engine.ts:76` `undoRedo:false`)。
- AI適用は `applyMcpEditPreview` (`EditorShell.tsx:3932-4036`) → approve IPC →
  返却docで `resetEditorDocument` (:3986)。`resetEditorDocument` (:774-796) は
  **undo/redoスタックを両方 `[]` にクリア** (:776-777)。だからCtrl+Zで戻せない。
- 既存の明示revert: `revertAppliedProposal` (:4170) → `bridge.storage.revertMcpEditProposal`,
  gate `getRevertableProposal` (:527, `appliedRevision === currentRevision` のときのみ)。

### あるべき姿 / 実装方針
- AI適用を **undo 可能** にする。Ctrl+Z 1手で直前のAI適用グループを取り消し、かつ提案ストアを
  `reverted` に戻して整合させる。
- 実装:
  - 適用時に `resetEditorDocument` でスタックを消さない専用経路にする。
    適用前の document スナップショットと、適用した proposalId 群を含む **AI適用用の undo エントリ** を
    undoStack に push する (通常の `pushDocumentHistory` エントリに `appliedProposalIds` を付与する形が素直)。
    既存 `applyMergedExternalDocument` (:806-817) がスタックを保持する経路なので参考にする。
  - undo 実行 (`edit.undo` `EditorShell.tsx:1689`) 時、そのエントリが `appliedProposalIds` を持つなら
    - document をスナップショットに戻し、
    - 各 proposalId に `bridge.storage.revertMcpEditProposal` を呼んでストアを `reverted` に戻す。
    - redo 側には再適用情報を積む (redoでの再approveは任意。最低限 undo が整合すれば良いが、redoも
      対応できるとなお良い)。
  - `getRevertableProposal` の gate (`appliedRevision === currentRevision`) と衝突しないよう、
    undo は「最後に適用したものから逆順」に取り消す前提で実装する (undoスタックが自然にその順序)。
- 複数提案を1グループ(1 run)で適用した場合、Ctrl+Z 1手でそのグループ全体が戻ること。

### 検証
- 依頼→承認→Ctrl+Z: 本文が適用前に戻り、提案が `reverted` になっていること。
- Ctrl+Y / Shift+Ctrl+Z (redo) の挙動が壊れていないこと。

---

## Issue 4: 1依頼で確認ボタンを何度も押す → 1依頼=1確認 + 一括適用

### 現状
- 提案の単位 = **MCP write 1呼び出し = 1提案** (`sigma-doc-mcp-server-core.ts:1478-1506`)。
- グルーピング `groupMcpProposalsForPreview` (`ai-edit-preview-types.ts:185-313`) は
  (a) `baseRevision` バケット→ (b) `baseRevision === currentRevision` のバケットのみ runId で
  1カードにmerge、(c) `baseRevision !== currentRevision` は stale として分離。
- run 途中で revision が進む (人手編集 or 別提案の auto-apply) と、同一 run の提案が別 baseRevision
  バケットに割れ、複数カードになる。`assertSameBaseRevision` (:867) が跨ぎ承認を禁止している。

### あるべき姿 / 実装方針
- **1 run = 1 確認カード** を常に成立させる。実装は Issue 6 と連動:
  - 衝突判定を selection ベースにし revision を判定から外すので、`baseRevision` でのバケット分割自体を
    やめ、**runId で1カードにまとめる**。同一 run 内の各提案は承認時に順に現在docへ replay (rebase) する。
  - `assertSameBaseRevision` は撤廃/緩和し、「同一 run かつ selection衝突なし」なら跨ぎ revision でも
    1回で承認できるようにする。batch承認 `ipc/storage.ts:178` を、run内提案を現在revに順次 rebase して
    まとめて適用する形に拡張する (auto-apply loop `main.ts:1027-1141` が既に「1つ適用→残りをrebase」を
    やっているので、そのrebaseロジックを手動承認経路でも使う)。
- **「すべて適用」一括ボタン**: 当該ドキュメントの pending 提案(全run)を1操作でまとめて承認する。
  プレビューカードスタック (`PageCanvasEditor.tsx:3465`) の近傍か、AI編集パネルにボタンを置く。
  内部的には batch approve を全 pending proposalId に対して呼ぶ (run跨ぎもrebaseして順次適用)。
  衝突する run があればそれだけ stale notice に残し、残りは適用する (partial success)。

### 検証
- 途中で人手編集を挟む1依頼でも、確認カードが1つで、1クリックで全部適用されること。
- 複数依頼をためて「すべて適用」1クリックで全部適用され、衝突分だけ残ること。

---

## Issue 1: 複数のAI編集を同時にできない → 別箇所は並列・独立確定 (リグレッション修正)

### 現状の設計
- `AiRunAnchorQueue` は別ブロックなら並列。ただし `resolveAnchorQueueKey` (`ai-run-controller.ts:515`) が
  `blockId` を取れないケース、または最近のブロックロック/シマー実装
  (commits 7f4117b, 4f6176e, 4bbb043) が**全体をロック**してしまっている疑い。
- ブロックロック導出 `ai-editing-block-locks.ts:75` `deriveAiEditingLocks` は running セッションのみロック。

### やること
1. **まずリグレッションを再現・特定する**。実行中に2つ目のAI編集を別箇所で開始できるか、
   ローカル起動 + headless playwright で確認する
   (参照: memory `reference_graph_ui_local_verification` / `reference_overlay_repro_harness`)。
   - `resolveAnchorQueueKey` が意図せず同一keyを返して直列化していないか
     (例: blockId が null に落ちて null 同士で競合、あるいは documentId だけでkey化)。
   - ブロックロック/シマーが「実行中は新規AI編集の起動UI自体を無効化」していないか
     (`EditorShell.tsx` / AiEditPanel / launcher の disabled 条件、`ai-editing-block-locks` 参照)。
2. 特定した原因を、**別ブロック(別選択)なら2つ目以降のrunを即座に開始でき、各runが独立の確認カードを
   持って独立に確定できる**よう修正する。同一ブロックへの同時runは従来通り直列(キュー)でよい。
3. 並列runそれぞれの提案が Issue 4 のグルーピングで別カードとして正しく独立表示されること
   (runId が別なので別カードになる想定 — ここは分割が正しい)。

### 検証
- 箇所Aに依頼を投げ、走行中に箇所Bへ依頼を投げ → 2つが並行して走り、それぞれ独立に確定できること。

---

## Issue 5: 図形の一部更新 (直線の端だけ矢印に変更) ができない

### 原因 (確定済み)
- 端点マーカーは `line`/`arrow` shape の props に `arrowheadStart?` / `arrowheadEnd`
  (`apps/desktop/src/components/editor/overlay-canvas/types.ts:41-42,169-170,183-184,194-199`) として存在。
  手動ツールバー(「線の左端」「線の右端」→「矢印」「丸」)では動く (検証済: `tmp/verify-line-endpoint.mjs`)。
- **MCP `update_shape` の入力スキーマ (`sigma-doc-mcp-server-core.ts:2467-2496) に
  `arrowheadStart`/`arrowheadEnd` が無い**。これらは `insert_shape` のみに存在
  (`server-core.ts:147-148`, whitelist `SHAPE_TOOL_ARG_KEYS` :404-405,
   agent-tools schema `sigma-doc-agent-tools.ts:483-484`, apply :3586,3615,3643)。
- merge層 `patchShape` (`overlay-canvas/store.ts:73-90`) は `props` を浅くmergeするので、
  単一マーカーキーの部分更新は**受け入れられる**。スキーマに口が無いだけ。
- `type` は `update_shape` で変更不可 (`computeUpdatedOverlayShapes` `sigma-doc-edit-schema.ts:503-509`)。
  よって「lineをarrowに作り変える」のではなく、**既存 line/arrow の端点マーカーprop更新**で実現する
  (作り直しによるサイズ/スタイル喪失を避ける。commits 9777bc0/01a468c の方針と一致)。

### 実装方針
- `update_shape` の入力スキーマに `arrowheadStart?` / `arrowheadEnd?` を追加
  (`server-core.ts:2467-2496`)。許容値は `insert_shape` と同一 enum に合わせる
  (`none`/`arrow`/`dot`(丸) など — types.ts と insert 側の定義に合わせる)。
- ハンドラ (`server-core.ts:2498-2563`) で他style props と同様に patch.props へ通す。
  line/arrow 以外の kind に指定されたら弾く (点検メッセージを既存様式で返す)。
- agent-tools 側 (`sigma-doc-agent-tools.ts`) の update 用スキーマ/whitelist にも同フィールドを追加。
- 部分更新なので、端点マーカーだけ変えて他 (points/位置/色/太さ) は保持されること。

### 検証
- 既存の直線を用意 → `update_shape` で `arrowheadEnd:"arrow"` のみ指定 → 右端だけ矢印になり、
  位置・長さ・色・もう一方の端点が保持されること (preview PNG で確認)。
- log で「作り直しによるリセット」ではなく差分更新になっていること。

---

## 実装順序 (推奨)
1. Issue 6 (selection スナップショット + selection ベース衝突判定) — 土台。
2. Issue 4 (1 run=1確認 + 一括適用) — 6 の revision 撤廃に乗る。
3. Issue 2 (亡霊除去・楽観除去) — 6/4 の結果を確認しつつ。
4. Issue 3 (Ctrl+Z 取消 + ストア整合)。
5. Issue 1 (並列リグレッション再現→修正)。
6. Issue 5 (update_shape 端点マーカー) — 独立、いつでも可。

## 完了条件
- 上記各 Issue の「検証」を満たす。
- `apps/desktop` から型チェック/ビルド、関連 vitest (vitest は apps/desktop から実行) が通る。
- 上記6項目の検証を e2e/手動で確認 (ローカル起動 + playwright、port は空きを使う。
  参照 memory: reference_graph_ui_local_verification)。
- 変更内容と検証結果を簡潔にまとめて PR を作成 (main 宛)。commit/push はこのタスクで実施してよい。
