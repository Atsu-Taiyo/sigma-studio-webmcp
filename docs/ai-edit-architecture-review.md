# AI編集アーキテクチャ調査と設計提言

## Status

2026-08-07/08に実施した外部調査(業界実装、査読論文、OSSソースコード)と、現行実装の実測を突き合わせた設計提言。まだ実装計画ではなく、方向性の根拠を残すためのdocとする。

このdocは `docs/ai-edit-tool-roadmap.md` と**逆方向の結論**を出している。ロードマップはtoolを追加する計画として書かれ、実際にPhase 1/2で多数のtoolが実装された。本docは、その結果到達した61toolという状態が測定上の劣化帯にあることを示し、統合を提案する。ロードマップのPhase 3(外部capability設定化)は本docの「ユーザー拡張」節と整合するので、そちらは有効なまま。

公開tool一覧の正本は `docs/mcp-local-app.md`。文書モデルは `docs/sigma-doc-schema.md`。全体構成は `docs/architecture.md`。

## 結論

変異toolを `apply_edits` 1本に畳み、保留編集を文書ブランチとして扱い、承認とプロバイダ差分をホスト側が所有する。

独立した3つの証拠が同じ方向を指した。ProseMirrorブロック文書をAIが編集する現存最良の実装であるBlockNote AIは、LLMに渡すtoolを3つしか持たない。Cursor Agentは約12。paper.designはデザインツール丸ごとを24で開けている。そしてSWE-agentの論文は、モデルを固定したままインターフェースだけで成功率が10.3%から18.0%へ動くことをablationで示している。

## 現状の実測

`apps/desktop` のnon-testソース(`src` / `electron` / `mcp`)を `wc -l` で集計した値。

- AI編集機能の総行数 51,374行。アプリ全体201,938行の25.4%にあたる。
- MCP tool 61個。`mcp/sigma-doc-mcp-server-core.ts` が5,606行。
- 提案ストア `electron/local-sigma-doc-proposal-store.ts` 単体で3,750行。
- プロバイダ別クライアント3本。`codex-app-server-client.ts` 1,401行、`claude-stream-client.ts` 971行、`gemini-headless-client.ts` 960行。Codexのみ共通ランナーに乗っていない。
- ストリーム表現が3方言に分裂している。CodexはJSON-RPCの `item/*`、Claudeはstream-jsonの `tool_use`、Geminiはtoolイベントを持たないので `mcp/tool-activity.ts` のJSONLをポーリングしている。

対して文書モデル自体は小さい。ブロック7種(section / heading / paragraph / list / problem / layoutSection / boxBlock)とoverlay図形26種。61というtool数は文書モデルの複雑さから来ているのではなく、操作の切り方から来ている。

症状として、`src/lib/ai/mcp-tool-categories.ts` に日本語と英語の正規表現で指示文からtoolを10カテゴリに絞り込むrouterが存在する。

## 証拠

### インターフェース設計はモデル選択より効く

SWE-agent (Yang et al., NeurIPS 2024, arXiv:2405.15793) のTable 3は、GPT-4 Turboを固定したままACI(Agent-Computer Interface)だけを変えたablation。SWE-bench Lite解決率で、同一モデルのまま相対+75%が動く。

| 構成 | 解決率 |
| --- | --- |
| 専用編集toolなし(bash / sedのみ) | 10.3% |
| 検索をページ送りにする | 12.0% |
| 文書ビューを全文表示 | 12.7% |
| 文書ビューを30行に絞る | 14.3% |
| 編集toolあり、適用前検証なし | 15.0% |
| 検索toolそのものを外す | 15.7% |
| 編集tool + 適用前検証(既定) | 18.0% |

適用前検証だけで3ポイント。ページ送りの検索は検索toolがないより悪い。エージェントは予算が尽きるまで `next` を呼び続けるため。文脈窓は大きすぎても小さすぎても4から5ポイント落ちる。

エラーは減衰せず増幅する。編集試行は最終的に90.5%成功するが、一度失敗すると57.2%に落ちる。全失敗の23.4%が「編集失敗から復帰できなかった」に分類されている。

### 編集フォーマットに行番号を使ってはいけない

3組織が独立に同じ結論に達している。

