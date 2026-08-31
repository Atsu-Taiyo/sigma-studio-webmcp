# 配布 / リリース手順

Sigma Studio デスクトップアプリを Windows / macOS 向けに配信するための手順です。

## 配布モデル

```text
             Atsu-Taiyo/ai-math-editor  (Private)     ソース + CI（GitHub Actions）
                              │
                              │  タグ v* を push（デスクトップと npm の共通の合図）
        ┌─────────────────────┴─────────────────────┐
        ▼                                           ▼
GitHub Actions (release.yml)                GitHub Actions (publish-npm.yml)
 ├─ macOS ランナー  → 署名 + notarization 済み DMG + 自動更新用 ZIP（arm64 / x64）
 └─ Windows ランナー → 未署名 NSIS インストーラ（.exe）
        │  PAT で cross-repo publish                 ├─ @sigma-studio/viewer
        ▼                                           └─ @sigma-studio/editor
Atsu-Taiyo/SIGMA-Studio  (Public)                    ▼
        │                                    npm registry（本体と同じ version）
        ▼                                           │
   誰でも releases ページからダウンロード              ▼
                                             npm install @sigma-studio/editor
```

- **ソースは非公開**（`ai-math-editor`）のまま、**バイナリだけ公開**リポジトリ（`SIGMA-Studio`）に発行します。
- `SIGMA-Studio` には README と GitHub Releases の配布物だけを置き、`ai-math-editor` のソースコードは push しません。
- アプリ内の「最新版を確認」は `SIGMA-Studio` の GitHub Releases を参照し、更新がある場合はアプリ内でダウンロードして再起動時に適用します。失敗時は `github.com/Atsu-Taiyo/SIGMA-Studio/releases/latest` を手動フォールバックとして開けます。
- 内部保存先は `~/Library/Application Support/Sigma Studio/data`、環境変数は `SIGMA_STUDIO_*` に統一します。
- macOS は Apple Developer ID で**署名 + notarization**、Windows は**未署名**（SmartScreen 警告あり / 後述の回避手順を案内）。
- WindowsのMicrosoft Store版は別途AppXを生成し、Microsoft Storeによる無料の署名・配信・自動更新を使います。

## 初回セットアップ（1回だけ）

### 1. SIGMA-Studio リポジトリを Public にする

`https://github.com/Atsu-Taiyo/SIGMA-Studio` → Settings → General → Danger Zone → **Change visibility** → Public。
（Private のままだとリリース資産は認証が必要になり「誰でもダウンロード」ができません。）

### 2. cross-repo publish 用 PAT を作成

CI は `ai-math-editor` で動きますが、リリースは `SIGMA-Studio` に発行するため、デフォルトの `GITHUB_TOKEN` では権限が足りません。PAT を作成します。

- GitHub → Settings → Developer settings → **Fine-grained personal access tokens** → Generate new token
  - Repository access: **Only select repositories** → `Atsu-Taiyo/SIGMA-Studio`
  - Permissions: **Contents → Read and write**
- （classic PAT の場合は `repo` スコープ）
- 作成したトークンを `ai-math-editor` の Secrets に `RELEASE_REPO_TOKEN` として登録。

### 3. GitHub Secrets を登録

`ai-math-editor` → Settings → Secrets and variables → Actions → **New repository secret**。

| Secret 名 | 必須 | 用途 |
|---|---|---|
| `RELEASE_REPO_TOKEN` | ✅ | SIGMA-Studio へリリースを発行する PAT |
| `MAC_CSC_LINK` | Mac 署名時 | Developer ID Application 証明書（.p12）を base64 化した文字列 |
| `MAC_CSC_KEY_PASSWORD` | Mac 署名時 | .p12 のパスワード |
| `APPLE_ID` | Mac 公証時 | Apple ID（メールアドレス） |
| `APPLE_APP_SPECIFIC_PASSWORD` | Mac 公証時 | App 用パスワード（appleid.apple.com で発行） |
| `APPLE_TEAM_ID` | Mac 公証時 | 10 桁の Team ID |

> 公開リリースでは macOS の署名 + notarization を必須にしています。Mac 署名系の Secret が未登録の場合、macOS ジョブは失敗します。ローカルの `npm run electron:dist:mac` は検証用に未署名ビルドも可能です。

### 4. npm の Trusted Publishing を設定（トークン不要）

