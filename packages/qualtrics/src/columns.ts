/**
 * The column map: every column of the Qualtrics response export that records a DDI
 * variable, with that variable's URN. Made beside the survey, from the same numbering, so
 * a column and its QID never disagree. It holds only what Qualtrics adds (the ImportId, a
 * select-all option's column suffix, a roster's rounds or row); how to read a cell is the
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
	/**
	 * A select-all option's column suffix, the ImportId's `choiceId`: the option's code as a
	 * number (`010` is `10`), or its position from 1 when the code is letters (experiments 12
	 * and 13).
	 */
	readonly choice?: string;
	/** A question Qualtrics loops: columns `1_<importId>` to `<rounds>_<importId>`. */
	readonly rounds?: number;
	/** A roster written out row by row: the row this column is. */
	readonly row?: number;
	/** The URN of the DDI variable the column records. */
	readonly variable: string;
}

/**
 * Each select-all option's suffix, from its code and position, or undefined where Qualtrics'
 * name for it isn't known. Only forms experiment 13 measured are named: a whole number
 * (leading zeros dropped: `010` is `10`), a decimal as written (`1.5`), and letters, which
 * fall back to the position (the choice key the QSF writer gives it). Two options with one
 * suffix share one column in the export, so neither is named. Numbers stop at 15 digits,
 * where a float would print differently.
 */
export function choiceSuffixes(
	codes: readonly string[],
): readonly (string | undefined)[] {
	const suffixes = codes.map((code, i) =>
		/^(0|-?[1-9]\d{0,14})$/.test(code)
			? code
			: /^0+[1-9]\d{0,14}$/.test(code)
				? code.replace(/^0+/, "")
				: /^[1-9]\d{0,13}\.\d{0,13}[1-9]$/.test(code)
					? code
					: /^[A-Za-z]+$/.test(code)
						? String(i + 1)
						: undefined,
	);
	return suffixes.map((s) =>
		suffixes.filter((t) => t === s).length > 1 ? undefined : s,
	);
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
			`The QSF column map can't name the DDI variable ${what}.`,
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
					if (domain.kind === "choice" && domain.many) {
						const suffixes = choiceSuffixes(domain.choices.map((c) => c.code));
						domain.choices.forEach((c, i) => {
							const choice = suffixes[i];
							if (choice === undefined)
								ctx.note(
									"qsf-unmapped",
									"warning",
									s.id,
									`The QSF column map can't tell which column records option \`${c.code}\` of \`${s.question.name}\`: Qualtrics' name for it isn't known for this code.`,
								);
							else
								add(
									{ importId: qid, choice },
									s.records.find((r) => r.code === c.code)?.urn,
									s.id,
									`for option \`${c.code}\` of \`${s.question.name}\``,
									rounds,
								);
						});
					} else
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
