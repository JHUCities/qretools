# @qretools/core

The library under QREtools: survey questions and a question bank's shared files,
written in a small YAML surface language, read with holes, checked, and elaborated to
[DDI-Lifecycle 4.0](https://ddialliance.org/). It runs in the browser and in Node.
Questions, banks, findings and DDI are plain values. A broken draft still evaluates:
what's missing is a finding with a path into the text, never an exception.

Three entry points, split by what they need:

| Import | What it gives |
|---|---|
| `@qretools/core` | Read, check and elaborate questions and shared files, a whole bank at once (`bankOf`), and validate the DDI. Pure. |
| `@qretools/core/editor` | What an editor needs as well: where the caret is, what to colour, the cursor inspector, edits and fixes, the JSON Schemas for completion. Pure. |
| `@qretools/core/node` | `readBank(dir)`: a bank's files read from a directory. The only entry that does I/O. |

The DDI schema the output is checked against is exported as
`@qretools/core/schema.json`.

## The `qretools` command

For a bank checked out on disk, in CI or at a terminal:

```sh
qretools check path/to/bank            # findings, one per line; exit 1 on anything to fill in or fix
qretools check path/to/bank --strict   # warnings fail too
qretools export path/to/bank -o bank.json   # the bank's DDI, validated
```

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
	makeValidator,
	status,
} from "@qretools/core";
import { readBank } from "@qretools/core/node";
```

A question, evaluated against its bank's shared files (here none, and the agency its
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

A whole bank from a directory: each file's evaluation and findings by path, the
shared files' environment, the paths that aren't bank files, and the DDI agency the
bank declares in its own file, `bank.yaml`. A bank without one is reported once, under
`bank.yaml`, and its items are published under `invalid` until it has one.

```ts
const bank = bankOf(await readBank("fixtures/bank"));
Object.keys(bank.questions).length; // → 6
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
