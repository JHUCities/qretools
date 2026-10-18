/**
 * Rosters as Qualtrics can run them (owner, 2026-10-18), before the survey is written. A
 * count roster Qualtrics can loop exactly (`loopable`) stays a loop, which the writer makes
 * a Loop & Merge block. Every other roster is written out row by row: a count roster or an
 * `each` as rows 1..max, row k under `count >= k`; a roster by `more` as rounds 1..max,
 * round k nested under round k-1's `more`; an `each` over such a roster, row k under every
 * earlier round's `more`. In row k, `index` is k, an answer or value recorded in a written-
 * out roster is row k's copy, `<k>_<variable>` (as Qualtrics names a loop's columns), and
 * an answer recorded in a looped roster is read at its round k.
 */
import type { Expr } from "../cond/ast.ts";
import type { Finding } from "../findings.ts";
import type { Cond, Part, ReadInstrument, Source, Step } from "./read.ts";

/** A row's copy of a variable: the column Qualtrics' Loop & Merge would give it. */
export const rowVariable = (k: number, variable: string): string =>
	`${k}_${variable}`;
/** A row's copy of a step. */
const rowId = (id: string, k: number) => `${id}#${k}`;
/** The step a row's copy was made from, for findings: they're the author's, not the copy's. */
export const baseId = (id: string): string => id.split("#")[0] ?? id;

/** The same expression with some names replaced. */
const mapNames = (e: Expr, f: (name: string) => Expr | undefined): Expr => {
	const go = (x: Expr): Expr => {
		switch (x.kind) {
			case "name":
				return f(x.name) ?? x;
			case "unary":
				return { ...x, operand: go(x.operand) };
			case "binary":
				return { ...x, left: go(x.left), right: go(x.right) };
			case "member":
				return { ...x, operand: go(x.operand), set: x.set.map(go) };
			case "call":
				return { ...x, args: x.args.map(go) };
			default:
				return x;
		}
	};
	return go(e);
};
/** An if's arm: its condition and the steps it leads to. */
const arm = (cond: Cond, then: readonly Step[]) => ({ cond, then });
const numberAt = (k: number, at: Expr): Expr => ({
	kind: "number",
	value: k,
	text: String(k),
	range: at.range,
});
/** Conditions joined by `and`, their sources merged (a name two of them use differently renamed); undefined for none. */
const allOf = (conds: readonly Cond[]): Cond | undefined =>
	conds.reduce<Cond | undefined>((all, c) => {
		if (all === undefined) return c;
		const renamed = new Map<string, string>();
		for (const [name, source] of c.sources) {
			const held = all.sources.get(name);
			if (held === undefined || held === source) continue;
			let fresh = name;
			for (let n = 2; all.sources.has(fresh) || c.sources.has(fresh); n++)
				fresh = `${name}_${n}`;
			renamed.set(name, fresh);
		}
		const expr = mapNames(c.expr, (name) => {
			const fresh = renamed.get(name);
			return fresh === undefined
				? undefined
				: { kind: "name", name: fresh, range: c.expr.range };
		});
		return {
			expr: {
				kind: "binary",
				op: "and",
				left: all.expr,
				right: expr,
				range: c.expr.range,
			},
			sources: new Map([
				...all.sources,
				...[...c.sources].map(([name, s]): [string, Source] => [
					renamed.get(name) ?? name,
					s,
				]),
			]),
		};
	}, undefined);

/** The asks in a flow, at any depth. */
const asksIn = (steps: readonly Step[]): string[] =>
	steps.flatMap((s): string[] => {
		switch (s.kind) {
			case "ask":
				return [s.id];
			case "if":
				return [
					...s.branches.flatMap((b) => asksIn(b.then)),
					...asksIn(s.else ?? []),
				];
			case "stop":
				return asksIn(s.say);
			case "section":
			case "loop":
			case "repeat":
				return asksIn(s.flow);
			default:
				return [];
		}
	});
/** The variables a flow's asks record, at any depth. */
const recordsIn = (steps: readonly Step[]): string[] =>
	steps.flatMap((s): string[] => {
		switch (s.kind) {
			case "ask":
				return s.records.map((r) => r.variable);
			case "if":
				return [
					...s.branches.flatMap((b) => recordsIn(b.then)),
					...recordsIn(s.else ?? []),
				];
			case "stop":
				return recordsIn(s.say);
			case "section":
			case "loop":
			case "repeat":
				return recordsIn(s.flow);
			default:
				return [];
		}
	});

