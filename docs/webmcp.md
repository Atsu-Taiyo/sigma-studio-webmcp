# WebMCP integration

Sigma Studio のWeb版は、対応ブラウザで開かれたときだけ `document.modelContext.registerTool(...)` で、現在開いているSigmaDocを編集するツールを登録します。Electronデスクトップ版は従来の `sigma-local` MCPを使い、SDK埋め込みではWebMCP UIとツールを公開しません。

## Architecture

```text
browser agent
  -> document.modelContext.registerTool(...)
  -> WebMcpBridge (registration and one pending draft)
  -> webmcp-tools
  -> sigma-doc-agent-tools (shared renderer-safe execution layer)
  -> AiEditSessionDraft live preview
  -> human apply or discard
  -> EditorShell.commitDocumentChange (one Undo unit)
  -> SigmaDoc
```

WebMCP用の別文書はありません。SigmaDocが唯一の正本です。読み取りは現在の文書を参照し、書き込みは共有実行層の `SigmaDocAgentSession` に操作を追加します。エージェントが複数回write toolを呼んでも独立した変更案は増えず、1つの作業ドラフトが更新されます。紙面上の既存AI差分カードでライブプレビューし、デスクトップ版と共通のキャンバス左上「AIタスク」をホバー展開して適用または破棄します。適用は `commitDocumentChange` を1回だけ通るため、1回のUndoで戻せます。

ドラフト開始時のWeb revisionとSigmaDocを保持します。次のwriteまたは人間の適用時に本文ブロック、問題内ブロック、overlay図形、ページ設定を比較し、前提が変わっていれば `STALE_DRAFT` と変更IDを返します。`edit_text` の引用・範囲と、`update_overlay` の完全な `expectedShape` も対象単位で照合します。エージェントは再読取後に `withdraw_pending_proposal` で古いドラフトを破棄して作り直します。

主な実装箇所:

- `apps/desktop/src/lib/webmcp-tools.ts`: JSON Schema、共有実行層への変換、鮮度ガード、単一ドラフト
- `apps/desktop/src/components/editor/webmcp/WebMcpBridge.tsx`: ブラウザAPI登録、ライブプレビュー、既存AI操作面への適用・破棄接続
- `apps/desktop/src/components/editor/AiEditWebPlaceholder.tsx`: Web AIパネルの接続状態とエージェント指示
- `apps/desktop/src/components/editor/EditorShell.tsx`: Web限定gate、既存`AiTaskDock`へのpreview統合、1 undo単位のcommit
- `apps/desktop/src/lib/webmcp-tools.test.ts`: ツール意味論と単一ドラフトのユニットテスト
- `apps/desktop/tests/e2e/webmcp.spec.ts`: Web上の登録、Markdown数式変換、プレビュー、承認、reference UI非表示
- `apps/desktop/tests/e2e/webmcp-challenge.spec.ts`: 1エージェントと人間編集のstaleシナリオ

## Registered tools

ブラウザへ公開するのは、従来の粒度別ツールを目的別に集約した16ツールに、3Dグラフの専用2ツールを加えた18ツールです。全write toolは `expectedRevision` を必須とし、初回編集前に `get_agent_instructions` と `inspect_document` を呼ぶようdescriptionで案内します。座標はページ左上基準の絶対px、回転と弧角度は度、用紙と余白はmmです。update系は未指定fieldを保持します。

| Tool | Mode | Purpose |
|---|---|---|
| `get_agent_instructions` | read | ユーザーの自由記述指示と組み込み編集ガイダンス |
| `inspect_document` | read | 通常はrevision、選択、対象、前後文脈、outline、pageLayout、overlayを返し、必要時だけ完全SigmaDocを返す |
| `read_blocks` | read | ID指定した1個以上の本文・問題内ブロックの完全JSON |
| `search_document` | read | 本文、TeX、表セル、overlayテキスト検索 |
| `validate_document` | read | 現在の文書またはpending draftを正規スキーマで検証 |
| `get_pending_proposal` | read | 単一ドラフトの操作数、対象、操作概要、base revision |
| `withdraw_pending_proposal` | read action | 文書を書き換えずpending draftを破棄 |
| `insert_markdown` | proposal | MarkdownからWord風の本文、数式、コード、リスト、任意のネイティブ囲み枠を挿入 |
| `edit_text` | proposal | 既存本文をrange/text/block対象で置換・インライン書式変更 |
| `edit_problem` | proposal | lead/prompt/answer/solution/hintsを持つ問題を作成・部分更新 |
| `organize_blocks` | proposal | 本文ブロックを移動・削除 |
| `update_layout` | proposal | 用紙・余白・文書全体または局所段組みを目的指定で更新 |
| `create_overlay` | proposal | `objectType`で通常図形・テキスト・表・2D/3Dグラフを作成 |
| `update_overlay` | proposal | 完全な`expectedShape`を鮮度ガードにしてoverlayをその場で部分更新 |
| `arrange_overlay` | proposal | 複数overlayを整列・等間隔配置 |
| `delete_overlay` | proposal | 通常図形・テキスト・表・グラフを削除 |
| `insert_graph3d` | proposal | preset起点またはGraph3DSpecで3Dグラフを挿入（zUp・rotationはラジアン） |
| `update_graph3d` | proposal | 3D specの指定fieldだけをその場で更新。ID・位置・サイズ・未指定fieldは保持 |

内部実装には従来の粒度別ツールを残し、公開ツールがそこへ安全に振り分けます。これにより、表のセル更新、グラフ更新、図形更新などの正確なSigmaDoc操作と鮮度ガードは維持しつつ、エージェントが毎回選ぶツール候補とスキーマ量を減らします。低レベルの完全ブロック置換は公開しません。

