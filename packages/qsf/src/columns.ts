/**
 * The column map: every column of the Qualtrics response export that records a DDI
 * variable, with that variable's URN. Made beside the survey, from the same numbering, so
 * a column and its QID never disagree. It holds only what Qualtrics adds (the ImportId, a
 * select-all option's position, a roster's rounds or row); how to read a cell is the
 * variable's representation in the DDI.
 */
import { logical } from "./computes.ts";
import type { Ctx } from "./number.ts";
import type { ReadInstrument, Step } from "./read.ts";
import { rowOf } from "./unroll.ts";

/** One column of the response export. */
export interface Column {
	/** Its ImportId: `QIDn` (a choice), `QIDn_TEXT` (typed), or an embedded data field's name. */
	readonly importId: string;
	/** A select-all option's column: the option's position, from 1 (never its code). */
	readonly choice?: string;
	/** A question Qualtrics loops: columns `1_<importId>` to `<rounds>_<importId>`. */
	readonly rounds?: number;
	/** A roster written out row by row: the row this column is. */
	readonly row?: number;
	/** The URN of the DDI variable the column records. */
	readonly variable: string;
}

/** The map, with what the survey's `qretools_*` fields carry, so a response can be matched to it. */
export interface ColumnMap {
	readonly qretools?: string;
	readonly instrument?: string;
	readonly ddi?: string;
	readonly columns: readonly Column[];
}

/**
 * The columns of the survey written from `instrument` (already unrolled): inputs first,
 * then the flow in order. A column with no variable to name is a finding, never a gap.
 */
export function columnsOf(
	instrument: ReadInstrument,
	ctx: Ctx,
): readonly Column[] {
	const columns: Column[] = [];
	const unmapped = (id: string, what: string) =>
		ctx.note(
			"qsf-unmapped",
			"warning",
			id,
			`The column map can't name the DDI variable ${what}.`,
		);
	const add = (
		column: Omit<Column, "variable" | "row">,
		variable: string | undefined,
		id: string,
		what: string,
		rounds: number | undefined,
	) => {
		if (variable === undefined) return unmapped(id, what);
		const row = rowOf(id);
		columns.push({
			...column,
			...(rounds !== undefined && { rounds }),
			...(row !== undefined && { row }),
			variable,
		});
	};
	for (const input of instrument.inputs)
		add(
			{ importId: input.variable },
			input.urn,
			"",
			`of the input \`${input.variable}\``,
			undefined,
		);

	const walk = (steps: readonly Step[], rounds: number | undefined): void => {
		for (const s of steps)
			switch (s.kind) {
				case "ask": {
					const qid = ctx.qidOf(s.id);
					const domain = s.question.domain;
					if (domain.kind === "choice" && domain.many)
						domain.choices.forEach((c, i) => {
							const record = s.records.find((r) => r.code === c.code);
							add(
								{ importId: qid, choice: String(i + 1) },
								record?.urn,
								s.id,
								`for option \`${c.code}\` of \`${s.question.name}\``,
								rounds,
							);
						});
					else
						add(
							{ importId: domain.kind === "choice" ? qid : `${qid}_TEXT` },
							s.records[0]?.urn,
							s.id,
							`for \`${s.question.name}\``,
							rounds,
						);
					break;
				}
				case "compute":
					// True or false: inlined where it's read, so it has no column.
					if (!logical(ctx, s.value.expr))
						add(
							{ importId: s.variable },
							s.variableUrn,
							s.id,
							`of the computed value \`${s.variable}\``,
							rounds,
						);
					break;
				case "if":
					for (const b of s.branches) walk(b.then, rounds);
					if (s.else !== undefined) walk(s.else, rounds);
					break;
				case "stop":
					walk(s.say, rounds);
					break;
				// After unroll, a loop left is one Qualtrics runs (Loop & Merge): its rounds.
				case "loop":
					walk(s.flow, s.max);
					break;
				// Unroll writes every `more` roster out row by row: none is left to loop.
				case "repeat":
					walk(s.flow, rounds);
					break;
				case "section":
					walk(s.flow, rounds);
					break;
				case "say":
					break;
				default:
					s satisfies never;
			}
	};
	walk(instrument.flow, undefined);
	return columns;
}
