/**
 * A condition in words, phrased against the codes of what its names read:
 * `x = "1"` reads “x is “Yes””, `isnull(x)` “x isn't answered”, and a run of three or more
 * codes in their list's order “x is 1 to 5 (“A” to “E”)”. Spans, not a string: each name is
 * a reference to what it reads, so a page links it. What can't be phrased shows as written.
 *
 * Three-valued, as VTL is: a question not answered is null, and a condition that is null
 * isn't true. So what an else is taken on (`notTrue`) includes "not answered", and what
 * a `not` asks for (`false`) doesn't. An input is set before the interview, so it is
 * never "not answered". Codes are strings, matched as written: `1` isn't `"01"`.
 */

import type { Condition, Expr, Source } from "@qretools/core";
import { holesOf, printCondition } from "@qretools/core";
import type { Para, Ref, Span, Text } from "./text.ts";

/** What a page knows of what a name reads: its valid codes, and whether it may be unanswered. */
export interface Known {
	readonly codes?: readonly { readonly code: string; readonly label?: Text }[];
	readonly nullable: boolean;
}

/** What a page makes of what a name reads: a reference to link, and what it knows of it. */
export type Lookup = (source: Source) => {
	readonly ref: Ref;
	readonly known?: Known;
};

/** When the words hold: the condition is true, false, or not true (false or null). */
export type Mode = "true" | "false" | "notTrue";

interface Phrase {
	readonly spans: readonly Span[];
	/** Its outermost connective, so a phrase inside another is bracketed where it must be. */
	readonly top?: "and" | "or";
}

const text = (t: string): Span => ({ kind: "text", text: t });
const code = (t: string): Span => ({ kind: "code", text: t });
const words = (...spans: Span[]): Phrase => ({ spans });

function join(parts: readonly Phrase[], op: "and" | "or"): Phrase {
	if (parts.length === 1) return parts[0] as Phrase;
	return {
		spans: parts.flatMap((p, i) => [
			...(i === 0 ? [] : [text(`, ${op} `)]),
			...(p.top !== undefined && p.top !== op
				? [text("("), ...p.spans, text(")")]
				: p.spans),
		]),
		top: op,
	};
}

/**
 * Commands in words, joined by "and", each as it holds (`true`) or as an else is taken
 * on it (`notTrue`). Undefined when any of them can't be read (not VTL, or not parsed).
 */
export function conditionsWords(
	parts: readonly { readonly cond: Condition; readonly mode: Mode }[],
	lookup: Lookup,
): Para | undefined {
	const phrases = parts.map((p) => phrase(p.cond, p.mode, lookup));
	return phrases.every((p) => p !== undefined) && phrases.length > 0
		? join(phrases, "and").spans
		: undefined;
}

/** Whether a command reads as a condition (true or false), not a value. */
export const isCondition = (c: Condition): boolean => {
	if (c.kind !== "parsed") return false;
	const e = c.expr;
	switch (e.kind) {
		case "binary":
			return !["+", "-", "*", "/"].includes(e.op);
		case "member":
		case "boolean":
			return true;
		case "unary":
			return e.op === "not";
		case "call":
			return e.fn === "isnull" || e.fn === "between";
		default:
			return false;
	}
};

