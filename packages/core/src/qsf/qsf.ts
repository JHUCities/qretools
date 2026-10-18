/**
 * An instrument's DDI as a Qualtrics survey: the DDI read back, then written as QSF. The
 * DDI is the record of the survey; the QSF is made from it, never from the instrument's
 * source. Anything Qualtrics can't run as the DDI says is a finding at its DDI item, and
 * any error refuses the survey (`qsfRefusal`): a survey asking something other than the
 * DDI says would be fielded silently.
 */
import type { DdiDocument } from "../ddi/document.ts";
import type { Finding } from "../findings.ts";
import { readInstrument } from "./read.ts";
import type { QsfObject } from "./skeleton.ts";
import { writeQsf } from "./write.ts";

export type { Qsf, QsfObject } from "./skeleton.ts";

export function qsfOf(
	ddi: DdiDocument,
	options: {
		readonly name: string;
		/** When the survey is made (`qsfTime`): the core has no clock. */
		readonly created: string;
	},
): { readonly qsf?: QsfObject; readonly findings: readonly Finding[] } {
	const read = readInstrument(ddi);
	// DDI the export can't read is no survey: what it would leave out isn't known.
	if (read.findings.some((f) => f.severity === "error"))
		return { findings: read.findings };
	const written = writeQsf(read.instrument, options);
	return {
		qsf: written.qsf,
		findings: [...read.findings, ...written.findings],
	};
}

/** Why a survey can't be exported to Qualtrics: its errors, if any. */
export const qsfRefusal = (
	findings: readonly Finding[],
): { readonly errors: number } | undefined => {
	const errors = findings.filter((f) => f.severity === "error").length;
	return errors === 0 ? undefined : { errors };
};

/** A time as Qualtrics' survey header has it, `YYYY-MM-DD hh:mm:ss`, in UTC. */
export const qsfTime = (at: Date): string =>
	at.toISOString().slice(0, 19).replace("T", " ");

/** The survey as made at another time: only its header's dates change. */
export const withCreated = (qsf: QsfObject, created: string): QsfObject => ({
	...qsf,
	SurveyEntry: {
		...(qsf.SurveyEntry as QsfObject),
		SurveyCreationDate: created,
		LastModified: created,
	},
});

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
