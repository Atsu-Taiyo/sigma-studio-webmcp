# AI Skill Scope Policy

## 目的

Sigma Studio の AI チャットで使う skill / instruction を、どの範囲の設定として扱い、Claude Code / Codex / Antigravity の3プロバイダへどう届けるかを整理する。

以前はこの配送が「runtime投影」「プロンプト注入(auto/explicit)」「MCP読み取りツール」の3経路に分散していた。その後 skill を常にアプリ全体スコープへ一本化した時期を経て、現在はワークスペースごとの実行ディレクトリを新設し、skill・instructionともグローバル/ワークスペースの2層スコープを持てるようにしている。

## 基本方針

### 1. skill・instructionともグローバル/ワークスペースの2層

skillは「アプリ全体で使うグローバルskill」と「特定ワークスペースだけで使うワークスペースskill」の両方を持てる。instructionも同様にグローバル指示とワークスペース指示の2層。

- グローバル指示: 常に1本。全ワークスペースに適用。
- ワークスペース指示: `workspace-instructions:<workspaceId>` で、初回保存まで存在しない。プロンプト注入のみで届く(後述)。
- グローバルskill: 全ワークスペースの実行ディレクトリに投影される。
- ワークスペースskill: そのワークスペース専用の実行ディレクトリにのみ投影される。

skill名は**全スコープ横断で一意**にする(投影先がプロバイダごとにフラットな名前空間 `.agents/skills/<name>/SKILL.md` 等のため、同名のグローバルskillとワークスペースskillが同じ投影パスを取り合うことはできない)。manifestのidはスコープに関係なく常に `skill-<name>` の形。

### 2. 正本は `ai-agent-config`

Studio skill / instruction の正本は `userData/data/ai-agent-config` 配下に置く。

```text
data/
  ai-agent-config/
    manifest.json
    skills/
      <skill-name>/
        SKILL.md                      # グローバルskill
      workspaces/
        <workspaceId>/
          <skill-name>/
            SKILL.md                  # ワークスペースskill
    instructions/
      global.md
      workspaces/
        <workspaceId>.md
```

### 3. 配送先はワークスペースごとの実行ディレクトリ + フォールバック

各AI CLI は自分の cwd 直下(`.claude/skills`、`.agents/skills` 等)をネイティブ探索する。そのため実行時のcwdを、その run が属するワークスペース専用のディレクトリへ切り替える。

```text
data/
  agent-workspaces/
    <workspaceId>/
      claude/
        CLAUDE.md                     # グローバル指示
        .claude/
          skills/
            <skill-name>/SKILL.md     # グローバル∪当該ワークスペースのskill
      codex/
        AGENTS.md                     # グローバル指示
        .agents/
          skills/
            <skill-name>/SKILL.md     # グローバル∪当該ワークスペースのskill
      antigravity/
        AGENTS.md                     # グローバル指示
        .agents/
          skills/
            <skill-name>/SKILL.md     # グローバル∪当該ワークスペースのskill
          mcp_config.json             # MCP起動設定。skills投影のrmで絶対に巻き込まない

  # workspaceIdが解決できないrun向けのフォールバック(常にグローバルのみ投影される)。
  codex-agent-workspace/
    AGENTS.md
    .agents/skills/<skill-name>/SKILL.md
  claude-agent-home/
    CLAUDE.md
    .claude/skills/<skill-name>/SKILL.md
  antigravity-agent-workspace/
    AGENTS.md
    .agents/skills/<skill-name>/SKILL.md
    .agents/mcp_config.json
```

**投影内容は union**: `agent-workspaces/<ws>/<provider>/` には、有効な**グローバルリソース ∪ そのワークスペースのリソース**が投影される。ワークスペーススキルは自分のワークスペースのディレクトリにだけ投影され、フォールバックディレクトリにも他ワークスペースにも決して投影されない。

Antigravity CLIも作業ディレクトリ直下の `AGENTS.md` と `.agents/skills` をネイティブ認識する。そのためグローバル指示はCodex/Antigravityの `AGENTS.md`、Claudeの `CLAUDE.md` へ投影する。

投影先パスはmanifestに保存しない。`(kind, sourcePath, workspaceId)` から実行のたびに導出する(`ai-resource-store.ts` の `deriveRuntimeTarget`)。これにより投影先の命名規則を変えてもmanifestマイグレーションが要らない。