本文を新しく挿入する場合は `insert_markdown` の `markdown` へまとめて渡します。`$...$` と `$$...$$` はSigmaDocの `mathInline` へ変換され、文字として `$` を出す場合は `\$` と書きます。変換後も書き込みは直接確定せず、通常どおり紙面上のproposal previewを人が確認します。

```json
{
  "expectedRevision": 12,
  "targetId": "p_intro",
  "markdown": "## 円の方程式\n\n式 $x^2+y^2=1$ を考える。金額は \\$5。\n\n- 中心は $O$\n- 半径は $1$"
}
```

対応範囲は、空行区切りの段落、ATX見出し、箇条書き・番号付きリストとその入れ子、`**太字**`、`*斜体*`、fenced code、`$...$` / `$$...$$` です。Markdownの表、リンク、画像、blockquote、inline codeはまだ構造変換しません。paginationは同じ呼び出しの`pagination`、囲み枠は`container`で指定します。段組みは`update_layout`を使います。

表の1セルだけを直すときは削除して作り直さず、`update_overlay.cellPatches`を使います。2Dグラフと通常図形も同じ`update_overlay`が`expectedShape.type`から処理を選び、未指定fieldを保持します。3Dグラフは外部契約を維持した専用の`update_graph3d`でも、`update_overlay`の3D分岐でも更新できます。

## Single-agent UI and instructions

Web版のAIパネルには次を表示します。

1. `document.modelContext` の利用可否、登録中・接続済み・一部失敗・失敗の状態、登録できなかったツール名
2. agent.md相当の自由記述指示。教材IDごとの設定データとしてlocalStorageに保存

単一ドラフトの操作数、変更対象、適用・破棄はAIパネルや右上の独自カードへ重複表示しません。デスクトップ版と同じキャンバス左上の`AiTaskDock`だけで扱います。紙面上のAI差分カードは実際の挿入結果を確認するため引き続き表示します。

ユーザー入力の指示は ambient context へ混ぜず、`untrustedContentHint` を付けた `get_agent_instructions` からだけ取得できます。ブラウザが `modelContext.provideContext` を提供する場合も、渡すのは固定のアプリケーションガイダンスだけです。Web版では選択箇所を「AIに追加」するワンドとreference蓄積経路を作りません。選択の受け渡しはエージェント側UIの責務です。一方、AI差分カードはWebでも有効なままなので、write toolの結果を紙面で確認できます。

## Intentionally unavailable desktop tools

次のデスクトップMCP機能はWebMCPに公開しません。

- library/folder CRUD、`search_library`: Webページで開いている1文書の権限境界を越えるため
- materials: デスクトップのworkspaceライブラリとファイル保存に依存するため
- AI resource CRUD、`update_ai_settings`: Webではユーザー指示をlocalStorage設定として扱い、desktop userDataへ書かないため
- visual PNG session、`render_page`: Webでは同じ紙面のライブghost previewで確認できるため
- `get_active_reference` などrun-context系: reference選択はエージェント側UIの責務とするため

## Challenge demo and PDF parity

`apps/desktop/public/demo/webmcp-challenge.sigmadoc.json` は、本文・本文中数式・通常図形・2Dグラフ・表を1ページに含むデモ教材です。fixture自体はWebMCPツール刷新では変更しません。

`pdf-parity.spec.ts` はこのfixtureを通常の編集面とdesktop PDF用の `PagedRenderSurface` の両方で描画し、本文・数式・3種類のoverlayについてページ番号とページ内のx/y/w/hを0.5 CSS px以内で比較します。WebMCP Challenge E2Eは、単一エージェントがドラフトを作った後に人間が本文を編集し、適用と次のwriteの両方でstale guardが働く流れを確認します。

## Local testing

1. Chrome 149以降で `chrome://flags/#enable-webmcp-testing` を開く。
2. WebMCP testingをEnabledにしてChromeを再起動する。
3. リポジトリルートで `npm install`、`npm run dev` を実行する。
4. 表示されたローカルURLをChromeで開く。
5. AIパネルの接続状態と登録ツール数を確認する。

自動テスト:

```sh
npm run typecheck
npm --workspace @sigma-studio/desktop exec vitest run src/lib/webmcp-tools.test.ts
cd apps/desktop
npm exec playwright test tests/e2e/webmcp.spec.ts tests/e2e/webmcp-challenge.spec.ts
npm exec playwright test tests/e2e/pdf-parity.spec.ts --grep "WebMCP Challenge fixture"
```

## Challenge provenance

このWebMCP作業は、2026-08-28に `origin/main` の `937311481f6bfbde39b755d0cfca81493632c9a1`（`v0.393.0`）へ応募用ブランチをfast-forwardした後に追加しています。既存のSigma Studioと応募期間中に追加したWebMCP部分を区別するときは、このcommitを比較元にします。

```sh
git diff 937311481f6bfbde39b755d0cfca81493632c9a1...HEAD -- \
  apps/desktop/src/components/editor/EditorShell.tsx \
  apps/desktop/src/components/editor/webmcp \
  apps/desktop/src/lib/webmcp-tools.ts \
  apps/desktop/src/lib/webmcp-tools.test.ts \
  apps/desktop/tests/e2e/webmcp.spec.ts \
  docs/webmcp.md README.md
```

## Public submission repository

WebMCP Challengeへの提出時は、審査員がアクセスできる公開リポジトリが必要です。リポジトリには動作に必要なソースとアセット、導入・テスト・デプロイ手順、`document.modelContext.registerTool(...)` の実装、既存部分と応募期間中の実装の区別を含めます。

応募用の公開リポジトリは、ルートの `LICENSE` に記載したMIT Licenseで公開します。公開前には秘密情報と第三者アセットを確認し、動作に必要なソースと手順が揃っていることを再確認します。
