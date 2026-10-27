/**
 * The writer's first pass: every ask and statement's QID in flow order (rosters included, so
 * later steps never renumber), and what the later passes ask about the flow.
 */
import type { Finding } from "./findings.ts";
import type { Question, ReadInstrument, Step } from "./read.ts";

/** Each ask and statement's QID and each ask's question, by DDI ID; the asks inside a roster's rows; every name the data has. */
export interface Numbering {
	readonly qids: ReadonlyMap<string, string>;
	readonly questions: ReadonlyMap<string, Question>;
	readonly looped: ReadonlySet<string>;
	/** The looped roster each looped ask is in, by DDI ID, and each loop's block ID. */
	readonly loopOf: ReadonlyMap<string, string>;
	readonly loopBlocks: ReadonlyMap<string, string>;
	readonly names: ReadonlySet<string>;
	/** Every step's place in the flow, depth first. */
	readonly order: ReadonlyMap<string, number>;
	/** Each computed variable's computes, and whether each is on every path through the survey. */
	readonly computes: ReadonlyMap<
		string,
		readonly {
			readonly step: Extract<Step, { kind: "compute" }>;
			readonly everyPath: boolean;
		}[]
	>;
}

/** QIDs in flow order, depth first, over every flow a step holds. */
export function number(instrument: ReadInstrument): Numbering {
	const qids = new Map<string, string>();
	const questions = new Map<string, Question>();
	const looped = new Set<string>();
	const loopOf = new Map<string, string>();
	const loopBlocks = new Map<string, string>();
	let loop: string | undefined;
	const names = new Set(instrument.inputs.map((i) => i.variable));
	const order = new Map<string, number>();
	const computes = new Map<
		string,
		{ step: Extract<Step, { kind: "compute" }>; everyPath: boolean }[]
	>();
	const go = (
		steps: readonly Step[],
		inLoop: boolean,
		every = !inLoop,
	): void => {
		for (const s of steps) {
			order.set(s.id, order.size);
			switch (s.kind) {
				case "ask":
				case "say":
					qids.set(s.id, `QID${qids.size + 1}`);
					if (inLoop) looped.add(s.id);
					if (s.kind === "ask" && loop !== undefined) loopOf.set(s.id, loop);
					if (s.kind === "ask") {
						// A warning is a statement on the ask's page, numbered right after it; one the
						// writer refuses keeps its number, so the QIDs after it never move.
						for (const c of s.checks)
							if (c.severity !== "blocking")
								qids.set(c.id, `QID${qids.size + 1}`);
						questions.set(s.id, s.question);
						for (const r of s.records) names.add(r.variable);
					}
					break;
				case "compute":
					names.add(s.variable);
					computes.set(s.variable, [
						...(computes.get(s.variable) ?? []),
						{ step: s, everyPath: every },
					]);
					break;
				case "if":
					for (const b of s.branches) go(b.then, inLoop, false);
					go(s.else ?? [], inLoop, false);
					break;
				case "stop":
					go(s.say, inLoop, false);
					break;
				case "loop":
				case "repeat": {
					const outer = loop;
					loop = s.id;
					loopBlocks.set(
						s.id,
						`BL_qretoolsLoop${String(loopBlocks.size + 1).padStart(3, "0")}`,
					);
					go(s.flow, true, false);
					loop = outer;
					break;
				}
				case "section":
					go(s.flow, inLoop, every);
					break;
				default:
					s satisfies never;
			}
		}
	};
	go(instrument.flow, false);
	return {
		qids,
		questions,
		looped,
		loopOf,
		loopBlocks,
		names,
		order,
		computes,
	};
}

/** How a part of the writer reports: a finding at a DDI ID. */
export type Note = (
	code: Finding["code"],
	severity: Finding["severity"],
	path: string,
	message: string,
) => void;

/** What every part of the writer knows: the numbering, and how to report. */
export interface Ctx {
	readonly numbering: Numbering;
	readonly note: Note;
	readonly qidOf: (id: string) => string;
	readonly placeOf: (id: string) => number;
	/** An ask the survey has no single question for: in a roster, or a roster's row never written. */
	readonly outside: (ask: string) => boolean;
	/** Something left out because it isn't exported yet. */
	readonly notYet: (path: string, what: string) => void;
}

export const context = (numbering: Numbering, note: Note): Ctx => ({
	numbering,
	note,
	qidOf: (id) => numbering.qids.get(id) ?? "",
	placeOf: (id) => numbering.order.get(id) ?? -1,
	outside: (ask) => numbering.looped.has(ask) || !numbering.qids.has(ask),
	notYet: (path, what) =>
		note(
			"qsf-inexpressible",
			"error",
			path,
			`${what} can't be exported to Qualtrics yet, so it's left out.`,
		),
});
