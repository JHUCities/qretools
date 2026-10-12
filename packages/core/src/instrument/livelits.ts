/**
 * An instrument's livelits (see surface/livelits.ts): a question picker at every `ask`,
 * a bank picker at every `uses` entry, and the order pickers of a section and an ask.
 * Where they go comes from the parse's shape alone (its steps, ranges and empties), so
 * they don't depend on the banks; what an `ask` or `uses` picker offers is the app's to
 * give, from these functions, as the banks it has are the app's.
 */
import { type Address, relativeFolder } from "../address.ts";
import type { Expr } from "../cond/ast.ts";
import type { BankScope, Evaluation } from "../evaluate.ts";
import type { Fix, Range } from "../findings.ts";
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
	const steps = (flow: readonly Node[]): Livelit[] =>
		flow.flatMap((n): Livelit[] => {
			switch (n.kind) {
				case "ask":
					const missing = (n.question?.evaluation.draft.fills ?? []).filter(
						(declared) => !n.fills.some((fill) => fill.name === declared.name),
					);
					const askField = parsed.ranges[`${n.path}.ask`];
					return [
						...(askField === undefined || missing.length === 0
							? []
							: [
									{
										id: `${n.path}.fill`,
										label: "Add a question fill",
										at: askField[1],
										field: askField,
										span: [askField[1], askField[1]] as Range,
										picker: { kind: "actions" as const },
										actions: missing.map((fill) => ({
											kind: "fill" as const,
											label: `Fill \`${fill.name}\`…`,
											path: n.path,
											name: fill.name,
											question: `${n.question?.alias}.${n.question?.name}`,
										})),
									},
								]),
						...pickerAt(
							source,
							parsed,
							`${n.path}.ask`,
							"Choose a question",
							{ kind: "questions" },
							(w) => QUALIFIED.test(w),
						),
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

/** Add an empty fill below one `ask`, preserving the author's surrounding indentation. */
export function addInstrumentFill(
	source: string,
	path: string,
	name: string,
	question: string,
): { readonly text: string; readonly caret: number } | undefined {
	const parsed = parseInstrument(source, {});
	const range = parsed.ranges[path];
	const ask = parsed.ranges[`${path}.ask`];
	if (range === undefined || ask === undefined) return undefined;
	const written = source.slice(ask[0], ask[1]);
	const current =
		/^(?<indent>[ \t]*)(?<inline>-\s*)?ask:\s*(?<name>.+?)\s*$/m.exec(written);
	const rawName = current?.groups?.name;
	const currentName =
		rawName?.startsWith('"') && rawName.endsWith('"')
			? rawName.slice(1, -1)
			: rawName?.startsWith("'") && rawName.endsWith("'")
				? rawName.slice(1, -1)
				: rawName;
	if (currentName !== question) return undefined;
	const currentLine = source.lastIndexOf("\n", ask[0] + current.index) + 1;
	const base = /^([ \t]*)/.exec(source.slice(currentLine))?.[1];
	if (base === undefined) return undefined;
	const fillIndent = /-\s*ask:/.test(source.slice(currentLine, ask[1]))
		? `${base}  `
		: base;
	const lead = source[range[1] - 1] === "\n" ? "" : "\n";
	const inserted = `${lead}${fillIndent}fill:\n${fillIndent}  ${name}:`;
	return {
		text: source.slice(0, range[1]) + inserted + source.slice(range[1]),
		caret: range[1] + inserted.length,
	};
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

/** What a `uses` picker offers besides the banks there are: a new one, or one on GitHub. */
const bankActions = (path: string): readonly Fix[] => [
	{ kind: "bank", label: "New bank in this workspace…", how: "new", path },
	{ kind: "bank", label: "Use a bank from GitHub…", how: "import", path },
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
 * The banks an instrument in `folder` can use: the workspace's own, written from there
 * (`../banks/hh`), then those in other repositories its instruments already use, each
 * spelled as it was written there (`JHUCities/…`, not its lowercased key), so choosing
 * one changes nothing another instrument's diff would show.
 */
export function bankChoices(
	folder: string,
	local: readonly string[],
	remote: readonly Extract<Address, { kind: "remote" }>[],
): readonly Choice[] {
	return [
		...local.map((bank) => ({
			name: relativeFolder(folder, bank),
			detail: bank === "" ? "This workspace's bank" : `The bank in ${bank}`,
		})),
		...remote.map((a) => ({
			name: `${a.owner}/${a.repo}${a.path === "" ? "" : `/${a.path}`}@${a.ref}`,
			detail: "A bank on GitHub",
		})),
	];
}
