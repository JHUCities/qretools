/**
 * Paths and reach: every way through an instrument's routing, counted, never listed.
 *
 * A path is one outcome for each branch met (an `if`'s branches, a screen-out's yes or no),
 * kept only if some answers make it happen given the outcomes before it on that path. So
 * two conditions on one input can't both be taken one way and then the other, and a
 * question not asked on a path reads as null (`isnull(x)` holds where x wasn't asked).
 * Paths are structural, not weighted: a path is one way through, not a share of respondents.
 *
 * The count is a forward pass over the flow. What is carried is, for each set of answers
 * still possible (kept only for the variables a later condition reads), how many paths
 * have asked how many questions. Paths whose futures can't differ share an entry, so an
 * instrument with millions of paths is counted without listing them. Answers are kept in
 * parts, one per group of variables some condition has tied together, so ten questions
 * read separately later are ten short lists, not every combination of their answers.
 */

import type { Expr } from "../cond/ast.ts";
import { evaluateCondition, UNKNOWN, type Value } from "../cond/eval.ts";
import type {
	Condition,
	Instrument,
	Parsed,
	ReadInstruments,
	Source,
	Step,
} from "./read.ts";

/** Where a question is asked from, over the paths that reach it. */
export interface Reach {
	readonly paths: number;
	/** The fewest and most questions asked before it. */
	readonly fewest: number;
	readonly most: number;
}

/** The same counts with one input held to one of its codes. */
export interface ByInput {
	readonly variable: string;
	readonly code: string;
	readonly label: string;
	readonly paths: number;
	readonly stopped: number;
	/** By ask ID, as `Paths.reach` and `Paths.completed`. */
	readonly reach: ReadonlyMap<string, Reach>;
	readonly completed: ReadonlyMap<string, number>;
}

export interface Paths {
	readonly paths: number;
	/** Of which end at a screen-out. */
	readonly stopped: number;
	/** Questions asked on a path not screened out, and how many such paths ask that many. */
	readonly lengths: ReadonlyMap<number, number>;
	/** By ask ID, over every path; an ask no path reaches is absent. */
	readonly reach: ReadonlyMap<string, Reach>;
	/** By ask ID: how many paths not screened out ask it (so whether it's asked on all of them). */
	readonly completed: ReadonlyMap<string, number>;
	/** By ask ID: the variables the conditions on the way to it read, in order. */
	readonly decidedBy: ReadonlyMap<string, readonly string[]>;
	/** Each computed value the routing reads, and the variables its definition reads. */
	readonly computes: ReadonlyMap<string, readonly string[]>;
	/** For each input some condition reads with a code list, each code in turn. */
	readonly byInput: readonly ByInput[];
	/** Rosters and loops, by step ID: their questions are counted once, as for one row. */
	readonly repeated: readonly string[];
	/** Conditions kept as written: both outcomes are counted. */
	readonly unread: number;
}

/** An instrument's paths, and its reach with each routing input held to each of its codes. */
export function pathsOf(
	instrument: Instrument,
	inputs: ReadInstruments["inputs"],
): Paths {
	const all = countPaths(instrument, new Map());
	const read = readsOf(instrument.flow);
	const byInput = inputs.flatMap((i) =>
		read.has(i.variable) && i.domain?.kind === "choice"
			? i.domain.choices.map((c) => {
					const one = countPaths(instrument, new Map([[i.variable, c.code]]));
					return {
						variable: i.variable,
						code: c.code,
						label: c.label,
						paths: one.paths,
						stopped: one.stopped,
						reach: one.reach,
						completed: one.completed,
					};
				})
			: [],
	);
	return { ...all, byInput };
}

/** Answers possible so far: a variable absent is null. */
type World = Readonly<Record<string, Value>>;
/** Questions asked so far, and how many paths have asked that many. */
type Lengths = ReadonlyMap<number, number>;
/** The answers still possible for variables a condition has tied together. */
interface Part {
	readonly vars: readonly string[];
	readonly worlds: readonly World[];
}
/** Paths that share the answers still possible: how many asked how many questions, and which questions they reached. */
interface Entry {
	/** Independent of each other: any world of one goes with any world of another. */
	readonly parts: readonly Part[];
	readonly lengths: Lengths;
	/** Tallied as paths split, so each path that goes on to branch counts once per branch. */
	readonly reached: ReadonlyMap<string, Reach>;
}
/** Paths by the answers still possible on them, keyed by those answers written out. */
type Frontier = ReadonlyMap<string, Entry>;

