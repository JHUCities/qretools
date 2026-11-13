/**
 * The next step of an interview: pure, a state in and one reply out. No position is
 * stored: a state is the inputs and the answers so far, keyed by Variable URN as
 * `qretools responses` writes them, and `nextStep` replays the flow against them each
 * time, so Back is removing an answer. The reply is the first question on the route that
 * has no answer, with its fills piped in, or an input the route needs and wasn't given,
 * or the end. The caller never evaluates a condition.
 *
 * Only what the route passes is held: an answer to a question the route no longer
 * reaches (after an earlier answer changed) is ignored, and no condition reads it.
 */
import { z } from "zod";
import { evaluateCondition, UNKNOWN, type Value } from "../cond/eval.ts";
import { holds, type Representation } from "../responses.ts";
import { err, ok, type Result } from "../result.ts";
import type {
	Condition,
	Domain,
	Instrument,
	Part,
	Source,
	Step,
} from "./read.ts";

const Code = z.object({ code: z.string(), label: z.string() });

/** What the caller sends: the inputs by name, and every answer so far. */
export const NextState = z.strictObject({
	/** Each input by its name in the instrument; `null` is "not known". */
	inputs: z
		.record(z.string(), z.union([z.string(), z.number(), z.null()]))
		.default({}),
	answers: z
		.array(
			z.strictObject({
				/** The Variable's URN. */
				variable: z.string(),
				/** The row of a roster, from 1; only for a variable a roster records. */
				row: z.int().positive().optional(),
				/** A code (always a string), a number, text, or one of the variable's missing codes. */
				value: z.union([z.string(), z.number()]),
			}),
		)
		.default([]),
});
export type NextState = z.input<typeof NextState>;

const Missing = z.array(Code);
const Variable = { variable: z.string(), name: z.string(), missing: Missing };

const AskDomain = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("choice"),
		...Variable,
		choices: z.array(Code),
	}),
	z.object({
		kind: z.literal("select-all"),
		options: z.array(
			z.object({
				...Code.shape,
				...Variable,
				/** The value of this option's variable when it's chosen, and when it isn't. */
				ticked: z.string(),
				unticked: z.string(),
			}),
		),
	}),
	z.object({
		kind: z.literal("number"),
		...Variable,
		min: z.number().optional(),
		max: z.number().optional(),
		decimals: z.int(),
	}),
	z.object({
		kind: z.literal("text"),
		...Variable,
		maxLength: z.int().optional(),
	}),
	/** A domain this doesn't read (a date, say): any text is taken. */
	z.object({ kind: z.literal("other"), ...Variable }),
]);

const InputDomain = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("choice"), choices: z.array(Code) }),
	z.object({
		kind: z.literal("number"),
		min: z.number().optional(),
		max: z.number().optional(),
		decimals: z.int(),
	}),
	z.object({ kind: z.literal("text"), maxLength: z.int().optional() }),
	z.object({ kind: z.literal("other") }),
]);

/** The kinds of note `nextStep` gives: stable, for a caller to switch on. */
const NOTE_CODES = [
	"next-verbatim",
	"next-undecided",
	"next-empty-fill",
	"next-unrecorded",
	"next-section-order",
	"next-no-count",
	"next-roster-cap",
	"next-loop-skipped",
] as const;
type NoteCode = (typeof NOTE_CODES)[number];

/** What was said since the last answer, and why the route so far may not be what the DDI means. */
const Along = {
	/** The statements shown since the last question answered, in order. */
	statements: z.array(z.string()),
	/** What the route so far couldn't follow as the DDI says (a condition it can't evaluate, a fill with no value). */
	notes: z.array(
		z
			.object({ code: z.string(), message: z.string() })
			.describe(
				`A note: \`code\` names its kind (${NOTE_CODES.join(", ")}, or a DDI reader finding's code such as ddi-unread). Later versions may add codes: take one you don't know as information.`,
			),
	),
};

/** What `next` replies. */
export const Next = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("ask"),
		/** The QuestionConstruct's URN: one question may be asked at two steps. */
		step: z.string(),
		question: z.string(),
		/** The QuestionItem's URN. */
		questionUrn: z.string(),
		/** The roster row it is asked for, from 1. */
		row: z.int().optional(),
		text: z.string(),
		instructions: z.array(z.string()),
		domain: AskDomain,
		/** The DDI's order for the options (`Random`, `Rotate`), verbatim: the caller shuffles. */
		responseOrder: z.string().optional(),
		/** Why the question is asked again: its answer can't be taken. */
		problem: z.string().optional(),
		...Along,
	}),
	z.object({
		kind: z.literal("input"),
		/** The input's name, as `inputs` keys it. */
		name: z.string(),
		/** Its Variable's URN. */
		variable: z.string(),
		domain: InputDomain,
		/** The codes it may hold in place of a value. */
		missing: Missing,
		// No statements: those on the way come once, with the ask or the end that follows.
		notes: Along.notes,
	}),
	z.object({
		kind: z.literal("end"),
		/** At the end of the flow, or screened out. */
		how: z.enum(["end", "stopped"]),
		...Along,
	}),
]);
export type Next = z.infer<typeof Next>;

