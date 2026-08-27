# TeX Box Block Plan And Current Status

## Status

この文書は、TeX風の箱をSigmaDoc本文フローの `boxBlock` として扱うための計画と、現在の実装状態をまとめる。

実装済み:

- Slash command から `/fancybox`、`/itembox`、`/tcolorbox`、`/tcolorbox-note`、`/doublebox`、`/shadebox`、`/leftbar`、`/dashedbox`、`/ruledbox`、`/screenbox`、`/ovalbox`、`/cornerbox` を `boxBlock` として挿入できる。
- Slash command の `boxBlock` はトップレベル本文だけでなく、問題の導入文・問題文・コメント・解答でも同じ構造として挿入できる。問題全体の `frame` 設定とは独立している。
- `BoxBlockNode`、`BoxFrameSpec`、`BoxDecorationSpec` は `src/types/sigma-doc.ts` と `src/lib/sigma-doc-schema.ts` の現行schemaに入っている。
- 編集画面と印刷プレビューは、同じ `BoxFrameSpec` からCSS変数と `data-box-*` 属性を作って描画する。
- 箱内 `layoutSection` と本文・問題エリアの `layoutSection` は、同じ段数・段間CSS変数、balanced columns、段内改段規則を使う。ページをまたぐ配置だけは外側のページcompositorが担当する。

未実装または計画中:

- TeX importで `\begin{itembox}` を `boxBlock` にすること。現在は `【タイトル】 本文` のparagraph fallbackとして取り込む。
- `\begin{tcolorbox}`、`\newtcolorbox`、ユーザー定義box style registryの本格import。
- 任意TikZ/underlayの解釈。今後も任意実行はしない。

## 目的

`itembox`、`tcolorbox`、ユーザー定義の `\newtcolorbox` を、最終的には本文中の編集可能なSigmaDocブロックとして扱う。

この計画は、TeX全文を保存形式にするためのものではない。正本はSigmaDoc JSONのままにし、TeXの箱定義は「箱ブロックの見た目を作るためのテンプレート」として扱う。本文に挿入される実体は、TeX文字列ではなく、タイトル、本文、スタイル参照、引数、描画キャッシュを持つSigmaDocブロックにする。

## 背景

現在のTeX importでは、`itembox` は本文ブロックへ平文化される。例えばタイトル付きの `itembox` は `【キーワード】 ...` のような paragraph に変換される。これは意味を失いにくい安全なfallbackだが、実際の紙面で箱として見せたい教材には足りない。

一方で、`tcolorbox` や `\newtcolorbox` は、色、罫線、タイトル、角、underlayのTikZ描画などを含められる。これを完全なTeXエンジン再現として実装するのは重い。特に `underlay` の任意TikZをReact/CSSで完全に解釈するのは現実的ではない。

そのため、実装は2層に分ける。

- SigmaDoc上の箱ブロック: 編集、保存、選択、履歴、AI編集、印刷に使う正本。
- TeX box template: `\newtcolorbox` 風の設定から、箱ブロックの描画方法を導くユーザー定義。

## ゴール

- 本文フロー内に箱ブロックを挿入できる。
- 箱ブロックはタイトルと本文を持ち、本文には通常のRichBlockを入れられる。
- `\begin{itembox}` / `\begin{tcolorbox}` / `\begin{teiri}{...}` のようなTeX入力を箱ブロックへimportできる。
- 設定画面で `\newtcolorbox{teiri}[1]{...}` のような定義を登録できる。
- 登録した定義は、挿入メニューやTeX importで利用できる。
- `underlay` のような複雑な装飾は、段階的に「安全な描画プリセット」へ変換する。
- TeX定義をそのまま任意実行しない。安全なsubsetとして解釈する。

## 非ゴール

- TeX全文をSigmaDocの正本にする。
- 任意のLaTeX packageやTikZを完全実行する。
- `tcolorbox` の全オプションを初期実装で完全再現する。
- 印刷を編集DOMから直接行う。
- tldrawや外部canvas形式を箱ブロックの正本にする。

