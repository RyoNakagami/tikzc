# TikZc Editor の名称変更

VSCode 拡張機能の名称を変更する開発者向けに，表示箇所と変更するファイル，
ビルドからローカル環境への反映までをまとめる．現在の表示名は **TikZc Editor**．

## 拡張機能の表示名

拡張機能一覧に表示する名称は，
[`vscode-extension/package.json`](../vscode-extension/package.json) の `displayName` で指定する．
表示名だけを変える場合は，この項目を変更する．

```json
"displayName": "TikZc Editor"
```

タブ名・画面内の見出し・コマンド名には個別の文字列が設定されている．
`displayName` の変更だけでは，それらの表記は更新されない．

## 画面全体の表記を揃える箇所

以下のパスはリポジトリルートを基準とする．行番号は実装変更で動くため，
表中の項目名・関数名を検索して変更する．

| 表示箇所 | ファイル | 変更する項目・文字列 |
|---|---|---|
| 拡張機能一覧 | [`vscode-extension/package.json`](../vscode-extension/package.json) | `displayName`：`TikZc Editor` |
| コマンドパレット | 同上 | `contributes.commands[].title`：`TikZc Editor: Open to the Side`，`TikZc Editor: Export (SVG / PNG)` など |
| 設定画面のグループ名 | 同上 | `contributes.configuration.title`：`TikZc Editor (tikzc)` |
| プレビューのタブ名 | [`vscode-extension/src/preview/preview.ts`](../vscode-extension/src/preview/preview.ts) | `createWebviewPanel` のタイトル引数と，`refresh()` 内の `panel.title`：`TikZc Editor: <ファイル名>` |
| プレビュー上部の見出し | [`vscode-extension/src/preview/preview-html.ts`](../vscode-extension/src/preview/preview-html.ts) | `buildPreviewHtml()` の `<header><strong>TikZc Editor</strong>` |

プレビューのタブ名は，作成直後とファイル表示更新時の両方で設定される．
`createWebviewPanel` と `panel.title` を合わせて変更する．

利用手順の表記も，次のファイルで確認する．

- [README.md](../README.md)
- [拡張機能の README](../vscode-extension/README.md)
- [英語マニュアル](MANUAL.md)／[日本語マニュアル](MANUAL-jp.md)

## 表示名と識別子

現在の名称・識別子は次のとおり．表示名の変更では，既存のインストール，
キーバインド，設定を引き継ぐために識別子を維持する．

| 用途 | 現在の値 | 定義箇所 |
|---|---|---|
| 表示名 | `TikZc Editor` | 拡張の `package.json` の `displayName` |
| 拡張のパッケージ名 | `tikzc-preview` | 同ファイルの `name` |
| Publisher | `RyoNak` | 同ファイルの `publisher` |
| 拡張 ID | `RyoNak.tikzc-preview` | `publisher` と `name` の組み合わせ |
| コマンド ID | `tikzc.showPreview`，`tikzc.export` | `contributes.commands[].command` |
| 設定キー | `tikzc.*` | `contributes.configuration.properties` |
| プレビューの webview 識別子 | `tikzcNativePreview` | `preview.ts` の `createWebviewPanel` 第1引数 |
| CLI コマンド | `tikzc` | Rust CLI |

VSIX のファイル名もパッケージ名に基づくため，表示名変更後も
`tikzc-preview-<version>.vsix` となる．`name` や `publisher` を変更する場合は，
拡張 ID と配布手順への影響を含む別の変更として扱う．

## 確認とローカル環境への反映

表記の確認には，リポジトリルートで次の検索を使う．

```sh
rg -n 'TikZc Editor|TikZc Preview|Rust TikZ Preview|TikZ Preview|Local TikZ Editor' \
  vscode-extension/package.json vscode-extension/src vscode-extension/webview \
  vscode-extension/README.md README.md docs
```

このドキュメントなどに残る旧名称の説明と，実際の画面表示に使う文字列を確認する．

依存関係を導入済みの開発環境で，リポジトリルートから次を実行する．

```sh
cd vscode-extension
npm run check
npm run package
tikzc_version=$(cat ../VERSION)
code --install-extension "dist/packages/tikzc-preview-${tikzc_version}.vsix" --force
```

`npm run check` は型検査，`npm run package` は拡張機能のビルドと VSIX 作成を行う．名称変更だけで Rust の処理を変更していなければ，
Rust 実行ファイルの再ビルド・再インストールは不要．

インストール後は VSCode のコマンドパレットで **Developer: Reload Window** を実行し，
次の表示を確認する．

1. 拡張機能一覧の表示名が `TikZc Editor` になっている．
2. コマンドパレットに `TikZc Editor: Open to the Side` が表示される．
3. `.tikz` を開くと，タブ名と画面上部の見出しに新しい名称が表示される．
4. 設定画面に意図した名称が表示される．

Marketplace への公開とバージョン更新は，[公開手順](PUBLISH-jp.md)と
[バージョニング方針](VERSIONING_POLICY.md)に従う．