タグ push で npm へ自動公開します。認証は **Trusted Publishing（OIDC）** で行うため、**npm のトークンはリポジトリに置きません**。GitHub Actions が発行する OIDC トークンを npm 側が検証し、「このリポジトリのこのワークフローからの publish か」を判定します。

`@sigma-studio/viewer` と `@sigma-studio/editor` の **両方** に対して、npmjs.com で以下を登録します。

1. npmjs.com → 対象パッケージ → **Settings** → **Trusted publishing** → GitHub Actions を選択
2. 次の3つを入力（**大文字小文字まで完全一致**で照合されます）

   | 項目 | 値 |
   |---|---|
   | Organization or user | `Atsu-Taiyo` |
   | Repository | `ai-math-editor` |
   | Workflow filename | `publish-npm.yml` |

   Environment name は空のままで構いません（GitHub Environments を使っていないため）。
3. Allowed actions は **npm publish** を有効にします。

これで publish 時のシークレットは不要になり、**有効期限切れで公開が止まる事故が原理的に起きません**。さらに provenance（出所証明）が自動で付与され、npm のパッケージページに「どのリポジトリのどのコミットからビルドされたか」が表示されます。

> **ワークフローのファイル名を変えると publish が通らなくなります。** `publish-npm.yml` をリネーム・移動する場合は、npm 側の Trusted publishing 設定も同時に更新してください。
>
> 動作要件は npm CLI 11.5.1 以上 / Node.js 22.14.0 以上です。ワークフローは Node 24（npm 11.x 同梱）を使うため満たしていますが、`node-version` を下げた場合に不可解な認証エラーにならないよう、publish 前に npm のバージョンを検証しています。
>
> 未設定のままタグを push すると、テストとビルドまで通ったあと publish で認証エラーになります。ワークフローが赤くなるだけで npm は変化しないので、設定してから Actions で再実行すれば復旧できます（デスクトップ配布は別ワークフローなので影響を受けません）。

### 5. Apple 署名素材の取得（Mac 署名する場合）

1. **Apple Developer Program** に登録（年間 $99）。
2. **Developer ID Application** 証明書を作成
   - Xcode → Settings → Accounts → Manage Certificates → ＋ → *Developer ID Application*
   - もしくは developer.apple.com → Certificates → ＋ → *Developer ID Application*
3. 証明書を **キーチェーンアクセス**から書き出す
   - 「ログイン」キーチェーンで証明書（＋秘密鍵）を選択 → 右クリック → 書き出す → `.p12` 形式、パスワードを設定。
4. base64 化して Secret に登録
   ```sh
   base64 -i DeveloperID.p12 | pbcopy   # クリップボードに base64 文字列
   ```
   → `MAC_CSC_LINK` に貼り付け、パスワードを `MAC_CSC_KEY_PASSWORD` に登録。
5. **App 用パスワード**を appleid.apple.com → サインインとセキュリティ → App 用パスワード で発行し `APPLE_APP_SPECIFIC_PASSWORD` に登録。
6. **Team ID** は developer.apple.com → Membership で確認し `APPLE_TEAM_ID` に登録。

## Microsoft Store版（Windows、無料署名）

GitHub Releases向けの未署名NSIS `.exe` は残したまま、Microsoft StoreにはAppXを提出します。AppXはMicrosoft Storeが署名するため、Windowsコード署名証明書の購入は不要です。Store版の更新はMicrosoft Storeが配信し、アプリ内のGitHub Releases向け更新機能は自動的に無効になります。

### 初回セットアップ

1. Partner Centerで `Sigma Studio` の製品名を予約する。
2. 製品の **Product identity** ページから次の値を取得する。

   | GitHub Actions Variable | Partner Centerの値 |
   |---|---|
   | `WINDOWS_STORE_IDENTITY_NAME` | Package/Identity/Name |
   | `WINDOWS_STORE_PUBLISHER` | Package/Identity/Publisher |
   | `WINDOWS_STORE_PUBLISHER_DISPLAY_NAME` | Package/Properties/PublisherDisplayName |

3. GitHub Actionsの **Variables** に3値を登録する。
4. Store掲載用の説明文、アイコン、スクリーンショット、サポートURL、プライバシーポリシーURLを準備する。

### AppXを生成して提出する

1. Actions → **Build Windows Store package** → **Run workflow** を実行する。
2. 成功後、artifact `sigma-studio-windows-store` をダウンロードする。
3. Partner Centerの **Packages** に `Sigma-Studio-Store-<version>-x64.appx` をアップロードする。
4. Properties、Age ratings、Store listings、Submission optionsを入力し、審査へ提出する。