/** A value a text answer has that no condition names. */
const OTHER = "\u0000other";

function countPaths(
	instrument: Instrument,
	fixed: ReadonlyMap<string, string>,
): Omit<Paths, "byInput"> {
	const conditions = conditionsOf(instrument.flow);
	const sources = new Map<string, Source>();
	for (const c of conditions)
		if (c.kind === "parsed")
			for (const s of c.sources.values())
				if (s.kind !== "row" && !sources.has(s.variable))
					sources.set(s.variable, s);
	const literals = new Map<string, Value[]>();
	for (const c of conditions)
		if (c.kind === "parsed")
			for (const [name, v] of literalsOf(c.expr)) {
				const s = c.sources.get(name);
				if (s !== undefined && s.kind !== "row")
					literals.set(s.variable, [...(literals.get(s.variable) ?? []), v]);
			}

	/** The values a variable can take when asked (or, for an input, from the start). */
	const valuesOf = (variable: string): readonly Value[] => {
		const s = sources.get(variable);
		const named = literals.get(variable) ?? [];
		if (s?.kind === "input") {
			const code = fixed.get(variable);
			if (code !== undefined) return [code];
			return s.domain?.kind === "choice"
				? s.domain.choices.map((c) => c.code)
				: values(s.domain, named);
		}
		if (s?.kind !== "answer") return [null];
		if (s.option !== undefined)
			return [null, s.option.ticked, s.option.unticked];
		const d = s.question.domain;
		return [
			null,
			...(d.kind === "choice"
				? d.choices.map((c) => c.code)
				: values(d, named)),
		];
	};

	const ended: Entry[] = [];
	const stopped: Entry[] = [];
	const repeated: string[] = [];

	const lookup =
		(c: Parsed, w: World) =>
		(name: string): Value => {
			const s = c.sources.get(name);
			if (s === undefined) return null;
			// shortcut: a roster is followed for one row, so its row number is 1; count rows if a report needs them.
			if (s.kind === "row") return 1;
			return w[s.variable] ?? null;
		};

	const go = (
		steps: readonly Step[],
		frontier: Frontier,
		after: ReadonlySet<string>,
	): Frontier => {
		// What a later step reads, from each step on: the variables worth keeping.
		const live: ReadonlySet<string>[] = [];
		let later = after;
		for (let i = steps.length - 1; i >= 0; i--) {
			live[i] = later;
			later = union(later, readsOf([steps[i] as Step]));
		}
		let f = frontier;
		steps.forEach((s, i) => {
			f = project(
				step(s, f, live[i] as ReadonlySet<string>),
				live[i] as ReadonlySet<string>,
			);
		});
		return f;
	};

	const step = (s: Step, f: Frontier, after: ReadonlySet<string>): Frontier => {
		switch (s.kind) {
			case "ask": {
				const asked = s.records
					.map((r) => r.variable)
					.filter((v) => after.has(v));
				return entries(
					[...f.values()].map((e) => ({
						parts: asked.reduce(
							(ps, v) => [...without(ps, v), fresh(v)],
							e.parts,
						),
						lengths: shift(e.lengths),
						reached: tally([e.reached, new Map([[s.id, reachOf(e.lengths)]])]),
					})),
				);
			}
			case "say":
				return f;
			case "compute": {
				const value = s.value;
				if (!after.has(s.variable)) return f;
				return entries(
					[...f.values()].map((e) => {
						const [tied, rest] = join(
							without(e.parts, s.variable),
							variablesOf(value),
						);
						const worlds = tied.worlds.map(
							(w): World => ({
								...w,
								// A definition kept as written could be anything.
								[s.variable]:
									value.kind === "parsed"
										? evaluateCondition(value.expr, lookup(value, w))
										: UNKNOWN,
							}),
						);
						return {
							...e,
							parts: [...rest, { vars: [...tied.vars, s.variable], worlds }],
						};
					}),
				);
			}
			case "if": {
				const outs = [...s.branches.map((b) => b.then), s.else ?? []].map(
					() => [] as Entry[],
				);
				for (const e of f.values()) {
					let rest: readonly Part[] | undefined = e.parts;
					for (const [j, b] of s.branches.entries()) {
						if (rest === undefined) break;
						const [yes, no]: Outcomes = split(b.cond, rest);
						if (yes !== undefined) outs[j]?.push({ ...e, parts: yes });
						rest = no;
					}
					if (rest !== undefined)
						outs[s.branches.length]?.push({ ...e, parts: rest });
				}
				return union2(
					[...s.branches.map((b) => b.then), s.else ?? []].map((flow, j) =>
						go(flow, entries(outs[j] ?? []), after),
					),
				);
			}
			case "stop": {
				const yes: Entry[] = [];
				const no: Entry[] = [];
				for (const e of f.values()) {
					const [y, n] = split(s.cond, e.parts);
					if (y !== undefined) yes.push({ ...e, parts: y });
					if (n !== undefined) no.push({ ...e, parts: n });
				}
				const out = go(s.say, entries(yes), new Set());
				stopped.push(...out.values());
				return go(s.else, entries(no), after);
			}
			case "count": {
				// A roster by count has no rows when its count is blank or below 1.
				repeated.push(s.id);
				const yes: Entry[] = [];
				const no: Entry[] = [];
				for (const e of f.values()) {
					const [y, n] = split(
						s.count,
						e.parts,
						(v) => typeof v === "number" && v >= 1,
					);
					if (y !== undefined) yes.push({ ...e, parts: y });
					if (n !== undefined) no.push({ ...e, parts: n });
				}
				return union2([go(s.flow, entries(yes), after), entries(no)]);
			}
			case "repeat":
			case "loop":
				repeated.push(s.id);
				return go(s.flow, f, after);
			case "section":
				return go(s.flow, f, after);
			default:
				return s satisfies never;
		}
	};

	/**
	 * The answers where a condition holds, and those where it doesn't (undefined: none); a
	 * condition that can't be read, or reads a hole, goes both ways.
	 */
	const split = (
		c: Condition,
		parts: readonly Part[],
		holds: (v: Value) => boolean = (v) => v === true,
	): Outcomes => {
		if (c.kind === "verbatim") return [parts, parts];
		const [tied, rest] = join(parts, variablesOf(c));
		const yes: World[] = [];
		const no: World[] = [];
		for (const w of tied.worlds) {
			const v = evaluateCondition(c.expr, lookup(c, w));
			if (v === UNKNOWN) {
				yes.push(w);
				no.push(w);
			} else (holds(v) ? yes : no).push(w);
		}
		const out = (worlds: World[]) =>
			worlds.length === 0 ? undefined : [...rest, { vars: tied.vars, worlds }];
		return [out(yes), out(no)];
	};

	/** A variable just asked (or an input): each value it can have, on its own. */
	const fresh = (v: string): Part => ({
		vars: [v],
		worlds: valuesOf(v).map((x) => (x === null ? {} : { [v]: x })),
	});

	const read = readsOf(instrument.flow);
	const start = [...read]
		.filter((v) => sources.get(v)?.kind === "input")
		.map(fresh);
	const out = go(
		instrument.flow,
		entries([{ parts: start, lengths: new Map([[0, 1]]), reached: new Map() }]),
		new Set(),
	);
	ended.push(...out.values());
	const lengths = merge(ended.map((e) => e.lengths));

	const computes = new Map<string, readonly string[]>();
	const decidedBy = new Map<string, readonly string[]>();
	const statics = (steps: readonly Step[], around: readonly Condition[]) => {
		for (const s of steps) {
			switch (s.kind) {
				case "ask":
					decidedBy.set(s.id, [
						...new Set(around.flatMap((c) => [...variablesOf(c)])),
					]);
					break;
				case "compute":
					computes.set(s.variable, [...variablesOf(s.value)]);
					break;
				case "if": {
					const before: Condition[] = [];
					for (const b of s.branches) {
						statics(b.then, [...around, ...before, b.cond]);
						before.push(b.cond);
					}
					if (s.else !== undefined) statics(s.else, [...around, ...before]);
					break;
				}
				case "stop":
					statics(s.say, [...around, s.cond]);
					statics(s.else, [...around, s.cond]);
					break;
				case "count":
					statics(s.flow, [...around, s.count]);
					break;
				case "repeat":
				case "loop":
				case "section":
					statics(s.flow, around);
					break;
				case "say":
					break;
				default:
					s satisfies never;
			}
		}
	};
	statics(instrument.flow, []);
	const routed = new Set([...decidedBy.values()].flat());
	for (const c of computes.keys()) if (!routed.has(c)) computes.delete(c);

	return {
		paths: sum(lengths) + sum(merge(stopped.map((e) => e.lengths))),
		stopped: sum(merge(stopped.map((e) => e.lengths))),
		lengths: new Map([...lengths].sort(([a], [b]) => a - b)),
		reach: tally([...ended, ...stopped].map((e) => e.reached)),
		completed: new Map(
			[...tally(ended.map((e) => e.reached))].map(([id, x]) => [id, x.paths]),
		),
		decidedBy,
		computes,
		repeated,
		unread: conditions.filter((c) => c.kind === "verbatim").length,
	};
}

