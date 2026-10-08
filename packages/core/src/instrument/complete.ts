/**
 * Completion in an instrument: bank questions after `ask:`, and the names a condition
 * can read wherever the condition language is written (`EXPRESSIONS`, `FILL_SOURCE`,
 * the parser's own table). Pure, with no editor library in it: where the word being
 * typed starts, in source offsets, and what may go there, for an editor to filter and
 * insert.
 *
 * The caret's place is read from the YAML the core parses, as `placeAt` does for a
 * question; inside a condition, the condition language's own tokenizer finds the word,
 * so a caret inside a string offers nothing.
 */
import {
	isMap,
	isScalar,
	isSeq,
	type Pair,
	parseDocument,
	type Scalar,
	type YAMLMap,
	type Node as YamlNode,
} from "yaml";
import { tokenize } from "../cond/lex.ts";
import { NAME_KIND } from "../copy.ts";
import type { BankScope } from "../evaluate.ts";
import type { Node } from "./draft.ts";
import { CONSTRUCTS, EXPRESSIONS, parseInstrument } from "./parse.ts";
import { scalarMap } from "./scalar.ts";

export interface CompletionOption {
	readonly label: string;
	/** What it is: a question's title or text, or what kind of name it is. */
	readonly detail?: string;
	readonly kind: "question" | "variable" | "name";
}

export interface InstrumentCompletion {
	/** Where the word being typed starts: an editor replaces from here to the caret. */
	readonly from: number;
	readonly options: readonly CompletionOption[];
}

/** What a field holds, for completion: a bank question, or the condition language. */
type Field = "question" | "expression";

/** A pair whose value the caret is at, the map holding it, and the keys leading there. */
interface At {
	readonly pair: Pair;
	readonly map: YAMLMap;
	readonly segments: readonly (string | number)[];
}

export function instrumentCompletion(
	source: string,
	offset: number,
	banks: Readonly<Record<string, BankScope>>,
): InstrumentCompletion | undefined {
	const doc = parseDocument(source, { prettyErrors: false });
	const at = pairAt(source, doc.contents, offset, []);
	if (at === undefined) return undefined;
	const field = fieldOf(at);
	if (field === undefined) return undefined;
	const value = at.pair.value;
	const word =
		isScalar(value) && value.value !== null && value.range != null
			? wordIn(source, value as Scalar, offset, field)
			: { from: offset };
	if (word === undefined) return undefined;
	return {
		from: word.from,
		options: field === "question" ? questions(banks) : names(source, banks),
	};
}

/**
 * The pair whose value the caret is at: inside or at the end of a written scalar, or
 * after a key's colon on the caret's own line with nothing written yet.
 */
function pairAt(
	source: string,
	node: unknown,
	offset: number,
	segments: readonly (string | number)[],
): At | undefined {
	if (isSeq(node))
		for (const [i, item] of node.items.entries()) {
			const found = pairAt(source, item, offset, [...segments, i]);
			if (found !== undefined) return found;
		}
	if (!isMap(node)) return undefined;
	for (const pair of node.items) {
		if (!isScalar(pair.key)) continue;
		const key = String(pair.key.value);
		const value = pair.value as YamlNode | null;
		if (isMap(value) || isSeq(value)) {
			const found = pairAt(source, value, offset, [...segments, key]);
			if (found !== undefined) return found;
			continue;
		}
		const at = { pair, map: node, segments: [...segments, key] };
		if (isScalar(value) && value.value !== null && value.range != null) {
			if (value.range[0] <= offset && offset <= endOf(source, value as Scalar))
				return at;
			continue;
		}
		// Nothing written yet: the caret after the colon, on the key's own line.
		const keyEnd = pair.key.range?.[1];
		if (keyEnd === undefined) continue;
		const between = source.slice(keyEnd, offset);
		if (/^: *$/.test(between) && !/\S/.test(lineRest(source, offset)))
			return at;
	}
	return undefined;
}

/** Where a scalar's text ends for the caret: a plain one also takes trailing spaces on its line. */
function endOf(source: string, node: Scalar): number {
	const end = node.range?.[1] ?? 0;
	if (node.type !== "PLAIN") return end;
	let e = end;
	while (source[e] === " ") e++;
	return e;
}

const lineRest = (source: string, offset: number): string => {
	const end = source.indexOf("\n", offset);
	return source.slice(offset, end === -1 ? undefined : end);
};

