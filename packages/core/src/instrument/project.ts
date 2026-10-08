/**
 * A project: a folder holding instruments (`instruments/*.yaml`) and its own file,
 * `project.yaml`, which says what the project publishes under: today one field, the
 * DDI agency, read by the rule `bank.yaml` is. The agency is the project's, never a
 * person's, so everyone who exports it exports under one.
 */
import { parseDocument } from "yaml";
import type { Finding, Range } from "../findings.ts";
import { parseAgencyFile } from "../surface/bankfile.ts";
import { indexDocument, pointAt } from "../surface/parse.ts";
import { withSpacing } from "../surface/spacing.ts";

/** Where a project keeps things: its own file at its root, and its instruments' folder (one file each). */
export const PROJECT = {
	file: "project.yaml",
	instruments: "instruments",
} as const;

export interface Project {
	/** Absent until the file gives a valid one. */
	readonly agency?: string;
	/**
	 * The agency as written, valid or not: what an instrument is published under, so its
	 * own findings say `invalid-agency` where the file's is wrong (as the CLI's `--agency`).
	 */
	readonly given?: string;
	readonly findings: readonly Finding[];
	readonly ranges: Readonly<Record<string, Range>>;
}

/** The project file, read. Total, as a bank file is: anything wrong is a finding with its place. */
export function projectOf(source: string): Project {
	const doc = parseDocument(source, { prettyErrors: false });
	const { ranges, empties } = indexDocument(doc, source.length);
	const { agency, findings } = parseAgencyFile(source, "project");
	const written = doc.get("agency");
	const given =
		agency ??
		(typeof written === "string" && written.trim() !== ""
			? written
			: undefined);
	return {
		...(agency !== undefined && { agency }),
		...(given !== undefined && { given }),
		findings: withSpacing(doc, source, findings.map(pointAt(empties))),
		ranges,
	};
}