- Aider: refactoringベンチで `gpt-4-1106-preview` がSEARCH/REPLACE 20%に対しunified diff 61%。diffのハンクヘッダを剥がしてsearch/replaceとして扱い、編集エラーが30から50%減ったと報告。
- OpenAI V4A(`apply_patch`): 明示的に行番号を持たない。前後3行の文脈と `@@ class Foo` のスコープ指定だけで位置を決める。
- Anthropic `str_replace_based_edit_tool`: `old_str`(空白・インデント含め厳密一致)と `new_str` のみ。

「考える」と「形式を出す」も分けたほうがよい。Aiderのarchitect/editorモードは同じモデルの自己ペアでも効く。Claude 3.5 Sonnet 77.4%から80.5%、o1-miniはDeepSeekをeditorにすると61.1%から71.4%。

同じ原理が構造化出力にも現れる。"Let Me Speak Freely?" (EMNLP 2024, arXiv:2408.02442) はGSM8KでGPT-3.5がtext 76.60%からJSON mode 49.25%と報告した。ただし.txt社の反証(プロンプトを揃えると差は消える)が説得力を持つ。教訓は「構造化が悪い」ではなく「推論の前に形式を強制するな」。散文で考えさせてからtool callを出させる。

### 61は測定された劣化帯のど真ん中にある

| 研究 | 測定 | 結果 |
| --- | --- | --- |
| RAG-MCP (arXiv:2505.03275) | 1から1,100サーバーでtool選択精度を掃引 | 1-30個は90%超。31-70個で劣化開始。100個超で大幅劣化 |
| The 99% Success Paradox (arXiv:2605.18857) | 選択の情報量が崩壊する境界 λ = K·R̄/N | N=50-500かつ関連3-5個でλ≈4。ほぼランダム |
| Enterprise Agent Routing (arXiv:2606.17519) | 51から584toolでのルーティングF1 | 51個58.2%、584個42.1% |
| ToolScope (arXiv:2510.20036, Oracle AI) | 冗長toolを自動監査してマージする介入 | +8.4から+38.6ポイント |

検索で解こうとすると悪化する。ToolChoiceConfusion (arXiv:2606.06284) は100toolを素朴なキーワード検索でtop-5に絞り、成功率0.83から0.61へ22ポイント悪化させた(誤tool呼び出しは1.25から2.36へ増加)。因果的に必要なものだけを毎ステップ露出する構成は0.99、誤呼び出し0.01、トークン90%減。

現状の正規表現routerはこの「検索で絞る」層の素朴版にあたる。置き換えるべきは検索の賢さではなく、toolの数そのものになる。

そして61は最悪の種類の多さになっている。FuncBenchGen (arXiv:2509.26553) は無関係なtoolを0/10/20/40個追加する統制実験で、引数の型を共有する「つながった」toolが最も精度を落とすことを示した。型を共有しない無関係なtoolは40個足してもほぼ無害で、GPT-5はむしろ改善した。

`update_shape` / `update_table` / `update_graph` / `update_rich_content` / `update_problem_content` / `replace_block` / `delete_blocks` / `delete_shapes` はすべて同じ `blockId` / `targetId` / `shapeId` を取る。教科書的な最悪ケースにあたる。削るならまずこの共有型の軸で畳む。

同じ実験からもう1つ。GPT-5の失敗の79.6%は「知らない変数の値を使おうとした」もので、tool選択ミスではなかった。対策はtoolの結果に既知の状態をまとめて返すことで、62.5%から81.3%になる。

### 文書のCRUDはまだ半分しか成功しない

MCPMark (arXiv:2509.24002) はNotion / GitHub / Filesystem / PostgreSQLに対する127個の書き込み込みタスクを、最終状態の検証スクリプトで採点した。最も成績の良いgpt-5-mediumでpass@1 52.56%、4回とも成功するpass^4は33.86%。1タスクあたり平均16.2ターン、17.4tool呼び出し。

読み取り専用のMCP-Atlas (arXiv:2602.00933、36サーバー、1,000タスク)は82.2%。読み取りは易しい領域、書き込みは難しい領域と、同時代・同モデル級ではっきり分かれている。

書き込み系AI編集は最先端でも一発で正しいのは約半分になる。差分付き承認はUXの磨き込みではなく、正しさを担保する仕組みそのものにあたる。