## Current SigmaDoc Model

`SigmaBlock` には既に `boxBlock` がある。現行型の入口は `src/types/sigma-doc.ts` と [SigmaDoc Schema](sigma-doc-schema.md) を正とする。

```ts
export interface BoxBlockNode extends BaseNode {
  type: "boxBlock";
  styleId: string;
  title?: InlineNode[];
  blocks: BoxBlockChildBlock[];
  frame?: BoxFrameSpec;
}
```

`styleId` は `fancybox`、`itembox`、`tcolorbox`、`cornerbox` などのbuilt-in style、または将来のユーザー定義styleを指す。`title` は実際に本文へ表示するタイトルです。現行schemaに `args` はなく、TeX定義の引数再展開は未実装です。`blocks` は箱の中身で、paragraph、heading、list、入れ子box、箱内layout sectionを保持できる。

箱内layout sectionはTeXで`itembox`内へ`multicols`を置く構成に対応し、その中では手動改段を使える。箱直下の手動改ページは許可せず、長い箱のページ・外側段への継続はSigma Studioの自動分割で処理する。

`frame` はユーザー定義を解決した後の描画用スナップショットを持つ。定義が削除・変更されても既存ブロックが最低限表示できるようにするため、完全に `styleId` だけへ依存させない。

```ts
export interface BoxFrameSpec {
  borderWidthPx?: number;
  borderColor?: string;
  borderStyle?: "solid" | "dashed" | "dotted" | "double" | "none";
  backgroundColor?: string;
  titleBackgroundColor?: string;
  titleColor?: string;
  titleAlign?: TextAlign;
  titleFontWeight?: "normal" | "bold";
  titleFontFamily?: string;
  titleFontSizePx?: number;
  titleLineHeight?: string;
  bodyColor?: string;
  bodyAlign?: TextAlign;
  bodyFontFamily?: string;
  bodyFontSizePx?: number;
  bodyLineHeight?: string;
  cornerStyle?: "sharp" | "round";
  radiusPx?: number;
  paddingPx?: BoxSpacingPx;
  decorations?: BoxDecorationSpec[];
}
```

`decorations` は、CSSだけで安全に表現できる装飾の抽象表現です。

```ts
export type BoxDecorationSpec =
  | { type: "cornerSquares"; sizePx: number; color: string }
  | { type: "doubleRule"; offsetPx: number; widthPx?: number; color?: string }
  | { type: "titleDoubleRule"; ruleWidthPx?: number; ruleColor?: string; guideColor?: string }
  | { type: "titleBand"; heightPx?: number; backgroundColor?: string }
  | { type: "titlePlate"; borderColor?: string; radiusPx?: number; paddingPx?: BoxSpacingPx }
  | { type: "leftBar"; widthPx: number; color: string }
  | { type: "shadow"; offsetXPx: number; offsetYPx: number; blurPx?: number; spreadPx?: number; color: string }
  | { type: "horizontalRules"; widthPx?: number; color?: string }
  | { type: "notebookRules"; ... };
```

ユーザー例の `underlay` は、将来も任意TikZとして実行しません。よく使う見た目だけを `BoxDecorationSpec` のsafe subsetに写します。

## ユーザー定義モデル案

文書単位またはアプリ設定に `boxStyles` を持つ。

```ts
export interface BoxStyleDefinition {
  id: string;
  displayName: string;
  sourceKind: "builtin" | "tcolorbox";
  commandName?: string;
  argumentCount?: number;
  sourceTex?: string;
  frame: BoxFrameSpec;
  titleTemplate?: RichInlineTemplate;
  unsupportedOptions?: string[];
  createdAt?: string;
  updatedAt?: string;
}
```

保存場所は2段階で考える。

