import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const usage = `Usage: devtools/bump-version.sh <version>
       devtools/bump-version.sh --check
       devtools/bump-version.sh -h | --help

Synchronize VERSION, root and vscode-extension package.json/package-lock.json,
the Claude Code / Codex plugin manifests, Cargo.toml, and the local tikzc
package in Cargo.lock.
Accepts SemVer (e.g. 1.0.1, 1.1.0-rc.1), with an optional leading v.
--check checks the same files against VERSION without writing (exit 1 on errors).

Requires Node.js. No npm/Cargo commands, dependency updates, or Git operations
are performed. Dependency versions and release history are excluded.
Rebuild target/release/tikzc after bumping to update its --version output.
`;

function validVersion(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(version);
  return !!match && match[0] === version
    && (!match[4] || match[4].split(".").every(id => !/^0\d+$/.test(id)));
}

function requiredVersion(value, label) {
  if (typeof value !== "string" || !validVersion(value)) {
    throw new Error(`${label}: missing or invalid SemVer version`);
  }
  return value;
}

// JSON is validated first. Scan string/structural tokens to locate only the
// root version, preserving hand-formatted arrays and nested version fields.
function packageJson(text) {
  const data = JSON.parse(text);
  requiredVersion(data.version, "version");
  let depth = 0;
  const versions = [];
  for (const token of text.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\]]/g)) {
    if (token[0] === "{" || token[0] === "[") depth++;
    else if (token[0] === "}" || token[0] === "]") depth--;
    else if (depth === 1 && JSON.parse(token[0]) === "version") {
      const value = /^(\s*:\s*)"(?:\\.|[^"\\])*"/.exec(text.slice(token.index + token[0].length));
      if (value) {
        const start = token.index + token[0].length + value[1].length;
        versions.push({ start, end: token.index + token[0].length + value[0].length });
      }
    }
  }
  if (versions.length !== 1) throw new Error("expected one root version field");
  const { start, end } = versions[0];
  return {
    fields: [["version", data.version]],
    update: version => text.slice(0, start) + JSON.stringify(version) + text.slice(end),
  };
}

function packageLock(text) {
  const data = JSON.parse(text);
  const fields = [
    ["version", requiredVersion(data.version, "version")],
    ['packages[""].version', requiredVersion(data.packages?.[""]?.version, 'packages[""].version')],
  ];
  return {
    fields,
    update(version) {
      data.version = version;
      data.packages[""].version = version;
      return JSON.stringify(data, null, 2) + "\n";
    },
  };
}

// These repository manifests use explicit [package] / [[package]] tables.
// Limit edits to the selected table; never rewrite dependency versions or
// regenerate Cargo.lock (which could resolve new dependency versions).
function cargoPackage(text, lock = false) {
  const headers = [...text.matchAll(/^\[.+\][ \t]*(?:#.*)?\r?$/gm)];
  const tables = headers.map((header, i) => ({
    header: header[0].trim().replace(/[ \t]*#.*$/, ""),
    start: header.index + header[0].length,
    end: headers[i + 1]?.index ?? text.length,
  }));
  const matches = tables.filter(table => {
    const body = text.slice(table.start, table.end);
    return table.header === (lock ? "[[package]]" : "[package]")
      && /^[ \t]*name[ \t]*=[ \t]*(["'])tikzc\1[ \t]*(?:#.*)?\r?$/m.test(body)
      && (!lock || !/^[ \t]*source[ \t]*=/m.test(body));
  });
  if (matches.length !== 1) throw new Error("expected one local tikzc package table");
  const table = matches[0];
  const body = text.slice(table.start, table.end);
  const versions = [...body.matchAll(/^([ \t]*version[ \t]*=[ \t]*)(["'])([^"'\r\n]*)\2[ \t]*(?:#.*)?\r?$/gm)];
  if (versions.length !== 1) throw new Error("expected one explicit package version");
  const match = versions[0];
  const version = requiredVersion(match[3], "tikzc.version");
  const start = table.start + match.index + match[1].length + 1;
  return {
    fields: [["tikzc.version", version]],
    update: next => text.slice(0, start) + next + text.slice(start + version.length),
  };
}

// A single registry is shared by checking and updating to prevent drift.
const targets = [
  ["package.json", packageJson],
  ["package-lock.json", packageLock],
  ["vscode-extension/package.json", packageJson],
  ["vscode-extension/package-lock.json", packageLock],
  ["plugins/tikzc/.claude-plugin/plugin.json", packageJson],
  ["plugins/tikzc/.codex-plugin/plugin.json", packageJson],
  ["Cargo.toml", cargoPackage],
  ["Cargo.lock", text => cargoPackage(text, true)],
];

function main(args) {
  if (args.length === 1 && ["-h", "--help"].includes(args[0])) {
    console.log(usage);
    return;
  }
  if (args.length !== 1) throw new Error(usage);
  const check = args[0] === "--check";
  const next = args[0].replace(/^v/, "");
  if (!check && !validVersion(next)) throw new Error(`'${next}' is not a valid SemVer version.`);
  const canonicalText = fs.readFileSync(path.join(root, "VERSION"), "utf8");
  const canonical = requiredVersion(canonicalText.trim(), "VERSION");

  // Read and validate every target before the first write, so missing files,
  // malformed JSON and unsupported version layouts cannot leave a partial bump.
  const files = targets.map(([file, inspect]) => {
    try {
      const text = fs.readFileSync(path.join(root, file), "utf8");
      return { file, text, ...inspect(text) };
    } catch (error) {
      throw new Error(`${file}: ${error.message}`);
    }
  });
  if (check) {
    console.log(`Canonical version (VERSION file): ${canonical}`);
    let mismatch = false;
    for (const { file, fields } of files) {
      for (const [field, actual] of fields) {
        const ok = actual === canonical;
        console.log(`  ${ok ? "OK" : "MISMATCH"} ${file}#${field}: ${actual}${ok ? "" : ` (expected ${canonical})`}`);
        mismatch ||= !ok;
      }
    }
    if (mismatch) throw new Error("Versioning mistake found.");
    console.log("All versions consistent.");
    return;
  }

  const changes = [
    { file: "VERSION", text: canonicalText, updated: next + "\n" },
    ...files.map(entry => ({ ...entry, updated: entry.update(next) })),
  ];
  console.log(`Bumping version to ${next}`);
  for (const { file, text, updated } of changes) {
    if (text !== updated) fs.writeFileSync(path.join(root, file), updated);
    console.log(`  ${text === updated ? "unchanged" : "updated"} ${file}`);
  }
  console.log(`
Dependency versions were left untouched.
Next steps:
  1. Add a release entry for ${next} to CHANGELOG.md
  2. Run devtools/bump-version.sh --check
  3. Rebuild: cargo build --release --locked
  4. Verify: target/release/tikzc --version (use tikzc.exe on Windows)
  5. Review: git diff
`);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}
