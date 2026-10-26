/**
 * What an instrument's flow says about itself, in QL's tradition: whether every name
 * is asked or computed before it's read, whether a question is asked twice on one path,
 * whether every branch can be taken, what a check reads, and whether fills fit. One
 * structured pass over the flow, as a compiler checks definite assignment: through an
 * `if`, a name is asked for certain only if every branch asks it, and possibly if any
 * does. Exclusive branches may each ask the same question.
 */
import { type Expr, namesOf } from "../cond/ast.ts";
import { evaluateCondition, UNKNOWN } from "../cond/eval.ts";
import { printCondition } from "../cond/print.ts";
import { type Type, typeOf } from "../cond/type.ts";
import type { Finding, Range } from "../findings.ts";
import { type Named as BankNamed, definedVariables } from "../surface/draft.ts";
import type { TextEntry } from "../surface/env.ts";
import type {
	Cond,
	InstrumentDraft,
	Named,
	Node,
	Placeholder,
	QuestionRef,
	UniverseRef,
} from "./draft.ts";
import { fillCompatibility } from "./fills.ts";
import { answerType, type ParsedInstrument } from "./parse.ts";

/** What has been asked or computed on the way to a step: for certain, or on some path. */
interface Seen {
	readonly definite: ReadonlySet<string>;
	readonly possible: ReadonlySet<string>;
	/** Values that exist on every path, and the roster row they belong to when any. */
	readonly values: ReadonlyMap<string, Available>;
}

interface Available {
	readonly named: Named;
	readonly row?: string;
}

export interface FillSource {
	readonly name: string;
	readonly type: Type;
	/** What to write at this fill site: a code becomes `label(name)`. */
	readonly presentation: "value" | "label";
}

export interface InstrumentCheck {
	readonly findings: readonly Finding[];
	/** Values a fill may read at its exact point in the flow. */
	readonly fills: Readonly<Record<string, readonly FillSource[]>>;
}

/** Where a name is read, which decides what an unasked (empty) answer does there. */
type Use = "branch" | "stop" | "more" | "check" | "value" | "count" | "text";

/**
 * What a missing answer does where it's read, and what the author can do about it. Each
 * hint says who it's about, so it reads on its own, without its message.
 */
function emptyHint(name: string, use: Use, computed: boolean): string {
	const n = `\`${name}\``;
	const missing = computed
		? `Anyone for whom ${n} isn't computed by this point has no value for it`
		: `Anyone not asked ${n} by this point has no answer to it`;
	const isnull = `\`isnull(${name})\``;
	const add = `add \`or isnull(${name})\``;
	// "May": a condition can still be true without this answer (`a = "1" or x = "2"`).
	const untrue = `${missing}, so this condition may not be true for them`;
	switch (use) {
		case "branch":
			return `${untrue} and the branch may be skipped. To include them, ${add}; to treat them differently, give them a branch on ${isnull}.`;
		case "stop":
			return `${untrue} and they may not be stopped here. To stop them too, ${add}.`;
		case "more":
			return `${untrue} and their roster may end here. To ask them for more rows, ${add}.`;
		case "check":
			return `${missing}, so this check may pass for them and its message may not be shown. If the check should cover them too, add a check on ${isnull}.`;
		case "value":
			return `${missing}, so this value may be empty for them. To give them a value, compute it in a branch on ${isnull}.`;
		case "count":
			return `${missing}, so this roster may have no rows for them. To give them rows, ${computed ? "compute" : "ask"} ${n} on every route that reaches here.`;
		case "text":
			return computed
				? `${missing}, so this text shows nothing in its place for them. Compute ${n} on every route that reaches here, or move this text into the branch that computes it.`
				: `${missing}, so this text shows nothing in its place for them. Ask ${n} on every route that reaches here, or move this text into the branch that asks it.`;
		default:
			return use satisfies never;
	}
}

const NONE: Seen = {
	definite: new Set(),
	possible: new Set(),
	values: new Map(),
};

const add = (
	s: Seen,
	keys: readonly string[],
	values: readonly Available[] = [],
): Seen => ({
	definite: new Set([...s.definite, ...keys]),
	possible: new Set([...s.possible, ...keys]),
	values: new Map<string, Available>([
		...s.values,
		...values.map((v) => [nameOf(v.named), v] as const),
	]),
});

