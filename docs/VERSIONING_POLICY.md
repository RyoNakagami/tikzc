---
date-modified: "2026-10-13"
project: tikzc
---

# Versioning Policy

- Versioning of `tikzc` follows [Semantic Versioning](https://semver.org/)
- Release numbers are managed in the `MAJOR.MINOR.PATCH` format

## Updating and checking versions

[`VERSION`](../VERSION) is the canonical project version. From any working
directory, invoke [`devtools/bump-version.sh`](../devtools/bump-version.sh)
by its path, with the intended version or `--check`:

```sh
devtools/bump-version.sh 1.0.1
devtools/bump-version.sh --check
cargo build --release --locked
target/release/tikzc --version
```

The update/check targets are shared in `devtools/bump-version.mjs`:

| File | Managed field |
| --- | --- |
| `VERSION` | Canonical version |
| `Cargo.toml` | `[package].version` |
| `Cargo.lock` | Local `tikzc` package version |
| `package.json`, `vscode-extension/package.json` | Root `version` |
| `package-lock.json`, `vscode-extension/package-lock.json` | Root `version` and `packages[""].version` |

The script accepts SemVer, including prerelease/build metadata and an optional
leading `v`. All target version fields are read and validated before updates.
`--check` writes nothing and exits 1 for mismatches or missing/invalid fields.
The current Cargo layout uses an explicit package version; workspace-inherited
versions require updating the registry/parser before changing that layout.

Dependency versions, `rust-version`, Cargo's lockfile format version,
historical changelog entries, and diagrams of previous releases are
independent and are not updated. Documentation refers
to `VERSION` or reads it in commands instead of repeating the current release.
Add the release notes to `CHANGELOG.md` separately.

Updating metadata does not rewrite existing binaries or archives. Rebuild (or
reinstall) the release CLI to embed the new version, and rerun the extension's
`npm run package` to produce a VSIX carrying the new version. The VSIX does not
contain the native executable; the extension warns when the installed `tikzc`
differs from its own major.minor version. The updater itself needs only Bash
and Node.js; it does not run Cargo, npm or Git.

## MAJOR.MINOR.PATCH

| Release Type | Main Contents | Backward Compatibility | Typical Example |
| :-------------- | :---------- | :------------ | :------------ |
| **Major Release** | - Backward-incompatible changes (breaking changes)<br>- Removal of deprecated features<br>- API updates involving specification changes<br>- Changes included in a major release are recorded in the **Release Note** | ❌ No | `v1.0.0 → v2.0.0` |
| **Minor Release** | - Addition of new features<br>- Large-scale bug fixes<br>- Deprecation announcements | ✅ Yes | `v1.1.0 → v1.2.0` |
| **Patch Release** | - Bug fixes<br>- Stability and performance improvements (non-breaking)<br>- Guarantees that existing code continues to work without issues | ✅ Yes | `v1.2.1 → v1.2.2` |

---

### Deprecation Policy

`tikzc` handles deprecation according to the following policy.

1. Deprecations are announced in a **Minor Release**.
2. Warning messages explicitly state the following two points:
   - The replacement (replacement method / attribute)
   - The version in which removal will be enforced (e.g., `will be removed in 2.0.0`)
3. After the announcement, the deprecated feature continues to work within the same major version (`1.x`).
4. Removal takes place in the next **Major Release** (`2.0.0`).

---

### Example: Deprecation Flow

| Version | Status | Description |
| :----------- | :------ | :------ |
| `1.2.0` | 🔔 Announcement | Deprecate the function `old_method()`. Point users to `new_method()` as the replacement. |
| `1.3.0` | ⚠ Continued warning | Still works, with a warning. Migration recommended. |
| `2.0.0` | ⛔ Removal | Remove `old_method()` completely. |

---

## References

- [Semantic Versioning](https://semver.org/)
- [Python Package Building Techniques for Regmonkeys > Versioning Policy](https://ryonakagami.github.io/python-statisticalpackage-techniques/posts/python-packaging-guide/versioning.html)