Windows端末で生成する場合は、同じ3つの環境変数を設定して `npm run electron:dist:store` を実行します。現在のAppXツールチェーンはWindows専用のため、macOSではGitHub Actionsを使います。

## リリースを出す（毎回）

1. バージョンを上げる。**手で package.json を書き換えず、必ずこのコマンドを使う。**
   ```sh
   npm run version:set -- patch    # 0.188.2 -> 0.188.3
   npm run version:set -- minor    # 0.188.2 -> 0.189.0
   npm run version:set -- 0.190.0  # 明示指定も可
   ```
   デスクトップ本体（ルート + `apps/desktop`）と、npm に公開する `@sigma-studio/viewer` / `@sigma-studio/editor`、その依存・example・`package-lock.json` が同じ version に揃う。
2. コミットして `main` に反映。
   ```sh
   git commit -am "Bump version to 0.189.0"
   git push origin main
   ```
   この時点ではまだ何も公開されない（デスクトップも npm も、次のタグ push が合図）。
3. バージョンに対応するタグを push。**これがデスクトップ配布と npm 公開の共通の合図。**
   ```sh
   git tag v0.189.0
   git push origin v0.189.0
   ```
   （タグ名 `v<version>` は package.json の `version` と一致させる。ズレていると両ワークフローが即座に失敗する。）
4. 同じタグで 2 つのワークフローが並行して走る。
   - **Release** — macOS / Windows で並列ビルドし、`SIGMA-Studio` に **下書き（draft）リリース**として資産をアップロードする。
   - **Publish npm packages** — `@sigma-studio/viewer` と `@sigma-studio/editor` を同じ version で npm に公開する。既に公開済みの version なら skip するので、タグの打ち直しや再実行をしても二重公開にはならない。
5. `https://github.com/Atsu-Taiyo/SIGMA-Studio/releases` で下書きを確認し、以下の資産が揃っていることを確認する。
   - `Sigma-Studio-<version>-arm64.dmg`
   - `Sigma-Studio-<version>-x64.dmg`
   - `Sigma-Studio-<version>-arm64.zip`
   - `Sigma-Studio-<version>-x64.zip`
   - `Sigma-Studio-<version>-x64.exe`
   - `latest-mac.yml`
   - `latest.yml`
   - `*.blockmap`
6. リリースノートを書いて **Publish release**。
7. 公開後、`releases/latest` から誰でも DMG / EXE をダウンロード可能。既存ユーザーはアプリ内の設定 → アプリ → 最新版を確認から更新できます。
8. npm 側は `npm view @sigma-studio/editor version` で新しい version になっていることを確認する。

### npm 公開の自動化について

**タグ `v*` を push した時に、デスクトップ配布と npm 公開が同時に走る**、が唯一のルールです。`main` への merge では何も公開されないので、version を上げるコミットを安心して先に入れておけます。

**Publish npm packages** の起動条件は次の2つです。

| 起動条件 | 挙動 |
|---|---|
| タグ `v*` の push | 未公開 version なら公開。**通常はこれだけ** |
| 手動実行（`workflow_dispatch`、`main` 限定） | 公開が失敗した時のやり直し用 |

公開するかどうかは **npm registry に問い合わせて決めます**。そのためタグの打ち直し・失敗後の再実行・手動実行のどれでも「未公開の version なら公開、公開済みなら skip」で正しく振る舞い、二重公開は起きません。

> npm の version は取り消せません（unpublish は実質不可）。**タグを push した時点で確定します。**

### version の整合性について

デスクトップ配布と npm 公開は**同じ version** で動きます。整合していない状態はリリースできません。

- `npm run version:check` — ルート / `apps/desktop` / viewer / editor / example / `package-lock.json` の version と相互依存が揃っているか確認する（差分があれば何がズレているか一覧で出る）。
- `npm run version:sync` — ルートの version を正本として揃え直す（手で package.json を編集してしまった場合の復旧用）。
- 両ワークフローとも実行の冒頭で `version:check`（と、タグ実行なら「タグ名 == version」）を検証し、ズレていればビルド前に失敗します。CI は version を勝手に書き換えないので、commit の tree と公開物は必ず一致します。