なおGitHubから採取したMCPクライアント1,723件の実測 (arXiv:2607.25635) では、tool実行前にブロッキングの承認を要求するアプリは37.2%しかない。現行の承認ゲートは少数派の正しい側にある。

### 細粒度でアンカーされた提案がレビューを機能させる

AnchoredAI (arXiv:2509.16128, n=22の被験者内実験) は、AI提案をチャット欄に出す場合と該当箇所にインラインでアンカーする場合を比較した。

| 指標 | チャット | アンカー |
| --- | --- | --- |
| 1操作あたりの貼り付け語数 | 199 | 35 |
| 文書が丸ごと置換された割合 | 22.5% | 6.8% |
| 「自分が主な書き手だ」(5点法) | 2.3 | 4.0 |
| レビュー負荷 NASA-TLX(努力) | 41.4 | 73.0 |

CoAuthor (CHI 2022, arXiv:2201.06796、1,445セッション)は人間がAI提案を72.3%受け入れることを示している。人は受け入れるので、何を受け入れさせるかの単位を設計側が決めるしかない。ただし最終行の代償は本物で、細粒度化はレビュー負荷を上げる。1提案あたりの承認コストを1クリックまで下げないと成立しない。

### AI編集はブランチである

Ink & Switch の Patchwork は、AI編集を文書に直接書かずブランチに着地させ、部分マージさせる設計を出している。主張は3つ。diffがレビュー面である。編集ごとに理由を添えるとボットは有用になる。来歴(どれがAI由来か)が一級市民である。

Cursorは逆にAgentの編集を即座にディスクへ書き、accept/rejectは保持するか巻き戻すかの層でしかない。並行編集はマージではなくgit worktreeによる隔離で解いている。文書エディタでこの手は使えない。ユーザーは同じ紙面を見ているため。

現行の提案ストアは実質Patchwork方式を独自に再実装している。問題は、汎用のブランチ基盤がないまま提案ストアだけが3,750行に育ったこと。

### 文書編集にマルチエージェントは要らない

Cognition の "Don't Build Multi-Agents" の核心は「行動は暗黙の決定を含み、矛盾した決定は悪い結果を生む」。並列サブエージェントは対話越しに前提を共有できない。

Anthropicは逆にmulti-agent research systemで単一Opus 4比+90.2%を報告しているが、同じ記事で「コーディングタスクはresearchほど並列化できる部分が少ない」と明記し、「全エージェントが同じ文脈を共有する必要があるタスク、依存関係が多いタスクには向かない」と適用範囲を切っている。文書編集はそれにあたる。

## 事例

### BlockNote AI

`TypeCellOS/BlockNote` の `packages/xl-ai`。LLMに見せるのは3tool。

```
add    { referenceId, position: "before"|"after", blocks: [...] }
update { id, block }     // block は部分でよい (PartialBlock)
delete { id }
```

さらに3つを1つのLLM toolに包み、`operations[]` 配列で複数opを1回のtool callに入れる。移動toolはない(delete + add)。位置は必ず `referenceId` と `before`/`after` で、絶対インデックスを使わない。

盗むべき実装が3つある。

1. projection + rebase。保留中サジェストを適用した射影文書に対して編集を計算し、ProseMirror stepを実文書へ写像する。ソースコメントいわく「サジェストを含むエディタに対してサジェストマークを意識しない操作を適用でき、全機能を表現できない形式からの操作も適用できる」。
2. プロンプト内のブロックidに `$` を付ける。モデルが渡していないidを使うと `id must end with $` で即座に落ちる。
3. 選択範囲外のブロックからはidを剥がす。「読んでよいが触ってはいけない」をプロンプトではなく構造で強制する。

### paper.design

HTML/CSSをそのままキャンバスにしたデザインツール。デスクトップアプリがローカルMCPサーバーを内蔵し、ファイルを開くと `http://127.0.0.1:29979/mcp` で自動起動する。接続は `claude mcp add paper --transport http http://127.0.0.1:29979/mcp --scope user` の1行。

tool数は公称24(ドキュメント列挙は21)。読み取り11、書き込み9、出力1。

- 読み取り: `get_basic_info` `get_selection` `get_node_info` `get_children` `get_tree_summary` `get_screenshot` `get_jsx` `get_computed_styles` `get_fill_image` `get_font_family_info` `get_guide`
- 書き込み: `write_html` `create_artboard` `set_text_content` `rename_nodes` `duplicate_nodes` `move_nodes` `update_styles` `delete_nodes` `finish_working_on_nodes`
- 出力: `export` (PNG / JPG / SVG / MP4)