/** A state from untrusted JSON, once: the core takes only a parsed one. */
export function nextStateOf(json: unknown): Result<ParsedState, string> {
	const r = NextState.safeParse(json);
	return r.success ? ok(r.data) : err(z.prettifyError(r.error));
}
export type ParsedState = z.output<typeof NextState>;

/** The JSON Schemas of the state `next` reads and the reply it writes: its contract. */
export const nextSchemas = () => ({
	state: z.toJSONSchema(NextState, { io: "input" }),
	// Open objects (no `additionalProperties: false`, as `input` writes them): a field added later mustn't fail a caller's validation.
	reply: z.toJSONSchema(Next, { io: "input" }),
});

type Ask = Extract<Step, { kind: "ask" }>;
type Recorded = Ask["records"][number];
type Input = Extract<Source, { kind: "input" }>;
/** A value held: a code or text, a number, or `null` for none. */
type Held = string | number | boolean | null;

// shortcut: a roster with no max (a count from an input or a compute) stops at 100 rows; make it a setting if a survey needs more.
const MAX_ROWS = 100;

const keyOf = (urn: string, row: number | undefined) =>
	row === undefined ? urn : `${urn}#${row}`;

/** Each variable the flow records, with its ask and whether a roster records it; or why it can't be run. */
function recordsOf(
	flow: readonly Step[],
): Result<
	Map<string, { ask: Ask; record: Recorded; inRoster: boolean }>,
	string
> {
	const out = new Map<
		string,
		{ ask: Ask; record: Recorded; inRoster: boolean }
	>();
	const go = (steps: readonly Step[], depth: number): string | undefined => {
		for (const s of steps) {
			let problem: string | undefined;
			if (s.kind === "ask")
				for (const record of s.records)
					out.set(record.urn, { ask: s, record, inRoster: depth > 0 });
			else if (s.kind === "if")
				problem =
					s.branches.map((b) => go(b.then, depth)).find((p) => p) ??
					go(s.else ?? [], depth);
			else if (s.kind === "stop")
				problem = go(s.say, depth) ?? go(s.else, depth);
			else if (s.kind === "section" || s.kind === "loop")
				problem = go(s.flow, depth);
			else if (s.kind === "count" || s.kind === "repeat") {
				// shortcut: an answer names one row, so a roster inside a roster can't be keyed; key by every row if a survey needs one.
				if (depth > 0)
					return `A roster inside a roster (${s.name ?? s.id}) can't be run yet.`;
				problem = go(s.flow, depth + 1);
			}
			if (problem !== undefined) return problem;
		}
		return undefined;
	};
	const problem = go(flow, 0);
	return problem === undefined ? ok(out) : err(problem);
}

/** An input's value, from what the caller sent, as its domain reads it; or why it can't be. */
function inputValue(
	input: Input,
	v: string | number | null,
): Result<Held, string> {
	if (v === null) return ok(null);
	const d = input.domain ?? { kind: "other" };
	const missing = input.missing ?? [];
	if (typeof v === "number" && d.kind !== "number")
		return err(
			`Input \`${input.variable}\` holds ${d.kind === "choice" ? "a code" : "text"}: send its value as a string, not ${v}.`,
		);
	const why = refusal(d, { missing }, String(v));
	if (why !== undefined) return err(`Input \`${input.variable}\`: ${why}`);
	// As for an answer: a number's missing code has no value in a condition.
	if (d.kind !== "number") return ok(String(v));
	return ok(missing.some((m) => m.code === String(v)) ? null : Number(v));
}

