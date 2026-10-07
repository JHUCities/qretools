/**
 * Messages mark field names with backticks; that is the whole convention. This splits
 * a message into plain and code pieces, so every view (React, CodeMirror's tooltips)
 * draws them the same way.
 */

export interface Span {
	readonly code: boolean;
	readonly text: string;
}

/** The pieces of `text`, alternating plain and code; empty pieces are dropped. */
export const codeSpans = (text: string): readonly Span[] =>
	text
		.split("`")
		.map((part, i) => ({ code: i % 2 === 1, text: part }))
		.filter((s) => s.text !== "");

/** The text as plain words, backticks removed: for screen readers and plain-text places. */
export const plainText = (text: string): string => text.replaceAll("`", "");
