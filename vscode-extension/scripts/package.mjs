import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = fileURLToPath(new URL("../dist/packages/", import.meta.url));
mkdirSync(output, { recursive: true });
execFileSync(process.execPath, [fileURLToPath(new URL("../node_modules/@vscode/vsce/vsce", import.meta.url)), "package", "--no-dependencies", "--out", output], { cwd: root, stdio: "inherit" });
