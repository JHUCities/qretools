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

`packages/cli`: checks and exports a workspace on disk, in CI or at a terminal.

## Examples

Every example below runs as a test (`src/node/readme.test.ts`). They share these
imports:

```ts
import { readFile } from "node:fs/promises";
import {
	bankOf,
	documentOf,
	EMPTY_ENV,
	evaluate,
	importsOf,
	instrumentOf,
	makeValidator,
	questionItems,
	status,
} from "@qretools/core";
import { readWorkspace } from "@qretools/core/node";
```

A question, evaluated against its workspace's shared files (here none): its findings,
the respondent's view and the codebook entry, all from the text, as an editor shows
them while it's typed.

```ts
const question = `name: nhd_sat
text: How satisfied are you with your neighborhood as a place to live?
intent: How satisfied residents are with their neighborhood overall
responses:
  "1": Satisfied
  "2": Neither satisfied nor dissatisfied
  "3": Dissatisfied
`;
const evaluation = evaluate(question, EMPTY_ENV);
status(evaluation.findings).kind; // → "complete"
```

Its DDI is one output of the question, made when asked for, under the agency the bank
declares (`bank.agency`; a `Bank` can be passed whole).

```ts
const published = { env: EMPTY_ENV, agency: "org.example" };
const ddi = documentOf(questionItems(evaluation.draft, published));
Object.keys(ddi); // → ["QuestionItem", "CodeList", "Category", "Variable"]
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
version by path, to `bankOf(files, { "scales/agree4.yaml": { number: "3" } })` or as
`versions` beside the agency; `questionItems(draft, bank, path)` finds the question's
own by its path.

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
validator.ok && validator.value(ddi); // → []
```