export function unroll(instrument: ReadInstrument): {
	readonly instrument: ReadInstrument;
	readonly findings: readonly Finding[];
} {
	const findings: Finding[] = [];
	const refuse = (path: string, message: string) =>
		findings.push({
			code: "qsf-inexpressible",
			severity: "error",
			path,
			message,
		});

	// What every roster records: its asks, and the values it computes.
	const rosterAsks = new Set<string>();
	const rosterComputes = new Set<string>();
	const collect = (steps: readonly Step[], inRoster: boolean): void => {
		for (const s of steps) {
			if (s.kind === "ask" && inRoster) rosterAsks.add(s.id);
			if (s.kind === "compute" && inRoster) rosterComputes.add(s.variable);
			if (s.kind === "if") {
				for (const b of s.branches) collect(b.then, inRoster);
				collect(s.else ?? [], inRoster);
			}
			if (s.kind === "stop") collect(s.say, inRoster);
			if (s.kind === "section") collect(s.flow, inRoster);
			if (s.kind === "loop" || s.kind === "repeat") collect(s.flow, true);
		}
	};
	collect(instrument.flow, false);

	// The count rosters Qualtrics loops, with their maximum; their asks are read by round.
	const looped = new Map<string, number>();
	const loopedAsks = new Set<string>();
	const findLoops = (steps: readonly Step[]): void => {
		for (const s of steps) {
			if (s.kind === "loop") {
				const max = loopable(s);
				if (max !== undefined) {
					looped.set(s.id, max);
					for (const a of asksIn(s.flow)) loopedAsks.add(a);
				}
			}
			if (s.kind === "if") {
				for (const b of s.branches) findLoops(b.then);
				findLoops(s.else ?? []);
			}
			if (s.kind === "stop") findLoops(s.say);
			if (s.kind === "section") findLoops(s.flow);
		}
	};
	/**
	 * A count roster's maximum when Qualtrics can loop it exactly: counted by one number question
	 * asked outside any roster; only asks, statements, sections and ifs inside; conditions on its
	 * own answers, answers outside rosters and inputs; texts piping only its row number; and an
	 * if with elif or else asking nothing its conditions read (display logic is evaluated again
	 * on each page). Undefined otherwise: it's written out row by row.
	 */
	const loopable = (s: Extract<Step, { kind: "loop" }>): number | undefined => {
		const counted =
			s.count.expr.kind === "name"
				? s.count.sources.get(s.count.expr.name)
				: undefined;
		if (
			counted?.kind !== "answer" ||
			counted.question.domain.kind !== "number" ||
			counted.asks.length !== 1 ||
			counted.asks.some((a) => rosterAsks.has(a))
		)
			return undefined;
		const max = s.max ?? counted.question.domain.max;
		if (max === undefined) return undefined;
		const own = new Set(asksIn(s.flow));
		const readable = (c: Cond) =>
			[...c.sources.values()].every(
				(x) =>
					x.kind === "input" ||
					(x.kind === "answer" &&
						x.asks.every((a) => own.has(a) || !rosterAsks.has(a))),
			);
		const shown = (parts: readonly Part[]) =>
			parts.every(
				(p) =>
					p.kind === "text" ||
					(p.source.kind === "row" && p.source.loop === s.id),
			);
		const simple = (steps: readonly Step[]): boolean =>
			steps.every((x) => {
				switch (x.kind) {
					case "ask":
						return shown(x.text);
					case "say":
						return shown(x.text);
					case "section":
						return simple(x.flow);
					case "if": {
						const conds = x.branches.map((b) => b.cond);
						const read = new Set(
							conds.flatMap((c) =>
								[...c.sources.values()].flatMap((v) =>
									v.kind === "answer" ? [v.variable] : [],
								),
							),
						);
						const asked = recordsIn([x]);
						const arms = x.branches.length + (x.else === undefined ? 0 : 1);
						return (
							conds.every(readable) &&
							(arms < 2 || !asked.some((v) => read.has(v))) &&
							x.branches.every((b) => simple(b.then)) &&
							simple(x.else ?? [])
						);
					}
					default:
						return false;
				}
			});
		return simple(s.flow) ? max : undefined;
	};
	findLoops(instrument.flow);

	/** A source at row k: a roster's answer or value is row k's copy; a row number is gone. */
	const sourceAt = (s: Source, k: number): Source => {
		if (s.kind === "answer" && s.asks.some((a) => loopedAsks.has(a)))
			return { ...s, row: k };
		if (s.kind === "answer" && s.asks.some((a) => rosterAsks.has(a)))
			return {
				...s,
				variable: rowVariable(k, s.variable),
				asks: s.asks.map((a) => rowId(a, k)),
			};
		if (s.kind === "compute" && rosterComputes.has(s.variable))
			return { ...s, variable: rowVariable(k, s.variable) };
		return s;
	};
	const condAt = (c: Cond, k: number): Cond => ({
		expr: mapNames(c.expr, (name) => {
			const s = c.sources.get(name);
			return s?.kind === "row" ? numberAt(k, c.expr) : undefined;
		}),
		sources: new Map(
			[...c.sources]
				.filter(([, s]) => s.kind !== "row")
				.map(([name, s]) => [name, sourceAt(s, k)]),
		),
	});
	const textAt = (parts: readonly Part[], k: number): Part[] =>
		parts.map((p) =>
			p.kind === "text"
				? p
				: p.source.kind === "row"
					? { kind: "text", text: String(k) }
					: { ...p, source: sourceAt(p.source, k) },
		);
	/** Steps as row k has them. A roster inside a roster is refused: Qualtrics has no nesting. */
	const stepsAt = (steps: readonly Step[], k: number): Step[] =>
		steps.flatMap((s): Step[] => {
			const id = rowId(s.id, k);
			switch (s.kind) {
				case "ask":
					return [
						{
							...s,
							id,
							records: s.records.map((r) => ({
								...r,
								variable: rowVariable(k, r.variable),
							})),
							text: textAt(s.text, k),
							checks: s.checks.map((c) => ({
								...c,
								id: rowId(c.id, k),
								ensure: condAt(c.ensure, k),
								...(c.message && { message: textAt(c.message, k) }),
							})),
						},
					];
				case "say":
					return [{ ...s, id, text: textAt(s.text, k) }];
				case "compute":
					return [
						{
							...s,
							id,
							variable: rowVariable(k, s.variable),
							value: condAt(s.value, k),
						},
					];
				case "if":
					return [
						{
							...s,
							id,
							branches: s.branches.map((b) =>
								arm(condAt(b.cond, k), stepsAt(b.then, k)),
							),
							...(s.else && { else: stepsAt(s.else, k) }),
						},
					];
				case "stop":
					return [
						{ ...s, id, cond: condAt(s.cond, k), say: stepsAt(s.say, k) },
					];
				case "section":
					return [{ ...s, id, flow: stepsAt(s.flow, k) }];
				case "loop":
				case "repeat":
					if (k === 1)
						refuse(
							s.id,
							"A roster inside a roster: Qualtrics can't nest them.",
						);
					return [];
				default:
					return s satisfies never;
			}
		});

	// Each roster by `more`, by its DDI ID: the condition to enter each of its rounds after the first.
	const rounds = new Map<string, readonly Cond[]>();

	/** A count roster's or `each`'s rows, each under its condition to exist. */
	const loop = (s: Extract<Step, { kind: "loop" }>): Step[] => {
		const counted =
			s.count.expr.kind === "name"
				? s.count.sources.get(s.count.expr.name)
				: undefined;
		// An `each` over a roster by `more`: row k exists when round k was entered.
		if (counted?.kind === "row" && rounds.has(counted.loop)) {
			const entered = rounds.get(counted.loop) ?? [];
			return Array.from({ length: entered.length + 1 }, (_, i) => {
				const k = i + 1;
				const flow = stepsAt(s.flow, k);
				const guard = allOf(entered.slice(0, k - 1));
				return guard === undefined
					? flow
					: [
							{
								kind: "if",
								id: rowId(s.id, k),
								branches: [arm(guard, flow)],
							} satisfies Step,
						];
			}).flat();
		}
		const max =
			s.max ??
			(counted?.kind === "answer" && counted.question.domain.kind === "number"
				? counted.question.domain.max
				: undefined);
		if (max === undefined) {
			refuse(
				s.id,
				"This roster has no maximum, and its count has none: Qualtrics needs one to write its rows.",
			);
			return [];
		}
		return Array.from({ length: max }, (_, i) => {
			const k = i + 1;
			const guard: Cond = {
				expr: {
					kind: "binary",
					op: ">=",
					left: s.count.expr,
					right: numberAt(k, s.count.expr),
					range: s.count.expr.range,
				},
				sources: new Map(
					[...s.count.sources].filter(([, source]) => source.kind !== "row"),
				),
			};
			return {
				kind: "if",
				id: rowId(s.id, k),
				branches: [arm(guard, stepsAt(s.flow, k))],
			} satisfies Step;
		});
	};

	/** A roster by `more`: round k nested under round k-1's `more`, which may hold on a skipped answer. */
	const repeat = (s: Extract<Step, { kind: "repeat" }>): Step[] => {
		const mores = Array.from({ length: s.max - 1 }, (_, i) =>
			condAt(s.more, i + 1),
		);
		rounds.set(s.id, mores);
		const round = (k: number): Step[] => [
			...stepsAt(s.flow, k),
			...(k < s.max
				? [
						{
							kind: "if",
							id: rowId(s.id, k + 1),
							branches: [arm(mores[k - 1] ?? s.more, round(k + 1))],
						} satisfies Step,
					]
				: []),
		];
		return round(1);
	};

	const walk = (steps: readonly Step[]): Step[] =>
		steps.flatMap((s): Step[] => {
			switch (s.kind) {
				case "loop": {
					const max = looped.get(s.id);
					return max === undefined ? loop(s) : [{ ...s, max }];
				}
				case "repeat":
					return repeat(s);
				case "if":
					return [
						{
							...s,
							branches: s.branches.map((b) => arm(b.cond, walk(b.then))),
							...(s.else && { else: walk(s.else) }),
						},
					];
				case "stop":
					return [{ ...s, say: walk(s.say) }];
				case "section":
					return [{ ...s, flow: walk(s.flow) }];
				default:
					return [s];
			}
		});

	return {
		instrument: { ...instrument, flow: walk(instrument.flow) },
		findings,
	};
}