デザインツール全体が現行の3分の1のtool数で開いている。しかも対象はartboard、ノード木、CSS、フォント、画像まで含む。

盗むべき設計が4つある。

1. `get_guide(topic)` でガイダンスをtoolとして配る。トピック別の手順を返すだけのtool(ドキュメントの例は `figma-import`)で、段階的開示をMCP toolとして実装している。現行は `src/lib/ai/mcp-edit-prompt.ts` (461行) に約19個のプロンプト断片を持ち、グラフ用・図形用・表用と出し分けて毎ターン注入している。
2. `write_html` は書き込みプリミティブ1本にモード2つ。「HTMLをパースしてノードを追加または置換する(insert-children / replaceモード)」。位置指定はノードIDのみ。
3. 視覚検証を通常の読み取りtoolとして常設する。`get_screenshot` (base64、1x/2x)、`get_jsx`、`get_computed_styles` が普通に並んでいて、「見ながら作る」専用セッションが存在しない。
4. MCPサーバーをアプリの中に置く。常に「いま開いているファイル」が対象なので、ファイル指定も別プロセスへの描画依頼も要らない。現行はMCPを別プロセスで起動しているため `electron/ai-render-bridge.ts` (469行) のHTTPブリッジを別途持っている。アプリ内ホスティングにすればこれは不要になる。

権限モデルは、読み取りを低リスクとして扱い、書き込みは明示承認、「常に許可」はファイル文脈と操作範囲を見てユーザーが選択的に与える。ブラウザ版ではMCP接続ができない制約も同じ形。

ただしPaperには編集がステージされるのか即時適用なのか、undo/履歴をどう扱うのかの記述がない。`finish_working_on_nodes`(作業中インジケータ解除)があることから即時反映型に見える。教材文書では取れない選択肢なので、保留ブランチと承認はこちら固有の価値として残る。

### Cursor

フロンティアモデルは意図だけを出し(`// ... existing code ...` の遅延diff)、安い専用モデルが全文を実体化する二段構え。全文書き換えを選んだ理由は、出力トークンが多いほど思考の余地が増えること、事前学習で全文のほうを多く見ていること、そしてモデルが行番号を数えられないこと。失敗時は再試行せず上位モデルにエスカレートする(`reapply` tool)。

### Zed Agent Client Protocol

JSON-RPC over stdio。LSPを明示的に手本にした、エディタとエージェントの間のプロトコル。方向が重要で、エージェントが子プロセス、エディタがホストになる。エージェントはファイルを直接触らず、エディタに呼び返す。

- エディタからエージェント: `initialize` `session/new` `session/prompt` `session/cancel`
- エージェントからエディタ: `fs/read_text_file` `fs/write_text_file` `session/request_permission` `session/update` `terminal/*`

そのまま欲しい性質が3つある。

1. diffがプロトコルレベルのcontent typeになっている。`{ type: "diff", path, oldText, newText }` が進捗ストリームに流れるので、ホストはエージェントのtool名を知らなくても差分UIを描ける。
2. 権限要求がエージェント側から来る。`session/request_permission` は選択肢集合(allow_once / allow_always / reject_once / reject_always)を渡してきて、クライアントは選ぶだけ。要求にToolCall全体(タイトル、種別、位置、diff)が乗るので、tool名ではなく実際の変更を見せる承認ダイアログが作れる。
3. 最小実装が仕様準拠になる。クライアント側の必須実装は `session/request_permission` だけで、あとは `initialize` での能力ネゴシエーション。

対応エージェントはClaude Agent、Codex CLI、Gemini CLI、Cursor、Cline、GitHub Copilotほか多数。ホスト側はZed、JetBrains、Visual Studio、Neovim、Emacsに加えてObsidianのクライアントが3つあり、非コード文書エディタでの実績がある。

## 提案アーキテクチャ

### tool語彙を畳む

```
apply_edits(operations: [
  { op: "insert", referenceId, position, blocks: [...] },
  { op: "update", id, patch: {...} },   // 未指定フィールドは保持
  { op: "delete", id },
  { op: "move",   id, referenceId, position },
])
```