/** What the field at the caret holds, by the parser's own table; undefined for prose and everything else. */
function fieldOf({ pair, map, segments }: At): Field | undefined {
	const key = String((pair.key as Scalar).value);
	const parent = segments.at(-2);
	// A fill's source, `fill: {name: <value>}`: the parser's `FILL_SOURCE`.
	if (parent === "fill") return "expression";
	// A check: an item under `checks`.
	if (typeof parent === "number" && segments.at(-3) === "checks")
		return key in EXPRESSIONS.check ? "expression" : undefined;
	const construct = map.items
		.map((p) => (isScalar(p.key) ? String(p.key.value) : ""))
		.find((k) => (CONSTRUCTS as readonly string[]).includes(k));
	if (construct === undefined) return undefined;
	if (construct === "ask") return key === "ask" ? "question" : undefined;
	const fields: Readonly<Record<string, string>> | undefined =
		EXPRESSIONS[construct as keyof typeof EXPRESSIONS];
	return fields !== undefined && key in fields ? "expression" : undefined;
}

/**
 * The word being typed in a written value, or undefined where nothing is offered: the
 * caret inside a word (not at its end), or inside a condition's string.
 */
function wordIn(
	source: string,
	node: Scalar,
	offset: number,
	field: Field,
): { from: number } | undefined {
	const text = String(node.value);
	const toSource = scalarMap(source, node, text);
	// Past a quoted value's closing quote is outside the value: nothing goes there.
	if (node.type !== "PLAIN" && offset > toSource([text.length, text.length])[1])
		return undefined;
	if (field === "question") {
		const [start] = toSource([0, 0]);
		const [, end] = toSource([text.length, text.length]);
		// A question's name is one word: offered only at its end, never mid-word.
		return offset >= end ? { from: start } : undefined;
	}
	for (const t of tokenize(text)) {
		if (t.kind === "end") break;
		const [a, b] = toSource(t.range);
		if (offset < a || offset > b) continue;
		if (t.kind === "string") return undefined;
		if (t.kind === "name")
			// At the name's end: what it starts is completed; inside it, nothing.
			return offset === b ? { from: a } : undefined;
		if (offset > a && offset < b) return undefined;
	}
	return { from: offset };
}

/** Every bank question, `alias.name`, with its title or text. */
function questions(
	banks: Readonly<Record<string, BankScope>>,
): readonly CompletionOption[] {
	return Object.entries(banks).flatMap(([alias, bank]) =>
		[...bank.index.names.entries()].flatMap(([name, paths]) => {
			const [path] = [...paths].sort();
			const draft =
				path === undefined ? undefined : bank.questions[path]?.draft;
			const detail = draft?.title ?? draft?.text;
			return [
				{
					label: `${alias}.${name}`,
					kind: "question" as const,
					...(detail !== undefined && { detail }),
				},
			];
		}),
	);
}

/**
 * Every name a condition can read, in the order they are declared: the instrument's own
 * (inputs, computes, `as`), each roster's row number, then the banks' variables.
 */
function names(
	source: string,
	banks: Readonly<Record<string, BankScope>>,
): readonly CompletionOption[] {
	const parsed = parseInstrument(source, banks);
	const own = [...parsed.scope.entries()].map(
		([name, named]): CompletionOption => ({
			label: name,
			kind: "name",
			detail: NAME_KIND[named.kind],
		}),
	);
	const rows = rostersOf(parsed.draft.flow).map(
		(r): CompletionOption => ({
			label: `${r}.index`,
			kind: "name",
			detail: NAME_KIND.index,
		}),
	);
	const variables = Object.entries(banks).flatMap(([alias, bank]) =>
		[...bank.index.variables.entries()].flatMap(([variable, symbols]) => {
			const [path] = symbols.map((s) => s.key).sort();
			const draft =
				path === undefined ? undefined : bank.questions[path]?.draft;
			const detail = draft?.title ?? draft?.text;
			return [
				{
					label: `${alias}.${variable}`,
					kind: "variable" as const,
					...(detail !== undefined && { detail }),
				},
			];
		}),
	);
	return [...own, ...rows, ...variables];
}

const rostersOf = (flow: readonly Node[]): readonly string[] =>
	flow.flatMap((n): readonly string[] =>
		n.kind === "roster"
			? [...(n.name === undefined ? [] : [n.name]), ...rostersOf(n.flow)]
			: n.kind === "section" || n.kind === "each"
				? rostersOf(n.flow)
				: n.kind === "if"
					? [
							...n.branches.flatMap((b) => rostersOf(b.then)),
							...rostersOf(n.else ?? []),
						]
					: [],
	);