- Phase 1: 文書内の `metadata.boxStyles` または `documentSettings.boxStyles` に保存する。
- Phase 2: デスクトップのユーザー設定に「よく使う箱テンプレート」を保存し、新規文書へコピーできるようにする。

文書の再現性を優先するため、本文で使われたスタイルは文書内にも埋め込む。アプリ設定だけに依存すると、別環境で開いた時に表示が崩れる。

## `\newtcolorbox` 変換方針

例:

```tex
\newtcolorbox{teiri}[1]
{
  enhanced,
  boxrule=0.5pt,
  colframe=white,
  colback=white,
  colbacktitle=white,
  coltitle=black,
  sharp corners,
  borderline={0.5pt}{0pt}{black!50,densely dashed},
  title={\center\bfseries\large 《#1》},
  underlay={...}
}
```

初期対応する項目:

| tcolorbox option | SigmaDoc変換 |
|---|---|
| `boxrule=0.5pt` | `frame.borderWidthPx` |
| `colframe=...` | `frame.borderColor` |
| `colback=...` | `frame.backgroundColor` |
| `colbacktitle=...` | `frame.titleBackgroundColor` |
| `coltitle=...` | `frame.titleColor` |
| `sharp corners` | `frame.cornerStyle = "sharp"` |
| `arc=...` | `frame.cornerStyle = "round"` と半径 |
| `borderline={0.5pt}{0pt}{black!50,densely dashed}` | `borderStyle = "dashed"`、色、幅 |
| `title={...#1...}` | `titleTemplate` |
| `center` / `\center` | `titleAlign = "center"` |
| `\bfseries` | `titleFontWeight = "bold"` |
| `\large` | `titleFontSizePx` |
| 既知の `underlay` pattern | `decorations` |
| 未対応option | `unsupportedOptions` に記録 |

`black!50` のようなxcolor表記は、初期実装では代表的な `black!n`、`white`、`red`、`blue`、`gray` 程度だけ変換する。未対応色は `unsupportedOptions` へ残し、描画は安全な既定値にfallbackする。

## 描画方針

### 編集画面

Tiptap上では `boxBlock` をblock node viewとして表示する。中身の `blocks` は既存のRichText編集コンポーネントを再利用する。

必要な操作:

- 箱ブロック選択
- タイトル編集
- 本文編集
- 箱スタイル変更
- Hover時の3点メニューから開く設定ダイアログで、余白・罫線・タイトル表示を編集
- 箱全体の複製、削除、上下移動

### PageCanvas / Print

印刷では専用print rendererが `boxBlock` をHTML/CSSへ変換する。CSSで表現できるものはCSSで出し、複雑なdecorationsはSVG overlayを箱内背景として出す。

ユーザー例のような角の四角と内側の装飾罫線は、`position: absolute` のSVGを箱背景に敷く。TikZを直接実行せず、SigmaDocの `BoxDecorationSpec` からSVGを生成する。

## Import方針

### itembox

現在のTeX importでは平文化fallbackを使います。将来、これを `boxBlock` 生成へ置き換えます。

- `\begin{itembox}[l]{キーワード}` は `styleId: "itembox"`。
- `[l]` はタイトル位置または本文alignへ変換する。
- `{キーワード}` は `title`。
- bodyは `texSourceToRichBlocks()` で `blocks` に変換する。

### tcolorbox

`readEnvironmentAt()` で `tcolorbox` を検出し、optionとbodyを読む。

- `\begin{tcolorbox}[title=定理] ...` は built-in `tcolorbox`。
- option内の `title`、色、罫線は `frame` に変換する。
- 未対応optionは保持して、import warningへ出す。

### custom environment

TeX importの前処理で `\newtcolorbox{name}[n]{options}` を抽出し、`BoxStyleDefinition` として登録する。

その後、本文中の `\begin{name}{arg1} ... \end{name}` または `\begin{name}[...] ...` を、対応する `boxBlock` に変換する。

## 設定UI

