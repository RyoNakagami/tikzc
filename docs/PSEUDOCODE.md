# Pseudocode (`algorithm` environments)

Since 1.3.0, tikzc renders LaTeX `algorithmic`-style pseudocode in the
[pseudocode.js](https://github.com/SaswatPadhi/pseudocode.js) syntax and
look, either alone or together with a TikZ figure. Provenance notes written as
LaTeX comments (`% @src`, `% @ref`, `% @explain`) are checked by `tikzc check`
and drawn as figure-reference markers and an explanation list.

There is no new subcommand. What a file renders depends on its content:

| Content | Output |
| --- | --- |
| `tikzpicture` (any `algo=` node embeds pseudocode) | the figure |
| `tikzpicture` and `algorithm`, no `algo=` node | the figure with the first algorithm placed beside it (`#| layout`) |
| only `algorithm` environments | the first algorithm alone (others: `algo-unplaced` warning) |
| neither | unchanged: an empty canvas |

```sh
tikzc ista.tikz -o ista.png         # pseudocode only
tikzc lasso.tikz -f both -o out/    # figure + pseudocode
tikzc check lasso.tikz              # syntax + linter, writes nothing
```

Pseudocode files are ordinary `.tikz` files: the extension decides by content,
not by file extension. The VS Code extension resolves `algo=<file>` relative to
the open document.

## One-file form

```latex
#| line-number: true
#| paper: doi:10.xxxx/xxxx
#| impl: example/estimator@a1b2c3d

\begin{algorithm}[name=ista]
\caption{ISTA for Lasso}
\begin{algorithmic}
\PROCEDURE{ISTA}{$X, y, \lambda$}
  \STATE $\beta \gets 0$                  % @src paper=eq3.1
  \REPEAT
    \STATE $r \gets y - X\beta$          % @src impl=est.py:120
    \STATE $\beta \gets S_{\lambda}(\beta + X^{\top} r / n)$
    % @src paper=eq3.4 impl=est.py:131
    % @ref sparse-corner
    % @explain ソフト閾値で係数を0へ縮小
  \UNTIL{$\|\Delta\beta\| < \mathrm{tol}$} % @src impl=est.py:140
  \RETURN $\beta$
\ENDPROCEDURE
\end{algorithmic}
\end{algorithm}

\begin{tikzpicture}
  \draw[draw=violet, fill=violet!15]
    (1.5,0) -- (0,1.5) -- (-1.5,0) -- (0,-1.5) -- cycle;
  \node[ref=sparse-corner, anchor=north west] at (1.6,-0.1) {頂点で接する};
  \node[algo=ista, anchor=north west] at (4.5,2.5) {};
\end{tikzpicture}
```

## Arrows from lines into the figure

A named `algo=` node makes each pseudocode line a node: `(<name>-<line
number>)` and, for a line with `@ref`, `(<name>-<ID>)`. A line node spans the
ruled pseudocode (not the explanation list below it) and the height of the
line, so `west`, `east`, `north
east`, ... work as for any node, and arrows take every TikZ path form:
`-|`, `|-`, `to[bend left]`, `.. controls ..`, `rounded corners`, labels.

```latex
\node[algo=ista, algo-focus={sparse-corner}, anchor=north west] (A) at (4.5,2.5) {};
\draw[->, thick, orange, rounded corners]
  (A-sparse-corner.west) -| node[pos=0.25, below] {頂点で接する} (corner);
\draw[->, blue] (A-2.west) to[bend right=40] (origin);
```

`algo-focus={5,sparse-corner}` highlights lines (line numbers or `@ref` IDs);
`algo-focus color=<color>` sets the fill (default `orange!20`). Using
`(<name>-<ID>)` in the figure links the `@ref` line like a `ref=` node does.
Line nodes exist only for an `algo=` node (not for `#| layout:` placement) and
ignore a rotation of that node. See `tests/fixtures/algo-arrows.tikz`, and `tests/fixtures/algo-steps.tikz`
for steps drawn as boxes, each holding one algorithm.

## Two-file form

Put only the `algorithm` environment in `ista.tikz` and reference it with
`\node[algo=ista.tikz] {};`. `algo=` resolves an algorithm name of the same
file first, then a path relative to the input file (CLI) or the open document
(extension). The first algorithm of the referenced file is drawn. Headers
(`#|`) always come from the file being compiled.

The pseudocode is set at the node's `font=` size (default 10pt, like node
text), so `\node[algo=ista, font=\small] {};` matches `font=\small` labels.

## Supported syntax

| Kind | Commands |
| --- | --- |
| Environments | `algorithm` (`[name=...]`, `[number=3]` for "Algorithm 3" with later algorithms continuing from it, `[number=none]` for no number (the counter is unchanged; an empty `title-prefix` also drops "Algorithm"); float placement such as `[H]` is ignored), `algorithmic`, `\caption`, `\label` (ignored) |
| Blocks | `\PROCEDURE`/`\ENDPROCEDURE`, `\FUNCTION`/`\ENDFUNCTION`, `\IF`/`\ELSIF`/`\ELSE`/`\ENDIF`, `\FOR`/`\FORALL`/`\ENDFOR`, `\WHILE`/`\ENDWHILE`, `\REPEAT`/`\UNTIL`, `\LOOP`/`\ENDLOOP` |
| Statements | `\STATE`, `\RETURN`, `\PRINT`, `\BREAK`, `\CONTINUE`, `\REQUIRE`, `\ENSURE`, `\INPUT`, `\OUTPUT`, `\COMMENT` |
| In statements | `\CALL{Name}{args}`, `\TRUE`, `\FALSE`, `\AND`, `\OR`, `\NOT`, `\TO`, `\DOWNTO`, `\textsc` |
| Text | everything node labels accept: `$...$` math, `\textbf`, `\textit`, `\texttt`, Japanese text, ... |

