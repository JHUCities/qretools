/**
 * A codebook as HTML: strings in, strings out, every one escaped where it is written.
 * Pure, as the model is: no DOM, so the page can be written by a command, a test or a
 * custom element alike.
 */

import { itemKeyOf } from "@qretools/core";
import type { Span, Text } from "./text.ts";

const ENTITIES: Readonly<Record<string, string>> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};

/** Text safe in a text node or a double-quoted attribute value: nothing in it can end either. */
export const escapeHtml = (s: string): string =>
	s.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);

/**
 * The id of an item's anchor: its key at every version (`agency:id`), so a permalink
 * survives an edit that gives the item a new version, and a reference to an older
 * version still finds it. Every such id holds a colon, so the page's own ids
 * (`contents`) can't collide with one. None for a URN that isn't one, or whose key
 * holds whitespace, which an id can't.
 */
export const anchorOf = (urn: string): string | undefined => {
	const key = itemKeyOf(urn);
	return key === undefined || /\s/.test(key) ? undefined : key;
};

/**
 * A link to an anchor on the page. Colons are allowed in a fragment and keep it
 * readable; anything else encoded (`@`, `$`, `#`) still finds its id, since a browser
 * looks for the fragment's percent-decoded form too (HTML's "find a potential indicated
 * element").
 */
export const hrefOf = (anchor: string): string =>
	`#${encodeURIComponent(anchor).replaceAll("%3A", ":")}`;

/** How text is written where it is: `inLink` inside an `<a>`, where another link can't go. */
interface Context {
	/** The anchors the page has: a reference to anything else is named, not linked. */
	readonly anchors: ReadonlySet<string>;
	readonly inLink?: boolean;
}

function spanHtml(s: Span, { anchors, inLink }: Context): string {
	switch (s.kind) {
		case "text":
			return escapeHtml(s.text);
		case "code":
			return `<code>${escapeHtml(s.text)}</code>`;
		case "link":
			// Only http(s) addresses become links (text.ts), so escaping is all the href needs.
			return inLink
				? escapeHtml(s.text)
				: `<a href="${escapeHtml(s.url)}" rel="external">${escapeHtml(s.text)}</a>`;
		case "ref": {
			const anchor = anchorOf(s.urn);
			const data = `data-urn="${escapeHtml(s.urn)}" data-kind="${escapeHtml(s.type)}"${s.name === undefined ? "" : ` data-name="${escapeHtml(s.name)}"`}`;
			const words = escapeHtml(s.name ?? s.urn);
			return !inLink && anchor !== undefined && anchors.has(anchor)
				? `<a href="${hrefOf(anchor)}" ${data}>${words}</a>`
				: `<span ${data}>${words}</span>`;
		}
		default:
			return s satisfies never;
	}
}

/** Text where a paragraph can't go (a heading, a table cell, a link): its paragraphs run on. */
export const inlineHtml = (text: Text, context: Context): string =>
	text.map((p) => p.map((s) => spanHtml(s, context)).join("")).join(" ");

/** Text as paragraphs. */
export const blockHtml = (text: Text, context: Context): string =>
	text
		.map((p) => `<p>${p.map((s) => spanHtml(s, context)).join("")}</p>`)
		.join("");
