/**
 * An instrument's DDI read back, as the Qualtrics export needs it: the core's reader
 * (`readInstruments`), narrowed. The DDI is the record of the survey, so the QSF is made
 * from it, never from the instrument's YAML. Every condition must be parsed, every check
 * and roster read as one, and an ask may stand for one Qualtrics question only when no
 * respondent meets two asks recording one variable. Anything else is a finding at the DDI
 * item's ID.
 */

import {
	type Command,
	type Condition,
	type DdiDocument,
	ddiIndexOf,
	type Expr,
	type FlowCheck,
	type FlowDomain,
	type FlowStep,
	holesOf,
	readInstruments,
} from "@qretools/core";
import type { Finding } from "./findings.ts";

export type { Choice, FlowDomain as Domain } from "@qretools/core";

/** A bank question, as its asks show it. */
export interface Question {
	/** Its QuestionItem's DDI ID. */
	readonly id: string;
	readonly name: string;
	readonly domain: FlowDomain;
}

/** What a name in a condition or a text stands for. */
export type Source =
	| {
			readonly kind: "answer";
			/** The variable it is recorded as (the data's column). */
			readonly variable: string;
			/** The asks that record it, by DDI ID: more than one in exclusive branches. */
			readonly asks: readonly string[];
			readonly question: Question;
			/** Read at one round of a roster Qualtrics loops (an `each`'s row), not the current one. */
			readonly row?: number;
			/** For a select-all option: its code, and which values of the variable are a tick and none. */
			readonly option?: {
				readonly code: string;
				readonly ticked: string;
				readonly unticked: string;
			};
	  }
	| {
			readonly kind: "input";
			readonly variable: string;
			readonly domain?: FlowDomain;
	  }
	| { readonly kind: "compute"; readonly variable: string }
	/** The row number of a loop (a roster's `index`), by the loop's DDI ID. */
	| { readonly kind: "row"; readonly loop: string };

/** A condition: its expression, and what each of its names stands for. */
export interface Cond {
	readonly expr: Expr;
	readonly sources: ReadonlyMap<string, Source>;
}

/** A piece of displayed text: words, or a value piped in (a coded answer's words for `label`). */
export type Part =
	| { readonly kind: "text"; readonly text: string }
	| {
			readonly kind: "value";
			readonly source: Source;
			readonly label?: true;
	  };

export interface Check {
	readonly id: string;
	readonly severity: string;
	/** What must hold of the answers (the author's `ensure`). */
	readonly ensure: Cond;
	readonly message?: readonly Part[];
}

export type Step =
	| {
			readonly kind: "ask";
			readonly id: string;
			readonly question: Question;
			/** What it records: each variable, and an option's code for a select-all. */
			readonly records: readonly {
				readonly variable: string;
				readonly code?: string;
			}[];
			/** The question's text with its fills piped in. */
			readonly text: readonly Part[];
			readonly options?: "random" | "rotate";
			readonly checks: readonly Check[];
	  }
	| {
			readonly kind: "say";
			readonly id: string;
			readonly text: readonly Part[];
	  }
	| {
			readonly kind: "compute";
			readonly id: string;
			readonly variable: string;
			readonly value: Cond;
	  }
	| {
			readonly kind: "if";
			readonly id: string;
			readonly branches: readonly {
				readonly cond: Cond;
				readonly then: readonly Step[];
			}[];
			readonly else?: readonly Step[];
	  }
	/** Screen out: say its words, then end the survey (what follows is its else). */
	| {
			readonly kind: "stop";
			readonly id: string;
			readonly cond: Cond;
			readonly say: readonly Step[];
	  }
	/** A roster by count, or an `each` over one: rows 1 to the count, at most `max`. */
	| {
			readonly kind: "loop";
			readonly id: string;
			readonly count: Cond;
			readonly max?: number;
			readonly flow: readonly Step[];
	  }
	/** A roster by `more`: rows while `more` holds after each, at most `max`. */
	| {
			readonly kind: "repeat";
			readonly id: string;
			readonly more: Cond;
			readonly max: number;
			readonly flow: readonly Step[];
	  }
	| {
			readonly kind: "section";
			readonly id: string;
			readonly title?: string;
			readonly order?: "random" | "rotate";
			readonly flow: readonly Step[];
	  };

export interface ReadInstrument {
	readonly name?: string;
	readonly title?: string;
	/** Whether the bank has missing-value codes (on its variables, never a question's choices). */
	readonly missing?: true;
	readonly inputs: readonly Extract<Source, { kind: "input" }>[];
	readonly flow: readonly Step[];
}

