/**
 * `@qretools/core/editor`: what any editor of the surface language needs beyond the
 * main entry, with no editor library in it: where the caret is, what to colour, what
 * the cursor inspector says, edits and fixes resolved against the text, and the JSON
 * Schemas completion reads. Pure, like the main entry; kept apart so that entry stays
 * readable for programs that only check and export.
 */

export { locate, pathAt } from "./findings.ts";
export { type Inspection, inspect, mentionAt } from "./inspect.ts";
export {
	type CompletionOption,
	type InstrumentCompletion,
	instrumentCompletion,
} from "./instrument/complete.ts";
export {
	type OutlineItem,
	type OutlinePart,
	outlineOf,
} from "./instrument/outline.ts";
export { LIST_FIELDS, newLineAfter } from "./instrument/parse.ts";
export { labelledSource, textEntrySource } from "./schemes.ts";
export {
	addSpace,
	applyEdits,
	quoteCode,
	renameEdits,
	spaceBefore,
	withFields,
} from "./surface/edit.ts";
export { marksOf } from "./surface/marks.ts";
export { rangesOf } from "./surface/parse.ts";
export { type Place, placeAt } from "./surface/place.ts";
export {
	bankFileJsonSchema,
	labelledJsonSchema,
	labelsJsonSchema,
	nameFrom,
	questionJsonSchema,
	textEntryJsonSchema,
	workspaceFileJsonSchema,
} from "./surface/schema.ts";
export { domainSnippets, type FieldSnippet } from "./surface/snippets.ts";
