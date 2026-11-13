/**
 * An instrument's DDI as a Qualtrics survey: the DDI read back, then written as QSF. The
 * DDI is the record of the survey, so the QSF is made from it, never from the instrument's
 * YAML. Anything Qualtrics can't run as the DDI says is a finding at its DDI item. Any
 * error stops the export: otherwise a survey that differs from its DDI would be fielded
 * without a word.
 */

import type { DdiDocument } from "@qretools/core";
import type { ColumnMap } from "./columns.ts";
import type { Finding } from "./findings.ts";
import { readInstrument } from "./read.ts";
import type { QsfObject, QsfOptions } from "./skeleton.ts";
import { writeQsf } from "./write.ts";

export type { Qsf, QsfObject } from "./skeleton.ts";

/** A survey, or why there's none: the errors among its findings. */
export type QsfResult =
	| {
			readonly kind: "made";
			readonly qsf: QsfObject;
			/** Every column of its response export, with the DDI variable each records. */
			readonly columns: ColumnMap;
			readonly findings: readonly Finding[];
	  }
	| {
			readonly kind: "refused";
			readonly errors: number;
			readonly findings: readonly Finding[];
	  };

export function qsfOf(ddi: DdiDocument, options: QsfOptions): QsfResult {
	const read = readInstrument(ddi);
	// DDI the export can't read is no survey: what it would leave out isn't known.
	const findings = read.findings.some((f) => f.severity === "error")
		? read.findings
		: undefined;
	const written =
		findings === undefined ? writeQsf(read.instrument, options) : undefined;
	const all = findings ?? [...read.findings, ...(written?.findings ?? [])];
	const errors = all.filter((f) => f.severity === "error").length;
	return errors === 0 && written !== undefined
		? {
				kind: "made",
				qsf: written.qsf,
				columns: written.columns,
				findings: all,
			}
		: { kind: "refused", errors, findings: all };
}

/**
 * The column map of the survey `qsfOf` makes from `ddi`, or why there's none. Made by the
 * same code as the survey, so the map and a survey built from the same DDI number their
 * questions alike.
 */
export function qsfMapOf(
	ddi: DdiDocument,
	options: Pick<QsfOptions, "digest" | "version">,
):
	| {
			readonly kind: "made";
			readonly columns: ColumnMap;
			readonly findings: readonly Finding[];
	  }
	| Extract<QsfResult, { kind: "refused" }> {
	// The name and date reach only the survey's header, never its columns.
	const made = qsfOf(ddi, { ...options, name: "", created: "" });
	return made.kind === "made"
		? { kind: "made", columns: made.columns, findings: made.findings }
		: made;
}

/** Why the survey isn't exported, as the CLI and the app both say it. */
export const qsfRefusalReason = (errors: number): string =>
	`${errors === 1 ? "1 thing" : `${errors} things`} in this instrument can't be run in Qualtrics.`;

/** A time as Qualtrics' survey header has it, `YYYY-MM-DD hh:mm:ss`, in UTC. */
export const qsfTime = (at: Date): string =>
	at.toISOString().slice(0, 19).replace("T", " ");
