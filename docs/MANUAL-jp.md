# tikzc ユーザーマニュアル

本マニュアルでは，このリポジトリに含まれる2つのコンポーネントを詳細に解説します．

1. **`tikzc` CLI** — ローカルの LuaLaTeX ツールチェーンを用いて `.tikz`
   ファイルを SVG / PNG にコンパイルするコマンドラインツール
2. **VSCode 拡張機能（`tikzc-preview` / "TikZc Editor"）** — webview に埋め込んだ
   WYSIWYG TikZ エディタと，CLI と同じパイプラインによる高精度な SVG / PNG
   エクスポート

English version: [MANUAL.md](MANUAL.md)

---

## 目次

- [1. 概要とアーキテクチャ](#1-概要とアーキテクチャ)
- [2. 前提条件（TeX ツールチェーン）](#2-前提条件tex-ツールチェーン)
- [3. `.tikz` ソースの書式](#3-tikz-ソースの書式)
- [4. CLI リファレンス](#4-cli-リファレンス)
- [5. VSCode 拡張機能](#5-vscode-拡張機能)
- [6. トラブルシューティング](#6-トラブルシューティング)
- [7. アンインストール](#7-アンインストール)
- [8. 開発](#8-開発)
- [9. ライセンス](#9-ライセンス)

---

## 1. 概要とアーキテクチャ

CLI と拡張機能のエクスポートコマンドは，[`src/core.ts`](../src/core.ts) に
実装された単一のコンパイルパイプライン（Quarto フィルタ `quarto_tikz.lua`
の移植）を共有しています．

```text
.tikz ──(standalone .tex を組み立て)──▶ .tex
      ──(lualatex)────────────────────▶ .pdf
      ──(dvisvgm --pdf --no-fonts)────▶ .svg
      └─(pdftoppm -png)───────────────▶ .png
```

パイプラインの特徴：

- **LuaLaTeX + fontspec**：日本語（CJK）ラベルは OS のシステムフォントで
  そのまま描画されます．TikZ ソース側でのフォント設定は不要です．
- **`dvisvgm --no-fonts`**：グリフを SVG パスとして埋め込むため，フォント
  ファイルを同梱せずにどの環境でも同一の見た目で表示できます．
- **一時ディレクトリ**：コンパイルは毎回 OS の一時ディレクトリ配下の
  `tikzc-*` ディレクトリで実行され，終了後に削除されます（CLI の
  `--keep-tex` で生成された `.tex` のコピーを残せます）．

VSCode 拡張機能はさらに
[DominikPeters/tikz-editor](https://github.com/DominikPeters/tikz-editor)
（MIT）の WYSIWYG エディタを埋め込んでおり，その**内蔵 TikZ パーサにより
LaTeX 環境なしで即座にプレビューが描画**されます．LaTeX が必要になるのは
エクスポート時のみです．

---

## 2. 前提条件（TeX ツールチェーン）

> **重要：** CLI・拡張機能ともに TeX 環境を同梱していません．ローカルに
> インストール済みのツールチェーンを外部コマンドとして呼び出します．TeX
> 環境がない場合，コンパイルとエクスポートは失敗します（VSCode 上の
> WYSIWYG 編集自体は動作します）．

必要な外部コマンド（`PATH` 上にあること）：

| コマンド | 用途 | 入手元 |
|---|---|---|
| `lualatex` | `.tex` → `.pdf` | TeX Live / MacTeX / MiKTeX（TikZ/PGF と fontspec を含む構成） |
| `dvisvgm` | `.pdf` → `.svg` | TeX Live に同梱 |
| `pdftoppm` | `.pdf` → `.png`（PNG 出力時のみ） | poppler / poppler-utils |
| `node`（18 以上） | CLI の実行・ビルド | [nodejs.org](https://nodejs.org/) またはパッケージマネージャ |

### Linux（Ubuntu / Debian）

```sh
sudo apt install texlive-luatex texlive-pictures texlive-latex-extra poppler-utils
```

### macOS

```sh
# MacTeX（lualatex + dvisvgm + TikZ を含む）．GUI アプリが不要なら -no-gui 版で十分
brew install --cask mactex-no-gui

# pdftoppm（PNG 出力を使う場合のみ）
brew install poppler
```

インストール後はターミナルを開き直して `/Library/TeX/texbin` を PATH に
通してください．反映されない場合は `eval "$(/usr/libexec/path_helper)"` を
実行します．

### Windows

- **TeX Live**：[tug.org/texlive](https://tug.org/texlive/) のインストーラで
  導入（`lualatex` / `dvisvgm` を含む．scheme-full 推奨）．
  [MiKTeX](https://miktex.org/) でも動作します（不足パッケージは自動導入）．
- **poppler**（PNG 出力時のみ）：`scoop install poppler` または
  `choco install poppler`．手動導入の場合は
  [poppler-windows](https://github.com/oschwartz10612/poppler-windows/releases)
  を展開し `Library\bin` を PATH に追加します．

PowerShell / コマンドプロンプトでそのまま動作します（WSL は不要）．

### インストールの確認

```sh
lualatex --version && dvisvgm --version && pdftoppm -v && node --version
```

### 日本語（CJK）フォントについて

デフォルトのメインフォントは **`IPAexMincho`** で，TeX Live / MacTeX の
フル構成に同梱されています．fontspec が見つけられない場合は，`#| mainfont:`
ヘッダ・CLI の `--mainfont`・VSCode 設定 `tikzc.mainfont` のいずれかで OS
フォントを指定してください：

- macOS：例 `Hiragino Mincho ProN`
- Windows：例 `Yu Mincho`，`MS Mincho`

---

## 3. `.tikz` ソースの書式

`.tikz` ファイルは TikZ コードに，任意で `#|` ヘッダ行を先頭に付けたものです．

### 3.1 ヘッダオプション

ヘッダ行は `quarto_tikz` Lua フィルタと同じ `#| key: value` 記法です．
**ファイル先頭**に置く必要があり，`#|` オプションでない行が現れた時点で
ヘッダブロックは終了します．

```text
#| packages: [circuitikz, pgfplots]   -- 追加の \usepackage
#| libraries: [arrows.meta, calc]     -- 追加の \usetikzlibrary
#| scale: 1.5                         -- \scalebox で包む
#| mainfont: IPAexGothic              -- fontspec のメインフォント
\begin{tikzpicture}
  ...
\end{tikzpicture}
```

| キー | 値 | 効果 |
|---|---|---|
| `packages` | リスト（`[a, b]` または `a, b`） | 追加の `\usepackage{...}` |
| `libraries` | リスト | 追加の `\usetikzlibrary{...}` |
| `scale` | 数値 | 内容を `\scalebox{n}{...}` で包む |
| `mainfont` | フォント名 | `\setmainfont{...}`（fontspec） |

リスト値は `[a, b, c]` 形式と裸の `a, b` 形式のどちらも受け付け，各要素を
囲むダブルクォートは除去されます．

### 3.2 オプションの優先順位

各オプションの有効値は次の順に解決されます（上が優先）：

1. ソースファイルの `#|` ヘッダ
2. CLI フラグ（`--mainfont`，`--packages` など）または VSCode 設定
   （`tikzc.mainfont`，`tikzc.extraPackages` など）
3. 組み込みデフォルト

リスト系オプション（`packages`，`libraries`）は置き換えではなく
**マージ**されます（デフォルト + CLI/設定 + ヘッダ．重複は除去）．

### 3.3 組み込みデフォルト

設定なしで常に読み込まれるもの：

- パッケージ：`amsmath`，`amssymb`
- TikZ ライブラリ：`arrows.meta`，`positioning`，`calc`，`shapes.geometric`，
  `backgrounds`，`fit`
- メインフォント：`IPAexMincho`

### 3.4 裸の TikZ コード

本文に `\begin{tikzpicture}` が含まれない場合，自動的に `tikzpicture`
環境で包まれます．したがって次の1行だけでも完全なファイルとして有効です：

```text
\draw[->] (0,0) -- (2,1) node[right] {ラベル};
```

### 3.5 生成されるドキュメント

組み立てられる standalone ドキュメントは次の形になります：

```latex
\documentclass[border=2pt]{standalone}
\usepackage{fontspec}
\setmainfont{<mainfont>}
\usepackage{tikz}
\usepackage{<追加パッケージごとに1行>}
\usetikzlibrary{<全ライブラリをカンマ結合>}
\begin{document}
<本文．必要に応じて tikzpicture / \scalebox で包まれる>
\end{document}
```

TikZ は（`standalone` クラスの `tikz` オプションではなく）パッケージとして
読み込みます．これは `\scalebox` を機能させるためです．

---

## 4. CLI リファレンス

### 4.1 インストール

```sh
npm install
npm run build          # dist/tikzc.cjs を生成
npm link               # 任意：tikzc コマンドをグローバルに導入
```

`npm link` しない場合は `node dist/tikzc.cjs` として実行できます．

### 4.2 書式

```text
tikzc [options] <file.tikz>
```

使用例：

```sh
tikzc test.tikz                    # -> test.svg（入力と同じ場所）
tikzc test.tikz -f png --dpi 600   # -> test.png（600 dpi）
tikzc test.tikz -f both -o out/    # -> out/test.svg と out/test.png
tikzc test.tikz --watch            # 保存のたびに再コンパイル
tikzc --help
```

### 4.3 オプション一覧

| オプション | デフォルト | 説明 |
|---|---|---|
| `-f, --format <svg\|png\|both>` | `svg` | 出力フォーマット |
| `-o, --output <path>` | 入力の隣 | 出力ファイル**または**ディレクトリ |
| `--dpi <n>` | `300` | PNG 解像度（正の数） |
| `--mainfont <font>` | `IPAexMincho` | fontspec のメインフォント |
| `--packages <a,b>` | — | 追加の `\usepackage`（カンマ区切り） |
| `--libraries <a,b>` | — | 追加の `\usetikzlibrary`（カンマ区切り） |
| `--scale <n>` | — | `\scalebox{n}` で包む |
| `--keep-tex` | off | 生成した `.tex` も出力先に書き出す |
| `-w, --watch` | off | 入力ファイルを監視し変更のたびに再コンパイル |
| `-q, --quiet` | off | stderr への進捗表示を抑制 |
| `-h, --help` | — | ヘルプを表示して終了 |

ソースの `#|` ヘッダはこれらのフラグより**優先**されます
（[3.2 節](#32-オプションの優先順位)参照）．

### 4.4 出力パスの解決規則

出力のベース名は常に入力ファイル名の拡張子を置き換えたものです
（`figure.tikz` → `figure.svg` / `figure.png` / `figure.tex`）．

- **`-o` なし**：入力ファイルと同じディレクトリに出力
- **`-o` が既存ディレクトリ**（またはパス区切り文字で終わる）：その
  ディレクトリに出力（なければ作成）
- **`-o` がファイルパス**で単一フォーマット指定：そのパスをそのまま使用
- **`-f both`**：`-o` は常にディレクトリとして扱われます（2つのファイルが
  1つのパスを共有できないため）

### 4.5 watch モード

`--watch` は最初に1回コンパイルした後，入力ファイルを監視して変更のたびに
再コンパイルします．変更イベントは 200 ms でデバウンスされ（エディタは保存
1回で複数イベントを発火するため），コンパイル中に変更が入った場合は終了後に
もう1回コンパイルします．コンパイルエラーは表示されますが監視は継続します．
`Ctrl+C` で終了します．

### 4.6 終了コードとエラー

| コード | 意味 |
|---|---|
| `0` | 成功（watch モードではプロセスは動き続ける） |
| `1` | コンパイル失敗 |
| `2` | 使用方法の誤り（不正なフラグ・入力が読めない・入力未指定） |

LaTeX が失敗した場合，LaTeX ログから最初の `! ...` エラーブロックを抽出して
stderr に表示します：

```text
tikzc: lualatex compilation failed:
! Undefined control sequence.
l.12 \drow
```

進捗表示（`tikzc: test.svg (1234ms)`）は **stderr** に出るため，stdout は
スクリプトからの利用のためにクリーンに保たれます．

---

## 5. VSCode 拡張機能

### 5.1 概要

拡張機能（`RyoNak.tikzc-preview`，表示名 **TikZc Editor**）は
[DominikPeters/tikz-editor](https://github.com/DominikPeters/tikz-editor)
の WYSIWYG エディタを VSCode の webview パネルに埋め込みます：

- **キャンバスは即時描画**（tikz-editor 内蔵の TikZ パーサを使用．編集に
  LaTeX は不要）
- **キャンバス上の図形操作**（ノードの移動・描画など）は VSCode のテキスト
  バッファへ自動的に書き戻されます
- **VSCode 側のテキスト編集**は即座にキャンバスへ反映されます
- **エクスポートコマンド**は本物の lualatex + dvisvgm / pdftoppm
  パイプラインで高精度な出力を生成します（日本語ラベルも正しく描画）

### 5.2 ビルドとインストール

```sh
cd vscode-extension
npm install
npm run package        # webview（Vite）+ 拡張ホストをビルドし .vsix を生成
code --install-extension tikzc-preview-0.1.0.vsix
```

> macOS で `code` コマンドが見つからない場合は，VSCode のコマンドパレットで
> "Shell Command: Install 'code' command in PATH" を実行してください．

拡張機能は言語 ID `tikz`（拡張子 `.tikz`）のファイルを開いたときに
アクティベートされます．

### 5.3 コマンドとキーバインド

| コマンドパレット表示 | ID | 利用条件 |
|---|---|---|
| **TikZ: Open Editor to the Side** | `tikzc.showPreview` | アクティブエディタが `.tikz`．エディタタイトルバーのアイコンからも起動可 |
| **TikZ: Export as SVG** | `tikzc.exportSvg` | アクティブエディタが `.tikz` |
| **TikZ: Export as PNG** | `tikzc.exportPng` | アクティブエディタが `.tikz` |

デフォルトキーバインド：`Ctrl+K V`（macOS は `Cmd+K V`）で現在のエディタの
横にエディタパネルを開きます．

### 5.4 基本的な使い方

1. VSCode で `.tikz` ファイルを開く
2. タイトルバーのアイコンまたは `Ctrl+K V` で **Local TikZ Editor**
   パネルを開く
3. どちら側からでも編集できます：
   - VSCode のテキストエディタで TikZ コードを入力 → キャンバスが即時更新
   - キャンバス上で図形を操作 → 変更が VSCode バッファへ書き戻される
     （約 600 ms のデバウンス）
4. **保存は通常どおり `Ctrl+S`**．キャンバスからの書き戻しはバッファ編集
   のみで，ディスクへの保存はユーザーの判断に委ねられます．キャンバス側の
   未反映変更がある間，パネルタイトルに `●` が表示されます
5. 高品質な出力が必要になったら，コマンドパレットから
   **TikZ: Export as SVG / PNG** を実行し保存先を選択します．エクスポートは
   進捗通知つきで lualatex パイプライン全体を実行します

**単一ドキュメントモード**：パネルは常に，VSCode で現在開いている `.tikz`
ファイルだけを表示します．タブはなく，別の `.tikz` をアクティブにした状態で
再度コマンドを実行するとパネルがそのファイルに切り替わります（前回
セッションから復元されたドキュメントは閉じられます）．VSCode 外でディスク上
のファイルが変更された場合もファイルウォッチャで検知されます．

### 5.5 設定

設定は **TikZ Preview (tikzc)**（`tikzc.*`）配下にあり，**エクスポート**
パイプラインに適用されます：

| 設定 | 型 / デフォルト | 説明 |
|---|---|---|
| `tikzc.mainfont` | string，`""` | CJK ラベル用 fontspec メインフォント（空 = `IPAexMincho`） |
| `tikzc.extraPackages` | string[]，`[]` | すべての図に適用する追加の `\usepackage` |
| `tikzc.extraLibraries` | string[]，`[]` | すべての図に適用する追加の `\usetikzlibrary` |
| `tikzc.pngDpi` | number，`300` | PNG エクスポートの解像度 |
| `tikzc.debounceMs` | number，`400` | *宣言のみで現行バージョンでは未使用*（旧プレビュー版の名残） |

CLI と同様に，ソースの `#|` ヘッダはこれらの設定より優先されます．

### 5.6 描画エンジンとその限界

即時プレビューのキャンバスは tikz-editor の TikZ パーサを使っており，
**TikZ のサブセット**をサポートします：decorations / graphs / plots は部分
対応で，外部パッケージ（例：`circuitikz`）は描画されません．キャンバスは
高速でインタラクティブな近似表示であり，**エクスポートは常に正確**です
（本物の lualatex でコンパイルするため）．キャンバスと lualatex の結果が
食い違う場合はエクスポート側を信頼してください．

ラベル内の数式は webview 内で MathJax により描画されます．

### 5.7 ログと診断

- 出力チャネル **"TikZ Editor (tikzc)"**（表示 → 出力）に拡張ホストと
  webview のログ（RPC の失敗を含む）が表示されます
- 同じログが OS の一時ディレクトリの `tikzc-webview.log` にも追記されます
- 直近の lualatex ログはメモリに保持され，webview からのコンパイル /
  エクスポート後にエディタの「ログ表示」機能から参照できます
- エクスポート失敗時は，抽出された LaTeX エラーが VSCode のエラー通知に
  表示されます

### 5.8 アーキテクチャ（詳しく知りたい人向け）

```text
vscode-extension/
├── tikzc-editor/      ベンダリングした tikz-editor（WYSIWYG エディタ本体．MIT，無改変）
├── webview/           tikz-editor の App を VSCode webview で動かすブートストラップ +
│                      EditorPlatform アダプタ（ファイル同期・ダイアログ・クリップボード・
│                      lualatex ブリッジ）
├── src/extension.ts   拡張ホスト：webview との RPC，.tikz TextDocument との双方向同期，
│                      lualatex エクスポート（../src/core.ts を共有）
└── vite.config.ts     webview バンドルのビルド（エイリアスで tikz-editor ソースを直接解決 +
                       VSCode 版で使わない機能のビルド時スタブ差し替え）
```

- webview と拡張ホストは小さな RPC プロトコル（`rpc` / `notify` /
  `rpc-result` メッセージ）で通信します．ホスト側はリンクファイルの
  読み書き（`.tikz` TextDocument にマッピング），ファイルダイアログ，
  クリップボード，メッセージボックス，永続化（VSCode `globalState`），
  および `src/core.ts` への `latex.check` / `latex.compile` ブリッジを
  実装しています
- キャンバスからの書き戻しは `linked.write` を経由します：ドキュメントが
  VSCode で開かれていればバッファへの WorkspaceEdit になり（黙って
  ディスクに書くことはありません），開かれていなければファイルへ直接
  書き込みます
- ベンダリングした tikz-editor のソースは**無改変**です．
  `vite.config.ts` が，VSCode の単一ドキュメント・キャンバス専用モードで
  使わない部分（CodeMirror ソースパネル，タブストリップ，AI アシスタント
  パネル，サムネイル Web Worker，PowerPoint / IPE インポート，ホバー
  ドキュメント）をビルド時スタブに差し替えます．上流のコミットは
  `tikzc-editor/UPSTREAM.md` を参照し，ベンダコピーの更新は
  `./scripts/update-tikz-editor.sh` で行います

---

## 6. トラブルシューティング

**`lualatex compilation failed: ! LaTeX Error: File 'xxx.sty' not found`**
TeX 環境にパッケージが不足しています．TeX Live なら
`tlmgr install <package>` で導入してください（MiKTeX は自動導入されます）．

**fontspec が `IPAexMincho` を見つけられない**
TeX ディストリビューションが IPAex フォントを含まない最小構成です．
フォントを導入するか，`#| mainfont:` / `--mainfont` / `tikzc.mainfont` で
OS フォントを指定してください（[2 節](#日本語cjkフォントについて)参照）．

**`cannot read <file>`（終了コード 2）**
入力パスが存在しないか読み取れません．

**ターミナルではエクスポートできるのに VSCode からは失敗する**
VSCode がシェルの PATH を継承していない可能性があります（macOS で Dock
から起動した場合に典型的）．ターミナルから `code` で VSCode を起動するか，
TeX の bin ディレクトリを GUI アプリからも見えるようにしてください．

**キャンバスの描画が正しくない / 何も表示されない**
即時プレビューは TikZ のサブセットのみをサポートします
（[5.6 節](#56-描画エンジンとその限界)）．**TikZ: Export as SVG** を実行して
本物の lualatex で確認してください．エクスポートが正しければソースは
正しいということです．

**一時ファイルはどこへ？**
コンパイルは使い捨ての一時ディレクトリで実行されます．生成された `.tex` を
残すには CLI の `--keep-tex` を使い，拡張機能の問題は出力チャネル /
`tikzc-webview.log`（[5.7 節](#57-ログと診断)）を確認してください．

---

## 7. アンインストール

```sh
# VSCode 拡張機能（拡張 ID は publisher.name）
code --uninstall-extension RyoNak.tikzc-preview

# CLI（npm link した場合のみ）
npm unlink -g tikzc

# 依存パッケージはリポジトリ内に閉じている
rm -rf node_modules vscode-extension/node_modules
# Windows (PowerShell): Remove-Item -Recurse -Force node_modules, vscode-extension/node_modules
```

---

## 8. 開発

```sh
npm run check          # 型チェック（ルートと vscode-extension を別々に）
npm run build          # CLI のビルド（dist/tikzc.cjs）
npm test               # テスト実行（tsx --test tests/*.test.ts）

cd vscode-extension
npm run check          # 拡張ホスト + webview の型チェック
npm run build          # 拡張ホスト（esbuild）+ webview（Vite）のビルド
npm run package        # ビルド + .vsix の生成
```

[TESTING.md](TESTING.md) と [BRANCH_STRATEGY.md](BRANCH_STRATEGY.md) も
参照してください．

---

## 9. ライセンス

[MIT](../LICENSE)．ベンダリングしている
[tikz-editor](https://github.com/DominikPeters/tikz-editor)
（`vscode-extension/tikzc-editor/`，Dominik Peters 氏ほか）も MIT
ライセンスです．
