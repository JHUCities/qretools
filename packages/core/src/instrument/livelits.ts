/**
 * An instrument's livelits (see surface/livelits.ts): a question picker at every `ask`,
 * a bank picker at every `uses` entry, and the order pickers of a section and an ask.
 * Where they go comes from the parse's shape alone (its steps, ranges and empties), so
 * they don't depend on the banks; what an `ask` or `uses` picker offers is the app's to
 * give, from these functions, as the banks it has are the app's.
 */
import { relativeFolder } from "../address.ts";
import type { BankScope, Evaluation } from "../evaluate.ts";
import type { Range } from "../findings.ts";
import {
	type Choice,
	enumAt,
	type Livelit,
	type Source,
	valueSpan,
} from "../surface/livelits.ts";
import type { InstrumentDraft, Node } from "./draft.ts";
import { QUALIFIED } from "./parse.ts";

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
	parsed: Indexed & { readonly draft: InstrumentDraft },
): readonly Livelit[] {
	const steps = (flow: readonly Node[]): Livelit[] =>
		flow.flatMap((n): Livelit[] => {
			switch (n.kind) {
				case "ask":
					return [
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
		),
	);
	return [...uses, ...steps(parsed.draft.flow)].sort(
		(a, b) => a.field[0] - b.field[0],
	);
}

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
 * (`../banks/hh`), then those in other repositories other instruments already use.
 */
export function bankChoices(
	folder: string,
	local: readonly string[],
	remote: readonly string[],
): readonly Choice[] {
	return [
		...local.map((bank) => ({
			name: relativeFolder(folder, bank),
			detail: bank === "" ? "This workspace's bank" : `The bank in ${bank}`,
		})),
		...remote.map((address) => ({
			name: address,
			detail: "A bank on GitHub",
		})),
	];
}
