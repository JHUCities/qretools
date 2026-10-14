# @qretools/core

The library under QREtools: a workspace's survey questions, the shared files they name
and its instruments, written in a small YAML surface language, read with holes, checked,
and elaborated to [DDI-Lifecycle 4.0](https://ddialliance.org/). It runs in the browser
and in Node. Questions, workspaces, findings and DDI are plain values. A broken draft still evaluates:
what's missing is a finding with a path into the text, never an exception.

Three entry points, split by what they need:

| Import | What it gives |
|---|---|
| `@qretools/core` | Read, check and elaborate questions and shared files, a workspace's at once (`bankOf`; with its instruments, `workspaceOf`), and validate the DDI. Pure. |
| `@qretools/core/editor` | What an editor needs as well: where the caret is, what to colour, the cursor inspector, edits and fixes, the JSON Schemas for completion. Pure. |
| `@qretools/core/node` | `readWorkspace(dir)`: a workspace's files read from a directory. The only entry that does I/O. |

The DDI schema the output is checked against is exported as
`@qretools/core/schema.json`.

## Instruments

An instrument composes questions into a questionnaire: what it uses, each under an alias
(its own workspace, `bank: ../`, or another at a tag, `owner/repo@v1`, read with that
workspace's own shared files and settings), the inputs it receives from outside, and a flow of steps (`ask`,
`say`, `section`, `if`, `stop`, `compute`, `roster`, `each`) whose conditions are
written in a subset of VTL 2.1, the SDMX standard. `instrumentOf` reads it against
what it uses, checks its flow (every answer asked before it's read, asked once on a path,
every branch reachable), and elaborates it to DDI: an `Instrument` whose flow is
DDI's control constructs, with a Variable for everything it records. What a
resolver must fetch first, `importsOf` says without reading anything else.

```ts
const file = "fixtures/households/instruments/households.yaml";
const source = await readFile(file, "utf8");
importsOf(source); // → [{ alias: "hh", address: "../" }]
const households = bankOf(await readWorkspace("fixtures/households"));
const instrument = instrumentOf(source, {
	banks: { hh: households },
	agency: "org.example",
});
instrument.findings.filter((f) => f.severity !== "info"); // → []
Object.keys(instrument.ddi.Instrument ?? {});
// → ["org.example:instrument-households:1"]
```

## The `qretools` command

For a workspace checked out on disk, in CI or at a terminal:

```sh
qretools check path/to/workspace            # findings, one per line; exit 1 on anything to fill in or fix
qretools check path/to/workspace --strict   # warnings fail too
qretools export path/to/workspace -o questions.json   # its questions' DDI, validated
```

A workspace is one folder: `workspace.yaml` (its settings), `questions/<folder>/`, the
shared folders (`scales/` and so on), `missing.yaml`, `select_all.yaml` and
`instruments/`. `check` reports the findings of its questions and shared files and of
every instrument (read against its own workspace, written `../`, under the agency
`workspace.yaml` gives its questions too), and notes YAML files it reads as nothing.

A workspace in another repository (`owner/repo@v1`, or `owner/repo/folder@v1`) is read at
that tag with your own `git`, so whatever credentials git has reach a private
repository. Only `refs/tags/v1` is fetched, never a branch of that name, shallow and
only its folder, into a cache by tag and folder (`$XDG_CACHE_HOME/qretools`, else
`~/.cache/qretools`) beside the commit it resolved to; later runs read the cache. A tag
is immutable by convention only: to read one that was moved, delete its entry in the
cache. In CI, a private one needs git credentials for it, such as `GITHUB_TOKEN` given
to git (`git config --global url."https://x-access-token:${GITHUB_TOKEN}@github.com/".insteadOf https://github.com/`)
or a deploy key.

For one instrument, `qretools instrument check <file>` and `qretools instrument export
<file> --agency <agency>`: it reads its own workspace (`../`, the folder above it) and
others at their tags; `--bank alias=dir` reads an alias written as `owner/repo@v1` from a
directory instead, to work offline. Any other local address is refused.

`check` writes `path:line:col: level: message [code]`, as compilers do, so editors and
CI annotate it. `export` writes every question's DDI items in one document, and refuses
when it would be wrong: no declared agency, two items under one identity, or a document
the official schema rejects. In this repository, `pnpm qretools check <dir>` runs it.

It runs from source under Node 26, which strips TypeScript's types; no build. A copy
installed under `node_modules` would need one, since Node won't strip types there.

## Examples

Every example below runs as a test (`src/node/readme.test.ts`). They share these
imports:

```ts
import { readFile } from "node:fs/promises";
import {
	bankOf,
	EMPTY_ENV,
	evaluate,
	importsOf,
	instrumentOf,
	makeValidator,
	status,
} from "@qretools/core";
import { readWorkspace } from "@qretools/core/node";
```

A question, evaluated against its workspace's shared files (here none, and the agency its
DDI is published under): its findings, the respondent's view, the codebook entry and
its DDI, all from the text.

```ts
const question = `name: nhd_sat
text: How satisfied are you with your neighborhood as a place to live?
intent: How satisfied residents are with their neighborhood overall
responses:
  "1": Satisfied
  "2": Neither satisfied nor dissatisfied
  "3": Dissatisfied
`;
const env = { ...EMPTY_ENV, agency: "org.example" };
const evaluation = evaluate(question, env);
status(evaluation.findings).kind; // → "complete"
Object.keys(evaluation.ddi); // → ["QuestionItem", "CodeList", "Category", "Variable"]
```

A draft with gaps is still a value. Each gap is a hole, a finding with the path it
belongs at; the empty path is the question itself, which has no responses yet:

```ts
const draft = evaluate("name: nhd_sat\n", EMPTY_ENV);
draft.findings.map((f) => [f.severity, f.path]);
// → [["hole", "text"], ["hole", "intent"], ["hole", ""]]
```

A workspace's questions and shared files from a directory: each file's evaluation and
findings by path, the shared files' environment, the paths read as nothing, and the DDI
agency `workspace.yaml` declares. A workspace without one is reported once, under
`workspace.yaml`, and its items are published under `invalid` until it has one.

`workspace.yaml` has three fields: `agency`; `required`, the fields every question must
have beyond `name`, `text` and `intent` (such as `title`); and `required_in`, the fields
the questions in one folder must also have, by the folder's path (`questions/health:`
with a list under it). A folder only adds to `required`, and a folder named there that
holds no question is a warning on `workspace.yaml`. `envAt(env, path)` is the
environment the question at a path is read against; `bankOf` applies it to each.
`select_all.yaml` holds the two values a select-all-that-apply option is stored as
(absent: 1 Yes, 0 No).

```ts
const bank = bankOf(await readWorkspace("fixtures/bank"));
Object.keys(bank.questions).length; // → 9
bank.ignored; // → []
bank.agency; // → "org.example"
```

Every item is published at version 1 unless you say otherwise: DDI's rule is that a
version changes whenever its item does, and only history knows that. Pass each file's
version by path, `bankOf(files, { "scales/agree4.yaml": { number: "3" } })`, or a
question's own and its shared files' to `evaluate(source, env, { own, shared })`.

Validating the DDI against the official schema. Compile the validator once; it takes
a moment.

```ts
const schema = JSON.parse(
	await readFile(
		new URL(import.meta.resolve("@qretools/core/schema.json")),
		"utf8",
	),
);
const validator = makeValidator(schema);
validator.ok && validator.value(evaluation.ddi); // → []
```