ワークスペース指示はどのプロバイダにもファイル投影せず、実行時のプロンプト注入で届ける。各実行cwdの `AGENTS.md` / `CLAUDE.md` はグローバル指示のネイティブ投影先として保ち、ワークスペース指示との結合ファイルは永続化しない。

### 4. 実行時cwdの切り替え

`ai-edit:run` は編集対象fileIdからワークスペースIDを解決し(`resolveWorkspaceIdForFile`)、`LocalAiResourceStore.getAgentWorkspaceDir(provider, workspaceId)` が返す絶対パスをそのrunのcwdとして各クライアント(Claude/Codex/Antigravity)に渡す。workspaceIdが解決できないrunは、従来どおりの固定フォールバックディレクトリを使う(挙動不変)。

- `ClaudeStreamClient.runTurn({ cwd })` — 省略時は `claudeConfigDir`。
- `CodexAppServerClient.startThread/resumeThread/runTurn({ cwd })` — 省略時は `codexWorkspace`。app-serverプロセス自体のspawn cwdは常に `codexWorkspace`(スレッド/turnごとのcwdパラメータとは独立)。
- `GeminiHeadlessClient.runTurn({ workspaceDir })` — 省略時はコンストラクタの `workspaceDir`。添付ファイルの書き込み先もこのcwdに追従する。

Antigravityはワークスペース専用ディレクトリにも `mcp_config.json` が必要なため、`ai-edit:run` はrunのたびに `writeGeminiWorkspaceSettings` をそのディレクトリへ冪等に書き込む。

### 5. フィンガープリントは (provider × workspaceScope) の複合キー

`syncToRuntimeTargets` の差分判定(`.sync-manifest.json`)は、provider単体ではなく `"<provider>::<workspaceId|global>"` の複合キーでフィンガープリントを持つ。ワークスペースごとに投影内容が異なる(union)ため、providerだけでは同期要否を判定できない。

`options.workspaceIds` を省略すると、フォールバックスコープ(`null`)に加えて、ディスク上に既に実在する `agent-workspaces/<workspaceId>` ディレクトリすべてが対象になる。これにより、グローバルリソースの編集は「これまでに一度でも使われたワークスペースディレクトリ」全てへ再投影される。

旧スキーマ(`{ providers: { <provider>: {hash, syncedAt} } }`)からの後方互換変換は行わない。読み込み時に形が合わなければ空として扱い、次の同期で全ターゲットを書き直す。

### 6. Claude/Codex/Antigravityはネイティブskill探索を使う

`claude-stream-client.ts` の `--allowedTools` には `Skill` と `Read` を常に含める。これにより claude は cwd (実行ディレクトリの `.claude/skills`) と、ユーザー個人の `~/.claude/skills` を自力で発見し、タスクに合う `SKILL.md` 本文と supporting files (`references/` 等)だけを読み込む。公式スキルを含む全skill本文を毎ターンのプロンプトへ一括注入したり、全件読み込みさせたりはしない。Bash/Write/Edit/Task は引き続き不許可。

CodexとAntigravityは同様に `.agents/skills` をネイティブ探索する。プロバイダごとの特別なskill一覧はプロンプトに注入せず、それぞれのCLIがfrontmatterの `name` / `description` を読んで利用判定する。

`description` は3プロバイダの利用判定に必要な必須項目として扱う。UIでは空の説明を保存できず、旧バージョンが作成した空descriptionのskillは、読み込み・投影時にタイトルをフォールバックとしてSKILL.mdへ補完する。旧manifestのprovider移行は既知の共有形 `codex + claude` だけを3社へ拡張し、単一provider指定はprovider固有skillの意図を壊さないよう保持する。

ClaudeのMCPツールはrunごとに段階公開する。`mcp-tool-categories.ts` がユーザー指示、選択参照、明示選択skill IDから必要カテゴリを推論し、`mcp__sigma-studio-local__<tool-name>` を `--allowedTools` に個別列挙する。文書探索カテゴリとproposal確認・検証ツールは常に含め、推論に確信がない場合は全カテゴリへフォールバックする。切り分け用に `SIGMA_AI_TOOL_GATING=off` を指定すると従来の `mcp__sigma-studio-local__*` へ戻せる。

