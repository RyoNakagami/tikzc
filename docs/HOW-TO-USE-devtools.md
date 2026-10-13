---
date-modified: "2026-10-13"
project: tikzc
---

# Development Tools

The scripts in [`devtools/`](../devtools/) support development and release
work. They are not part of any product build and are not shipped with the CLI
or the VS Code extension.

| Script | Purpose | Writes to |
| --- | --- | --- |
| [`bump-version.sh`](../devtools/bump-version.sh) | Entry point for the version tool. Forwards its arguments to `bump-version.mjs` | (see below) |
| [`bump-version.mjs`](../devtools/bump-version.mjs) | Synchronizes or checks the project version across `VERSION`, manifests and lockfiles | Version fields of the managed files |
| [`compare-desktop.mjs`](../devtools/compare-desktop.mjs) | Renders a local set of diagrams with two `tikzc` executables and builds a side-by-side gallery | `target/` only |

All scripts require Node.js. `compare-desktop.mjs` also requires `rg`
(ripgrep) on `PATH`.

## `bump-version.sh` / `bump-version.mjs`

Sets the project version, or checks that every managed file agrees with
[`VERSION`](../VERSION). The policy behind it is described in
[VERSIONING_POLICY.md](VERSIONING_POLICY.md).

```sh
devtools/bump-version.sh <version>   # set the version everywhere
devtools/bump-version.sh --check     # verify, write nothing
devtools/bump-version.sh --help
```

`bump-version.sh` is a thin Bash wrapper that resolves the repository root from
its own location, so it can be invoked from any working directory. Where Bash
is not available (and in CI), run the Node script directly:

```sh
node devtools/bump-version.mjs --check
```

### Arguments

Exactly one argument is accepted.

| Argument | Behavior |
| --- | --- |
| `<version>` | SemVer such as `1.0.1` or `1.1.0-rc.1`, with optional build metadata. A leading `v` is stripped |
| `--check` | Compares every managed field with `VERSION`. Exits 1 on a mismatch or a missing/invalid field |
| `-h`, `--help` | Prints usage |

### Managed files

| File | Managed field |
| --- | --- |
| `VERSION` | Canonical version |
| `Cargo.toml` | `[package].version` of `tikzc` |
| `Cargo.lock` | Version of the local `tikzc` package (the `[[package]]` without `source`) |
| `package.json`, `vscode-extension/package.json` | Root `version` |
| `package-lock.json`, `vscode-extension/package-lock.json` | Root `version` and `packages[""].version` |

Updating and checking share one target list (`targets` in `bump-version.mjs`),
so the two modes cannot drift apart. To manage another file, add it there.

### Behavior

- Every target is read and validated before the first write. A missing file,
  malformed JSON or an unsupported version layout aborts the run without a
  partial bump.
- Edits are limited to the version fields. In `package.json` and the Cargo
  files only the version string is replaced, so formatting and comments are
  kept. `package-lock.json` is re-serialized with two-space indentation.
- Dependency versions are never changed, and `Cargo.lock` is not regenerated.
- No npm, Cargo or Git command is run. `CHANGELOG.md` is not edited.
- The Cargo parser expects an explicit `version = "..."` in the `tikzc`
  package table. A workspace-inherited version needs a parser change first.

### After a bump

1. Add the release entry to `CHANGELOG.md`.
2. Run `devtools/bump-version.sh --check`.
3. Rebuild with `cargo build --release --locked`; the binary's `--version`
   output only changes after a rebuild.
4. Verify with `target/release/tikzc --version` (`tikzc.exe` on Windows).
5. Review `git diff`.

The tool is covered by `tests/devtools/bump-version.test.ts` (root `npm test`),
and the `native-rust.yml` workflow runs the `--check` mode.

## `compare-desktop.mjs`

An opt-in, local audit that compares two `tikzc` executables over a corpus of
real diagrams: a reference and the build under test. Use it to see what a
change does to existing diagrams. It is not run by `cargo test`, `npm test` or
CI. See also [TESTING.md](TESTING.md).

The script itself is covered by `tests/devtools/compare-desktop.test.ts` (root
`npm test`), which runs it on a temporary corpus with stand-in executables.

```sh
# Keep a copy of the current build as the reference
cargo build --release --locked
cp target/release/tikzc target/tikzc-before

# After implementation changes
cargo build --release --locked
node devtools/compare-desktop.mjs --root /path/to/diagrams \
  --reference target/tikzc-before \
  --out target/desktop-comparison/after
```

### Options

| Option | Default | Description |
| --- | --- | --- |
| `--root <dir>` | The author's Desktop directory | Directory searched recursively for `*.tikz`. Always pass this explicitly |
| `--out <dir>` | `target/desktop-comparison/baseline` | Output directory. Must be inside this repository's `target/`; anything else is rejected |
| `--native <path>` | `target/release/tikzc` | Executable under test |
| `--reference <cmd>` | `tikzc` on `PATH` | Executable to compare against |
| `--reuse-reference <results.json>` | none | Reuses the reference results of an earlier run for inputs with the same SHA-256, and renders only the rest |

Options are not validated, and there is no `--help`: an unknown option is
ignored silently.

### What it does

1. Lists `*.tikz` files under `--root` with `rg`, including hidden and
   git-ignored files, and excluding `.git`, `node_modules` and `target`.
2. Deduplicates files with identical SHA-256 content. Each unique file is one
   case; the first path is the one rendered.
3. Runs both executables on each case as
   `<binary> <input> -f both -o <dir> --dpi 150 -q`, two cases at a time. Each
   process is killed, with its process group, after 30 seconds.
4. Records the exit code, elapsed time, captured output, PNG dimensions and
   SVG size, and saves `results.json` after every case.
5. Re-hashes all inputs at the end and fails if any changed during the run.
6. Writes the summary, the metrics and the HTML gallery.

### Output

| Path under `--out` | Content |
| --- | --- |
| `results.json` | Versions of both executables, SHA-256 of the native binary, all cases, `summary` and `externalMetrics` |
| `index.html` | Gallery with reference and native PNGs side by side. Click an image to open the SVG; failed cases show the error output |
| `<sha256 prefix>/reference/`, `<sha256 prefix>/native/` | SVG and PNG of each case |

`summary` counts the cases by which executable succeeded: `both`,
`referenceOnly`, `nativeOnly`, `neither`. `externalUnique` and `externalBoth`
count the cases that have a path outside this repository. `externalMetrics`
gives the median, 95th percentile and maximum of the relative canvas width and
height errors and of the run times, over the external cases where both
succeeded.

The summary JSON and the path of `index.html` are printed at the end. The exit
code does not reflect rendering failures or differences; inspect the gallery
and `results.json`.

### Cautions

- Input files are only read. All output stays under `target/`.
- `results.json` and the gallery contain the absolute paths of the input
  files. Keep them out of version control and do not share them when the
  corpus is private.
- The metrics compare PNG canvas dimensions only. They are not a measure of
  pixel or element-level correctness.
- The timings come from concurrent single runs and are not a benchmark.
- With `--reuse-reference`, the reused entries keep pointing at the images of
  the earlier output directory. Do not delete it while the new gallery is in
  use.
