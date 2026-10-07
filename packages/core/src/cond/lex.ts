/**
 * Conditions are written in a subset of VTL 2.1 (SDMX's Validation and Transformation
 * Language), the standard adopted for them: its scalar operators only. This is its
 * tokenizer. Total: any text tokenizes, and what isn't VTL is an `invalid` token for
 * the parser to report. Ranges are offsets into the condition's own text.
 */
import type { Range } from "../findings.ts";

export type TokenKind =
	| "name"
	| "string"
	| "number"
	| "op"
	| "("
	| ")"
	| "{"
	| "}"
	| ","
	| "invalid"
	| "end";

export interface Token {
	readonly kind: TokenKind;
	/** The token as written; for a string, without its quotes. */
	readonly text: string;
	readonly range: Range;
	/** A string with no closing quote. */
	readonly open?: true;
}

/** VTL's keyword operators, which are written like names. */
export const KEYWORDS = new Set([
	"and",
	"or",
	"xor",
	"not",
	"in",
	"not_in",
	"true",
	"false",
	"null",
]);

const NAME = /[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*/y;
const NUMBER = /[0-9]+(?:\.[0-9]+)?/y;
const OPS = [
	// Written as other languages write them: read, then told (see `MISTAKES`).
	"==",
	"!=",
	"||",
	"&&",
	"<>",
	"<=",
	">=",
	"=",
	"<",
	">",
	"+",
	"-",
	"*",
	"/",
	"|",
	"&",
	"!",
] as const;

/** Operators other languages use, and VTL's own for each. */
export const MISTAKES: Readonly<Record<string, string>> = {
	"==": "=",
	"!=": "<>",
	"||": "or",
	"|": "or",
	"&&": "and",
	"&": "and",
	"!": "not",
};

export function tokenize(text: string): readonly Token[] {
	const tokens: Token[] = [];
	let at = 0;
	const push = (kind: TokenKind, from: number, to: number, value?: string) =>
		tokens.push({
			kind,
			text: value ?? text.slice(from, to),
			range: [from, to],
		});
	while (at < text.length) {
		const c = text[at] ?? "";
		if (/\s/.test(c)) {
			at++;
			continue;
		}
		if (c === '"') {
			const close = text.indexOf('"', at + 1);
			if (close === -1) {
				tokens.push({
					kind: "string",
					text: text.slice(at + 1),
					range: [at, text.length],
					open: true,
				});
				at = text.length;
			} else {
				push("string", at, close + 1, text.slice(at + 1, close));
				at = close + 1;
			}
			continue;
		}
		NAME.lastIndex = at;
		const name = NAME.exec(text);
		if (name) {
			push("name", at, at + name[0].length);
			at += name[0].length;
			continue;
		}
		NUMBER.lastIndex = at;
		const number = NUMBER.exec(text);
		if (number) {
			push("number", at, at + number[0].length);
			at += number[0].length;
			continue;
		}
		const op = OPS.find((o) => text.startsWith(o, at));
		if (op !== undefined) {
			push("op", at, at + op.length);
			at += op.length;
			continue;
		}
		if ("(){},".includes(c)) {
			push(c as TokenKind, at, at + 1);
			at++;
			continue;
		}
		// Anything else, up to the next space or delimiter, is one invalid token.
		let end = at + 1;
		while (end < text.length && !/[\s(){},"]/.test(text[end] ?? "")) end++;
		push("invalid", at, end);
		at = end;
	}
	tokens.push({ kind: "end", text: "", range: [text.length, text.length] });
	return tokens;
}