No font is added for pseudocode: it is set in Computer Modern as with
pseudocode.js rendered by MathJax. Text and math use the bundled New Computer
Modern Math (keywords use its Mathematical Bold letters), Japanese falls back
to IPAex Mincho, and procedure names use synthesized small capitals, as
pseudocode.js does.

## Headers

| Key | Default | Meaning |
| --- | --- | --- |
| `line-number` | `false` | number the statements (forced on when a line has `@ref`, or `@explain` with the list shown) |
| `line-number-punc` | `:` | text after a line number |
| `no-end` | `false` | omit `end if`, `end for`, ... |
| `scope-lines` | `false` | vertical lines along indented blocks |
| `title-prefix` | `Algorithm` | caption prefix |
| `indent-size` | `1.2em` | indentation per block (`em` or `pt`) |
| `comment-delimiter` | `//` | prefix of `\COMMENT` text |
| `explain` | `below` | `below` lists `@explain` notes under the pseudocode; `none` hides them |
| `paper` | — | identifier of the paper (DOI, arXiv ID, ...) |
| `impl` | — | `owner/repo@rev`; the revision is required so `impl=path:line` stays valid |

Placement beside a figure (lengths in CSS px, 1px = 0.75pt; a `1600x900`
canvas is 1600×900 pixels at `--dpi 96`):

| Key | Default | Meaning |
| --- | --- | --- |
| `layout` | `algo-left` | `algo-left`, `algo-right`, `algo-top`, `algo-bottom` |
| `canvas` | sum of both | e.g. `1600x900`; the layout without `canvas` is zoomed as a whole to fit and centered |
| `gap` | `48` | space between pseudocode and figure |
| `align` | `center` | cross-axis alignment: `start`, `center`, `end` |
| `algo-at` | — | absolute canvas position `(x, y)` of the pseudocode |
| `algo-anchor` | `north west` | point of the pseudocode placed at `algo-at` |
| `algo-shift` | `(0, 0)` | offset from the automatic position |
| `algo-scale` | `1.0` | pseudocode scale (also for pseudocode-only output) |

An `\node[algo=...]` takes precedence over these keys (`layout-conflict`),
except `canvas`: the whole figure, with its pseudocode nodes and arrows, is
then scaled to fit the canvas and centred (`tests/fixtures/algo-arrows-canvas.tikz`).
With `canvas`, the pseudocode, the gap and the figure keep the proportions
they have without it; `algo-at` and `algo-shift` are canvas pixels.

## Notes

| Note | Example | Meaning |
| --- | --- | --- |
| `@src` | `% @src paper=eq3.4 impl=est.py:131` | sources; `paper=` and `impl=` may repeat; `impl=` is `path:line` or `path:start-end` |
| `@ref` | `% @ref sparse-corner` | ID shared with a `ref=` node of the figure, which shows the line number |
| `@explain` | `% @explain ...` | one or two sentences explaining the line |

A note at the end of a line belongs to that line; a note on its own line
belongs to the preceding statement. Annotated lines are referred to by line
number, so numbering is turned on when a line has `@ref`, or `@explain` while
the list is shown (`#| explain: below`, the default): a `ref=` node shows the
line number before its text (`5: ...`) and the `@explain` list is labelled
`5: ...`. Only an annotated line without a number (`\REQUIRE`, `\ENSURE`,
`\INPUT`, `\OUTPUT`) gets a circled number instead. A `ref=` node whose ID
no line has shows `?`.

## Diagnostics and linter

Errors that prevent rendering stop compilation with `file:line:column`:
`algo-unbalanced`, `algo-unknown-cmd`, `src-bad-format`, `impl-no-rev`,
`algo-name-missing`. `tikzc check` additionally prints these lints, each with
a suggested fix, and exits with code 3 if any is an error; rendering prints
warnings and errors without failing.

| Code | Severity | Meaning |
| --- | --- | --- |
| `ref-dangling` | error | an `@ref` ID has no `ref=` node in the figure |
| `ref-unused` | warning | a `ref=` node is not referenced by any line (drawn with `?`) |
| `src-unsourced` | warning | an assignment/update/condition has no `@src` (only once a file uses `@src`, `paper` or `impl`) |
| `explain-missing` | info | a line with `@ref` has no `@explain` |
| `algo-overlap` | warning | automatic placement: pseudocode and figure overlap (by how many px) |
| `algo-out-of-canvas` | error | pseudocode or figure leaves the `canvas` |
| `layout-conflict` | warning | placement headers other than `canvas` are ignored because of an `algo=` node |
| `algo-unplaced` | warning | an algorithm of the file is not drawn |

The preview server (`--preview-server`) returns the same lints as `lints`
in its response, and accepts an optional `path` for `algo=` files.
