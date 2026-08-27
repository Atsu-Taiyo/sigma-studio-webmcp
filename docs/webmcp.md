# WebMCP integration

Sigma Studio のWeb版は、対応ブラウザで開かれたときだけ `document.modelContext` に編集ツールを登録します。通常のブラウザとElectronでは、APIが無ければ何も登録せず、既存UIだけで動作します。

## Architecture

```text
browser agent
  -> document.modelContext.registerTool(...)
  -> WebMcpBridge (browser lifecycle adapter)
  -> webmcp-tools (input validation and SigmaDoc operations)
  -> EditorShell.commitDocumentChange
  -> SigmaDoc history, edit guards, rendering, and persistence
```

WebMCP用の別文書を持たず、編集中のSigmaDocだけを正本にします。書き込みは `EditorShell.commitDocumentChange` を通すため、WebMCP経由の変更も通常編集と同じUndo履歴と編集ガードの対象です。

実装箇所:

- `apps/desktop/src/components/editor/webmcp/WebMcpBridge.tsx`: ブラウザAPIへの登録とアンマウント時の解除
- `apps/desktop/src/lib/webmcp-tools.ts`: ツール定義、入力検査、SigmaDoc操作
- `apps/desktop/src/lib/webmcp-tools.test.ts`: ツール契約と純粋操作のテスト
- `apps/desktop/tests/e2e/webmcp.spec.ts`: 登録されたツールが実際の編集画面を更新するブラウザテスト

## Registered tools

| Tool | Mode | Purpose |
|---|---|---|
| `inspect_document` | read-only | タイトル、現在選択、アウトライン、ブロック数を取得 |
| `read_block` | read-only | IDで1ブロックの正確なSigmaDoc構造を取得 |
| `validate_document` | read-only | 現在の文書を正規Zodスキーマで検証 |
| `insert_content` | write | 段落、見出し、数式を選択位置・指定位置・文書末尾へ追加 |
| `replace_block_content` | write | 読取時の内容が変わっていない場合だけ段落または見出しを更新 |

`replace_block_content` は `expected_content` を必須にしています。AIがブロックを読んだ後に人間が編集した場合、古い内容で上書きせず再読取を要求します。

## Local testing

1. Chrome 149以降で `chrome://flags/#enable-webmcp-testing` を開く。
2. WebMCP testingをEnabledにしてChromeを再起動する。
3. リポジトリルートで `npm install`、`npm run dev` を実行する。
4. 表示されたローカルURLをChromeで開く。
5. Chrome DevToolsまたはWebMCP用Inspectorから登録ツールを確認する。

自動テスト:

```sh
npm --workspace @sigma-studio/desktop exec vitest run src/lib/webmcp-tools.test.ts
npm --workspace @sigma-studio/desktop exec playwright test tests/e2e/webmcp.spec.ts
npm run typecheck
```

## Challenge provenance

この公開リポジトリは、応募期間中の2026-08-28に作成した新規履歴です。WebMCPの登録、ツール操作、テストを含む応募用Webアプリの完全なソースを収録しています。

## Public submission repository

WebMCP Challengeへの提出時は、審査員がアクセスできる公開リポジトリが必要です。リポジトリには少なくとも次を含めます。

- 動作に必要なソースコードとアセット
- `npm install` から起動・テスト・デプロイまでの手順
- リポジトリ直下のオープンソースライセンスファイル（最終応募前に追加）
- WebMCP実装が確認できる `document.modelContext.registerTool(...)`
- 既存部分と応募期間中に追加した部分の説明

現在は所有者の方針によりプロジェクト全体のライセンスを未指定にしています。そのため、公開確認用としては利用できますが、Challengeの最終応募条件を満たすにはオープンソースライセンスの追加が必要です。
