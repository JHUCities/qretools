/**
 * Where a run of the form leads: pure, a run in and the route out. No position is stored:
 * a run is the inputs, the answers in order and this run's shuffles, and `walk` replays
 * the flow against them each time, so Back is dropping the last answer.
 *
 * `walk` is self-contained (it names nothing outside itself but its arguments), because
 * the page runs it from its source text, beside core's `evaluateCondition`.
 */
import type {
	Condition,
	evaluateCondition,
	FlowInstrument,
	FlowStep,
	Part,
	Value,
} from "@qretools/core";

/** An answer as recorded: a code or typed text, a number, or `null` for no answer. */
export type Answer = string | number | null;

export interface Run {
	readonly inputs: Readonly<Record<string, Answer>>;
	readonly answers: readonly Answer[];
	/** This run's order of a shuffled section's steps or an ask's options, by step ID. */
	readonly orders: Readonly<Record<string, readonly number[]>>;
}

type Ask = Extract<FlowStep, { kind: "ask" }>;
type Say = Extract<FlowStep, { kind: "say" }>;

/** What happened on the way, in order. */
export type Event =
	| {
			readonly kind: "ask";
			readonly step: Ask;
			readonly key: string;
			readonly value: Answer;
			readonly n: number;
	  }
	| { readonly kind: "say"; readonly text: string }
	| {
			readonly kind: "compute";
			readonly key: string;
			readonly value: Answer | boolean;
	  }
	| { readonly kind: "branch"; readonly words: string; readonly taken: boolean }
	| {
			readonly kind: "section";
			readonly title: string;
			readonly members?: readonly string[];
	  }
	| { readonly kind: "row"; readonly row: number }
	| { readonly kind: "stop"; readonly words: string }
	| { readonly kind: "note"; readonly text: string };

/** Where the run stands: the step waiting for an answer, why it is asked, and in which sections. */
export interface Place {
	readonly step: Ask | Say;
	/** Its text with the values piped in. */
	readonly text: string;
	readonly why: readonly string[];
	readonly sections: readonly string[];
	/** Its number among the questions asked, counting it. */
	readonly n: number;
}

export interface Walked {
	/** Each value held, by key: a variable, with its row numbers inside a roster (`age[2]`). */
	readonly held: Readonly<Record<string, Answer | boolean>>;
	readonly trail: readonly Event[];
	/** Absent when the run is over. */
	readonly current?: Place;
	/** How the run ended: at the end of the flow, or screened out. */
	readonly ended?: "end" | "stopped";
	readonly asked: number;
}

