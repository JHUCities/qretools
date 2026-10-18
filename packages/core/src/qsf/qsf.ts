/**
 * An instrument's DDI as a Qualtrics survey: the DDI read back, then written as QSF. The
 * DDI is the record of the survey; the QSF is made from it, never from the instrument's
 * source. Anything Qualtrics can't run as the DDI says is a finding at its DDI item, and
 * any error refuses the survey: a survey asking something other than the
 * DDI says would be fielded silently.
 */
import type { DdiDocument } from "../ddi/document.ts";
import type { Finding } from "../findings.ts";
import { readInstrument } from "./read.ts";
import type { QsfObject } from "./skeleton.ts";
import { writeQsf } from "./write.ts";

export type { Qsf, QsfObject } from "./skeleton.ts";

/** A survey, or why there's none: the errors among its findings. */
export type QsfResult =
	| {
			readonly kind: "made";
			readonly qsf: QsfObject;
			readonly findings: readonly Finding[];
	  }
	| {
			readonly kind: "refused";
			readonly errors: number;
			readonly findings: readonly Finding[];
	  };

export function qsfOf(
	ddi: DdiDocument,
	options: {
		readonly name: string;
		/** When the survey is made (`qsfTime`): the core has no clock. */
		readonly created: string;
	},
): QsfResult {
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
		? { kind: "made", qsf: written.qsf, findings: all }
		: { kind: "refused", errors, findings: all };
}

/** Why the survey isn't exported, as the CLI and the app both say it. */
export const qsfRefusalReason = (errors: number): string =>
	`${errors === 1 ? "1 thing" : `${errors} things`} in this instrument can't be run in Qualtrics as its DDI says.`;

/** A time as Qualtrics' survey header has it, `YYYY-MM-DD hh:mm:ss`, in UTC. */
export const qsfTime = (at: Date): string =>
	at.toISOString().slice(0, 19).replace("T", " ");

/**
 * Findings said of DDI items, as said of the instrument: each item's path where it came
 * from. One with no place keeps its message, and its DDI ID as detail.
 */
export const placeFindings = (
	findings: readonly Finding[],
	places: Readonly<Record<string, string>>,
): Finding[] =>
	findings.map((f) => {
		const place = places[f.path];
		return place !== undefined
			? { ...f, path: place }
			: f.path === ""
				? f
				: { ...f, path: "", detail: `DDI item ${f.path}` };
	});