/** After branches: certain only where every branch is, possible where any is. */
const merge = (branches: readonly Seen[]): Seen => {
	const [first, ...rest] = branches;
	if (first === undefined) return NONE;
	return {
		definite: new Set(
			[...first.definite].filter((k) => rest.every((b) => b.definite.has(k))),
		),
		possible: new Set(branches.flatMap((b) => [...b.possible])),
		values: new Map(
			[...first.values].filter(([name, value]) =>
				rest.every((b) => sameAvailable(value, b.values.get(name))),
			),
		),
	};
};

/** A branch may reuse an alias only when it remains the same usable value after joining. */
const sameAvailable = (a: Available, b: Available | undefined): boolean =>
	b !== undefined &&
	a.row === b.row &&
	JSON.stringify(a.named.type) === JSON.stringify(b.named.type);

/** A question asked, as a key: asking it again on one path needs `as:`. */
const askedKey = (q: QuestionRef): string => `ask:${q.alias}.${q.name}`;

/** The variables an ask records, as names in conditions read them. */
const recorded = (q: QuestionRef): readonly string[] =>
	definedVariables(q.evaluation.draft).map((d) => `${q.alias}.${d.name}`);

export function inspectInstrument(parsed: ParsedInstrument): InstrumentCheck {
	const { draft, names } = parsed;
	const findings: Finding[] = [];
	const fills: Record<string, readonly FillSource[]> = {};
	const say = (f: Finding) => findings.push(f);
	/** The rosters a step is within, innermost last, and the roster each row's answer belongs to. */
	const rows: string[] = [];
	const rowOf = new Map<string, string>();
	/** What every row of each roster answers for certain. */
	const perRow = new Map<string, readonly Available[]>();
	const inRows = <T>(roster: string | undefined, go: () => T): T => {
		if (roster !== undefined) rows.push(roster);
		try {
			return go();
		} finally {
			if (roster !== undefined) rows.pop();
		}
	};

	/** A value read here: what it means must be asked or computed by now. */
	const read = (cond: Cond | undefined, path: string, seen: Seen, use: Use) => {
		if (cond === undefined) return;
		const guarded = isnullArgs(cond.expr);
		for (const { name, range } of namesOf(cond.expr))
			readName(name, range, path, seen, guarded.has(name), use);
	};
	const readName = (
		name: string,
		range: Range | undefined,
		path: string,
		seen: Seen,
		guarded: boolean,
		use: Use,
	) => {
		const named = names.get(name);
		if (named === undefined || named.kind === "input" || named.kind === "index")
			return;
		const key = keyOf(named, name);
		const row = rowOf.get(key);
		if (row !== undefined && !rows.includes(row)) {
			say({
				code: "misplaced",
				severity: "error",
				path,
				message: `\`${name}\` is answered once for each row of \`${row}\`, so it's read inside \`${row}\` or an \`each\` over it.`,
				...(range !== undefined && { range }),
			});
			return;
		}
		const what = named.kind === "compute" ? "computed" : "asked";
		if (!seen.possible.has(key))
			say({
				code: "order",
				severity: "error",
				path,
				message: `\`${name}\` is read here before it's ${what}.`,
				hint:
					named.kind === "compute"
						? "Compute it earlier in the flow."
						: "Ask it earlier, on every route that reaches here.",
				...(range !== undefined && { range }),
			});
		else if (!seen.definite.has(key) && !guarded)
			say({
				code: "order",
				severity: "info",
				path,
				message:
					named.kind === "compute"
						? `It is possible that \`${name}\` hasn't been computed for some respondents by this point.`
						: `It is possible that some respondents haven't been asked \`${name}\` by this point.`,
				hint: emptyHint(name, use, named.kind === "compute"),
				...(range !== undefined && { range }),
			});
	};
	/** `{{name}}` placeholders in a statement read their names too, each at its place. */
	const readPlaceholders = (
		reads: readonly Placeholder[],
		path: string,
		seen: Seen,
	) => {
		for (const p of reads) readName(p.name, p.range, path, seen, false, "text");
	};

	/** A condition that comes out the same whatever is answered: a branch that's never, or always, taken. */
	const constant = (cond: Cond | undefined): boolean | undefined => {
		if (cond === undefined) return undefined;
		const v = evaluateCondition(cond.expr, () => UNKNOWN);
		return typeof v === "boolean" ? v : undefined;
	};

	/**
	 * Steps in order. A `stop` screens out whom the instrument isn't for, so what follows
	 * it is still asked of everyone the instrument is about.
	 */
	const flow = (
		nodes: readonly Node[],
		seen: Seen,
		conditional: boolean,
	): Seen => {
		let at = seen;
		for (const n of nodes) at = step(n, at, conditional);
		return at;
	};

	const step = (node: Node, seen: Seen, conditional: boolean): Seen => {
		switch (node.kind) {
			case "ask": {
				const q = node.question;
				const sources =
					node.fills.length === 0 ? [] : available(seen, parsed, rows);
				for (const fill of node.fills) {
					const want = q?.evaluation.draft.fills?.find(
						(f) => f.name === fill.name,
					)?.type;
					fills[fill.path] = sources.flatMap((source) => {
						const compatibility = fillCompatibility(want, source.type);
						return compatibility.kind === "compatible"
							? [
									{
										...source,
										presentation:
											compatibility.presentation === "label"
												? "label"
												: "value",
									},
								]
							: [];
					});
				}
				for (const fill of node.fills)
					read(fill.source, fill.path, seen, "text");
				// Unresolved, it still records its `as`: the hole already says what's wrong.
				if (q === undefined)
					return node.as === undefined ? seen : add(seen, [node.as]);
				const key = askedKey(q);
				if (node.as !== undefined && seen.possible.has(node.as))
					say({
						code: "name-clash",
						severity: "error",
						path: `${node.path}.as`,
						message: `\`${node.as}\` is already recorded on ${seen.definite.has(node.as) ? "this" : "a"} path here.`,
						hint: "Asked again on one path, the answer needs a name of its own.",
					});
				if (node.as === undefined && seen.possible.has(key))
					say({
						code: "name-clash",
						severity: "error",
						path: `${node.path}.ask`,
						message: `\`${q.alias}.${q.name}\` is already asked on ${seen.definite.has(key) ? "this" : "a"} path here, so its answer would be recorded twice.`,
						hint: "To ask it again, give the second answer its own name with `as:`.",
					});
				universe(node, conditional);
				fillTypes(node);
				const keys = node.as === undefined ? [key, ...recorded(q)] : [node.as];
				// Asked within a roster, the answer is one per row of the innermost.
				const inner = rows.at(-1);
				if (inner !== undefined) for (const k of keys) rowOf.set(k, inner);
				const after = add(
					seen,
					keys,
					q === undefined ? [] : outputs(q, parsed, node.as, inner),
				);
				// A check reads the answer just given, and what came before.
				for (const check of node.checks) {
					read(check.ensure, `${check.path}.ensure`, after, "check");
					readPlaceholders(check.messageReads, `${check.path}.message`, after);
				}
				return after;
			}
			case "say":
				readPlaceholders(node.reads, `${node.path}.say`, seen);
				return seen;
			case "section":
				return flow(node.flow, seen, conditional);
			case "if": {
				const ends: Seen[] = [];
				let decided = false;
				for (const branch of node.branches) {
					read(branch.cond, `${branch.path}.if`, seen, "branch");
					const value = constant(branch.cond);
					if (decided || value === false)
						say({
							code: "unreachable",
							severity: "warning",
							path: `${branch.path}.if`,
							message: decided
								? "An earlier condition is always true, so this branch is never taken."
								: "This condition is never true, so its branch is never taken.",
						});
					ends.push(flow(branch.then, seen, true));
					if (value === true) decided = true;
				}
				if (node.else !== undefined) {
					if (decided)
						say({
							code: "unreachable",
							severity: "warning",
							path: `${node.path}.else`,
							message:
								"A condition above is always true, so `else` is never taken.",
						});
					ends.push(flow(node.else, seen, true));
				} else ends.push(seen);
				return merge(ends);
			}
			case "stop":
				read(node.cond, `${node.path}.stop`, seen, "stop");
				readPlaceholders(node.sayReads, `${node.path}.say`, seen);
				if (constant(node.cond) === true)
					say({
						code: "unreachable",
						severity: "warning",
						path: `${node.path}.stop`,
						message:
							"This condition is always true, so nothing after it is ever asked.",
					});
				return seen;
			case "compute": {
				read(node.value, `${node.path}.value`, seen, "value");
				if (node.name === undefined) return seen;
				const named = parsed.scope.get(node.name);
				const row = rows.at(-1);
				if (row !== undefined) rowOf.set(node.name, row);
				return add(
					seen,
					[node.name],
					named === undefined
						? []
						: [{ named, ...(row !== undefined && { row }) }],
				);
			}
			case "roster": {
				// `count` is read before the rows; `more` at the end of each.
				if (node.end?.kind === "count")
					read(node.end.value, `${node.path}.count`, seen, "count");
				const end = inRows(node.name, () => {
					const body = flow(node.flow, seen, true);
					if (node.end?.kind === "more")
						read(node.end.cond, `${node.path}.more`, body, "more");
					return body;
				});
				if (node.name !== undefined)
					perRow.set(
						node.name,
						[...end.values.values()].filter((v) => v.row === node.name),
					);
				// There may be no rows at all. (A `more` roster always has one, since it asks
				// after each; kept cautious on purpose: a row's own answers are read only
				// within it anyway.)
				return merge([seen, end]);
			}
			case "each": {
				// Within a row, what every row answers is answered.
				const answered =
					node.roster === undefined ? undefined : perRow.get(node.roster);
				const start =
					answered === undefined
						? seen
						: add(
								seen,
								answered.map((v) => nameOf(v.named)),
								answered,
							);
				const end = inRows(node.roster, () => flow(node.flow, start, true));
				return merge([seen, end]);
			}
			case "hole":
				return seen;
			default:
				return node satisfies never;
		}
	};

	/**
	 * Whom a question is asked of, against the path that reaches it: advice, not rules.
	 * Its universe is the ask's, else its bank question's, else the instrument's.
	 */
	const universe = (
		node: Extract<Node, { kind: "ask" }>,
		conditional: boolean,
	) => {
		const q = node.question;
		const bank = q?.evaluation.draft.universe;
		const effective =
			(node.universe === undefined ? undefined : askUniverse(node.universe)) ??
			(bank === undefined || q === undefined
				? undefined
				: bankUniverse(q.alias, bank)) ??
			(draft.universe === undefined ? undefined : askUniverse(draft.universe));
		const everyone =
			draft.universe === undefined ? undefined : askUniverse(draft.universe);
		const at = `${node.path}.ask`;
		if (
			!conditional &&
			effective !== undefined &&
			effective.key !== everyone?.key
		)
			say({
				code: "universe",
				severity: "info",
				path: at,
				message: `Everyone is asked this, but its universe is ${effective.said}.`,
				hint: "Ask it under the condition that picks out its universe, or widen the universe.",
			});
		if (
			conditional &&
			(effective === undefined || effective.key === everyone?.key)
		)
			say({
				code: "universe",
				severity: "info",
				path: at,
				message:
					"Only some respondents reach this question, but its universe says everyone.",
				hint: "Say whom it's asked of with `universe:`.",
			});
	};

	/** A fill's declared parameter type governs what may be bound at this ask. */
	const fillTypes = (node: Extract<Node, { kind: "ask" }>) => {
		const declared = node.question?.evaluation.draft.fills ?? [];
		for (const fill of node.fills) {
			const want = declared.find((f) => f.name === fill.name)?.type;
			if (fill.source === undefined) continue;
			const value =
				fill.presentation === "label" && fill.source.expr.kind === "call"
					? fill.source.expr.args[0]
					: fill.source.expr;
			if (value === undefined) continue;
			const { type } = typeOf(value, (n) => names.get(n)?.type);
			const compatibility = fillCompatibility(want, type);
			if (compatibility.kind === "incompatible")
				say({
					code: "type",
					severity: "error",
					path: fill.path,
					message: `\`${fill.name}\` is a number fill, so it needs a number to fill it.`,
					range: value.range,
				});
			if (
				want === "text" &&
				type.kind === "code" &&
				fill.presentation !== "label"
			)
				say({
					code: "type",
					severity: "error",
					path: fill.path,
					message: `\`${fill.name}\` is text, so a coded answer needs its respondent-facing label.`,
					hint: `Write \`label(${printCondition(value)})\`.`,
					range: value.range,
				});
		}
	};

	flow(draft.flow, NONE, false);
	variableNames(draft, say);
	return { findings, fills };
}

