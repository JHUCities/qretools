/**
 * An instrument's livelits (see surface/livelits.ts): a question picker at every `ask`,
 * a bank picker at every `uses` entry, and the order pickers of a section and an ask.
 * Where they go comes from the parse's shape alone (its steps, ranges and empties), so
 * they don't depend on the banks; what an `ask` or `uses` picker offers is the app's to
 * give, from these functions, as the banks it has are the app's.
 */

import {
	type Document,
	isMap,
	isScalar,
	parseDocument,
	type Scalar,
} from "yaml";
import { type Address, HERE } from "../address.ts";
import type { Expr } from "../cond/ast.ts";
import type { BankScope, Evaluation } from "../evaluate.ts";
import type { Fix, Range } from "../findings.ts";
import { scalar } from "../surface/edit.ts";
import {
	type Choice,
	enumAt,
	type Livelit,
	type Offered,
	type Source,
	valueSpan,
} from "../surface/livelits.ts";
import type { FillSource } from "./check.ts";
import type { InstrumentDraft, Node } from "./draft.ts";
import { parseInstrument, QUALIFIED, type WrittenCond } from "./parse.ts";

const ORDER: readonly Choice[] = [
	{ name: "random", detail: "A new order for each respondent" },
	{ name: "rotate", detail: "Each respondent starts one further along" },
];

/**
 * A picker at a field, empty or holding a value `fits` accepts; none otherwise (a value
 * the author wrote that isn't a choice's shape is their words, not to be replaced).
 */
function pickerAt(
	source: string,
	parsed: Indexed,
	id: string,
	label: string,
	from: Source,
	fits: (written: string) => boolean,
): Livelit[] {
	const field = parsed.ranges[id];
	if (field === undefined) return [];
	const common = { id, label, field, actions: [] };
	const empty = parsed.empties[id];
	if (empty !== undefined)
		return [
			{
				...common,
				at: empty,
				span: [empty, empty],
				picker: { kind: "one", source: from },
			},
		];
	const span = valueSpan(source, field);
	const written = source.slice(span[0], span[1]);
	return fits(written)
		? [
				{
					...common,
					at: span[1],
					span,
					picker: { kind: "one", source: from, current: written },
				},
			]
		: [];
}

interface Indexed {
	readonly ranges: Readonly<Record<string, Range>>;
	readonly empties: Readonly<Record<string, number>>;
}

/**
 * The pickers of an instrument, from its parse: at each `uses` entry the parse read, at
 * each step the parse read as an `ask` (its question, and its options' order) or a
 * `section` (its steps' order), at any depth. Only the steps' shape is read, never what a
 * name resolves to, so the pickers are the same whether its banks are given or not: a
 * choice finds its picker again by id in a parse made without them.
 */
export function instrumentLivelits(
	source: string,
	parsed: Indexed & {
		readonly draft: InstrumentDraft;
		readonly conds: readonly WrittenCond[];
	},
	fills: Readonly<Record<string, readonly FillSource[]>> = {},
): readonly Livelit[] {
	// Parsed when a step first needs it, once.
	let parsedDoc: Document | undefined;
	const doc = () => {
		parsedDoc ??= parseDocument(source, { prettyErrors: false });
		return parsedDoc;
	};
	const steps = (flow: readonly Node[]): Livelit[] =>
		flow.flatMap((n): Livelit[] => {
			switch (n.kind) {
				case "ask": {
					const asked = `${n.question?.alias}.${n.question?.name}`;
					// A declared fill the ask doesn't have yet is an action of its question's
					// picker, offered only where it can be written (a flow map is the author's).
					const fillActions = (
						n.question?.evaluation.draft.fills ?? []
					).flatMap((declared): Fix[] =>
						n.fills.some((fill) => fill.name === declared.name) ||
						fillAdded(doc(), source, n.path, declared.name, asked) === undefined
							? []
							: [
									{
										kind: "fill",
										label: `Fill \`${declared.name}\`…`,
										path: n.path,
										name: declared.name,
										question: asked,
									},
								],
					);
					const askField = parsed.ranges[`${n.path}.ask`];
					const questions = pickerAt(
						source,
						parsed,
						`${n.path}.ask`,
						"Choose a question",
						{ kind: "questions" },
						(w) => QUALIFIED.test(w),
					).map((l) => ({ ...l, actions: fillActions }));
					return [
						...questions,
						// No question picker (the name is in quotes): the actions alone.
						...(questions.length > 0 ||
						fillActions.length === 0 ||
						askField === undefined
							? []
							: [
									{
										id: `${n.path}.fill`,
										label: "Add a question fill",
										at: askField[1],
										field: askField,
										span: [askField[1], askField[1]] as Range,
										picker: { kind: "actions" as const },
										actions: fillActions,
									},
								]),
						...enumAt(
							source,
							parsed,
							`${n.path}.options`,
							"Choose the order of the options",
							ORDER,
						),
						...n.fills.flatMap((fill) =>
							pickerAt(
								source,
								parsed,
								fill.path,
								`Choose a value for ${fill.name}`,
								{
									kind: "enum",
									values: (fills[fill.path] ?? []).map((value) => ({
										name:
											value.presentation === "label"
												? `label(${value.name})`
												: value.name,
										detail:
											value.presentation === "label"
												? "coded response label"
												: value.type.kind === "string"
													? "text"
													: value.type.kind,
									})),
								},
								(w) =>
									/^(?:[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)?|label\([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)?\))$/.test(
										w,
									),
							),
						),
					];
				}
				case "section":
					return [
						...enumAt(
							source,
							parsed,
							`${n.path}.order`,
							"Choose the order of the section's steps",
							ORDER,
						),
						...steps(n.flow),
					];
				case "if":
					return [
						...n.branches.flatMap((b) => steps(b.then)),
						...steps(n.else ?? []),
					];
				case "roster":
				case "each":
					return steps(n.flow);
				default:
					return [];
			}
		});
	const uses = parsed.draft.uses.flatMap((u) =>
		pickerAt(
			source,
			parsed,
			`uses.${u.alias}`,
			"Choose a bank",
			{ kind: "banks" },
			(w) => !w.includes("\n"),
		).map((l) => ({ ...l, actions: bankActions(l.id) })),
	);
	return [
		...uses,
		...steps(parsed.draft.flow),
		...sets(source, parsed.ranges, parsed.conds),
	].sort((a, b) => a.field[0] - b.field[0]);
}