`update` を部分パッチ意味論にすることが決定的になる。「表・図形を作り直すとサイズ・列幅・スタイルが失われる」という教訓 (PR #237) が `update_table` / `update_shape` / `update_graph` の粒度化を生んだが、その教訓が要求しているのはtoolを分けることではなく未指定フィールドを保持すること。BlockNoteが `PartialBlock` で同じ結論に達している。

ここでoverlay図形・表・グラフは `blocks` / `patch` のペイロードvariantとして吸収される。

| 提案tool | 吸収する現行tool | 数 |
| --- | --- | --- |
| `read_document(scope)` | `get_block` `get_blocks` `get_neighbor_blocks` `get_selected_block` `get_edit_context` `get_document_outline` `get_insertion_candidates` `get_active_reference` `read_local_document` | 9 |
| `apply_edits(operations[])` | `insert_body_content` `create_problem_content` `insert_shape` `insert_table` `insert_graph` `insert_material` `update_rich_content` `update_problem_content` `update_shape` `update_table` `update_graph` `update_column_layout` `update_page_layout` `replace_block` `move_blocks` `align_shapes` `delete_blocks` `delete_shapes` `visual_insert_shape` `visual_replace_shape` `visual_remove_shape` | 21 |
| `render(target)` | `render_page` `render_block_context` `render_visual_edit_session` `inspect_visual_edit_session` | 4 |
| `manage_library(action)` | 教材・フォルダCRUD | 7 |
| 廃止 | `begin` / `propose` / `review` / `discard_visual_edit_session` | 4 |
| 廃止 | `get_edit_proposal` `list_edit_proposals` `list_all_pending_proposals` `withdraw_current_edit_proposal` `withdraw_edit_proposal` | 5 |
| `apply_edits` の応答に統合 | `validate_local_document` | 1 |

残るのは `read_document` / `search_document` / `apply_edits` / `render` / `search_library` / `get_material` / `manage_library` の7から8。`mcp-tool-categories.ts` の正規表現routerは不要になる。

OpenAIのガイドが書いている通り、問題はtoolの数ではなく重複になる。「15個以上の明確に区別されたtoolをうまく扱う実装もあれば、10個未満の重複したtoolで破綻する実装もある」。

### ただし畳みすぎてはいけない

逆向きの証拠が2件ある。

専用の編集toolは残す。SWE-agentのablationで最大の落ち込みは、汎用シェルだけにして専用編集toolを外したとき(18.0%から10.3%、-7.7ポイント)だった。`apply_edits` は何でもできる汎用toolではなく、文書編集専用の第一級プリミティブとして設計する。

編集の粒度は2つ持ち、モデルに選ばせる。SWE-Edit (arXiv:2604.26102, Microsoft / UW-Madison) は、局所パッチ形式と構造的な全面書き換え形式をタスクに応じて選択させると、固定形式に対して解決率69.4%から69.9%、同時にコスト-11.8%、編集成功率93.4%から96.9%になると報告している。前者は空白の不一致に弱く、後者は再構成に強いので一本化すべきではない。

つまり `apply_edits` の `update` は、部分パッチとブロック全体の置換の両方を受け付け、どちらを使うかはモデルが決める形にする。

### 畳んだ後にやること

MCP toolの説明文の質は、この分野で最も測定されている変数になる。実在856toolの調査 (arXiv:2602.14878) では97.1%に説明の不備があり、56%は目的すら書けていない。説明を改善すると成功率+5.85ポイントだが、実行ステップが+67%増え、6件に1件は悪化する。構造を畳むほう(+8.4から+38.6ポイント)がはるかに費用対効果が高いので、まず畳み、それから書き直す。

書き直しは1回でよい。9スキルの実運用エージェントでの検証 (arXiv:2606.30775, Microsoft) では、実際の誤り事例を与えたLLMによる1回の書き直しが手作業でのチューニングと同等のF1(79.2%対79.4%)に達し、所要時間は120分から3.8分になった。反復してもほとんど改善しない。特定のtoolだけF1が低いときは、書き直しではなく分割が必要というサインにあたる。

### visual edit sessionはブランチがあれば消える

現状9toolが「見ながら作る」ループのために、5toolが提案ライフサイクルのために存在する。`apply_edits` が常に保留ブランチに着地し、`render` がその保留ブランチを描画できるなら、この14個は全部消える。visual edit sessionとは「まだ承認されていない編集をレンダリングして見る」ことであり、それは提案ブランチそのものだから。

これが設計上いちばん大きな単純化になる。現状は保留状態の表現が提案ストアとvisual edit sessionの2系統に分裂していて、両方に描画・検査・破棄の口が生えている。

### projection + rebase

現状は保留提案がある状態での次の編集を、`rebaseProposal` / `autoRebaseProposalsForFile` / `collectConflictSensitiveBlockIds` / `classifyProposalReplayFailure` という事後の再生と競合分類で解いている。射影方式なら「AIには常に保留適用後の文書を見せ、返ってきた操作を実文書に写像する」で、競合そのものが減る。

### プロバイダ境界をACPに合わせる

現状およそ4,900行がプロバイダ差分の吸収に費やされている。内部のセッション境界をACP準拠にすれば、ストリーム方言3種が1種になる。SDKに依存するかは別判断として、境界の形をACPに合わせること自体はノーリスクにあたる。

`{ type: "diff", oldText, newText }` を進捗ストリームの一級市民にする設計は、既存の差分カード・承認UXにそのまま接続する。

## BYO-AIの現実

| ベンダー | 認証 | 扱いやすさ |
| --- | --- | --- |
| Codex | `~/.codex/auth.json` を透過的に再利用。ChatGPTサブスクがそのまま効く | `--output-schema` で構造化出力、JSONLに `cached_input_tokens` も乗る。最も素直 |
| Gemini | Google OAuth。60 req/分、1000 req/日が無料 | 終了コードが型付き(42=入力エラー、53=ターン上限) |
| Claude | `--bare` はサブスク認証も失う。非bareは効くが環境を吸い込む | イベントは最も豊富だが下記2つの障害あり |

実装より先に確認すべき点が2つある。

規約。Claude Agent SDKのドキュメントに「事前承認がない限り、Anthropicはサードパーティ開発者が自社製品でclaude.aiログインやレート制限を提供することを許可しない」とある。「ユーザーが自分のClaudeサブスクを持ち込む」という前提はClaudeに関しては承認事項にあたる。ブランド面も「Claude Code」の名称使用は不可。

再現性と認証は両立しない。`--bare`(`-p` の既定になる予定)はhooks / skills / plugins / MCP / CLAUDE.mdの自動探索を全部切って決定性をくれるが、同時にOAuth資格情報もキーチェーンも読まなくなる。非bareならサブスクは効くが、ユーザーの `~/.claude` やプロジェクトの `.mcp.json` を吸い込むので同じ入力でもマシンごとに挙動が変わる。

推奨順はCodex、Gemini、Claude。そしてAPIキー経路(自前ループ)を第2アダプタとして持つ。自前ループが必要になるのは、引数レベルのtoolゲーティングがCLIでは得られないため。`--allowedTools` はtool名でしか絞れないが、「この編集が触るブロックはロック中か」で止めるには自前のループが要る。

Vercel AI SDKの `needsApproval`(boolまたは非同期関数)、`activeTools`(呼び出しごとのtool部分集合)、そして `execution-denied` を型付きメッセージパートとして履歴に残す設計はそのまま使える。最後のものが特に効く。ユーザーの拒否を例外ではなく普通のターンとしてモデルに見せるべきだから。

## ユーザー拡張

拡張はコードではなくファイルであるべきで、発見は段階的開示であるべきになる。

### スキル

Anthropic の Agent Skills は agentskills.io としてオープン標準になっている。`SKILL.md`(frontmatterの `name` と `description`)と任意の付随ファイルで、3段階で開く。メタデータだけをシステムプロンプトに常駐させ、関連しそうなときにSKILL.md本体を読み、参照ファイルは必要になってから読む。

既に `electron/ai-resource-store.ts` がSKILL.md + frontmatter + プロバイダ別投影を持っているので、やるべきは独自形式をやめて標準に合わせることになる。標準に合わせれば、ユーザーが他所から持ってきたスキルがそのまま動く。関連方針は `docs/ai-skill-scope-policy.md`。

### MCP

ACPやベンダーCLI経由なら、ユーザーが既に持っているMCPサーバーがそのまま使える。マーケットプレイスを自分で作る必要はない。ただし安全側の要件は具体的になる。

MCPTox (arXiv:2508.14925、実在45サーバー、353tool、1,312攻撃ケース) はo1-miniで攻撃成功率72.8%、最も拒否率の高いClaude-3.7-Sonnetでも拒否率3%未満と報告している。より高性能なモデルほど脆弱で、指示追従能力が高いほど攻撃指示にも従う。

攻撃の本質は、モデルはtool記述の全文を見るがユーザーはUIの短いラベルしか見ないという非対称にある。さらにshadowingでは悪意あるサーバーの記述が信頼されたサーバーの使われ方を書き換えられるので、攻撃者は自分のtoolを呼ばせる必要すらない。被害範囲はサーバー単位ではなくインストール済みサーバー全体の組み合わせに及ぶ。

公開サーバーの実測値も出ている。

- OSSサーバー1,899個の調査 (arXiv:2506.13538) で7.2%に一般的な脆弱性、5.5%にツールポイズニング。
- 39,884リポジトリを走査したVIPER-MCP (arXiv:2605.21392) は106件のゼロデイを実証し、67件にCVEが採番されている。
- リモートサーバー7,973個の調査 (arXiv:2605.22333) では40.55%が認証なしでtoolを露出し、OAuth対応の119個は全件が何らかの認証欠陥を持っていた。

最も重い事実として、攻撃の主戦場はtoolの記述ではなくtoolの返り値にある。MCPXKIT (IEEE TDSC) は「MCP tool返り値経由の攻撃」を成功率90%と報告し、IEEE S&P 2026のParasites in the Toolchainは悪意あるサーバーを一切必要とせず、汚染された文書と正規のtool 2つだけで成立する攻撃を示している。文書エディタではこの返り値経路こそが製品そのものにあたる。

最低限の要件は次の通り。

- tool記述を導入前に全文表示し、ユーザー向け表示とAIが見るテキストを明示的に分離する。
- サーバーとtoolをhashで固定し、変化したら再確認する(rug pull対策)。
- サーバー間の影響を遮断する。
- lethal trifecta を断つ。「私的データへのアクセス」「非信頼コンテンツへの曝露」「外部送信能力」が揃うと情報漏洩は原理的に不可避になる。教材文書を読んだセッションに、ユーザー追加の任意ネットワークtoolを同居させてはいけない。
- すべての書き込みは人間がレビューするdiffで終端する。既存の提案・承認モデルがそのまま防御になっている。

MCP仕様側は既に規範的な要求を課している。ワンクリックでローカルMCPサーバーを設定できるクライアントは、実行前にコマンド全文を省略せずに表示し、危険なコード実行であると明示し、明示的な承認を取らなければならない(MUST)。推奨(SHOULD)としてサンドボックス化、権限の最小化、`sudo` / `rm -rf` 等の危険パターンの強調も挙がっている。

ただし仕様が手当てしているのは認証・トランスポート層だけになる。ツールポイズニング、記述の信頼性、rug pull、サーバー間shadowing、返り値経由の間接注入は仕様の外側にあり、実測された攻撃成功率はすべてそこに集中している。`readOnlyHint` のようなtool注釈もサーバーの自己申告するヒントであって、攻撃者が制御できる。

証明可能な保証を持つ防御は現状ひとつだけで、CaMeL (Google DeepMind + ETH, arXiv:2503.18813)。信頼できるユーザー指示から制御フローとデータフローを抽出し、非信頼データが実行を左右できない構造にする。AgentDojoでタスク成功率77%(無防御は84%)、つまり約7ポイントの実用性と引き換えに証明可能な安全性を得る。検知型の防御は自前ベンチマークで74から96%を出すが、独立したベンチマーク(MCPSecBench)では平均30%未満しか止められない。

## 残すべき既存資産

削減の話が続くが、現行実装には正しく作られている部分がある。

- CAS書き込み(`saveDocument(expectedRevision)`)と `runExclusive(fileId)`。lost updateを防ぐ唯一の仕組み。
- `readDocumentBlockHashes`(revision毎のブロックハッシュ履歴)。承認時の鮮度検証の土台であり、過去の巻き戻り事故の解明にも使われた。
- 提案をブランチとして扱う発想そのもの。Patchworkが独立に同じ結論に達している。
- 細粒度の差分UIと選択的revert。AnchoredAIの数字がその価値を裏付けている。
- 適用前検証。SWE-agentのablationで3ポイント、失敗連鎖の防止でさらに大きい。

## 移行順序

各段階が単体で価値を出す順に並べる。

1. `apply_edits` の導入と変異21toolの吸収。既存toolは内部関数として残し、MCP露出だけを畳む。部分パッチと全体置換の2粒度を最初から持たせる。応答には影響ブロックの現在状態と次の `expectedRevision` を同梱する。ここで正規表現routerが不要になる。
2. 読み取り9toolを `read_document(scope)` に統合する。窓サイズ固定と要約打ち切りを入れ、ページ送りにはしない。
3. 保留ブランチの `render` を実装し、visual edit session 4toolと提案ライフサイクル5toolを廃止する。ここが最大の削減にあたる。
4. projection + rebase に置き換え、提案ストアの競合分類ロジックを縮退させる。
5. ACPアダプタを1本書き、Codexから順に載せ替えてストリーム方言3種を1種にする。
6. 8本の説明文を、実際の誤り事例を与えて1回だけ書き直す。以降は反復しない。特定toolだけ成績が悪いときは分割のサインとして扱う。
7. ユーザーMCP追加を、上記の安全要件込みで開放する。

## 未解決の判断

- Anthropicの規約。「第三者がclaude.aiログインを提供することは事前承認なしに不可」という記述はClaudeアダプタの前提を直撃する。実装より先に確認が要る。
- 環境ドリフトか再現性か。非bareでサブスク認証を取るならユーザーのグローバル設定を吸い込むことを受け入れる。bareで再現性を取るならAPIキーが必要になる。両立するモードは存在しない。
- ACPの成熟度。仕様はv1が安定、公式SDKはTS / Rust / Python / Java / Kotlin、実装も多数あるが、2025年に出たばかりのプロトコルにあたる。内部境界の形として採用するのはノーリスクだが、SDKに依存するかは別判断になる。

## 出典

一次情報のみ。

- SWE-agent: Yang, Jimenez, Wettig, Lieret, Yao, Narasimhan, Press. NeurIPS 2024. arXiv:2405.15793
- AnchoredAI: arXiv:2509.16128
- CoAuthor: Lee, Liang, Yang. CHI 2022. arXiv:2201.06796
- Let Me Speak Freely?: EMNLP 2024 Industry. arXiv:2408.02442。反証は https://blog.dottxt.ai/say-what-you-mean.html
- RAG-MCP: arXiv:2505.03275
- The 99% Success Paradox: arXiv:2605.18857
- Enterprise Agent Routing: arXiv:2606.17519
- ToolScope: arXiv:2510.20036
- ToolChoiceConfusion: arXiv:2606.06284
- FuncBenchGen: arXiv:2509.26553
- MCPMark: arXiv:2509.24002
- MCP-Atlas: arXiv:2602.00933
- MCPクライアント実測: arXiv:2607.25635
- SWE-Edit: arXiv:2604.26102
- MCP Tool Descriptions Are Smelly!: arXiv:2602.14878
- A Single Rewrite Suffices: arXiv:2606.30775
- MCPTox: arXiv:2508.14925
- MCP at First Glance: arXiv:2506.13538
- VIPER-MCP: arXiv:2605.21392
- リモートMCPサーバー認証実態: arXiv:2605.22333
- Parasites in the Toolchain: arXiv:2509.06572 (IEEE S&P 2026)
- CaMeL: arXiv:2503.18813
- BlockNote AI: https://github.com/TypeCellOS/BlockNote (packages/xl-ai)
- Paper MCP: https://paper.design/docs/mcp
- Agent Client Protocol: https://agentclientprotocol.com
- Cursor Instant Apply: https://cursor.com/blog/instant-apply
- Aider: https://aider.chat/docs/unified-diffs.html / https://aider.chat/2024/09/26/architect.html
- Anthropic Engineering: Building Effective Agents / Writing tools for agents / Effective context engineering / Agent Skills
- OpenAI: A practical guide to building agents / GPT-4.1 prompting guide
- Ink & Switch Patchwork: https://www.inkandswitch.com/patchwork/notebook/
- Cognition: https://cognition.com/blog/dont-build-multi-agents
- Simon Willison, The lethal trifecta: https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/
- MCP Security Best Practices: https://modelcontextprotocol.io/specification/draft/basic/security_best_practices