/**
 * Values to try for a number or text answer: null aside, each literal a condition compares
 * it with, a step either side of a number, and one other text.
 */
function values(
	d:
		| {
				readonly kind: string;
				readonly min?: number;
				readonly max?: number;
				readonly decimals?: number;
		  }
		| undefined,
	named: readonly Value[],
): Value[] {
	// An input with no stated domain may be compared with numbers or texts: try both.
	if (d?.kind === "number" || d === undefined) {
		// shortcut: a number is tried at each literal and a step either side, enough for comparisons with one literal each; not for arithmetic across answers.
		const step = 10 ** -(d?.decimals ?? 0);
		const ns = named.filter((v): v is number => typeof v === "number");
		const { min, max } = d ?? {};
		const tried = [
			...ns.flatMap((n) => [n - step, n, n + step]),
			min ?? max ?? 0,
			...(max !== undefined ? [max] : []),
		].filter(
			(n) => (min === undefined || n >= min) && (max === undefined || n <= max),
		);
		if (d !== undefined) return [...new Set(tried)];
		return [
			...new Set([
				...tried,
				...named.filter((v) => typeof v === "string"),
				OTHER,
			]),
		];
	}
	return [...new Set([...named.filter((v) => typeof v === "string"), OTHER])];
}

/** Literals compared with a name: `x = "1"`, `x in {"1", "2"}`, `18 <= x`. */
function literalsOf(e: Expr): [string, Value][] {
	const lit = (x: Expr): Value | undefined =>
		x.kind === "string" || x.kind === "number" ? x.value : undefined;
	switch (e.kind) {
		case "binary": {
			const r = lit(e.right);
			const l = lit(e.left);
			if (e.left.kind === "name" && r !== undefined) return [[e.left.name, r]];
			if (e.right.kind === "name" && l !== undefined)
				return [[e.right.name, l]];
			return [...literalsOf(e.left), ...literalsOf(e.right)];
		}
		case "member": {
			const op = e.operand;
			return op.kind === "name"
				? e.set.flatMap((x): [string, Value][] => {
						const v = lit(x);
						return v === undefined ? [] : [[op.name, v]];
					})
				: [];
		}
		case "unary":
			return literalsOf(e.operand);
		case "call":
			return e.args.flatMap(literalsOf);
		default:
			return [];
	}
}

