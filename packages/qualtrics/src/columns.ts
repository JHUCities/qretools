/**
 * The column map: every column of the Qualtrics response export that records a DDI
 * variable, with that variable's URN. Made beside the survey, from the same numbering, so
 * a column and its QID never disagree. It holds only what Qualtrics adds (the ImportId, a
 * select-all option's column suffix, a single-choice value it writes differently from its
 * code, a roster's rounds or row); how to read a cell is the variable's representation in
 * the DDI.
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
	 * A select-all option's column suffix, the ImportId's `choiceId`: the option's code as
	 * Qualtrics writes it (`exportedCodes`).
	 */
	readonly choice?: string;
	/**
	 * A single-choice question's exported value for each code it reads (`exportedCodes`),
	 * where some code isn't written as itself: exported value to code. Only these are read.
	 */
	readonly values?: Readonly<Record<string, string>>;
	/** A question Qualtrics loops: columns `1_<importId>` to `<rounds>_<importId>`. */
	readonly rounds?: number;
	/** A roster written out row by row: the row this column is. */
	readonly row?: number;
	/** The URN of the DDI variable the column records. */
	readonly variable: string;
}

/**
 * How Qualtrics writes the code (the recode) of the option at `position` (from 1), both as a
 * select-all option's column suffix and as a single-choice answer's exported value, or
 * undefined where it writes nothing. Measured in Qualtrics, 2026-11-12, in CSV and JSON
 * exports, and it is JavaScript's `parseFloat` exactly: a code that starts with a number is
 * that number as it prints (`010` is `10`, `1.50` is `1.5`, `1e2` is `100`, `1,5` is `1`);
 * any other code is its position, the choice key the QSF writer gives it. A code that
 * reads as `Infinity` is written as nothing: the answer is lost.
 */
const exported = (code: string, position: number): string | undefined => {
	const n = Number.parseFloat(code);
	return Number.isNaN(n)
		? String(position)
		: Number.isFinite(n)
			? String(n)
			: undefined;
};

/**
 * What Qualtrics writes for each option's code, from the codes in order (see `exported`),
 * or undefined where it writes nothing, or the same as for another option: two options
 * written the same can't be told apart, so neither is read.
 */
export function exportedCodes(
	codes: readonly string[],
): readonly (string | undefined)[] {
	const xs = codes.map((code, i) => exported(code, i + 1));
	return xs.map((x) => (xs.filter((y) => y === x).length > 1 ? undefined : x));
}

/** The map, with what the survey's `qretools_*` fields carry, so a response can be matched to it. */
export interface ColumnMap {
	/** What kind of map it is: a QSF column map, read by ImportId. */
	readonly source: "qsf";
	/** The version of QREtools that made the map, which may not be the one that built the survey: never compared. */
	readonly qretools?: string;
	readonly instrument?: string;
	readonly ddi?: string;
	/** The release its DDI was taken from, as a tag reference (`owner/repo@v1:name`), when it was. */
	readonly release?: string;
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
						const suffixes = exportedCodes(domain.choices.map((c) => c.code));
						domain.choices.forEach((c, i) => {
							const choice = suffixes[i];
							if (choice === undefined)
								ctx.note(
									"qsf-unmapped",
									"warning",
									s.id,
									`The QSF column map can't tell which column records option \`${c.code}\` of \`${s.question.name}\`: Qualtrics gives it no name, or the same name as another option.`,
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
					} else if (domain.kind === "choice") {
						const codes = domain.choices.map((c) => c.code);
						const exports = exportedCodes(codes);
						const unknown = codes.filter((_, i) => exports[i] === undefined);
						if (unknown.length > 0)
							ctx.note(
								"qsf-unmapped",
								"warning",
								s.id,
								`The QSF column map can't read option${unknown.length > 1 ? "s" : ""} ${unknown.map((c) => `\`${c}\``).join(", ")} of \`${s.question.name}\`: Qualtrics writes no value for ${unknown.length > 1 ? "each" : "it"}, or the same value as for another option.`,
							);
						const values = Object.fromEntries(
							codes.flatMap((c, i) => {
								const e = exports[i];
								return e === undefined ? [] : [[e, c]];
							}),
						);
						add(
							{
								importId: qid,
								...(codes.some((c, i) => exports[i] !== c) && { values }),
							},
							s.records[0]?.urn,
							s.id,
							`for \`${s.question.name}\``,
							rounds,
						);
					} else
						add(
							{ importId: `${qid}_TEXT` },
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