/** Backwards-compatible findings-only view for existing callers. */
export const checkInstrument = (parsed: ParsedInstrument): readonly Finding[] =>
	inspectInstrument(parsed).findings;

const nameOf = (named: Named): string => {
	switch (named.kind) {
		case "bank":
			return `${named.alias}.${named.variable}`;
		case "input":
			return named.input.name;
		default:
			return named.name;
	}
};

function available(
	seen: Seen,
	parsed: ParsedInstrument,
	rows: readonly string[],
): readonly FillSource[] {
	const inputs = [...parsed.scope.values()].flatMap((n) =>
		n.kind === "input"
			? [{ name: n.input.name, type: n.type, presentation: "value" as const }]
			: [],
	);
	const values = [...seen.values.values()].flatMap((v) =>
		v.row === undefined || rows.includes(v.row)
			? [
					{
						name: nameOf(v.named),
						type: v.named.type,
						presentation: "value" as const,
					},
				]
			: [],
	);
	const all = [...inputs, ...values];
	const count = new Map<string, number>();
	for (const { name } of all) count.set(name, (count.get(name) ?? 0) + 1);
	return all
		.filter((value) => count.get(value.name) === 1)
		.sort((a, b) => a.name.localeCompare(b.name));
}

function outputs(
	q: QuestionRef,
	parsed: ParsedInstrument,
	as: string | undefined,
	row: string | undefined,
): readonly Available[] {
	const bank = parsed.banks[q.alias];
	const type = answerType(q, bank);
	const named = (name: string, valueType: Type): Available => ({
		named: {
			kind: "bank",
			alias: q.alias,
			variable: name,
			question: q,
			type: valueType,
		},
		...(row !== undefined && { row }),
	});
	if (as !== undefined)
		return [
			{
				named: { kind: "as", name: as, path: q.path, question: q, type },
				...(row !== undefined && { row }),
			},
		];
	return definedVariables(q.evaluation.draft).map((d) =>
		named(d.name, d.option === undefined ? type : answerType(q, bank, true)),
	);
}

