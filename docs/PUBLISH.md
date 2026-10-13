---
author: "Ryo Nakagami"
date-modified: "2026-10-13"
project: tikzc
---

# Publishing to the VSCode Marketplace

This applies to `vscode-extension/` (extension ID: `RyoNak.tikzc-preview`). The
VSIX is platform-independent and does not contain the Rust CLI; users install
`tikzc` themselves with `cargo install`. Standalone CLI distribution is out of
scope here.

## 1. Prerequisites (first time only)

1. Create an [Azure DevOps](https://dev.azure.com/) account
2. Create a publisher on the [Marketplace publisher management page](https://marketplace.visualstudio.com/manage)
   - The publisher ID must match `"publisher": "RyoNak"` in `vscode-extension/package.json`
3. Create a Personal Access Token (PAT) in Azure DevOps
   - User settings → Personal Access Tokens → New Token
   - Organization: **All accessible organizations**
   - Scopes: Custom defined → **Marketplace → Manage**
4. Log in to vsce (enter the PAT when prompted)

   ```sh
   cd vscode-extension
   npx vsce login RyoNak
   ```

## 2. Release preparation

1. Synchronize the project, Rust CLI and npm/extension versions from the repository root:

   ```sh
   devtools/bump-version.sh <version>
   devtools/bump-version.sh --check
   cargo build --release --locked
   target/release/tikzc --version
   ```

   This also updates both npm lockfiles and the local `tikzc` entry in
   `Cargo.lock`. Rebuilding embeds the updated version into the native CLI.
2. Add an entry for the release to `CHANGELOG.md`
3. Make sure checks and tests pass (the extension tests need the release
   binary built in step 1)

   ```sh
   cargo test --locked
   cd vscode-extension
   npm ci
   npm run check && npm run test
   ```

## 3. Package and verify

```sh
npm run package        # build (esbuild) → vsce package --no-dependencies
code --install-extension dist/packages/tikzc-preview-<version>.vsix
```

Open a `.tikz` file and confirm that the preview and the export commands work
(see [docs/TESTING.md](TESTING.md)).

## 4. Publish

Publish the exact `.vsix` you just verified:

```sh
npx vsce publish --packagePath dist/packages/tikzc-preview-<version>.vsix
```

> [!NOTE]
> If you use `vsce publish` on its own, always pass `--no-dependencies`
> (the extension is bundled by esbuild) and run `npm run build` first.

## 5. After publishing

1. Check the verification status on the [Marketplace management page](https://marketplace.visualstudio.com/manage)
   (it takes a few minutes to propagate)
2. Install from the Marketplace and do a final check

   ```sh
   code --uninstall-extension RyoNak.tikzc-preview
   code --install-extension RyoNak.tikzc-preview
   ```

3. Tag the release. Merging the release PR into `main` with the `release`
   label creates the `v<version>` tag and the GitHub Release automatically
   ([`release-to-main.yml`](../.github/workflows/release-to-main.yml)); the
   `Manually create release tag` workflow does the same on demand. Both require
   a `## [<version>]` section in `CHANGELOG.md`. Do not push the tag by hand as
   well.

## Troubleshooting

- **401 Unauthorized**: the PAT has expired. Create a new one and run
  `npx vsce login RyoNak` again
- **Withdrawing a release**: `npx vsce unpublish RyoNak.tikzc-preview`
  (avoid this in principle; ship a fixed patch release instead)