export function readInstrument(ddi: DdiDocument): {
	readonly instrument: ReadInstrument;
	readonly findings: readonly Finding[];
} {
	const read = readInstruments(ddiIndexOf(ddi));
	// A condition kept as written is reported where the export needs it parsed, below.
	const findings: Finding[] = read.findings
		.filter((f) => f.code === "ddi-unread")
		.map((f) => ({ ...f, code: "qsf-unread" }));
	const unread = (id: string, message: string) =>
		findings.push({ code: "qsf-unread", severity: "error", path: id, message });
	const inexpressible = (id: string, message: string) =>
		findings.push({
			code: "qsf-inexpressible",
			severity: "error",
			path: id,
			message,
		});

	const cond = (c: Condition, at: string): Cond | undefined => {
		// A hole here is text the elaborator wouldn't write: it can't be exported.
		if (c.kind === "parsed" && holesOf(c.expr).length === 0)
			return { expr: c.expr, sources: c.sources };
		unread(at, `The export can't read \`${commandText(c.command)}\`.`);
		return undefined;
	};
	const ordered = (order: string | undefined) =>
		order === "Random" ? "random" : order === "Rotate" ? "rotate" : undefined;

	// Where each ask sits: the arm of every IfThenElse around it, outermost first.
	type Place = readonly { readonly at: string; readonly arm: number }[];
	const placed = new Map<string, Place>();
	const recorded = new Map<string, string[]>();

	const steps = (flow: readonly FlowStep[], place: Place): Step[] =>
		flow.flatMap((s) => step(s, place));
	const step = (s: FlowStep, place: Place): Step[] => {
		const { id } = s;
		switch (s.kind) {
			case "ask": {
				if (s.question.domain.kind === "other") {
					unread(s.question.id, "How this question is answered can't be read.");
					return [];
				}
				// One ask in two places would record its variable twice, unchecked.
				if (placed.has(id))
					inexpressible(id, "This step is in the flow more than once.");
				placed.set(id, place);
				for (const r of s.records)
					recorded.set(r.variable, [...(recorded.get(r.variable) ?? []), id]);
				const options = ordered(s.responseOrder);
				return [
					{
						kind: "ask",
						id,
						question: s.question,
						records: s.records,
						text: s.text,
						...(options !== undefined && { options }),
						checks: s.checks.flatMap((c) => check(c)),
					},
				];
			}
			case "say":
				return [{ kind: "say", id, text: s.text }];
			case "compute": {
				const value = cond(s.value, id);
				return value === undefined
					? []
					: [{ kind: "compute", id, variable: s.variable, value }];
			}
			case "if": {
				if (s.type !== undefined) {
					unread(
						id,
						"This check can't be read, or doesn't come after the question it checks.",
					);
					return [];
				}
				const branches: { cond: Cond; then: readonly Step[] }[] = [];
				for (const [i, b] of s.branches.entries()) {
					const c = cond(b.cond, i === 0 ? id : `${id}.elif-${i}`);
					// Without its first condition there is no if to write.
					if (c === undefined && i === 0) return [];
					if (c === undefined) continue;
					const then = steps(b.then, [...place, { at: id, arm: i }]);
					branches.push({ cond: c, then });
				}
				return [
					{
						kind: "if",
						id,
						branches,
						...(s.else !== undefined && {
							else: steps(s.else, [...place, { at: id, arm: -1 }]),
						}),
					},
				];
			}
			case "stop": {
				const c = cond(s.cond, id);
				if (c === undefined) return [];
				return [
					{
						kind: "stop",
						id,
						cond: c,
						say: steps(s.say, [...place, { at: id, arm: 0 }]),
					},
					...steps(s.else, [...place, { at: id, arm: 1 }]),
				];
			}
			case "count": {
				const count = cond(s.count, id);
				if (count === undefined) return [];
				return [
					{
						kind: "loop",
						id,
						count,
						...(s.max !== undefined && { max: s.max }),
						flow: steps(s.flow, place),
					},
				];
			}
			case "repeat": {
				const more = cond(s.more, id);
				if (more === undefined) return [];
				return [
					{ kind: "repeat", id, more, max: s.max, flow: steps(s.flow, place) },
				];
			}
			case "loop":
				unread(id, "The export can't read this loop's condition.");
				// What it holds is still read, so what else can't be is said too.
				steps(s.flow, place);
				return [];
			case "section": {
				const flow = steps(s.flow, place);
				const order = ordered(s.order);
				if (s.name === undefined && s.order === undefined) return flow;
				return [
					{
						kind: "section",
						id,
						...(s.name !== undefined && { title: s.name }),
						...(order !== undefined && { order }),
						flow,
					},
				];
			}
			default:
				return s satisfies never;
		}
	};
	const check = (c: FlowCheck): Check[] => {
		const ensure = cond(c.ensure, c.id);
		return ensure === undefined
			? []
			: [
					{
						id: c.id,
						severity: c.severity,
						ensure,
						...(c.message !== undefined && { message: c.message }),
					},
				];
	};

	const first = read.value.instruments[0];
	if (first === undefined) {
		unread("", "The DDI has no instrument.");
		return { instrument: { inputs: [], flow: [] }, findings };
	}
	const flow = steps(first.flow, []);
	// One Qualtrics question stands for a variable recorded by several asks only when no
	// respondent meets two of them: each pair must sit in different arms of one condition.
	const exclusive = (a: Place, b: Place) => {
		for (let i = 0; i < Math.min(a.length, b.length); i++) {
			if (a[i]?.at !== b[i]?.at) return false;
			if (a[i]?.arm !== b[i]?.arm) return true;
		}
		return false;
	};
	for (const [variable, asks] of recorded) {
		const at = [...new Set(asks)].map((ask) => ({
			ask,
			place: placed.get(ask) ?? [],
		}));
		const clash = at.find((b, j) =>
			at.slice(0, j).some((a) => !exclusive(a.place, b.place)),
		);
		if (clash !== undefined)
			inexpressible(
				clash.ask,
				`\`${variable}\` is recorded in two places one respondent can both reach.`,
			);
	}
	return {
		instrument: {
			...(first.name !== undefined && { name: first.name }),
			...(first.label !== undefined && { title: first.label }),
			...(Object.keys(ddi.ManagedMissingValuesRepresentation ?? {}).length >
				0 && { missing: true as const }),
			inputs: read.value.inputs,
			flow,
		},
		findings,
	};
}

const commandText = (c: Command) => c.text;