/** Every condition the routing turns on: branches, screen-outs, computes, roster counts. */
function conditionsOf(steps: readonly Step[]): Condition[] {
	return steps.flatMap((s): Condition[] => {
		switch (s.kind) {
			case "if":
				return [
					...s.branches.flatMap((b) => [b.cond, ...conditionsOf(b.then)]),
					...conditionsOf(s.else ?? []),
				];
			case "stop":
				return [s.cond, ...conditionsOf(s.say), ...conditionsOf(s.else)];
			case "compute":
				return [s.value];
			case "count":
				return [s.count, ...conditionsOf(s.flow)];
			case "repeat":
				return [s.more, ...conditionsOf(s.flow)];
			case "loop":
				return [s.cond, ...conditionsOf(s.flow)];
			case "section":
				return conditionsOf(s.flow);
			default:
				return [];
		}
	});
}

/** The variables a condition reads, a computed value by its own name. */
function variablesOf(c: Condition): Set<string> {
	if (c.kind === "verbatim") return new Set();
	return new Set(
		[...c.sources.values()].flatMap((s) =>
			s.kind === "row" ? [] : [s.variable],
		),
	);
}

const readCache = new WeakMap<readonly Step[], ReadonlySet<string>>();
/** The variables the conditions in some steps read. */
function readsOf(steps: readonly Step[]): ReadonlySet<string> {
	const known = readCache.get(steps);
	if (known !== undefined) return known;
	const out = new Set(conditionsOf(steps).flatMap((c) => [...variablesOf(c)]));
	readCache.set(steps, out);
	return out;
}

const union = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
	new Set([...a, ...b]);

