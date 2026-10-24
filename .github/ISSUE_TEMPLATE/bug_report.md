---
name: Unsupported input / incorrect rendering
about: Report TikZ input that tikzc rejects, or renders differently from TikZ
title: "vX.Y.Z: unsupported input / incorrect rendering in <area, e.g. nodes, labels, arrows>"
labels: ["bug"]
assignees: []
---

<!--
You can group several problems in one issue or file them separately.
If you file them separately, keep only one section under "Details".
-->

## Environment

- tikzc: vX.Y.Z (Rust engine)
- VS Code extension: vX.Y.Z <!-- remove if not used -->
- OS: <!-- e.g. macOS 15 / Ubuntu 24.04 -->

## Summary

Found the following problems in vX.Y.Z.

<!--
Use one of these types:
- Incorrect rendering: no error, but the output differs from TikZ
- Unsupported: compilation stops with an `Unsupported ...` error
-->

| # | Type | Input | Current behavior | Workaround |
|---|------|-------|------------------|------------|
| 1 | Incorrect rendering / Unsupported | `<input>` | <error message or symptom> | <alternative syntax, or none> |

## Details

### 1. <One-line description of the problem>

```latex
\begin{tikzpicture}
  % Minimal code that reproduces the problem
\end{tikzpicture}
```

- **Expected**: <how TikZ renders or interprets it>
- **Actual**: <the actual output or error message, including `tikzc check` results>
- **Workaround**: <equivalent syntax that works, or "none">
- **Notes**: <suspected cause, unverified points, etc. Remove if none>

<!-- For more problems, add "### 2. ..." in the same format -->

## Prioritization notes

<!--
Optional. Guidelines:
- Raise the priority of incorrect rendering (output changes without an error), since it is easy to miss
- Even with a workaround, commonly used syntax is worth supporting
- If something won't be fixed soon, showing the workaround in the error message already helps
-->

-