> 手動実行も可能: Actions タブ → Release / Publish npm packages → Run workflow（`workflow_dispatch`）。npm 公開の手動実行は `main` ブランチからのみ許可されています。
>
> mac / win の 2 ジョブが同じタグのリリースに資産を追加します。まれに下書きが二重に作られた場合は、片方を削除してもう片方に資産を集約してください。

## エンドユーザー向けインストール手順

### macOS

署名 + notarization 済みのため、通常どおり DMG を開いて `Sigma Studio.app` を Applications にドラッグするだけです。

- Apple Silicon Mac → `Sigma-Studio-<version>-arm64.dmg`
- Intel Mac → `Sigma-Studio-<version>-x64.dmg`

（未署名のテストビルドを配った場合のみ）「開発元を確認できないため開けません」が出たら、Finder でアプリを右クリック →「開く」→ ダイアログで再度「開く」。または `xattr -dr com.apple.quarantine "/Applications/Sigma Studio.app"`。

### Windows

未署名のため、初回起動時に SmartScreen が **「Windows によって PC が保護されました」** と表示します。
**「詳細情報」→「実行」** で起動できます（installer 実行時も同様）。

## ローカルビルド

```sh
npm run electron:dist:mac    # macOS 向け（署名 env があれば署名）
npm run electron:dist:win    # Windows 向け（要 Windows もしくは wine）
npm run electron:dist:store  # Microsoft Store提出用AppX（要Partner Center製品ID）
npm run electron:dist        # mac + win 両方
```

生成物は `apps/desktop/release/` に出力されます（GitHub へは publish しません）。

## アプリアイコン

アイコンの唯一の出典は `apps/desktop/build/icon.svg` です。ここから生成します。

```sh
npm --workspace @sigma-studio/desktop run icons:generate
```

| 生成物 | 用途 |
| --- | --- |
| `build/icon.png` (1024px) | Linux、`app.dock.setIcon()`、`BrowserWindow` の icon |
| `build/icon.icns` | macOS バンドル（electron-builder `mac.icon`）。`iconutil` が要るので macOS でのみ生成 |
| `build/icon.ico` | Windows（electron-builder `win.icon`） |

PNG / ICNS / ICO は生成物なので直接編集せず、SVG を編集して再生成してください。
角丸と余白は **素材側に焼き込んであります**（1024キャンバスの中央 824×824、角丸半径 185.4 =
macOS の App Icon グリッド）。`app.dock.setIcon()` も Windows のタスクバーもマスクをかけないため、
全面塗りの正方形を渡すと角の立った大きな四角がそのまま表示されます。

開発実行（`npm run electron:dev`）では `scripts/brand-dev-electron.mjs` が
`node_modules` の Electron.app の `CFBundleName` とバンドルアイコンを差し替えます。
macOS のメニューバー左上の名前は実行中の .app の `CFBundleName` から取られ、
`app.setName()` やメニューテンプレートの label では変えられないためです
（パッケージ版は electron-builder が `productName` を書き込むので影響しません）。

## アプリ内自動更新

- 自動更新は `electron-updater` を使い、公開済みの `Atsu-Taiyo/SIGMA-Studio` GitHub Releases から `latest-mac.yml` / `latest.yml` を取得します。
- macOS は ZIP 資産、Windows は NSIS インストーラと `.blockmap` を更新適用に使います。DMG は手動インストール用として残します。
- `latest-mac.yml` / `latest.yml` / `*.blockmap` / macOS ZIP を削除すると、アプリ内更新や差分ダウンロードが壊れます。
- 公開版は起動後にバックグラウンドで更新を確認し、更新がある場合は自動でダウンロードします。ダウンロード完了後、タイトルバーまたは設定画面の更新ボタンから再起動して適用できます。
- 更新確認はアプリの設定画面、または Help → Check for Updates... から手動でも実行できます。差分更新に失敗した場合は electron-updater がフルダウンロードにフォールバックし、それでも失敗した場合はリリースページを手動で開けます。
- Microsoft Store版では`electron-updater`を使いません。更新の確認・ダウンロード・適用はMicrosoft Storeが担当します。

## 既知の制約

- **AI 編集機能は外部の Codex CLI に依存**します。配布物には同梱していないため、AI 機能を使うユーザーは別途 Codex CLI のインストールとログインが必要です（ドキュメント編集自体は Codex なしで動作）。
- **GitHub Releasesで配るWindows NSIS版は未署名**のためSmartScreen警告が出ます。Microsoft Store版はStoreが署名するため、この制約の対象外です。
