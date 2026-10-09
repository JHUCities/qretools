/**
 * A response domain written out with its usual fields, for completion to offer beside
 * the bare key, as the instrument's constructs are (instrument/parse.ts `SNIPPETS`).
 * Each template is the text as it lands, at column 0 (a domain is a top-level field);
 * `${}` is a place to fill in, left empty so that, skipped, it is a hole, never an error.
 */

import { placeAt } from "./place.ts";
import { DOMAIN_KEYS } from "./schema.ts";

type DomainKey = (typeof DOMAIN_KEYS)[number];

/* biome-ignore-start lint/suspicious/noTemplateCurlyInString: `${}` is a snippet's place, not interpolation */
export const DOMAIN_SNIPPETS: Readonly<
	Record<DomainKey, { snippet: string; detail: string }>
> = {
	// Codes quoted, as bank files write them (an unquoted code is a finding).
	responses: {
		snippet: 'responses:\n  "1": ${}\n  "2": ${}',
		detail: "with two options",
	},
	// No `unit`: few number questions have one, and an empty one is a hole to delete.
	number: {
		snippet: "number:\n  min: ${}\n  max: ${}",
		detail: "with min and max",
	},
	open: { snippet: "open:\n  max_length: ${}", detail: "with max_length" },
};
/* biome-ignore-end lint/suspicious/noTemplateCurlyInString: above */

export interface FieldSnippet {
	readonly label: string;
	readonly detail: string;
	readonly snippet: string;
	/** Where it replaces from: the start of the word being typed. */
	readonly from: number;
}

/**
 * The response domains written out, where a top-level field goes in a question that has
 * none yet (a question is answered one way only). Nothing elsewhere.
 */
export function domainSnippets(
	source: string,
	offset: number,
): readonly FieldSnippet[] {
	const place = placeAt(source, offset);
	if (
		place?.kind !== "key" ||
		place.segments.length > 0 ||
		place.siblings.some((k) => (DOMAIN_KEYS as readonly string[]).includes(k))
	)
		return [];
	return DOMAIN_KEYS.filter((k) => k.startsWith(place.typed)).map((k) => ({
		label: k,
		...DOMAIN_SNIPPETS[k],
		from: offset - place.typed.length,
	}));
}
