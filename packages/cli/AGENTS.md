# Using the `qretools` CLI as an agent

How to write and check a QREtools workspace from a terminal, with no app. For how the
code is built, read `../../AGENTS.md`; for the command's details, `README.md`.

In this repository run it as `pnpm qretools <command>` from `v2/`, or
`node packages/cli/bin/qretools.ts <command>` (Node 26, no build).

## The loop

```sh
qretools init <dir> --agency <agency>   # once: writes <dir>/workspace.yaml; refuses if one exists
# write questions/<folder>/<name>.yaml and shared files (below)
qretools check <dir>                    # findings, one per line; fix them, rerun
qretools export <dir> -o out.json       # DDI-Lifecycle 4.0 JSON, schema-validated
```

- **Exit codes:** `0` fine, `1` the workspace has problems (or export refused), `2` the
  command couldn't run (bad arguments, nothing to read, `init` over an existing file).
- **Findings** go to stdout as `path:line:col: level: message [code]`, the last line to
  stderr as a count. `level` is `error` (`[to fill in]` for an empty required field),
  `warning` or `note`. `--strict` makes warnings fail too; notes never fail.
- `check` passing means `0 with something to fill in or fix`. Treat warnings as work
  unless the duplication is deliberate (see `variant_of`); notes are advice.
- An agency is letters, digits and hyphens in dot-joined parts (`edu.example.lab`).
  Without one, `export` refuses. Use a placeholder under `org.example` for examples;
  never another organization's.

## Layout

| Path | Holds |
|---|---|
| `workspace.yaml` | `agency:`, and optionally `required:` / `required_in:` (fields questions must have) |
| `questions/<folder>/<name>.yaml` | one question; the folder is for people, never read as meaning |
| `scales/<name>.yaml` | `labels:` code → label, named from a question's `responses:` |
| `universes/<name>.yaml` | `text:`, named from `universe:` |
| `instructions/<name>.yaml` | `text:`, named from `instruction:` |
| `concepts/<name>.yaml`, `units/<name>.yaml` | `label:` and optional `definition:`, named from `concept:` / `number.unit` |
| `missing.yaml` | `labels:` the missing-value codes, for every question |
| `select_all.yaml` | `chosen:` / `not_chosen:` storage of select-all options (default 1 Yes / 0 No) |
| `instruments/<name>.yaml` | one instrument (`qretools instrument check <file>`) |

Names are lowercase, start with a letter (`snake_case`), and are unique per kind across
the whole workspace, whatever folder.

## A question

```yaml
name: wrkstat                 # the variable name
title: Labor force status     # short codebook title
text: Last week were you working full time, part time, or what?   # exactly as read
intent: Labor force status of the respondent    # what it measures, and why
concept: employment_status    # optional, a shared concept
universe: working             # optional, shared name or prose
responses:                    # exactly one of responses, number, open
  "1": Working full time
  "2": Working part time
instruction: Select one       # optional, shared name or prose
source: GSS WRKSTAT, https://…   # optional, where it comes from
note: Verbatim original wording … # optional, not shown to the respondent
```

- **Response domain**, exactly one:
  - `responses:` an inline `"code": label` map or a shared scale's name; add
    `select: many` for select all that apply (an option may then be a map of `label`,
    `title`, `variable`, `note`).
  - `number: { min, max, unit, decimals }`, every key optional.
  - `open: { max_length }`.
- **Quote every code** (`"1"`, not `1`): codes are text, and `"01"` and `"1"` differ.
- **Fills:** `{{name}}` in `text`, declared under `fills: { name: number | text }`; an
  instrument supplies the value.
- **`variant_of: { other_name: why }`** marks two questions alike on purpose (repeated
  mentions, split-ballot forms) and silences their duplicate warnings.
- An unknown key is an error; keys from an older format go under `legacy:`.
  The authoritative field list is `QuestionSchema` in
  `../core/src/surface/schema.ts`.

## Findings you'll see most

| Code | Do |
|---|---|
| `to fill in` | write the empty or missing required field |
| `unknown-key` | remove it, or move it under `legacy:` |
| `unquoted-code` | quote the code |
| `duplicate-text`, `duplicate-list` | share it (a scale, universe, instruction), or add `variant_of` if deliberate |
| `matches-scale` | replace the inline list with the shared scale's name |
| `duplicate-scale` | merge the two scales; there's no `variant_of` for scales yet |
| `double-barreled` and other notes | advice on wording; keep a source's wording when importing |

## Importing an existing survey

- **Take every value from a source:** wording, codes, labels. Where the source has
  none, leave the field out, or empty so `check` flags it. Don't invent wording.
- **Keep the original:** quote the source's wording verbatim in `note` when you split
  it into `text`, `universe` and `instruction`.
- **Name the provenance:** say where each question came from in `source`.
- **Generate the files from a script** when importing many, so the import can be rerun.
  `../../../qretools-gss` is a worked example: the GSS Replicating Core's Demographic
  and Work items, generated by its `tools/generate.py`.
