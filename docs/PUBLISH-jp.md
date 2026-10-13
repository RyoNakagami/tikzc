---
author: "Ryo Nakagami"
date-modified: "2026-10-13"
project: tikzc
---

# VSCode Marketplace への公開手順

対象は `vscode-extension/`（拡張ID: `RyoNak.tikzc-preview`）．VSIX は全プラットフォーム共通で，Rust CLI を含まない．
利用者が `cargo install` で `tikzc` を別途導入する．CLI 単体の配布は本手順の対象外．

## 1. 事前準備（初回のみ）

1. [Azure DevOps](https://dev.azure.com/) アカウントを作成する
2. [Marketplace publisher 管理ページ](https://marketplace.visualstudio.com/manage) で publisher を作成する
   - publisher ID は `vscode-extension/package.json` の `"publisher": "RyoNak"` と一致させること
3. Azure DevOps で Personal Access Token (PAT) を発行する
   - User settings → Personal Access Tokens → New Token
   - Organization: **All accessible organizations**
   - Scopes: Custom defined → **Marketplace → Manage**
4. vsce にログインする（PAT を入力）

   ```sh
   cd vscode-extension
   npx vsce login RyoNak
   ```

## 2. リリース準備

1. リポジトリルートで，プロジェクト・Rust CLI・npm／拡張のバージョンを一括更新する

   ```sh
   devtools/bump-version.sh <version>
   devtools/bump-version.sh --check
   cargo build --release --locked
   target/release/tikzc --version
   ```

   npm の両 lockfile と `Cargo.lock` のローカル `tikzc` エントリも更新される．Rust CLI の表示バージョンへの反映には再ビルドが必要．
2. `CHANGELOG.md` に当該バージョンのエントリを追加する
3. チェックとテストを通す（拡張のテストには手順 1 でビルドした release バイナリが必要）

   ```sh
   cargo test --locked
   cd vscode-extension
   npm ci
   npm run check && npm run test
   ```

## 3. パッケージと動作確認

```sh
npm run package        # build (esbuild) → vsce package --no-dependencies
code --install-extension dist/packages/tikzc-preview-<version>.vsix
```

`.tikz` を開いてプレビュー・エクスポートが動くことを確認する（[docs/TESTING.md](TESTING.md) 参照）．

## 4. 公開

動作確認した `.vsix` をそのまま公開する：

```sh
npx vsce publish --packagePath dist/packages/tikzc-preview-<version>.vsix
```

> [!NOTE]
> `vsce publish` を単体で使う場合は，esbuild でバンドル済みのため必ず `--no-dependencies` を付ける（`npm run build` を先に実行すること）．

## 5. 公開後

1. [Marketplace の管理ページ](https://marketplace.visualstudio.com/manage) で検証ステータスを確認する（反映まで数分かかる）
2. Marketplace 経由でインストールして最終確認する

   ```sh
   code --uninstall-extension RyoNak.tikzc-preview
   code --install-extension RyoNak.tikzc-preview
   ```

3. リリースタグを作成する．`release` ラベル付きのリリース PR を `main` にマージすると，[`release-to-main.yml`](../.github/workflows/release-to-main.yml) が `v<version>` タグと GitHub Release を自動作成する．`Manually create release tag` workflow でも同じ処理を手動実行できる．どちらも `CHANGELOG.md` の `## [<version>]` 節を必要とする．タグを手動で重ねて push しない．

## トラブルシューティング

- **401 Unauthorized**: PAT の期限切れ．再発行して `npx vsce login RyoNak` をやり直す
- **公開の取り下げ**: `npx vsce unpublish RyoNak.tikzc-preview`（原則使わず，修正版の patch リリースで対応する）