/** The key a name is asked or computed under. */
const keyOf = (named: Named, name: string): string =>
	named.kind === "bank" ? `${named.alias}.${named.variable}` : name;

/** Names read inside `isnull(...)`: reading them where they may be unanswered is the point. */
function isnullArgs(e: Expr): ReadonlySet<string> {
	const out = new Set<string>();
	const walk = (x: Expr, inside: boolean): void => {
		if (x.kind === "name") {
			if (inside) out.add(x.name);
		} else if (x.kind === "unary") walk(x.operand, inside);
		else if (x.kind === "binary") {
			walk(x.left, inside);
			walk(x.right, inside);
		} else if (x.kind === "member") {
			walk(x.operand, inside);
			for (const s of x.set) walk(s, inside);
		} else if (x.kind === "call")
			for (const a of x.args) walk(a, inside || x.fn === "isnull");
	};
	walk(e, false);
	return out;
}

/** A universe as a key to compare and words to say: a shared one by name, prose by its text. */
interface UniverseKey {
	readonly key: string;
	readonly said: string;
}
const askUniverse = (u: UniverseRef): UniverseKey =>
	u.kind === "ref"
		? { key: `${u.alias}.${u.name}`, said: `\`${u.alias}.${u.name}\`` }
		: { key: `text:${u.text}`, said: `"${u.text}"` };