/**
 * The text with one declared fill added, empty, to the `ask` at `path`, the caret after
 * it; undefined when the step isn't that question's any more (a stale action), already
 * names the fill, or isn't written as lines a line can be added to (a flow map, a `fill`
 * holding a word), which the author edits by hand. Under the step's `fill:` at its
 * entries' indent, or as a new `fill:` after the `ask`'s own lines, at its key's column.
 */
export function addInstrumentFill(
	source: string,
	path: string,
	name: string,
	question: string,
): { readonly text: string; readonly caret: number } | undefined {
	return fillAdded(
		parseDocument(source, { prettyErrors: false }),
		source,
		path,
		name,
		question,
	);
}

/** `addInstrumentFill` on a document already parsed: the pickers ask for every missing fill. */
function fillAdded(
	doc: Document,
	source: string,
	path: string,
	name: string,
	question: string,
): { readonly text: string; readonly caret: number } | undefined {
	const step = doc.getIn(
		path.split(".").map((p) => (/^\d+$/.test(p) ? Number(p) : p)),
		true,
	);
	if (!isMap(step) || step.flow) return undefined;
	const pairOf = (key: string) =>
		step.items.find((p) => isScalar(p.key) && p.key.value === key);
	const ask = pairOf("ask");
	const askStart = isScalar(ask?.key) ? ask.key.range?.[0] : undefined;
	if (askStart === undefined) return undefined;
	if (!isScalar(ask?.value) || ask.value.value !== question) return undefined;
	const columnOf = (at: number) => at - (source.lastIndexOf("\n", at - 1) + 1);
	const indent = " ".repeat(columnOf(askStart));
	// New lines after the line holding `end`'s last written character.
	const after = (end: number, lines: string) => {
		let last = end;
		while (last > 0 && /\s/.test(source[last - 1] ?? "")) last--;
		const lineEnd = source.indexOf("\n", last);
		const at = lineEnd === -1 ? source.length : lineEnd;
		return {
			text: source.slice(0, at) + lines + source.slice(at),
			caret: at + lines.length,
		};
	};
	const entry = `${scalar(name)}:`;
	const fill = pairOf("fill");
	if (fill === undefined) {
		const end = ask.value.range?.[1];
		return end === undefined
			? undefined
			: after(end, `\n${indent}fill:\n${indent}  ${entry}`);
	}
	const key = fill.key as Scalar;
	const v = fill.value;
	if (v === null || (isScalar(v) && v.value === null && v.source === ""))
		return key.range == null
			? undefined
			: after(key.range[1], `\n${indent}  ${entry}`);
	if (!isMap(v) || v.flow || v.range == null) return undefined;
	if (v.items.some((p) => isScalar(p.key) && String(p.key.value) === name))
		return undefined;
	const first = v.items[0]?.key;
	const firstStart = isScalar(first) ? first.range?.[0] : undefined;
	// An explicit key (`? a`) starts after its mark: not a column to write a plain key at.
	if (
		firstStart !== undefined &&
		source
			.slice(source.lastIndexOf("\n", firstStart - 1) + 1, firstStart)
			.trim() !== ""
	)
		return undefined;
	return after(
		v.range[1],
		`\n${firstStart === undefined ? `${indent}  ` : " ".repeat(columnOf(firstStart))}${entry}`,
	);
}

/**
 * A checklist at each set of codes a condition tests a name against (`x in {"1", "2"}`,
 * `not_in`), once its braces are both written and it holds only codes: anything else in
 * it (a name, a number) would be lost to a rewrite. Each is named by its condition's path
 * and its order among that condition's sets, read left to right in the expression's
 * pre-order. None in a block scalar, which may rewrap the text written into it.
 */
