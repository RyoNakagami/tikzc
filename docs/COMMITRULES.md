# Commit Rules

- This project follows the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) specification.
- A consistent commit history makes the project easier to read, enables automated changelog generation, and clarifies the intent of every change.

## Commit Message Format

```text
<type>(<scope>): <description>   ← single line, mandatory

[optional body]

[optional footer(s)]
```

- The **header** is the first line and is mandatory — it is always a **single line**.
- The **scope** is optional.
- A blank line separates the header from the body, and the body from the footer.

### Example

```text
feat(render): add star node shape

Star nodes now contain their text and expose border anchors, so
paths connect to the outline instead of the bounding box.

Closes #42
```

## Type

The `<type>` describes the kind of change and must be one of the following:

| Type       | Description                                                          |
| ---------- | -------------------------------------------------------------------- |
| `feat`     | A new feature                                                        |
| `fix`      | A bug fix                                                            |
| `docs`     | Documentation-only changes                                           |
| `style`    | Changes that do not affect meaning (formatting, whitespace, etc.)    |
| `refactor` | A code change that neither fixes a bug nor adds a feature            |
| `perf`     | A code change that improves performance                              |
| `test`     | Adding missing tests or correcting existing tests                    |
| `build`    | Changes to the build system or external deps (e.g. Cargo, npm)      |
| `ci`       | Changes to CI configuration files and scripts                        |
| `chore`    | Other changes that don't modify `src` or test files                  |
| `revert`   | Reverts a previous commit                                            |

## Scope

The `<scope>` is optional and provides additional context about the section of the
codebase affected, e.g. `feat(render):`, `fix(extension):`, `docs(commitrules):`.
Use a short, lowercase noun. Omit the scope when the change is global.

## Description

- Keep the description on a **single line** — never wrap it onto multiple lines.
- Use the **imperative, present tense**: "add", not "added" or "adds".
- Do **not** capitalize the first letter.
- Do **not** end with a period.
- Keep the header concise — aim for **50 characters or fewer**, and a hard limit of 72.
- If more explanation is needed, put it in the **body**, not the description.

## Body

- Optional. Use it to explain **what** and **why**, not **how**.
- Wrap lines at **72 characters**.
- Separate from the header with one blank line.

## Footer

- Optional. Used for metadata such as issue references and breaking changes.
- Reference issues with `Closes #<id>`, `Fixes #<id>`, or `Refs #<id>`.

### Breaking Changes

A breaking change is indicated either by appending a `!` after the type/scope, or
by a `BREAKING CHANGE:` footer (or both).

```
feat(cli)!: require Rust 1.92 to build

BREAKING CHANGE: the minimum supported Rust version is now 1.92.
```

## Quick Reference

```
feat:     a new feature
fix:      a bug fix
docs:     documentation only
style:    formatting, no code change
refactor: code change, no feature/fix
perf:     performance improvement
test:     adding or fixing tests
build:    build system or dependencies
ci:       CI configuration
chore:    maintenance / tooling
revert:   revert a previous commit
```