/** Why a value can't be a variable's answer, or undefined when it can be. */
function refusal(
	d: Domain,
	record: Pick<Recorded, "missing" | "ticked" | "unticked">,
	value: string,
): string | undefined {
	const missing = record.missing.map((m) => m.code);
	if (missing.includes(value)) return undefined;
	const r: Representation | undefined =
		record.ticked !== undefined && record.unticked !== undefined
			? { kind: "codes", codes: [record.ticked, record.unticked] }
			: d.kind === "choice"
				? { kind: "codes", codes: d.choices.map((c) => c.code) }
				: d.kind === "number"
					? {
							kind: "number",
							missing,
							...(d.min !== undefined && { min: d.min }),
							...(d.max !== undefined && { max: d.max }),
						}
					: { kind: "text" };
	if (!holds(r, value))
		return r.kind === "codes"
			? `${JSON.stringify(value)} isn't one of its codes (${[...r.codes, ...missing].join(", ")}).`
			: `${JSON.stringify(value)} isn't a number${d.kind === "number" && (d.min !== undefined || d.max !== undefined) ? ` from ${d.min ?? "any"} to ${d.max ?? "any"}` : ""}.`;
	if (d.kind === "number" && (value.split(".")[1]?.length ?? 0) > d.decimals)
		return `${JSON.stringify(value)} has more than ${d.decimals} decimal places.`;
	if (
		d.kind === "text" &&
		d.maxLength !== undefined &&
		value.length > d.maxLength
	)
		return `It is longer than ${d.maxLength} characters.`;
	return undefined;
}

/**
 * The next step of an interview through `instrument`, given its declared inputs and the
 * state so far; an error when the state can't belong to it (an unknown input or variable,
 * a row where there's no roster, an answer given twice, a code sent as a number).
 */
