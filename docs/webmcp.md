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

WebMCP用の別文書はありません。SigmaDocが唯一の正本です。読み取りは現在の文書を参照し、書き込みは共有実行層の `SigmaDocAgentSession` に操作を追加します。エージェントが複数回write toolを呼んでも独立した変更案は増えず、1つの作業ドラフトが更新されます。紙面上の既存AI差分カードでライブプレビューし、人間だけが全操作をまとめて適用または破棄できます。適用は `commitDocumentChange` を1回だけ通るため、1回のUndoで戻せます。

ドラフト開始時のWeb revisionとSigmaDocを保持します。次のwriteまたは人間の適用時に本文ブロック、問題内ブロック、overlay図形、ページ設定を比較し、前提が変わっていれば `STALE_DRAFT` と変更IDを返します。`update_rich_content` の `expectedContent`、`apply_edits` の `quote`、overlay更新の完全な `expectedShape` も対象単位で照合します。エージェントは再読取後に `withdraw_pending_proposal` で古いドラフトを破棄して作り直します。

主な実装箇所:

- `apps/desktop/src/lib/webmcp-tools.ts`: JSON Schema、共有実行層への変換、鮮度ガード、単一ドラフト
- `apps/desktop/src/components/editor/webmcp/WebMcpBridge.tsx`: ブラウザAPI登録、ライブプレビュー、適用・破棄・履歴
- `apps/desktop/src/components/editor/AiEditWebPlaceholder.tsx`: Web AIパネル、接続状態、エージェント指示
- `apps/desktop/src/components/editor/EditorShell.tsx`: Web限定gate、preview統合、1 undo単位のcommit
- `apps/desktop/src/lib/webmcp-tools.test.ts`: ツール意味論と単一ドラフトのユニットテスト
- `apps/desktop/tests/e2e/webmcp.spec.ts`: Web上の登録、typed runs、プレビュー、承認、reference UI非表示
- `apps/desktop/tests/e2e/webmcp-challenge.spec.ts`: 1エージェントと人間編集のstaleシナリオ

## Registered tools

全write toolは `expectedRevision` を必須とし、初回編集前に `get_agent_instructions` と `get_edit_context` を呼ぶようdescriptionで案内します。座標はページ左上基準の絶対px、回転と弧角度は度、用紙と余白はmmです。update系は未指定fieldを保持します。

| Tool | Mode | Purpose |
|---|---|---|
| `get_agent_instructions` | read | ユーザーの自由記述指示と組み込み編集ガイダンス |
| `get_edit_context` | read | revision、選択、対象の完全JSON、前後文脈、outline、pageLayout、overlayShapes |
| `get_document_outline` | read | 本文outline、pageLayout、完全なoverlayShapes |
| `get_block` | read | 1ブロックの完全JSON |
| `get_blocks` | read | 複数ブロックの完全JSON |
| `search_document` | read | 本文、TeX、表セル、overlayテキスト検索 |
| `read_document` | read | `summary` または完全な `full` SigmaDoc |
| `validate_document` | read | 現在の文書またはpending draftを正規スキーマで検証 |
| `get_pending_proposal` | read | 単一ドラフトの操作数、対象、操作概要、base revision |
| `withdraw_pending_proposal` | read action | 文書を書き換えずpending draftを破棄 |
| `insert_body_content` | proposal | paragraph/heading/list/boxBlock、typed runsのインライン数式、paginationを挿入 |
| `update_rich_content` | proposal | paragraph/headingをtextまたはtyped runsで部分更新 |
| `apply_edits` | proposal | range/text/block対象の`replace_text`と`format_inline` |
| `create_problem_content` | proposal | lead/prompt/answer/solution/hintsを持つ問題を作成 |
| `update_problem_content` | proposal | 問題の指定エリアだけを更新 |
| `replace_block` | proposal | 粒度更新で表せない完全構造置換のfallback |
| `delete_blocks` | proposal | 本文ブロックを削除 |
| `move_blocks` | proposal | 本文ブロックを順序維持して移動 |
| `update_page_layout` | proposal | preset/orientation/customSizeMm/marginsMmを部分更新 |
| `update_column_layout` | proposal | 文書全体・block範囲・layoutSectionの段組みを更新 |
| `insert_shape` | proposal | 標準shape、placement、度指定回転、独立arrowheadを挿入 |
| `update_shape` | proposal | 通常shapeの位置・形状・表示・style・端点を部分更新 |
| `align_shapes` | proposal | 複数shapeを整列・等間隔配置 |
| `delete_shapes` | proposal | 通常shape、表、グラフをoverlayから削除 |
| `insert_table` | proposal | plain表またはvariation表を挿入 |
| `update_table` | proposal | 表をその場で更新。`cellPatches`は他セル・列幅・行高・grid・styleを保持 |
| `insert_graph` | proposal | typed curves/points/annotations/fills/axesで2Dグラフを挿入 |
| `update_graph` | proposal | graph specの指定fieldだけをその場で更新 |

本文と数式を混在させる場合は、たとえば次のtyped runsを使います。

```json
{
  "expectedRevision": 12,
  "targetId": "p_intro",
  "blocks": [{
    "type": "paragraph",
    "id": "p_formula",
    "runs": [
      "式 ",
      { "type": "math", "id": "math_1", "tex": "x^2+y^2=1" },
      " を考える。"
    ]
  }]
}
```

表の1セルだけを直すときは `delete_shapes` + `insert_table` で作り直さず、`update_table.cellPatches` を使います。グラフと通常図形も同様に `update_graph` / `update_shape` を使います。

## Single-agent UI and instructions

Web版のAIパネルには次を表示します。

1. `document.modelContext` の利用可否、登録中・接続済み・一部失敗・失敗の状態、登録できなかったツール名
2. agent.md相当の自由記述指示。教材IDごとの設定データとしてlocalStorageに保存
3. 単一ドラフトの操作数と変更対象数

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