function phrase(
	cond: Condition,
	mode: Mode,
	lookup: Lookup,
): Phrase | undefined {
	// A hole is text the parser couldn't read: it isn't phrased.
	if (cond.kind !== "parsed" || holesOf(cond.expr).length > 0) return undefined;
	const about = (e: Expr) => {
		const source = e.kind === "name" ? cond.sources.get(e.name) : undefined;
		return source === undefined ? undefined : lookup(source);
	};
	const knownOf = (e: Expr): Known | undefined => about(e)?.known;
	const nameOf = (e: Expr & { kind: "name" }): Span => {
		const r = about(e)?.ref;
		// The name as the command writes it: the reference may be named otherwise, or not at all.
		return r === undefined ? code(e.name) : { ...r, name: e.name };
	};
	const literal = (e: Expr | undefined): string | undefined =>
		e?.kind === "string" ? e.value : e?.kind === "number" ? e.text : undefined;
	/** What an else is taken on also holds when the name isn't answered, but for an input. */
	const orUnanswered = (p: Phrase, e: Expr, m: Mode, also?: Expr): Phrase =>
		m === "notTrue" &&
		[e, also].some((x) => x?.kind === "name" && knownOf(x)?.nullable !== false)
			? { spans: [...p.spans, text(", or not answered")], top: "or" }
			: p;
	const label = (e: Expr, c: string): Span[] => {
		const list = knownOf(e)?.codes;
		const l = list?.find((x) => x.code === c)?.label;
		// A code its list doesn't have says so; a value with no list is just itself.
		return l === undefined
			? list === undefined || list.length === 0
				? [code(c)]
				: [text("code "), code(c)]
			: [
					text("“"),
					...l.flatMap((p, i) => [...(i === 0 ? [] : [text(" ")]), ...p]),
					text("”"),
				];
	};
	/** `x is “A”`, `x is “A” or “B”`, `x is 1 to 5 (“A” to “E”)`. */
	const isIn = (
		e: Expr & { kind: "name" },
		codes: readonly string[],
	): Phrase => {
		if (codes.length === 0)
			return words(nameOf(e), text(" has no other answer"));
		const list = knownOf(e)?.codes ?? [];
		const at = codes.map((c) => list.findIndex((x) => x.code === c));
		const run =
			codes.length >= 3 &&
			at.every(
				(i, k) => i >= 0 && (k === 0 || i === (at[k - 1] as number) + 1),
			);
		const [first, last] = [codes[0] as string, codes.at(-1) as string];
		if (run)
			return words(
				nameOf(e),
				text(` is ${first} to ${last} (`),
				...label(e, first),
				text(" to "),
				...label(e, last),
				text(")"),
			);
		return {
			spans: [
				nameOf(e),
				text(" is "),
				...codes.flatMap((c, i) => [
					...(i === 0 ? [] : [text(i === codes.length - 1 ? " or " : ", ")]),
					...label(e, c),
				]),
			],
			...(codes.length > 1 && { top: "or" as const }),
		};
	};
	/** That `e` is one of `set`, or (`negated`) isn't, as it holds in mode `m`. */
	const member = (
		e: Expr & { kind: "name" },
		set: readonly string[],
		negated: boolean,
		m: Mode,
	): Phrase => {
		if ((m === "true") !== negated) return isIn(e, set);
		const list = knownOf(e)?.codes;
		// Without a list, the codes it isn't.
		const other =
			list === undefined || list.length === 0
				? words(
						nameOf(e),
						text(" isn't "),
						...set.flatMap((c, i) => [
							...(i === 0 ? [] : [text(" or ")]),
							code(c),
						]),
					)
				: isIn(
						e,
						list.map((c) => c.code).filter((c) => !set.includes(c)),
					);
		return orUnanswered(other, e, m);
	};
	const COMPARE: Readonly<Record<string, readonly [string, string]>> = {
		"<": ["is less than", "is at least"],
		"<=": ["is at most", "is more than"],
		">": ["is more than", "is at most"],
		">=": ["is at least", "is less than"],
	};

	const go = (e: Expr, m: Mode): Phrase => {
		switch (e.kind) {
			case "binary": {
				if (e.op === "and" || e.op === "or") {
					// Under false or not true, De Morgan's laws: an `and` becomes "or".
					const and = (e.op === "and") === (m === "true");
					return join([go(e.left, m), go(e.right, m)], and ? "and" : "or");
				}
				if (e.left.kind !== "name") break;
				const lit = literal(e.right);
				if (lit !== undefined && (e.op === "=" || e.op === "<>"))
					return member(e.left, [lit], e.op === "<>", m);
				// Against a number, or another name: `n <= size` reads "n is at most size".
				const right =
					lit !== undefined
						? text(lit)
						: e.right.kind === "name"
							? nameOf(e.right)
							: undefined;
				const compare = COMPARE[e.op];
				if (compare === undefined || right === undefined) break;
				return orUnanswered(
					words(
						nameOf(e.left),
						text(` ${compare[m === "true" ? 0 : 1]} `),
						right,
					),
					e.left,
					m,
					e.right,
				);
			}
			case "member": {
				const set = e.set.map(literal);
				if (e.operand.kind === "name" && set.every((v) => v !== undefined))
					return member(e.operand, set as string[], e.negated, m);
				break;
			}
			case "call": {
				const [first, second] = e.args;
				if (e.fn === "isnull" && first?.kind === "name")
					return words(
						nameOf(first),
						text(m === "true" ? " isn't answered" : " is answered"),
					);
				// `nvl(c, d)` is never null: c, or d where c is null.
				if (
					e.fn === "nvl" &&
					first !== undefined &&
					second?.kind === "boolean"
				) {
					if (m === "true")
						return second.value
							? join([go(first, "true"), words(text("not answered"))], "or")
							: go(first, "true");
					return go(first, second.value ? "false" : "notTrue");
				}
				break;
			}
			case "unary":
				// shortcut: `not` under an else (true or null) is shown as written.
				if (e.op === "not" && m !== "notTrue")
					return go(e.operand, m === "true" ? "false" : "true");
				break;
			case "name":
				return words(
					nameOf(e),
					text(
						m === "true"
							? " is true"
							: m === "false"
								? " is false"
								: " isn't true",
					),
				);
			case "boolean":
				return words(text(e.value === (m === "true") ? "always" : "never"));
		}
		// Anything else: as written.
		const written = code(printCondition(e));
		return m === "true"
			? words(written)
			: words(written, text(m === "false" ? " is false" : " isn't true"));
	};
	return go(cond.expr, mode);
}