CodexとAntigravityには現時点で同等のper-runツール許可設定を渡す構成がないため、MCPツールは従来どおり全公開のままにする。今回の段階公開はClaudeだけに適用し、両プロバイダのプロンプトやMCP設定は絞り込まない。

### 7. プロンプト注入は instruction と explicit skill の本文だけ

実行時のプロンプト注入(`buildRunContext` / `formatAiResourcePromptSection`)で本文を必ず届けるのは次の2つだけにする。

- `always`: グローバル指示 + 対象ワークスペースの指示
- `explicit`: コンポーザーでユーザーが `/` などで明示的に選んだskillの本文

「instruction文言とのキーワード一致による自動(auto)注入」は廃止済み。ネイティブ探索に乗る3プロバイダでは、有効なskillはすでに実行ディレクトリの `.agents/skills` / `.claude/skills` 配下にあり、description からモデル自身が判断して読みに行けるため、アプリ側でのキーワード一致による事前注入は不要。

### 8. Antigravityの特別なskill一覧注入は行わない

Antigravity CLIは `.agents/skills` をネイティブ探索するため、`buildRunContext` への `{ name, description, path }` 一覧の特別注入は行わない。通常はCLIによる暗黙選択、コンポーザーから選ばれた場合は他providerと同じexplicit本文注入を使う。

### 9. 外部グローバルskillの走査は廃止

`~/.agents/skills`、`~/.codex/skills`、`~/.claude/skills`、`~/.gemini/config/skills` をアプリ側でスキャンする機構(scanGlobalSkills)は廃止済み。各CLIが対応する個人skillディレクトリをネイティブに探索するため、アプリ側で二重にスキャンする必要がない。

### 10. MCP読み取り・書き込みツールはグローバルのみ操作

`list_ai_resource_files` / `read_ai_resource_file`(supporting filesを読む読み取り専用ツール)は廃止済み。ネイティブskill探索に完全に委ねる方針のため不要。

`save_ai_resource` / `delete_ai_resource`(Studio管理下のskill/instructionの作成・更新・削除)は引き続き提供するが、**常にグローバルスコープのみを操作する契約は変更しない**(ワークスペーススキルはMCPツールからは作成・更新・削除できず、Sigma StudioのAI設定UI経由でのみ操作する)。

skill名は全スコープ横断で一意なため、指定した名前が既存のワークスペーススキルと一致する場合、save/deleteとも明示的にエラーで拒否する(黙って他ワークスペースのスキルを書き換えたり、`-2` サフィックスの別名グローバルスキルを作ったりしない)。

## データモデル

`AiResourceManifestEntry` は次の形。`workspaceId` はskill・instructionのどちらにも付与できる。

```json
{
  "id": "skill-graph-material",
  "kind": "skill",
  "title": "graph-material",
  "sourcePath": "skills/graph-material/SKILL.md",
  "enabled": true,
  "providers": ["codex", "claude", "antigravity"],
  "loadMode": "auto",
  "description": "関数、座標平面、図形、教材用グラフを作成・修正する。",
  "tags": [],
  "updatedAt": "2026-07-08T00:00:00.000Z"
}
```

ワークスペーススキルは `sourcePath` が `skills/workspaces/<workspaceId>/<name>/SKILL.md`、`workspaceId` フィールドがそのワークスペースIDになる点だけが異なる。

`runtimeTargets` フィールドは manifest から削除している。投影先は `(kind, sourcePath, workspaceId)` から実行時に導出する。

## AI設定UI

AI設定ダイアログは「グローバル」「ワークスペース」の2層。

- グローバル: AIへの指示、スキル(`workspaceId` 未設定のもの)
- ワークスペース: AIへの指示、スキル(選択中ワークスペースのもの)

コンポーザーの `/`-slash skill候補も「グローバル + 編集対象ドキュメントのワークスペース」に絞り込み、実行時の `buildRunContext` のスコープ判定と常に一致させる(選べるのに実行時には無視されるskillを作らない)。

## 参考

- OpenAI Codex Agent Skills: https://developers.openai.com/codex/skills
- Claude Code Skills: https://docs.anthropic.com/en/docs/claude-code/skills
- Google Antigravity Agent Skills: https://antigravity.google/docs/skills
- Google Antigravity CLI migration: https://antigravity.google/docs/gcli-migration
