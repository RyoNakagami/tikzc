# tikzc ユーザーマニュアル

tikzc は，`.tikz` ファイルを Rust 製のエンジンで SVG / PNG に描画します．
実行時に TeX もネットワークも必要ありません．本マニュアルは次の2つを解説します．

1. **`tikzc` CLI** — `.tikz` ファイルを SVG / PNG にコンパイルするコマンド
2. **VSCode 拡張機能（`tikzc-preview` / "TikZc Editor"）** — キャンバス編集つきの
   ライブプレビューと，CLI と一致する SVG / PNG エクスポート

English version: [MANUAL.md](MANUAL.md)

## 目次

- [1. 概要](#1-概要)
- [2. インストール](#2-インストール)
- [3. `.tikz` ソースの書式](#3-tikz-ソースの書式)
- [4. CLI リファレンス](#4-cli-リファレンス)
- [5. VSCode 拡張機能](#5-vscode-拡張機能)
- [6. トラブルシューティング](#6-トラブルシューティング)
- [7. アンインストール](#7-アンインストール)
- [8. 開発](#8-開発)
- [9. ライセンス](#9-ライセンス)

## 1. 概要

```text
.tikz ──(構文解析，マクロとループの展開)──▶ 図
      ──(レイアウト．文字は Typst で組版)──▶ .svg   （字形はパス）
      └─(同じ SVG をラスタライズ)──────────▶ .png
```

- **文書化された TikZ のサブセットに対応します．** tikzc は TeX を実行しません．
  対応構文は[互換性の契約](RUST_ENGINE.md#native-compatibility-contract)にあります．
  未対応の構文は `file:line:column` 形式の診断で失敗し，別のレンダラーへの
  フォールバックはありません．
- **出力は自己完結しています．** 日本語・数式・アイコンのフォントを実行ファイルに
  埋め込み，字形を SVG パスとして書き出すため，どの環境でも同じ見た目になります．
- **LaTeX とは画素単位で一致しません．** フォントメトリクス，行分割，矢印の形は，
  同じソースを lualatex で組んだ結果と異なる場合があります．

## 2. インストール

Rust 1.92 以上（Windows では MSVC Build Tools も）を導入し，次を実行します．

```sh
cargo install --git https://github.com/RyoNakagami/tikzc tikzc --locked
# チェックアウトから：cargo install --path . --locked
tikzc --version        # tikzc <version>
```

初回ビルドでは Rust の依存をダウンロードし，約 15 MiB のフォントを埋め込みます．
VSCode 拡張機能は [5.1 節](#51-ビルドとインストール)を参照してください．

## 3. `.tikz` ソースの書式

`.tikz` ファイルは TikZ コードで，先頭に `#|` で始まるヘッダ行を置けます．

### 3.1 ヘッダオプション

```latex
#| mainfont: IPAexGothic
#| libraries: [arrows.meta, calc]
#| scale: 1.5
\begin{tikzpicture}
  \node[draw] (a) {入力};
  \node[draw, right=2cm of a] (b) {$y = f(x)$};
  \draw[->] (a) -- (b);
\end{tikzpicture}
```

| ヘッダ | 意味 |
| --- | --- |
| `mainfont` | ラベルのフォント．既定は `IPAexMincho`．同梱フォントは導入不要．それ以外はシステムにインストールされたフォントを読み，見つからなければ失敗する |
| `scale` | 図全体の拡大率．(0, 100] の範囲 |
| `libraries` | 図が使う TikZ ライブラリ．指定できるのは `arrows.meta`，`positioning`，`calc`，`shapes.geometric`，`backgrounds`，`fit`，`decorations.pathreplacing`，`patterns`，`matrix` |
| `packages` | 図が使うパッケージ．指定できるのは `amsmath`，`amssymb`，`fontawesome` |
| `filename`，`width`，`height` | 互換性のために受け付けるが無視する．出力サイズや出力先は変わらない |

ヘッダ行は先頭にまとめて書きます．ヘッダでない行が現れた時点で解析を終えます．
未知のヘッダキー，ライブラリ，パッケージはエラーになります．

### 3.2 オプションの優先順位

ソースの `#|` ヘッダは VSCode の設定（`tikzc.mainfont`，`tikzc.extraPackages`，
`tikzc.extraLibraries`）より優先されます．CLI にはフォントやライブラリを指定する
フラグがないため，ヘッダを使います．

### 3.3 裸の TikZ コード

`\begin{tikzpicture}…\end{tikzpicture}` 全体を書いても，描画コマンドだけを書いても
構いません．描画コマンドだけの場合は1つの図として扱います．

## 4. CLI リファレンス

### 4.1 書式

```sh
tikzc <file.tikz> [-o output.svg|output.png|directory] [-f svg|png|both]
tikzc check <file.tikz>
```

### 4.2 オプション一覧

| オプション | 説明 |
| --- | --- |
| `-o`，`--output <path>` | 出力ファイルまたは出力ディレクトリ |
| `-f`，`--format <format>` | `svg`，`png`，`both`．既定は `-o` の拡張子から推定し，なければ `svg` |
| `--dpi <number>` | PNG の解像度．既定は 150 |
| `-q`，`--quiet` | 進捗の1行を出力しない |
| `-V`，`--version` | バージョンを表示 |
| `-h`，`--help` | ヘルプを表示 |

`tikzc check` はファイルをコンパイルして対応可否だけを報告し，出力は書きません．

### 4.3 出力パスの解決規則

- `-o` がなければ，入力と同じ場所に形式の拡張子で出力します
  （`diagram.tikz` → `diagram.svg`）．
- `-o` が既存のディレクトリである，パス区切りで終わる，または形式が `both` の場合は，
  ディレクトリとして扱い，入力のファイル名を使います．
- それ以外は `-o` を出力ファイルとします．親ディレクトリがなければ作成します．
- 入力ファイルを上書きする出力先は指定できません．

SVG は背景が透明，PNG は背景が白です．すべての変換が終わってからファイルを
書くため，失敗した実行が既存の出力を置き換えることはありません．

### 4.4 終了コード

| コード | 意味 |
| --- | --- |
| 0 | 成功 |
| 1 | ラスタライズまたはファイル書き込みの失敗 |
| 2 | 使い方または入力の誤り：未知のオプション，不正な DPI や形式，読めない入力，入力と同じ出力先 |
| 3 | ソースが不正，または未対応の構文を使っている（`file:line:column: message`） |

## 5. VSCode 拡張機能

拡張機能（`RyoNak.tikzc-preview`，表示名 **TikZc Editor**）は，マシンにインストール
された `tikzc` を実行し，その SVG または PNG を表示します．エクスポートは
プレビューと同じ成果物を書き出します．キャンバス編集の詳細は
[拡張機能の README](../vscode-extension/README.md) を参照してください．

### 5.1 ビルドとインストール

先に `tikzc` をインストールしてください（[2 節](#2-インストール)）．VSIX には
実行ファイルが含まれません．

```sh
cd vscode-extension
npm ci
npm run package        # 拡張機能をビルドし .vsix を生成
code --install-extension "dist/packages/tikzc-preview-$(cat ../VERSION).vsix"
```

> macOS で `code` コマンドが見つからない場合は，VSCode のコマンドパレットで
> "Shell Command: Install 'code' command in PATH" を実行してください．

拡張機能は `.tikz` ファイルを開いたときにアクティベートされます．`tikzc` は PATH から
探し，`tikzc.nativePath` を設定した場合はそのパスを使います．実行ファイルと拡張機能の
major.minor バージョンが異なる場合は警告を表示します．

### 5.2 コマンドとキーバインド

| コマンドパレット表示 | ID | 利用条件 |
| --- | --- | --- |
| **TikZc Editor: Open to the Side** | `tikzc.showPreview` | アクティブエディタが `.tikz`．エディタタイトルバーのアイコンからも起動可 |
| **TikZc Editor: Export (SVG / PNG)** | `tikzc.export` | アクティブエディタが `.tikz` |

デフォルトキーバインド：`Ctrl+K V`（macOS は `Cmd+K V`）で現在のエディタの
横にプレビューを開きます．

### 5.3 基本的な使い方

1. VSCode で `.tikz` ファイルを開く
2. タイトルバーのアイコンまたは `Ctrl+K V` でプレビューを開く
3. どちら側からでも編集できます：
   - テキストエディタで TikZ コードを入力 → 未保存のバッファが
     `tikzc.debounceMs` 経過後に再コンパイルされる
   - キャンバス上で編集（ラベル，移動，重なり順，図形の追加，矢印の編集点）→
     変更をコンパイルして検証したうえで，バッファへ1回の Undo 可能な編集として
     適用される
4. **保存は通常どおり `Ctrl+S`**．キャンバスでの編集はバッファを変更するだけです
5. **TikZc Editor: Export (SVG / PNG)**（またはプレビューの **エクスポート…** ボタン）を実行し，SVG / PNG を選んで保存先を選択する（既定はワークスペースルート）

プレビューはアクティブな `.tikz` エディタに追従します．エラーはソース位置つきで
表示されます．

### 5.4 設定

設定は **TikZc Editor (tikzc)**（`tikzc.*`）配下にあり，プレビューとエクスポートの
両方に適用されます：

| 設定 | 型 / デフォルト | 説明 |
| --- | --- | --- |
| `tikzc.nativePath` | string，`""` | `tikzc` 実行ファイルのパス（空 = PATH 上の `tikzc`）．マシン単位の設定 |
| `tikzc.mainfont` | string，`""` | ラベルの既定フォント（空 = `IPAexMincho`） |
| `tikzc.extraPackages` | string[]，`[]` | 追加パッケージ．tikzc が受け付けるものに限る |
| `tikzc.extraLibraries` | string[]，`[]` | 追加の TikZ ライブラリ．tikzc が受け付けるものに限る |
| `tikzc.pngDpi` | number，`300` | PNG プレビューとエクスポートの解像度 |
| `tikzc.debounceMs` | number，`400` | 最後の入力からプレビューを再コンパイルするまでの待ち時間 |
| `tikzc.language` | `en` \| `ja`，`en` | プレビューのツールバーとメッセージの言語．プレビューのツールバーからも切り替え可能 |

## 6. トラブルシューティング

**`tikzc … is older than 1.0.0`**
拡張機能は 1.0.0 以上の `tikzc` をすべて受け付けます．PATH 上の `tikzc` が 0.x
（初期の Rust ビルド，または TeX ベースの npm 版 CLI）です．npm 版があれば削除し
（`npm unlink -g tikzc`），現行の Rust 版をインストールしてください
（[2 節](#2-インストール)）．または `tikzc.nativePath` に 1.0.0 以上の実行ファイル
（例：`~/.cargo/bin/tikzc`）を設定します．

**`Cannot run Rust tikzc` と表示される／ターミナルでは動くのに VSCode では動かない**
VSCode がシェルの PATH を継承していない可能性があります（macOS で Dock から
起動した場合に典型的）．`tikzc.nativePath` を設定するか，ターミナルから `code` で
VSCode を起動してください．

**`Unsupported …` などの `file:line:column` 形式の診断が出る**
ソースが対応範囲外の構文を使っています．
[互換性の契約](RUST_ENGINE.md#native-compatibility-contract)を確認して該当箇所を
書き換えるか，[機能追加の進め方](FEATURE_WORKFLOW.md)に沿って対応を依頼してください．

**フォントが見つからないと報告される**
同梱されていない `mainfont` はシステムへのインストールが必要です．どの環境でも
描画できる図にするには，同梱フォント（IPAexMincho，IPAexGothic）を使ってください．
Noto Sans CJK Regular/Bold は同梱していません．`mainfont: Noto Sans CJK JP` を
指定した図には，そのフォントのシステムへのインストールが必要です．

**バージョン不一致の警告が出続ける**
インストール済みの `tikzc` と拡張機能の major.minor バージョンが異なります．
上記の `cargo install` で `tikzc` を入れ直し，同じチェックアウトから VSIX を
作り直してください．

## 7. アンインストール

```sh
# VSCode 拡張機能（拡張 ID は publisher.name）
code --uninstall-extension RyoNak.tikzc-preview

# cargo install で入れた CLI
cargo uninstall tikzc

# tikzc 0.x の npm 版 CLI が残っている場合
npm unlink -g tikzc
```

## 8. 開発

```sh
cargo fmt --all --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked            # レンダラーと CLI
cargo build --release --locked # 拡張機能のテストに必要

npm ci && npm run check && npm test   # 開発ツール（devtools）のテスト

cd vscode-extension
npm ci
npm run check          # 拡張ホスト，webview スクリプト，テストの型チェック
npm test               # プレビュー，エクスポート，キャンバス編集のテスト
npm run package        # ビルド + .vsix の生成
```

[TESTING.md](TESTING.md)，[REPOSITORY_STRUCTURE.md](REPOSITORY_STRUCTURE.md)，
[BRANCH_STRATEGY.md](BRANCH_STRATEGY.md) も参照してください．

## 9. ライセンス

[MIT](../LICENSE)．埋め込みフォントのライセンス表示は
[`assets/fonts/`](../assets/fonts/README.md) にあります．