設定画面に「箱テンプレート」を追加する。

最低限のUI:

- テンプレート一覧
- 新規追加
- TeX定義貼り付け
- 解析プレビュー
- 対応済みoption / 未対応option表示
- テンプレート名、コマンド名、引数数
- プレビュー本文とタイトル引数の入力
- 保存、複製、削除

ユーザーはTeX定義を貼るが、実行されるのは安全な解析器だけにする。任意のTeXコマンド実行、外部ファイル参照、shell escape、任意TikZ実行はしない。

## 実装フェーズ

### Phase 1: SigmaDoc boxBlock基盤

- Status: implemented.
- `BoxBlockNode` と `BoxFrameSpec` は `src/types/sigma-doc.ts` にある。
- Zod schema、built-in style、編集/印刷描画は実装済み。

### Phase 2: Editor表示と編集

- Status: partially implemented.
- Slash commandからbuilt-in `boxBlock` を挿入し、編集画面/印刷画面で描画できる。
- 設定ダイアログ上の全style編集やユーザー定義style管理は今後の拡張。

### Phase 3: itembox importの置き換え

- Status: not implemented.
- 既存の `createItemboxBlocks()` を `createItemboxBlock()` に置き換える。
- import fallbackとして、schema未対応時だけ平文化できるようにする。
- `tex-import.test.ts` に `itembox` が `boxBlock` になるテストを追加。

### Phase 4: tcolorbox subset import

- Status: not implemented.
- `\begin{tcolorbox}[...]` をboxBlockへ変換する。
- `title`、色、罫線、角、paddingのsubsetを解析する。
- 未対応optionをimport warningとして残す。

### Phase 5: `\newtcolorbox` style registry

- Status: not implemented.
- preambleから `\newtcolorbox{name}[n]{options}` を抽出する。
- `BoxStyleDefinition` へ変換して文書内に保存する。
- 本文中のcustom environmentをstyle参照付きboxBlockに変換する。

### Phase 6: underlay pattern対応

- Status: partially represented by built-in safe decorations.
- よく使うunderlay patternだけを `BoxDecorationSpec` に変換する。
- ユーザー例の内側角丸線と四隅の小四角をプリセット化する。
- print rendererと編集画面でSVG decorationを表示する。

### Phase 7: ユーザー設定UI

- Status: not implemented.
- 設定画面に箱テンプレート管理を追加する。
- 登録済みテンプレートから本文へ挿入できるようにする。
- 文書内スタイルとグローバルスタイルの同期/コピー境界を決める。

## 技術メモ

TeX parserは、最初は既存の `tex-import.ts` の軽量parserを拡張してよい。ただし `\newtcolorbox` のoption解析が複雑になったら、`@unified-latex` のようなLaTeX AST parserをimport専用に導入する候補がある。導入する場合も、ASTは変換時の派生データであり、保存正本にはしない。

KaTeXは数式レンダラであり、`tcolorbox` のブロック環境を解釈する用途には使わない。LaTeXMLやPandocは重い変換器で、初期のデスクトップ内リアルタイム編集には向かない。

## 受け入れ条件

- Slash commandからbuilt-in box styleを `boxBlock` として挿入できる。
- `\begin{itembox}[l]{キーワード}...\end{itembox}` が `boxBlock` としてimportされる。
- `\begin{tcolorbox}[title=定理]...\end{tcolorbox}` が `boxBlock` としてimportされる。
- `\newtcolorbox{teiri}[1]{... title={...#1...} ...}` を読み、`\begin{teiri}{中間値の定理}...\end{teiri}` がタイトル付きboxBlockになる。
- 編集画面と印刷画面で、同じSigmaDoc boxBlockから同等の枠表示が出る。
- 未対応のTeX optionは消えずにwarningとして確認できる。
- TeX定義を変更しても、既存boxBlockは最低限表示できる。
- `npm run typecheck` と関連unit testsが通る。
