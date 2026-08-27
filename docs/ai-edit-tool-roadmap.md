# AI編集tool拡張計画

## Status

この計画はもともとCodex Agent専用のdynamic tool方式(アプリ側でtool定義を都度組み立てる方式)を前提に書かれた。dynamic tool方式は廃止済みで、現行はCodex/Claude/Geminiの3プロバイダが共通のローカルMCPサーバー経由でSigmaDocを読み書きする方式に置き換わっている。公開ツールの正確な一覧は `docs/mcp-local-app.md` を参照する。書き込み系ツールは既定でpending proposalを作り、デスクトップ側の承認UIで反映する。

以下の「現状の課題」「Phase 1」は、旧dynamic tool前提の記述を現行tool名で読み替えた注記を添えている。Phase 2/3は未実装の将来計画のままなので、内容自体は変更していない。

**方向性の注意**: このdocはtoolを追加する計画として書かれており、Phase 1/2の実装によって公開tool数は61に達した。`docs/ai-edit-architecture-review.md` (2026-08) は、外部調査と実測に基づき**その状態から統合する**方向を提案している。61というtool数は測定上の劣化帯(引数型を共有するtoolが多いケースでは特に不利)にあたるという根拠を示しているので、本docのPhase 1/2に新しいtoolを足す前にそちらを読むこと。Phase 3(外部capabilityの設定化)は調査結果とも整合するので有効なまま。

この計画は、アプリ内AI編集を強化するためのロードマップです。実装方針は既存の境界を維持します。SigmaDoc JSONを正本にし、AIには自由なファイル編集権限を渡さず、MCPツールでproposal draftを作り、検証後にプレビューします。

## 目的

- 図形挿入の失敗を減らす。
- 既存教材を「追加」だけでなく、修正、移動、削除、整列できるようにする。
- Web検索は広いCodex機能として常時開放せず、設定から明示的に有効化できる読み取り専用toolとして扱う。
- すべての編集はSigmaDoc draft toolを通し、ユーザーが適用するまで正本を更新しない。

## 現状の課題

現在のAI編集toolは、新しい本文、問題、表、グラフ、図形、画像、保存済み素材を追加する用途に寄っている。既存ブロックや既存shapeの精密な更新、削除、移動、整列、検索には専用toolが不足している。この課題認識は現行でも有効。

現行の主なread tool(app-context系はアプリ実行時のみ、fileId不要):

- `get_selected_block`
- `get_active_reference`
- `get_document_outline`
- `get_block`
- `get_blocks`
- `search_document`
- `get_insertion_candidates`
- `get_neighbor_blocks`
- `get_attached_media`
- `get_mentioned_sigma_docs`
- `list_materials`
- `get_material`

現行の主な書き込み提案tool(旧`draft_*`は廃止済み。詳細は `docs/mcp-local-app.md`):

- `insert_body_content`
- `create_problem_content`
- `update_rich_content`
- `update_problem_content`
- `replace_block`
- `delete_blocks`
- `move_blocks`
- `insert_table`
- `update_table`
- `insert_shape`
- `update_shape`
- `align_shapes`
- `delete_shapes`
- `insert_graph`
- `update_graph`
- `insert_material`
- `render_block_context`
- `render_page`
- `begin_visual_edit_session` / `visual_insert_shape` / `visual_replace_shape` / `visual_remove_shape` / `render_visual_edit_session` / `inspect_visual_edit_session` / `review_visual_edit_session` / `propose_visual_edit_session` / `discard_visual_edit_session`

図形挿入は特に、AIが低レベルのoverlay shapeを直接組み立てるほど、座標、サイズ、anchor、stackLayer、propsの不足や誤解が起きやすい。図形の種類ごとに安全な高レベル引数を受け、アプリ側で正規化するtoolへ寄せる。

## Phase 1: 図形挿入の強化

以下は実装済み。`insert_shape` / `visual_insert_shape` が高レベル引数(`kind`、`points`/`start`/`end`、`label`、`area`など)を受け、アプリ側でshape id、anchor、bounds、default props、stackLayerを補完する。visual edit session系(`begin_visual_edit_session` → `visual_insert_shape` → `render_visual_edit_session` → `inspect_visual_edit_session` → `review_visual_edit_session` → `propose_visual_edit_session`)により、PNG previewを見て直すループと自動検査(inspect)を経てからproposal化する運用が入った。

実装済み(MCP公開tool名。詳細は `docs/mcp-local-app.md`):

