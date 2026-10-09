/**
 * Completion in an instrument: bank questions after `ask:`, and the names a condition
 * can read wherever the condition language is written (`EXPRESSIONS`, `FILL_SOURCE`,
 * the parser's own table), and a coded answer's codes where one is compared with it or
 * put in its set (`hh.tenure = "2"`, `hh.tenure in {"1", "2"}`). Pure, with no editor library in it: where the word being
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
	visit,
	type YAMLMap,
	type Node as YamlNode,
} from "yaml";
import { KEYWORDS, type Token, tokenize } from "../cond/lex.ts";
import { NAME_KIND } from "../copy.ts";
import type { BankScope } from "../evaluate.ts";
import type { Node } from "./draft.ts";
import {
	CHECK_FIELDS,
	CONSTRUCTS,
	EXPRESSIONS,
	FIELDS,
	LIST_FIELDS,
	parseInstrument,
	SNIPPET_DETAIL,
	SNIPPETS,
} from "./parse.ts";
import { scalarMap } from "./scalar.ts";

export interface CompletionOption {
	readonly label: string;
	/** What it is: a question's title or text, or what kind of name it is. */
	readonly detail?: string;
	readonly kind:
		| "question"
		| "variable"
		| "name"
		| "code"
		| "field"
		| "step"
		| "snippet";
	/** What to insert, where it differs from the label (a code inside a double-quoted value). */
	readonly apply?: string;
	/**
	 * A construct written out with its required fields, in the common snippet syntax
	 * (`${name}` a placeholder, `${}` a stop), exactly as it should appear from `from`.
	 */
	readonly snippet?: string;
}

