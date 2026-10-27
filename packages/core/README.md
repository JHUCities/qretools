# @qretools/core

The library under QREtools. It reads a workspace's survey questions, the shared files
they name and its instruments, all written in a small YAML language. It checks them and
turns them into [DDI-Lifecycle 4.0](https://ddialliance.org/). It runs in the browser
and in Node. Questions, workspaces, findings and DDI are plain values. A broken draft
still reads: what's missing is a finding that points into the text, never an exception.

Three entry points, split by what they need:

| Import | What it gives |
|---|---|
| `@qretools/core` | Read and check questions and shared files, and turn them into DDI, one at a time or a whole workspace (`bankOf`; with its instruments, `workspaceOf`). Validate the DDI. Pure. |
| `@qretools/core/editor` | What an editor also needs: where the caret is, what to colour, the cursor inspector, edits and fixes, and the JSON Schemas for completion. Pure. |
| `@qretools/core/node` | `readWorkspace(dir)` reads a workspace's files from a folder. The only entry that touches the disk. |

The official DDI schema, which the output is checked against, is exported as
`@qretools/core/schema.json`.

## Instruments

An instrument puts questions together into a questionnaire. It has three parts:

- what it uses, each under a short name: its own workspace (`bank: ../`), or another
  at a tag (`owner/repo@v1`), read with that workspace's own shared files and settings;
- the inputs it gets from outside;
- a flow of steps (`ask`, `say`, `section`, `if`, `stop`, `compute`, `roster`, `each`).
  Conditions are written in part of VTL 2.1, the SDMX standard.

`instrumentOf` reads an instrument and checks its flow: every answer is asked before
it's read, asked once on any route, and every branch can be reached. It also turns the
instrument into DDI: an `Instrument`, with a Variable for everything it records.
`importsOf` lists what must be fetched first, without reading anything else.

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

`packages/cli` checks and exports a workspace on disk, in CI or at a terminal.

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

A question, read against its workspace's shared files (here none). The result has its
findings, the respondent's view and the codebook entry, as an editor shows them while
you type.

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

Its DDI is made when asked for, under the agency the bank declares (`bank.agency`; you
can pass a whole `Bank`).

```ts
const published = { env: EMPTY_ENV, agency: "org.example" };
const ddi = documentOf(questionItems(evaluation.draft, published));
Object.keys(ddi); // → ["QuestionItem", "CodeList", "Category", "Variable"]
```

A draft with gaps is still a value. Each gap is a hole: a finding that says where it
belongs. The empty path is the question itself, which has no way to answer yet:

```ts
const draft = evaluate("name: nhd_sat\n", EMPTY_ENV);
draft.findings.map((f) => [f.severity, f.path]);
// → [["hole", "text"], ["hole", "intent"], ["hole", ""]]
```

A workspace's questions and shared files, read from a folder. The result has each
file's evaluation and findings by path, the shared files' environment, the paths it
skipped, and the DDI agency `workspace.yaml` declares. A workspace with no agency is
told so once, on `workspace.yaml`. Its DDI can't be exported until it has one (the
preview shows `invalid` in its place).

`workspace.yaml` has three fields:

- `agency`;
- `required`: the fields every question must have as well as `name`, `text` and
  `intent` (such as `title`);
- `required_in`: more fields the questions in one folder must have, by the folder's
  path (`questions/health:` with a list under it). It only adds to `required`. A folder
  named there with no questions in it is a warning on `workspace.yaml`.

`envAt(env, path)` is the environment the question at a path is read against; `bankOf`
uses it for each question. `select_all.yaml` holds the two values stored for each
option of a select all that apply question (without it: 1 Yes, 0 No).

```ts
const bank = bankOf(await readWorkspace("fixtures/bank"));
Object.keys(bank.questions).length; // → 9
bank.ignored; // → []
bank.agency; // → "org.example"
```

Everything is published at version 1 unless you say otherwise. In DDI a version
changes whenever its item does, and only history knows that. Pass each file's version
by path, to `bankOf(files, { "scales/agree4.yaml": { number: "3" } })` or as `versions`
beside the agency. `questionItems(draft, bank, path)` finds the question's own version
by its path.

To check the DDI against the official schema, compile the validator once (it takes a
moment):

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