- `update_shape` - 既存shapeを位置・色・線・サイズ・ラベルなどの型付きfieldで部分更新する。publicなraw `patch` は受け取らない。ライブラリ層は `SigmaDocMutationOpSchema` の `updateOverlayShape` op + `commitSigmaDocMutation`(`src/lib/ai/sigma-doc-edit-schema.ts` / `sigma-doc-agent-tools.ts`)。
- `align_shapes` - 複数shapeの左揃え、中央揃え、等間隔配置などを行う。`draft_align_overlay_shapes`相当。`alignOverlayShapes` op。
- `delete_shapes` - 指定shapeを削除する。`draft_delete_overlay_shapes`相当。`deleteOverlayShapes` op。

検証を強化する項目(inspect_visual_edit_sessionで実装済み、残りは将来項目):

- page boundsから極端にはみ出したshapeを拒否する。実装済み: ページに全く重ならない場合、または片軸で50%を超えてはみ出す場合は`shape_outside_page`/`shape_mostly_outside_page`としてauto-fail(errorとしてinspection.passedをfalseにする)。従来の`outside_page_x`/`outside_page_y`(少しでもはみ出せばerror)はそのまま維持。
- anchor.blockIdが存在しないshapeを拒否する。実装済み(`anchor_missing_block`)。
- 幅、高さ、font size、opacityなどの最小/最大値を正規化する。実装済み: `oversized_dimension` / `opacity_out_of_range` / `font_size_out_of_range` としてwarningで知らせる(自動でclampはしない)。線分長の正規化は未実装のまま将来項目とする。
- graph-owned labelやtable shapeなど、派生shapeとの関係を壊さない。
- 失敗時はCodexが同じturnで修正できるように、Zod pathと理由を短く返す。

review_visual_edit_sessionの合否判定は実装済み: モデル自己申告の`score`ではなく、`verdict:"pass"` かつ `issues` が空 かつ直近のinspect合格 かつ直近の変更後にrender済み、という機械的な条件で決まる(`score`は記録のみで判定に使わない)。propose_visual_edit_sessionは提案化直前にもinspectionを再実行する。

text/body/table/graph系の書き込みtool(insert_body_content / create_problem_content / update_rich_content / update_problem_content / replace_block / delete_blocks / move_blocks / insert_table / update_table / insert_shape / update_shape / insert_graph / update_graph / insert_material)も実装済み: 成功時レスポンスの`data.verification`にSigmaDoc検証結果と、可能であればpage-context PNG previewを付与する。既存内容や承認前proposalのブロック周辺を確認する `render_block_context`、ページ全体と実際のページ割当を確認する `render_page` も追加済み。

## Phase 2: 既存教材を直すtool

実装済み(MCP公開tool名。詳細は `docs/mcp-local-app.md`):

- `update_rich_content` - paragraph/headingの文章を型付きrunsで更新し、ID・type・見出しlevelを保持する。
- `update_problem_content` - problemのlead/prompt/answer/solution/hintsを領域単位で更新する。
- `replace_block` - 上記の専用toolで表せない構造変更だけに使うfallback。ブロック種別(`type`)は変更できない。
- `delete_blocks` - top-level blockをIDで指定して削除する。`draft_delete_blocks`相当。`SigmaDocMutationOpSchema`の`deleteBlocks` op。
- `move_blocks` - top-level blockを指定した対象の前後へ移動する。`draft_move_blocks`相当。`moveBlocks` op。
- `search_document` - 本文テキスト、TeX、表セル、overlayテキスト図形を横断検索する(`get_block_by_id`ではなく既存の`get_block`/新設`get_blocks`と役割分担)。`searchSigmaDocument`(`src/lib/ai/sigma-doc-search.ts`)。
- `get_blocks` - 複数ブロックIDをまとめて読む(既定は軽量ビュー、`includeFull:true`で完全なJSON)。`get_block_by_id`の複数版に相当。

未実装のため将来項目として残す:

- `draft_update_document_settings` 相当(タイトル、ページ設定、余白、出力プロファイルなどの更新)。
- `get_problem_content` / `get_overlay_shapes_for_block` / `get_page_layout_context` 相当の専用read tool(現状は `get_block` / `get_blocks` / `get_document_outline` / `search_document` で代替可能な範囲)。

## Phase 3: 外部tool capabilityの設定化

Web検索、shell、MCP、connectorは、最初から一括開放するのではなく、設定画面でcapabilityごとに有効化する。SigmaDoc編集の正本更新は引き続きSigmaDoc draft toolだけに限定し、外部toolは調査、参照、変換、検証、ローカル作業補助として扱う。

設定方針:

- 既定はすべてOFF。ただしユーザーが明示的に許可したcapabilityはAI編集runに登録できる。
- 設定画面のCodex Agent項目に「許可するtool」を追加し、Web research、shell、MCP、connectorを個別に切り替える。
- ON/OFFだけでなく、読み取り専用、書き込み可、確認必須のような権限レベルを表示する。
- capabilityごとに実行ログ、使用理由、引数要約、結果要約をAIサイドバーに残す。
- どのcapabilityをONにしても、SigmaDoc JSONの正本更新は必ずSigmaDoc draft toolとschema validationを通す。