const bankUniverse = (alias: string, u: BankNamed<TextEntry>): UniverseKey =>
	u.kind === "ref"
		? { key: `${alias}.${u.name}`, said: `\`${alias}.${u.name}\`` }
		: { key: `text:${u.text}`, said: `"${u.text}"` };

/**
 * Every variable the instrument records has its own name in the export: two banks'
 * questions recording one name, or an `as` reusing one, would be two columns of one name.
 */
function variableNames(
	draft: InstrumentDraft,
	say: (f: Finding) => void,
): void {
	const owner = new Map<string, string>();
	const claim = (name: string, by: string, path: string) => {
		const earlier = owner.get(name);
		if (earlier === undefined) owner.set(name, by);
		else if (earlier !== by)
			say({
				code: "name-clash",
				severity: "error",
				path,
				message: `The variable \`${name}\` would be recorded by ${earlier} and by ${by}.`,
				hint: "Ask one of them under another name with `as:`.",
			});
	};
	for (const input of draft.inputs)
		claim(input.name, `the input \`${input.name}\``, input.path);
	const walk = (nodes: readonly Node[]): void => {
		for (const node of nodes)
			switch (node.kind) {
				case "ask": {
					const q = node.question;
					if (q === undefined) break;
					const by = `\`${q.alias}.${q.name}\``;
					if (node.as !== undefined)
						claim(node.as, `${by} asked again`, `${node.path}.as`);
					else
						for (const d of definedVariables(q.evaluation.draft))
							claim(d.name, by, `${node.path}.ask`);
					break;
				}
				case "section":
				case "roster":
				case "each":
					walk(node.flow);
					break;
				case "if":
					for (const b of node.branches) walk(b.then);
					if (node.else !== undefined) walk(node.else);
					break;
				case "compute":
					// Computed values aren't recorded in v1.
					break;
			}
	};
	walk(draft.flow);
}
