# @qretools/codebook

A codebook from any DDI-Lifecycle 4.0 document, not only one QREtools made. The model
is the document's variables and questions as data for a page to show, with text as
typed spans (words, links, code, references to other items by URN); `pageOf` writes it
as one HTML page.

```ts
import { codebookOf, pageOf, parse } from "@qretools/codebook";

const parsed = parse(JSON.parse(text)); // refused only when it isn't a JSON object
if (parsed.ok) {
	const codebook = codebookOf(parsed.value, { lang: "en" });
	// codebook.entries: one per variable, and one per question no variable records
	// codebook.findings: each reference anywhere in the document to an item it doesn't
	// have, not only those the codebook reads (provenance, which cites other studies, aside)
	const html = pageOf(codebook);
}
```

Each entry has the variable's name and label, its question's text and instructions, its
codes (missing ones marked), its format, universes and concepts, and every place an
instrument asks it: the conditions on the way there (the producer's commands, verbatim),
the loops around it and the order its section and options are shown in.

The page is self-contained: its style is inline, it runs no script and fetches nothing,
so it can be opened from a file, attached or printed. It looks like GitHub's Primer, in
light or dark as the reader's system is. Every entry and every shared item has an
anchor made from its URN without the version (`#us.jhu:variable-consent`), so a link to
it survives a new version; a reference is a link to its anchor, with `data-urn`,
`data-kind` and `data-name`.

Private while the app's codebook pane and a `qretools codebook` command try it out.

Not read yet, and left out without a word:

- question grids and question blocks (`QuestionGrid`, `QuestionBlock`);
- a question with several response domains (`StructuredMixedResponseDomain`, or a
  `ResponseDomain` written as several);
- a code list based on another list (`CodeList.CodeListReference`): only its own codes
  are shown;
- missing values given as numeric or text ranges: only missing codes are shown.
