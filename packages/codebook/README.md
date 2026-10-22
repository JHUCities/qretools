# @qretools/codebook

A codebook from any DDI-Lifecycle 4.0 document, not only one QREtools made. This first
part is the model: the document's variables and questions as data for a page to show,
with text as typed spans (words, links, code, references to other items by URN).

```ts
import { codebookOf, parse } from "@qretools/codebook";

const parsed = parse(JSON.parse(text)); // refused only when it isn't a JSON object
if (parsed.ok) {
	const codebook = codebookOf(parsed.value, { lang: "en" });
	// codebook.entries: one per variable, and one per question no variable records
	// codebook.findings: each reference anywhere in the document to an item it doesn't
	// have, not only those the codebook reads (provenance, which cites other studies, aside)
}
```

Each entry has the variable's name and label, its question's text and instructions, its
codes (missing ones marked), its format, universes and concepts, and every place an
instrument asks it: the conditions on the way there (the producer's commands, verbatim),
the loops around it and the order its section and options are shown in. Private while
the app's codebook pane and a `qretools codebook` command try it out.

Not read yet, and left out without a word:

- question grids and question blocks (`QuestionGrid`, `QuestionBlock`);
- a question with several response domains (`StructuredMixedResponseDomain`, or a
  `ResponseDomain` written as several);
- a code list based on another list (`CodeList.CodeListReference`): only its own codes
  are shown;
- missing values given as numeric or text ranges: only missing codes are shown.