export function nextStep(
	instrument: Instrument,
	declared: readonly Input[],
	state: ParsedState,
): Result<Next, string> {
	const records = recordsOf(instrument.flow);
	if (!records.ok) return records;
	const inputs = new Map<string, Held>();
	for (const [name, v] of Object.entries(state.inputs)) {
		const input = declared.find((i) => i.variable === name);
		if (input === undefined)
			return err(
				`The instrument has no input \`${name}\`; its inputs are ${declared.map((i) => `\`${i.variable}\``).join(", ") || "none"}.`,
			);
		const value = inputValue(input, v);
		if (!value.ok) return value;
		inputs.set(name, value.value);
	}
	const given = new Map<string, string>();
	for (const a of state.answers) {
		const r = records.value.get(a.variable);
		if (r === undefined)
			return err(
				`No question in this instrument records the variable ${a.variable}.`,
			);
		if (r.inRoster !== (a.row !== undefined))
			return err(
				r.inRoster
					? `Variable \`${r.record.variable}\` is recorded in a roster: its answers need a \`row\`.`
					: `Variable \`${r.record.variable}\` isn't recorded in a roster: its answers have no \`row\`.`,
			);
		const d = r.ask.question.domain;
		if (
			typeof a.value === "number" &&
			(d.kind === "choice" || d.kind === "text")
		)
			return err(
				`Variable \`${r.record.variable}\` holds ${d.kind === "choice" ? "a code" : "text"}: send its value as a string, not ${a.value}.`,
			);
		const key = keyOf(a.variable, a.row);
		if (given.has(key))
			return err(
				`Variable \`${r.record.variable}\`${a.row === undefined ? "" : ` row ${a.row}`} is answered twice.`,
			);
		given.set(key, String(a.value));
	}

	type Rows = readonly { readonly loop: string; readonly row: number }[];
	const held = new Map<string, Held>();
	const notes: { code: NoteCode; message: string }[] = [];
	const note = (code: NoteCode, message: string) => {
		if (!notes.some((n) => n.code === code && n.message === message))
			notes.push({ code, message });
	};
	let statements: string[] = [];
	let reply: Next | undefined;
	/** An input the route reads that the caller didn't send: the walk pauses for it. */
	let wanted: Input | undefined;

	const row = (rows: Rows) => rows[rows.length - 1]?.row;
	const heldKey = (variable: string, rows: Rows) => keyOf(variable, row(rows));
	// A name inside a roster reads its row's value, else the value outside it.
	const read = (s: Source, rows: Rows): Held => {
		if (s.kind === "row")
			return rows.find((r) => r.loop === s.loop)?.row ?? null;
		if (s.kind === "input") {
			if (!inputs.has(s.variable)) {
				wanted ??= s;
				return null;
			}
			return inputs.get(s.variable) ?? null;
		}
		// shortcut: values are held by variable name, so two banks' variables of one name would share one; key by URN if a survey imports both.
		const key = heldKey(s.variable, rows);
		return (held.has(key) ? held.get(key) : held.get(s.variable)) ?? null;
	};
	const value = (c: Condition, rows: Rows): Value => {
		if (c.kind === "verbatim") {
			note(
				"next-verbatim",
				`\`${c.command.text}\` can't be evaluated here, so it was taken as not true.`,
			);
			return null;
		}
		// An input not sent is undecided: it is wanted only if the condition turns on it.
		let unsent: Input | undefined;
		const v = evaluateCondition(c.expr, (name) => {
			const s = c.sources.get(name);
			if (s?.kind === "input" && !inputs.has(s.variable)) {
				unsent ??= s;
				return UNKNOWN;
			}
			return s === undefined ? null : read(s, rows);
		});
		if (v === UNKNOWN && unsent !== undefined) {
			wanted ??= unsent;
			return null;
		}
		if (v === UNKNOWN)
			note(
				"next-undecided",
				`\`${c.command.text}\` can't be decided here, so it was taken as not true.`,
			);
		return v;
	};
	const plain = (v: Value): Held => (typeof v === "symbol" ? null : v);
	/** Its words for a coded value: its question's, else its missing code's. */
	const labelOf = (s: Source, v: Held): string | undefined => {
		if (s.kind !== "answer" || typeof v !== "string") return undefined;
		const d = s.question.domain;
		return (
			(d.kind === "choice" ? d.choices : []).find((c) => c.code === v)?.label ??
			records.value.get(s.urn)?.record.missing.find((m) => m.code === v)?.label
		);
	};
	const textOf = (parts: readonly Part[], rows: Rows): string =>
		parts
			.map((p) => {
				if (p.kind === "text") return p.text;
				const v = read(p.source, rows);
				const name = p.source.kind === "row" ? "row" : p.source.variable;
				if (v === null) {
					// An input not sent yet is asked for, not noted.
					if (wanted !== undefined) return "";
					note(
						"next-empty-fill",
						`The fill \`${name}\` has no value, so nothing is shown in its place.`,
					);
					return "";
				}
				return (p.label && labelOf(p.source, v)) || String(v);
			})
			.join("");

	type Went = "paused" | "stopped" | undefined;
	/** Pause for a wanted input, if the step just read one. */
	const pauseForInput = (): Went => {
		if (wanted === undefined) return undefined;
		const { domain = { kind: "other" as const } } = wanted;
		reply = {
			kind: "input",
			name: wanted.variable,
			variable: wanted.urn,
			domain:
				domain.kind === "choice"
					? { kind: "choice", choices: [...domain.choices] }
					: domain,
			missing: [...(wanted.missing ?? [])],
			notes,
		};
		return "paused";
	};
	const go = (steps: readonly Step[], rows: Rows): Went => {
		for (const s of steps) {
			const went = step(s, rows);
			if (went !== undefined) return went;
		}
		return undefined;
	};
	const askReply = (
		s: Ask,
		first: Recorded,
		rows: Rows,
		problem?: string,
	): Next => {
		const variable = (r: Recorded) => ({
			variable: r.urn,
			name: r.variable,
			missing: [...r.missing],
		});
		const d = s.question.domain;
		const one = variable(first);
		const r = row(rows);
		const label = (code: string | undefined) =>
			(d.kind === "choice" ? d.choices : []).find((c) => c.code === code)
				?.label ?? "";
		return {
			kind: "ask",
			step: s.urn,
			question: s.question.name,
			questionUrn: s.question.urn,
			...(r !== undefined && { row: r }),
			text: textOf(s.text, rows),
			instructions: s.instructions.map((i) => textOf(i, rows)),
			domain:
				d.kind === "choice" && d.many
					? {
							kind: "select-all",
							options: s.records.map((o) => ({
								code: o.code ?? "",
								label: label(o.code),
								...variable(o),
								ticked: o.ticked ?? "",
								unticked: o.unticked ?? "",
							})),
						}
					: d.kind === "choice"
						? { kind: "choice", ...one, choices: [...d.choices] }
						: { ...d, ...one },
			...(s.responseOrder !== undefined && { responseOrder: s.responseOrder }),
			...(problem !== undefined && { problem }),
			statements,
			notes,
		};
	};
	const ask = (s: Ask, rows: Rows): Went => {
		const [first] = s.records;
		if (first === undefined) {
			// Nothing names its answer, so it can't be answered by a variable.
			note(
				"next-unrecorded",
				`Question \`${s.question.name}\` records no variable, so it was skipped.`,
			);
			return undefined;
		}
		const r = row(rows);
		const values = s.records.map((rec) => given.get(keyOf(rec.urn, r)));
		const pause = (problem?: string): Went => {
			reply = askReply(s, first, rows, problem);
			return pauseForInput() ?? "paused";
		};
		if (values.every((v) => v === undefined)) return pause();
		const unanswered = s.records.filter((_, j) => values[j] === undefined);
		if (unanswered.length > 0)
			return pause(
				`Every option needs a value (its ticked or unticked code, or a missing code); ${unanswered.map((u) => `\`${u.variable}\``).join(", ")} has none.`,
			);
		for (const [j, rec] of s.records.entries()) {
			const v = values[j] ?? "";
			const why = refusal(s.question.domain, rec, v);
			if (why !== undefined)
				return pause(
					s.records.length > 1 ? `\`${rec.variable}\`: ${why}` : why,
				);
			const isMissing = rec.missing.some((m) => m.code === v);
			// A number's missing code has no value in a condition; a code's is the code.
			held.set(
				heldKey(rec.variable, rows),
				s.question.domain.kind === "number"
					? isMissing
						? null
						: Number(v)
					: v,
			);
		}
		for (const c of s.checks) {
			if (c.severity !== "blocking") continue;
			// What it ensures holds unless it is false: an unknown passes, as the DDI's `nvl` says.
			if (value(c.ensure, rows) === false)
				return pause(
					c.message === undefined
						? "Its answer fails a check."
						: textOf(c.message, rows),
				);
		}
		const input = pauseForInput();
		if (input !== undefined) return input;
		statements = [];
		return undefined;
	};
	const step = (s: Step, rows: Rows): Went => {
		switch (s.kind) {
			case "ask":
				return ask(s, rows);
			case "say": {
				const text = textOf(s.text, rows);
				const went = pauseForInput();
				if (went !== undefined) return went;
				statements.push(text);
				return undefined;
			}
			case "compute": {
				held.set(heldKey(s.variable, rows), plain(value(s.value, rows)));
				return pauseForInput();
			}
			case "if": {
				const k = s.branches.findIndex((b) => value(b.cond, rows) === true);
				const went = pauseForInput();
				if (went !== undefined) return went;
				const taken = s.branches[k];
				if (taken !== undefined) return go(taken.then, rows);
				return s.else === undefined ? undefined : go(s.else, rows);
			}
			case "stop": {
				const stops = value(s.cond, rows) === true;
				const went = pauseForInput();
				if (went !== undefined) return went;
				if (!stops) return go(s.else, rows);
				return go(s.say, rows) ?? "stopped";
			}
			case "section":
				// shortcut: no randomness in the core, so a shuffled section runs in its written order; take an order in the state if a survey needs one.
				if (s.order !== undefined)
					note(
						"next-section-order",
						`Section \`${s.label ?? s.name ?? s.id}\` is in ${s.order} order in the DDI; it runs in its written order here.`,
					);
				return go(s.flow, rows);
			case "count": {
				const n = value(s.count, rows);
				const went = pauseForInput();
				if (went !== undefined) return went;
				const cap = Math.min(s.max ?? MAX_ROWS, MAX_ROWS);
				const name = s.name ?? s.id;
				if (n === null)
					note(
						"next-no-count",
						`Roster \`${name}\`'s count has no value, so it has no rows.`,
					);
				if (
					typeof n === "number" &&
					Math.min(Math.floor(n), s.max ?? Infinity) > MAX_ROWS
				)
					note(
						"next-roster-cap",
						`Roster \`${name}\` stops at ${MAX_ROWS} rows here.`,
					);
				const count = typeof n === "number" ? Math.min(Math.floor(n), cap) : 0;
				for (let r = 1; r <= count; r++) {
					const went = go(s.flow, [...rows, { loop: s.id, row: r }]);
					if (went !== undefined) return went;
				}
				return undefined;
			}
			case "repeat": {
				for (let r = 1; r <= Math.min(s.max, MAX_ROWS); r++) {
					const inRow = [...rows, { loop: s.id, row: r }];
					const went = go(s.flow, inRow);
					if (went !== undefined) return went;
					const more = value(s.more, inRow) === true;
					const paused = pauseForInput();
					if (paused !== undefined) return paused;
					if (!more) break;
					if (r === MAX_ROWS && s.max > MAX_ROWS)
						note(
							"next-roster-cap",
							`Roster \`${s.name ?? s.id}\` stops at ${MAX_ROWS} rows here.`,
						);
				}
				return undefined;
			}
			case "loop":
				note(
					"next-loop-skipped",
					`A loop this can't run (${s.construct}: ${s.cond.command.text}) was skipped, so its questions are never asked.`,
				);
				return undefined;
			default:
				return s satisfies never;
		}
	};
	const went = go(instrument.flow, []);
	if (went === "paused" && reply !== undefined) return ok(reply);
	return ok({
		kind: "end",
		how: went === "stopped" ? "stopped" : "end",
		statements,
		notes,
	});
}