export function walk(
	instrument: FlowInstrument,
	run: Run,
	evaluate: typeof evaluateCondition,
	// shortcut: a roster with no max (a count from an input or a compute) stops at 100 rows; make it a setting if a survey needs more.
	maxRows = 100,
): Walked {
	type Rows = readonly { readonly loop: string; readonly row: number }[];
	const held: Record<string, Answer | boolean> = { ...run.inputs };
	const trail: Event[] = [];
	let i = 0;
	let asked = 0;
	let current: Place | undefined;

	const keyOf = (variable: string, rows: Rows) =>
		variable + rows.map((r) => `[${r.row}]`).join("");
	// A name inside a roster reads its row's value, else the value outside it.
	const read = (variable: string, rows: Rows): Answer | boolean => {
		for (let k = rows.length; k >= 0; k--) {
			const v = held[keyOf(variable, rows.slice(0, k))];
			if (v !== undefined) return v;
		}
		return null; // never asked on this path
	};
	const value = (c: Condition, rows: Rows): Value => {
		// A condition kept as written can't be evaluated: never true.
		if (c.kind === "verbatim") return null;
		return evaluate(c.expr, (name) => {
			const s = c.sources.get(name);
			if (s === undefined) return null;
			if (s.kind === "row")
				return rows.find((r) => r.loop === s.loop)?.row ?? null;
			return read(s.variable, rows);
		});
	};
	const plain = (v: Value): Answer | boolean =>
		typeof v === "symbol" ? null : v;
	const words = (c: Condition) => c.command.text;
	const textOf = (parts: readonly Part[], rows: Rows): string =>
		parts
			.map((p) => {
				if (p.kind === "text") return p.text;
				const s = p.source;
				const v =
					s.kind === "row"
						? (rows.find((r) => r.loop === s.loop)?.row ?? null)
						: read(s.variable, rows);
				if (v === null) return `[${s.kind === "row" ? "row" : s.variable}]`;
				if (
					p.label &&
					s.kind === "answer" &&
					s.question.domain.kind === "choice"
				)
					return (
						s.question.domain.choices.find((c) => c.code === v)?.label ??
						String(v)
					);
				return String(v);
			})
			.join("");
	const nameOf = (s: FlowStep): string =>
		s.kind === "ask"
			? s.question.name
			: s.kind === "section"
				? (s.label ?? s.name ?? "section")
				: s.kind;

	type Went = "paused" | "stopped" | undefined;
	const go = (
		steps: readonly FlowStep[],
		why: readonly string[],
		sections: readonly string[],
		rows: Rows,
	): Went => {
		for (const s of steps) {
			const went = step(s, why, sections, rows);
			if (went !== undefined) return went;
		}
		return undefined;
	};
	const step = (
		s: FlowStep,
		why: readonly string[],
		sections: readonly string[],
		rows: Rows,
	): Went => {
		switch (s.kind) {
			case "ask": {
				const record = s.records[0];
				if (s.question.domain.kind === "choice" && s.question.domain.many) {
					trail.push({
						kind: "note",
						text: `Not run: ${s.question.name}, a select all that apply question`,
					});
					return undefined;
				}
				if (i === run.answers.length) {
					current = {
						step: s,
						text: textOf(s.text, rows),
						why,
						sections,
						n: asked + 1,
					};
					return "paused";
				}
				const answer = run.answers[i++] ?? null;
				// An ask that records no variable is answered, but nothing can read its answer.
				const key =
					record === undefined ? s.question.name : keyOf(record.variable, rows);
				if (record !== undefined) held[key] = answer;
				trail.push({ kind: "ask", step: s, key, value: answer, n: ++asked });
				return undefined;
			}
			case "say": {
				const text = textOf(s.text, rows);
				if (i === run.answers.length) {
					current = { step: s, text, why, sections, n: asked };
					return "paused";
				}
				i++;
				trail.push({ kind: "say", text });
				return undefined;
			}
			case "compute": {
				const key = keyOf(s.variable, rows);
				held[key] = plain(value(s.value, rows));
				trail.push({ kind: "compute", key, value: held[key] ?? null });
				return undefined;
			}
			case "if": {
				const k = s.branches.findIndex((b) => value(b.cond, rows) === true);
				for (const [j, b] of s.branches.entries())
					if (k < 0 || j <= k)
						trail.push({
							kind: "branch",
							words: words(b.cond),
							taken: j === k,
						});
				const taken = s.branches[k];
				if (taken !== undefined)
					return go(taken.then, [...why, words(taken.cond)], sections, rows);
				if (s.else === undefined) return undefined;
				const none = `none of: ${s.branches.map((b) => words(b.cond)).join("; ")}`;
				trail.push({ kind: "branch", words: none, taken: true });
				return go(s.else, [...why, none], sections, rows);
			}
			case "stop": {
				if (value(s.cond, rows) !== true)
					return go(s.else, why, sections, rows);
				trail.push({ kind: "stop", words: words(s.cond) });
				return go(s.say, [...why, words(s.cond)], sections, rows) ?? "stopped";
			}
			case "section": {
				const order = run.orders[s.id] ?? s.flow.map((_, j) => j);
				const flow = order.flatMap((j) => s.flow[j] ?? []);
				const title = s.label ?? s.name ?? "Section";
				trail.push({
					kind: "section",
					title,
					...(s.order !== undefined && { members: flow.map(nameOf) }),
				});
				return go(flow, why, [...sections, title], rows);
			}
			case "count": {
				const n = value(s.count, rows);
				const cap = Math.min(s.max ?? maxRows, maxRows);
				const count = typeof n === "number" ? Math.min(Math.floor(n), cap) : 0;
				for (let row = 1; row <= count; row++) {
					trail.push({ kind: "row", row });
					const went = go(s.flow, why, sections, [
						...rows,
						{ loop: s.id, row },
					]);
					if (went !== undefined) return went;
				}
				return undefined;
			}
			case "repeat": {
				for (let row = 1; row <= Math.min(s.max, maxRows); row++) {
					trail.push({ kind: "row", row });
					const inRow = [...rows, { loop: s.id, row }];
					const went = go(s.flow, why, sections, inRow);
					if (went !== undefined) return went;
					if (value(s.more, inRow) !== true) break;
				}
				return undefined;
			}
			case "loop":
				trail.push({
					kind: "note",
					text: `Not run: a loop the form can't read (${s.construct}: ${words(s.cond)})`,
				});
				return undefined;
			default:
				return s satisfies never;
		}
	};
	const went = go(instrument.flow, [], [], []);
	return {
		held,
		trail,
		...(current !== undefined && { current }),
		...(went !== "paused" && { ended: went === "stopped" ? "stopped" : "end" }),
		asked,
	};
}