export interface InstrumentCompletion {
	/** Where the word being typed starts: an editor replaces from here to the caret. */
	readonly from: number;
	/** Where the replaced text ends, when past the caret (a string's closing quote). */
	readonly to?: number;
	/**
	 * The options are already narrowed to the word being typed: an editor shows them as
	 * they are (each `apply` carries its own indent, from the line's start).
	 */
	readonly filtered?: true;
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
	const key = keyCompletion(source, doc, offset);
	if (key !== undefined) return key;
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
	const options =
		field === "question"
			? questions(banks)
			: word.codesOf === undefined
				? names(source, banks)
				: codes(
						source,
						banks,
						word.codesOf,
						isScalar(value) && value.type === "QUOTE_DOUBLE",
						// Touching the operator or a comma (the list opens as `=` is typed): a
						// space before the code, as it's written. After `{` or `(`, none.
						/[^\s{(]/.test(source[word.from - 1] ?? " "),
					);
	return {
		from: word.from,
		...(word.to !== undefined && { to: word.to }),
		options,
	};
}

/** A key written before the caret: its name, where it starts, and the map holding it. */
interface KeyAt {
	readonly name: string;
	readonly offset: number;
	readonly column: number;
	readonly map: YAMLMap;
	/** The map is an item of a list (a step, or a check). */
	readonly item: boolean;
}

/**
 * Where a key goes, and which: a word being typed (or none) alone on the caret's line.
 * After `- ` in a list field, the items it takes (a flow's steps, a check's `ensure`);
 * at a step's field column, its fields not yet written and, as new steps beside it, the
 * constructs. The parent is read from the YAML the core parses (the keys before the
 * caret's line and the maps holding them); only the caret's own line is read as text.
 */
function keyCompletion(
	source: string,
	doc: ReturnType<typeof parseDocument>,
	offset: number,
): InstrumentCompletion | undefined {
	const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
	const m = /^( *)(- +)?([A-Za-z_]*)$/.exec(source.slice(lineStart, offset));
	if (m === null || /\S/.test(lineRest(source, offset))) return undefined;
	const indent = m[1]?.length ?? 0;
	const dash = m[2];
	const word = m[3] ?? "";
	const keys = keysBefore(source, doc, lineStart);
	const matching = (names: readonly string[]) =>
		names.filter((n) => n.startsWith(word));
	if (dash !== undefined) {
		// The list's own key: the last one before the line, left of the dash.
		const parent = [...keys].reverse().find((k) => k.column < indent);
		if (
			parent === undefined ||
			!(LIST_FIELDS as readonly string[]).includes(parent.name)
		)
			return undefined;
		const items = parent.name === "checks" ? ["ensure"] : CONSTRUCTS;
		// The item's fields go at the column after its dash.
		const column = " ".repeat(indent + dash.length);
		return {
			from: offset - word.length,
			options: matching(items).flatMap((name): CompletionOption[] => {
				const key = parent.name === "checks" ? "check" : name;
				const written = SNIPPETS[key];
				return [
					{
						label: name,
						kind: parent.name === "checks" ? "field" : "step",
						apply: `${name}: `,
					},
					...(written === undefined
						? []
						: [
								{
									label: name,
									kind: "snippet" as const,
									detail: SNIPPET_DETAIL[key] ?? "",
									snippet: written(column),
								},
							]),
				];
			}),
		};
	}
	// A field of the map whose keys are at this column, if it hasn't ended since.
	const last = [...keys].reverse().find((k) => k.column <= indent);
	if (last === undefined || last.column !== indent) return undefined;
	const written = last.map.items.flatMap((p) =>
		isScalar(p.key) ? [String(p.key.value)] : [],
	);
	const construct = written.find((k) =>
		(CONSTRUCTS as readonly string[]).includes(k),
	);
	const fields =
		construct !== undefined
			? (FIELDS[construct] ?? [])
			: written.includes("ensure")
				? CHECK_FIELDS.filter((f) => f !== "ensure")
				: undefined;
	if (fields === undefined) return undefined;
	const pad = " ".repeat(indent);
	const field = (name: string): CompletionOption => ({
		label: name,
		kind: "field",
		// A field that holds a list comes with its first item, as Return writes it.
		apply: (LIST_FIELDS as readonly string[]).includes(name)
			? `${pad}${name}:\n${pad}  - `
			: `${pad}${name}: `,
		detail: construct === undefined ? "check" : `${construct} field`,
	});
	// Beside a step, a new step: at the step's dash, one level out.
	const dashAt = " ".repeat(Math.max(indent - 2, 0));
	const steps =
		construct === undefined || !last.item || indent < 2
			? []
			: matching(CONSTRUCTS).flatMap((name): CompletionOption[] => {
					const written = SNIPPETS[name];
					return [
						{
							label: `- ${name}`,
							kind: "step",
							apply: `${dashAt}- ${name}: `,
							detail: "new step",
						},
						...(written === undefined
							? []
							: [
									{
										label: `- ${name}`,
										kind: "snippet" as const,
										detail: `new step ${SNIPPET_DETAIL[name] ?? ""}`.trim(),
										snippet: `${dashAt}- ${written(pad)}`,
									},
								]),
					];
				});
	return {
		from: lineStart,
		to: offset,
		filtered: true,
		options: [
			...matching(fields.filter((f) => !written.includes(f))).map(field),
			...steps,
		],
	};
}

/** Every key written before `end`, in order, with its column and the map holding it. */
function keysBefore(
	source: string,
	doc: ReturnType<typeof parseDocument>,
	end: number,
): readonly KeyAt[] {
	const keys: KeyAt[] = [];
	visit(doc, {
		Pair(_, pair, path) {
			const at = pair.key;
			if (!isScalar(at) || at.range == null || at.range[0] >= end) return;
			const map = path.at(-1);
			if (!isMap(map)) return;
			const start = at.range[0];
			keys.push({
				name: String(at.value),
				offset: start,
				column: start - (source.lastIndexOf("\n", start - 1) + 1),
				map,
				item: isSeq(path.at(-2)),
			});
		},
	});
	return keys.sort((a, b) => a.offset - b.offset);
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

/** What a caret's place gives: where the word starts and ends, and, where a code goes, whose. */
interface Word {
	readonly from: number;
	readonly to?: number;
	readonly codesOf?: Slot;
}

/** A place a code of `name` goes: compared with it, or in its set, beside the codes `taken` there. */
interface Slot {
	readonly name: string;
	readonly taken: readonly string[];
}

/**
 * The word being typed in a written value, or undefined where nothing is offered: the
 * caret inside a word (not at its end), or inside a condition's string other than a code.
 */
function wordIn(
	source: string,
	node: Scalar,
	offset: number,
	field: Field,
): Word | undefined {
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
	const tokens = tokenize(text);
	for (const [i, t] of tokens.entries()) {
		if (t.kind === "end") break;
		const [a, b] = toSource(t.range);
		if (offset < a || offset > b) continue;
		if (t.kind === "string") {
			// Inside a code's quotes (closed ones as closeBrackets pairs them, or open):
			// the code replaces the whole string. Any other string offers nothing.
			const inside = offset > a && (t.open === true || offset < b);
			const slot = inside ? slotBefore(tokens.slice(0, i)) : undefined;
			return slot === undefined
				? undefined
				: { from: a, to: t.open === true ? offset : b, codesOf: slot };
		}
		if (t.kind === "name")
			// At the name's end: what it starts is completed; inside it, nothing.
			return offset === b ? { from: a } : undefined;
		if (offset > a && offset < b) return undefined;
	}
	const before = tokens.filter(
		(t) => t.kind !== "end" && toSource(t.range)[1] <= offset,
	);
	const slot = slotBefore(before);
	return slot === undefined
		? { from: offset }
		: { from: offset, codesOf: slot };
}

const EQUALS = new Set(["=", "<>", "==", "!="]);

/**
 * Whether a code goes after these tokens, and whose: after `name =` (or `<>`, and the
 * mistakes the parser tells), or after `{` or `,` in `name in {…` (or `not_in`).
 */
function slotBefore(tokens: readonly Token[]): Slot | undefined {
	const last = tokens.at(-1);
	if (last === undefined) return undefined;
	if (last.kind === "op" && EQUALS.has(last.text)) {
		const name = tokens.at(-2);
		return name?.kind === "name" && !KEYWORDS.has(name.text)
			? { name: name.text, taken: [] }
			: undefined;
	}
	if (last.kind !== "{" && last.kind !== ",") return undefined;
	// Back over the set's codes so far to its opening brace.
	const taken: string[] = [];
	let i = tokens.length - 1;
	for (; i >= 0 && tokens[i]?.kind !== "{"; i--) {
		const t = tokens[i];
		if (t?.kind === "string") taken.push(t.text);
		else if (t?.kind !== ",") return undefined;
	}
	const keyword = tokens[i - 1];
	const name = tokens[i - 2];
	return (keyword?.text === "in" || keyword?.text === "not_in") &&
		keyword.kind === "name" &&
		name?.kind === "name" &&
		!KEYWORDS.has(name.text)
		? { name: name.text, taken }
		: undefined;
}

/**
 * The codes of the coded answer a slot names, each with its label, but those already in
 * its set; none for a name that isn't coded or that nothing has. A code is a string in
 * the condition language; inside a double-quoted YAML value its quotes are escaped, and
 * where it would touch what comes before (`spaced`) a space goes first.
 */
function codes(
	source: string,
	banks: Readonly<Record<string, BankScope>>,
	{ name, taken }: Slot,
	escaped: boolean,
	spaced: boolean,
): readonly CompletionOption[] {
	const parsed = parseInstrument(source, banks);
	const type = (parsed.names.get(name) ?? parsed.scope.get(name))?.type;
	if (type?.kind !== "code") return [];
	return type.codes
		.filter((c) => !taken.includes(c.code))
		.map((c): CompletionOption => {
			const quoted = escaped ? `\\"${c.code}\\"` : `"${c.code}"`;
			const apply = spaced ? ` ${quoted}` : quoted;
			return {
				label: `"${c.code}"`,
				kind: "code",
				detail: c.label,
				...(apply !== `"${c.code}"` && { apply }),
			};
		});
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
