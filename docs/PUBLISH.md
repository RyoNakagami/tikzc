---
author: "Ryo Nakagami"
date-modified: "2026-07-10"
project: tikzc
---

# Publishing to the VSCode Marketplace

This applies to `vscode-extension/` (extension ID: `<your-id>.tikzc-preview`). The
CLI itself (`tikzc` at the repository root) is managed via npm and is out of
scope here.

## 1. Prerequisites (first time only)

1. Create an [Azure DevOps](https://dev.azure.com/) account
2. Create a publisher on the [Marketplace publisher management page](https://marketplace.visualstudio.com/manage)
   - The publisher ID must match `"publisher": "<your-id>"` in `vscode-extension/package.json`
3. Create a Personal Access Token (PAT) in Azure DevOps
   - User settings → Personal Access Tokens → New Token
   - Organization: **All accessible organizations**
   - Scopes: Custom defined → **Marketplace → Manage**
4. Log in to vsce (enter the PAT when prompted)

   ```sh
   cd vscode-extension
   npx vsce login <your-id>
   ```

## 2. Release preparation

1. Align the version in all three places: `VERSION`, the root `package.json`,
   and `vscode-extension/package.json`
2. Add an entry for the release to `CHANGELOG.md`
3. Make sure checks and tests pass

   ```sh
   cd vscode-extension
   npm install
   npm run check && npm run test
   ```

## 3. Package and verify

```sh
npm run package        # build (esbuild + vite) → vsce package --no-dependencies
code --install-extension tikzc-preview-<version>.vsix
```

Open a `.tikz` file and confirm that the preview and the export commands work
(see [docs/TESTING.md](TESTING.md)).

## 4. Publish

Publish the exact `.vsix` you just verified:

```sh
npx vsce publish --packagePath tikzc-preview-<version>.vsix
```

> [!NOTE]
> If you use `vsce publish` on its own, always pass `--no-dependencies`
> (dependencies are bundled by esbuild/vite) and run `npm run build` first.

## 5. After publishing

1. Check the verification status on the [Marketplace management page](https://marketplace.visualstudio.com/manage)
   (it takes a few minutes to propagate)
2. Install from the Marketplace and do a final check

   ```sh
   code --uninstall-extension <your-id>.tikzc-preview
   code --install-extension <your-id>.tikzc-preview
   ```

3. Tag the release and push the tag

   ```sh
   git tag v<version> && git push origin v<version>
   ```

## Troubleshooting

- **401 Unauthorized**: the PAT has expired. Create a new one and run
  `npx vsce login <your-id>` again
- **Withdrawing a release**: `npx vsce unpublish <your-id>.tikzc-preview`
  (avoid this in principle; ship a fixed patch release instead)
