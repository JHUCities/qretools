/**
 * Which variables an instrument records, and in which roster: a structural query over the
 * read flow (`readInstruments`), run by nothing. `next` checks a state's rows with it, and a
 * dataset puts each roster's values in a record of their own.
 */
import { err, ok, type Result } from "../result.ts";
import type { Step } from "./read.ts";

export type Ask = Extract<Step, { kind: "ask" }>;
export type Recorded = Ask["records"][number];

/** A variable the flow records: its ask, and the roster it is in, if any. */
export interface Recording {
	readonly ask: Ask;
	readonly record: Recorded;
	/** The roster's name (its `ConstructName`), else its ID. An `each` over a roster has the roster's name, so it joins it. */
	readonly roster?: string;
	/** The most rows the roster's step states it has, if it states any. */
	readonly max?: number;
}

/**
 * Each variable the flow records, by URN; or why the flow can't be keyed by row. A `loop`
 * (one DDI states that `next` can't run) isn't a roster.
 */
export function recordsOf(
	flow: readonly Step[],
): Result<Map<string, Recording>, string> {
	const out = new Map<string, Recording>();
	const go = (
		steps: readonly Step[],
		roster: { readonly roster: string; readonly max?: number } | undefined,
	): string | undefined => {
		for (const s of steps) {
			let problem: string | undefined;
			if (s.kind === "ask")
				for (const record of s.records)
					out.set(record.urn, {
						ask: s,
						record,
						...roster,
					});
			else if (s.kind === "if")
				problem =
					s.branches.map((b) => go(b.then, roster)).find((p) => p) ??
					go(s.else ?? [], roster);
			else if (s.kind === "stop")
				problem = go(s.say, roster) ?? go(s.else, roster);
			else if (s.kind === "section" || s.kind === "loop")
				problem = go(s.flow, roster);
			else if (s.kind === "count" || s.kind === "repeat") {
				// shortcut: an answer names one row, so a roster inside a roster can't be keyed; key by every row if a survey needs one.
				if (roster !== undefined)
					return `A roster inside a roster (${s.name ?? s.id}) isn't supported yet.`;
				problem = go(s.flow, {
					roster: s.name ?? s.id,
					...(s.max !== undefined && { max: s.max }),
				});
			}
			if (problem !== undefined) return problem;
		}
		return undefined;
	};
	const problem = go(flow, undefined);
	return problem === undefined ? ok(out) : err(problem);
}