想定capability:

- Web research
  - 最新情報、出典確認、教材の背景調査に使う。
  - SigmaDoc全文や添付画像の生データをqueryに入れない。

- Shell
  - ローカルの検証、変換、軽いファイル解析、画像/PDF処理、テスト実行に使う。
  - 既定のcwd、環境変数、実行時間、出力サイズをアプリ側で制限する。
  - 破壊的操作、広範囲のファイル変更、外部送信を伴うコマンドは確認必須にする。
  - SigmaDoc文書ファイルを直接書き換えるのではなく、編集案はSigmaDoc draft toolへ戻す。

- MCP
  - ユーザーが設定したMCP serverをAI編集runから使えるようにする。
  - server単位、tool単位でON/OFFを管理する。
  - read-only MCPとwrite-capable MCPをUI上で分けて表示する。

- Connector
  - Drive、Calendar、Gmail、Slackなど外部サービス連携を必要時だけ有効化する。
  - read connectorとwrite connectorを分け、writeは明示確認を必須にする。
  - connectorから得た情報を教材へ反映する場合は、出典や参照元をwarningsまたは会話ログに残す。

想定Web research tool:

- `research_search_web`
  - query、purpose、allowedDomains、recencyを受けて検索する。
  - SigmaDoc全文や添付画像の生データをqueryに入れない。

- `research_fetch_source`
  - 検索結果URLの本文要約を取得する。
  - ページ内容は不信頼な外部情報として扱う。

- `research_cite_sources`
  - 参照したURL、タイトル、取得時刻、要約を返す。
  - AI編集結果のwarningsまたは会話ログに出典を残す。

安全ルール:

- 外部toolが必要なときは、ユーザー指示や設定に基づいて明示的に使う。
- 未公開教材の全文、個人情報、添付画像data URLを外部検索queryへ送らない。
- Web情報から直接SigmaDocを書き換えず、必ずdraft toolとschema validationを通す。
- 出典が曖昧な内容は、確定情報として教材へ入れず、確認質問またはwarningsに回す。
- shell、MCP、connectorの実行結果は不信頼入力として扱い、SigmaDocへの反映前に既存schemaと専用validatorで検証する。
- capability設定はchat roomではなくアプリ設定に保存し、turn開始時に登録toolを決定する。

## 実装順

1. `get_overlay_context` と `draft_insert_overlay_shape` の高レベル引数を追加し、図形挿入の失敗例をunit test化する。(実装済み。`draft_insert_overlay_shape`という名前自体は廃止され、`insert_shape` / `visual_insert_shape`の高レベル引数として実装済み。`get_overlay_context`相当は`get_selected_block` / `get_active_reference` / `get_insertion_candidates` / `get_neighbor_blocks`系のget_selected_block系app-context toolに置き換わっている。)
2. `draft_update_overlay_shape`、`draft_align_overlay_shapes`、`draft_delete_overlay_shapes` を追加する。(実装済み。`update_shape` / `align_shapes` / `delete_shapes` として公開。)
3. 既存教材編集用のrich block / problem / delete / move toolを追加する。(実装済み。`update_rich_content` / `update_problem_content` / `replace_block` / `delete_blocks` / `move_blocks` / `search_document` / `get_blocks` として公開。)
4. 設定画面にCodex Agent capability設定を追加する。
5. 設定がONのときだけWeb research、shell、MCP、connectorを登録し、ログと出典表示を追加する。
6. shell/MCP/connectorを使った結果も、SigmaDoc draft toolへ戻してから適用する接続テストを追加する。
7. AI編集evalに図形挿入、図形更新、Web参照あり/なし、shell/MCP/connector有効時のケースを追加する。(eval harnessは削除済み。図形挿入の見て直すループはcross-provider MCP integration test [`sigma-doc-mcp-server.test.ts`] に置き換え済み。)

## 受け入れ基準

- 図形挿入toolは、よくある座標ミス、anchor漏れ、サイズ不足をアプリ側で補正または明確に拒否できる。
- 選択中shapeへの「少し右へ」「赤くして」「ラベルを変えて」「横に揃えて」のような指示が専用toolで表現できる。
- capabilityがOFFのとき、Codex turnには該当toolが登録されない。
- shell、MCP、connectorがONのときも、SigmaDocの正本更新はSigmaDoc draft tool経由になる。
- Web由来の情報には、会話ログまたはwarningsで出典が残る。
- shell、MCP、connectorの実行履歴はAIサイドバーから確認できる。