const keyOf = (w: World): string =>
	Object.keys(w)
		.sort()
		.map((k) => {
			const v = w[k];
			return `${k}=${typeof v === "symbol" ? "?" : JSON.stringify(v)}`;
		})
		.join("&");

/** A branch's two outcomes: the answers left on each, undefined where there are none. */
type Outcomes = readonly [
	readonly Part[] | undefined,
	readonly Part[] | undefined,
];

/** The parts some variables are in, as one (every combination), and the parts they aren't in. */
function join(
	parts: readonly Part[],
	names: ReadonlySet<string>,
): [Part, Part[]] {
	const tied = parts.filter((p) => p.vars.some((v) => names.has(v)));
	const rest = parts.filter((p) => !tied.includes(p));
	return [
		tied.reduce<Part>(
			(a, p) => ({
				vars: [...a.vars, ...p.vars],
				worlds: a.worlds.flatMap((w) => p.worlds.map((x) => ({ ...w, ...x }))),
			}),
			{ vars: [], worlds: [{}] },
		),
		rest,
	];
}

/** The parts with a variable dropped (asked again, or computed again). */
const without = (parts: readonly Part[], v: string): Part[] =>
	parts.map((p) =>
		p.vars.includes(v)
			? {
					vars: p.vars.filter((x) => x !== v),
					worlds: p.worlds.map(({ [v]: _, ...w }) => w),
				}
			: p,
	);

/** Parts written one way: worlds unique and in order, parts in order, those with no variable dropped. */
function normal(parts: readonly Part[]): [string, Part[]] {
	const keyed = parts
		.filter((p) => p.vars.length > 0)
		.map((p): [string, Part] => {
			const unique = new Map(p.worlds.map((w) => [keyOf(w), w]));
			const vars = [...p.vars].sort();
			const keys = [...unique.keys()].sort();
			return [
				`${vars.join(",")}:${keys.join("|")}`,
				{ vars, worlds: keys.map((k) => unique.get(k) as World) },
			];
		})
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	return [keyed.map(([k]) => k).join("\n"), keyed.map(([, p]) => p)];
}

/** Paths grouped by the answers still possible on them: equal sets are one entry. */
function entries(es: readonly Entry[]): Frontier {
	const out = new Map<string, Entry>();
	for (const e of es) {
		const [key, parts] = normal(e.parts);
		const had = out.get(key);
		out.set(
			key,
			had === undefined
				? { ...e, parts }
				: {
						parts: had.parts,
						lengths: merge([had.lengths, e.lengths]),
						reached: tally([had.reached, e.reached]),
					},
		);
	}
	return out;
}

/** A question reached by these paths: how many, and the fewest and most questions before it. */
const reachOf = (l: Lengths): Reach => ({
	paths: sum(l),
	fewest: Math.min(...l.keys()),
	most: Math.max(...l.keys()),
});

/** Reach summed over groups of paths. */
function tally(rs: readonly ReadonlyMap<string, Reach>[]): Map<string, Reach> {
	const out = new Map<string, Reach>();
	for (const r of rs)
		for (const [id, x] of r) {
			const had = out.get(id);
			out.set(
				id,
				had === undefined
					? x
					: {
							paths: had.paths + x.paths,
							fewest: Math.min(had.fewest, x.fewest),
							most: Math.max(had.most, x.most),
						},
			);
		}
	return out;
}

/** The answers without the variables no later step reads. */
function project(f: Frontier, keep: ReadonlySet<string>): Frontier {
	return entries(
		[...f.values()].map((e) => ({
			...e,
			parts: e.parts.map((p) => ({
				vars: p.vars.filter((v) => keep.has(v)),
				worlds: p.worlds.map((w) =>
					Object.fromEntries(
						Object.entries(w).filter(([k, v]) => keep.has(k) && v !== null),
					),
				),
			})),
		})),
	);
}

const union2 = (fs: readonly Frontier[]): Frontier =>
	entries(fs.flatMap((f) => [...f.values()]));

const shift = (l: Lengths): Lengths =>
	new Map([...l].map(([n, k]) => [n + 1, k]));

// shortcut: counts are numbers, exact to 2^53 paths; past that they are close, not exact.
function merge(ls: readonly Lengths[]): Map<number, number> {
	const out = new Map<number, number>();
	for (const l of ls) for (const [n, k] of l) out.set(n, (out.get(n) ?? 0) + k);
	return out;
}

const sum = (l: Lengths): number => [...l.values()].reduce((a, b) => a + b, 0);