function sets(
	source: string,
	ranges: Readonly<Record<string, Range>>,
	conds: readonly WrittenCond[],
): Livelit[] {
	return conds.flatMap(({ path, cond, form }) => {
		if (form === "block") return [];
		const members = membersOf(cond.expr);
		// The button after the whole value when the condition has one set (never inside
		// its closing quote), after each set's `}` when it has several.
		const field = ranges[path];
		const valueEnd =
			members.length === 1 && field !== undefined
				? valueSpan(source, field)[1]
				: undefined;
		return members.flatMap((m, n): Livelit[] => {
			const { operand, setRange } = m;
			const chosen = m.set.flatMap((e) =>
				e.kind === "string" ? [e.value] : [],
			);
			if (
				operand.kind !== "name" ||
				setRange === undefined ||
				chosen.length !== m.set.length
			)
				return [];
			return [
				{
					id: `${path}#${n}`,
					label: `Choose the codes of ${operand.name}`,
					at: valueEnd ?? setRange[1],
					field: m.range,
					span: setRange,
					picker: {
						kind: "many",
						source: { kind: "codes", name: operand.name },
						chosen,
						// The condition language has no empty set.
						min: 1,
					},
					actions: [],
					set: form,
				},
			];
		});
	});
}

type Member = Extract<Expr, { kind: "member" }>;

/** Every `in` and `not_in` of an expression, in pre-order, left to right. */
function membersOf(e: Expr): Member[] {
	switch (e.kind) {
		case "member":
			return [e, ...membersOf(e.operand), ...e.set.flatMap(membersOf)];
		case "unary":
			return membersOf(e.operand);
		case "binary":
			return [...membersOf(e.left), ...membersOf(e.right)];
		case "call":
			return e.args.flatMap(membersOf);
		default:
			return [];
	}
}

/**
 * The codes a condition's name can be tested against, each with its label (a bank's
 * missing codes included), or why it has none: what a set's checklist offers, read from
 * the instrument with its banks as the condition's own type is.
 */
export function codeChoices(
	source: string,
	banks: Readonly<Record<string, BankScope>>,
	name: string,
): Offered {
	const parsed = parseInstrument(source, banks);
	const type = (parsed.names.get(name) ?? parsed.scope.get(name))?.type;
	switch (type?.kind) {
		case "code":
			return type.codes.map((c) => ({ name: c.code, detail: c.label }));
		case undefined:
			return { reason: `Nothing is named \`${name}\` here.` };
		case "unknown":
			return { reason: `What \`${name}\` holds isn't known yet.` };
		case "number":
			return { reason: `\`${name}\` is a number: it has no codes.` };
		case "string":
			return { reason: `\`${name}\` is text: it has no codes.` };
		case "boolean":
			return { reason: `\`${name}\` is true or false: it has no codes.` };
		default:
			return type satisfies never;
	}
}

/** What a `uses` picker offers besides the banks there are: one on GitHub. */
const bankActions = (path: string): readonly Fix[] => [
	{ kind: "bank", label: "Use a bank from GitHub…", path },
];

/** What a question's answer is, in words: "select one, 5 options", "number", "open". */
function answerOf(domain: Evaluation["draft"]["domain"]): string | undefined {
	if (domain === undefined) return undefined;
	if (domain.kind === "number") return "number";
	if (domain.kind === "open") return "open";
	const how = domain.select === "many" ? "select all that apply" : "select one";
	return `${how}, ${domain.codes.length} options`;
}

/**
 * Every question of the banks given, `alias.name`, with what its answer is and its title
 * or text: the answer is what tells two near-identical questions apart.
 */
export function questionChoices(
	banks: Readonly<Record<string, BankScope>>,
): readonly Choice[] {
	return Object.entries(banks).flatMap(([alias, bank]) =>
		[...bank.index.names.entries()].map(([name, paths]): Choice => {
			const [path] = [...paths].sort();
			const draft =
				path === undefined ? undefined : bank.questions[path]?.draft;
			const words = draft?.title ?? draft?.text;
			const answer = answerOf(draft?.domain);
			return {
				name: `${alias}.${name}`,
				detail: [answer, words].filter((w) => w !== undefined).join(" · "),
			};
		}),
	);
}

/**
 * The banks an instrument can use: its own workspace's (`../`), then those in other
 * repositories its instruments already use, each spelled
 * as it was written there (`JHUCities/…`, not its lowercased key), so choosing one
 * changes nothing another instrument's diff would show.
 */
export function bankChoices(
	remote: readonly Extract<Address, { kind: "remote" }>[],
): readonly Choice[] {
	return [
		{ name: HERE, detail: "This workspace's questions" },
		...remote.map((a) => ({
			name: `${a.owner}/${a.repo}${a.path === "" ? "" : `/${a.path}`}@${a.ref}`,
			detail: "A bank on GitHub",
		})),
	];
}
