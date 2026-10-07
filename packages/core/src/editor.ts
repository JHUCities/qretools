/**
 * `@qretools/core/editor`: what any editor of the surface language needs beyond the
 * main entry, with no editor library in it: where the caret is, what to colour, what
 * the cursor inspector says, edits and fixes resolved against the text, and the JSON
 * Schemas completion reads. Pure, like the main entry; kept apart so that entry stays
 * readable for programs that only check and export.
 */

export { locate, pathAt } from "./findings.js";
export { type Inspection, inspect, mentionAt } from "./inspect.js";
export { labelledSource, textEntrySource } from "./schemes.js";
export {
	addSpace,
	applyEdits,
	quoteCode,
	renameEdits,
	spaceBefore,
} from "./surface/edit.js";
export { marksOf } from "./surface/marks.js";
export { rangesOf } from "./surface/parse.js";
export { type Place, placeAt } from "./surface/place.js";
export {
	bankFileJsonSchema,
	labelledJsonSchema,
	labelsJsonSchema,
	nameFrom,
	questionJsonSchema,
	textEntryJsonSchema,
} from "./surface/schema.js";
