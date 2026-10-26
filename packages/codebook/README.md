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

## `<ddi-codebook>`

The same codebook in any page, as a custom element: import
`@qretools/codebook/element` (it defines the element), then give it a document.

```html
<ddi-codebook language="en"></ddi-codebook>
<script type="module">
	import "@qretools/codebook/element";
	const codebook = document.querySelector("ddi-codebook");
	codebook.ddi = await (await fetch("ddi.json")).json(); // or the `ddi` attribute, as JSON text
	codebook.href = (ref) => undefined; // where a reference goes; undefined: its anchor
	codebook.addEventListener("ddi-follow", (e) => {
		// e.detail is the reference as `href` receives it ({ kind: "ref", urn, type, name });
		// e.target the link.
		// e.preventDefault() keeps the browser from following it.
	});
</script>
```

- `language` (attribute or property) is the language the document is read in, where
  it has it; without it, the document's first. The codebook is written in an element
  that says that language, and its own words (headings, terms) are marked English. The
  element's own `lang` keeps HTML's meaning.
- `href` is compared by identity: give it the same function each time, or the codebook
  is written again (and the reader's focus lost) whenever it changes.
- `ddi-follow` fires only for a plain click (or Enter) on a reference, and is composed,
  so a host in a shadow root hears it. A click with a
  modifier key opens the link as the browser does. The contents' links are plain
  `#…` links, never `ddi-follow`.
- It renders into its own children, not a shadow root, so its links, `:target`,
  history and find-in-page work as on the standalone page. Its style is scoped to it
  (CSS `@scope`), but the host's CSS still reaches in.
- It takes the host's colour scheme and sets no background.
- It writes itself only when what it shows changes.
- Show one codebook per page: its sections' ids (`ddi-contents`, `ddi-variables`,
  `ddi-shared`, …) are fixed, prefixed so they don't collide with the host page's.
- Its classes start `ddi-` too (`ddi-group`, `ddi-anchor`, …), so the host page's
  styles don't match them by accident.

Private while the app's codebook pane and a `qretools codebook` command try it out.

Not read yet, and left out without a word:

- question grids and question blocks (`QuestionGrid`, `QuestionBlock`);
- a question with several response domains (`StructuredMixedResponseDomain`, or a
  `ResponseDomain` written as several);
- a code list based on another list (`CodeList.CodeListReference`): only its own codes
  are shown;
- missing values given as numeric or text ranges: only missing codes are shown.
