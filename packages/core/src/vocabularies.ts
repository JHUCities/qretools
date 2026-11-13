/**
 * The DDI Alliance controlled vocabularies a dataset's provenance takes its terms from, as
 * data: each vocabulary's code values, each with the ID of its URI and its English label.
 * A standard's own vocabularies, adopted, not a bank's settings. Copied 2026-11-13 from the
 * code list of each version's page, for example
 * `curl -sL https://rdf-vocabulary.ddialliance.org/ddi-cv/ModeOfCollection/5.0.1/ModeOfCollection.html`
 * (the table's columns "Code value", "Code URI" and "Code descriptive term"). DDI Alliance,
 * CC BY 4.0. A new version is a new table, copied the same way in a release.
 */

import type { JsonObject } from "./ddi/document.ts";
import { err, ok, type Result } from "./result.ts";

/** A term of a DDI controlled vocabulary, or `Other` with words of our own. */
export type Term = string | { readonly other: string };

export interface Vocabulary {
	readonly name: string;
	readonly version: string;
	/** What a term of it names, for messages: "mode", "source", "unit". */
	readonly noun: string;
	/** Each code value, the ID that ends its URI, and its English label, in the vocabulary's order. */
	readonly codes: readonly (readonly [
		code: string,
		id: string,
		label: string,
	])[];
}

export const MODE_OF_COLLECTION: Vocabulary = {
	name: "ModeOfCollection",
	version: "5.0.1",
	noun: "mode",
	codes: [
		["Interview", "cb20d17", "Interview"],
		["Interview.FaceToFace", "9f669a4", "Face-to-face interview"],
		[
			"Interview.FaceToFace.CAPIorCAMI",
			"89e4fb4",
			"Face-to-face interview: Computer-assisted (CAPI/CAMI)",
		],
		[
			"Interview.FaceToFace.PAPI",
			"e477963",
			"Face-to-face interview: Paper-and-pencil (PAPI)",
		],
		["Interview.Telephone", "ae68e25", "Telephone interview"],
		[
			"Interview.Telephone.CATI",
			"1498dd4",
			"Telephone interview: Computer-assisted (CATI)",
		],
		["Interview.Email", "b0b2868", "E-mail interview"],
		["Interview.WebBased", "1af2bfa", "Web-based interview"],
		[
			"SelfAdministeredQuestionnaire",
			"35e4248",
			"Self-administered questionnaire",
		],
		[
			"SelfAdministeredQuestionnaire.Email",
			"69a46ca",
			"Self-administered questionnaire: E-mail",
		],
		[
			"SelfAdministeredQuestionnaire.Paper",
			"6255fce",
			"Self-administered questionnaire: Paper",
		],
		[
			"SelfAdministeredQuestionnaire.SMSorMMS",
			"ddaefe8",
			"Self-administered questionnaire: Messaging (SMS/MMS)",
		],
		[
			"SelfAdministeredQuestionnaire.CAWI",
			"557586d",
			"Self-administered questionnaire: Web-based (CAWI)",
		],
		[
			"SelfAdministeredQuestionnaire.CASI",
			"e48ace5",
			"Self-administered questionnaire: Computer-assisted (CASI)",
		],
		["FocusGroup", "9ec957d", "Focus group"],
		["FocusGroup.FaceToFace", "00b3692", "Face-to-face focus group"],
		["FocusGroup.Telephone", "2b4ef44", "Telephone focus group"],
		["FocusGroup.Online", "4da1255", "Online focus group"],
		[
			"SelfAdministeredWritingsAndDiaries",
			"08e658a",
			"Self-administered writings and/or diaries",
		],
		[
			"SelfAdministeredWritingsAndDiaries.Email",
			"fe226ad",
			"Self-administered writings and/or diaries: E-mail",
		],
		[
			"SelfAdministeredWritingsAndDiaries.Paper",
			"e5bef42",
			"Self-administered writings and/or diaries: Paper",
		],
		[
			"SelfAdministeredWritingsAndDiaries.WebBased",
			"9e67a7c",
			"Self-administered writings and/or diaries: Web-based",
		],
		["Observation", "c680d43", "Observation"],
		["Observation.Field", "bdc4aac", "Field observation"],
		[
			"Observation.Field.Participant",
			"3cee522",
			"Participant field observation",
		],
		[
			"Observation.Field.Nonparticipant",
			"8245871",
			"Non-participant field observation",
		],
		["Observation.Laboratory", "e679c7f", "Laboratory observation"],
		[
			"Observation.Laboratory.Participant",
			"2a58349",
			"Participant laboratory observation",
		],
		[
			"Observation.Laboratory.Nonparticipant",
			"68b02fb",
			"Non-participant laboratory observation",
		],
		["Observation.ComputerBased", "40b8b0c", "Computer-based observation"],
		["Experiment", "05aeba4", "Experiment"],
		["Experiment.Laboratory", "28a60a6", "Laboratory experiment"],
		[
			"Experiment.FieldIntervention",
			"5ff61de",
			"Field/Intervention experiment",
		],
		["Experiment.WebBased", "ed0d083", "Web-based experiment"],
		["Recording", "c5564d2", "Recording"],
		["Recording.RemoteSensing", "f25ffb0", "Recording: Remote sensing"],
		["AutomatedDataExtraction", "c867d80", "Automated data extraction"],
		[
			"AutomatedDataExtraction.ApiQuery",
			"0998f59",
			"Automated data extraction: API query",
		],
		[
			"AutomatedDataExtraction.DatabaseQuery",
			"613d44d",
			"Automated data extraction: Database query",
		],
		[
			"AutomatedDataExtraction.WebScraping",
			"d759f9a",
			"Automated data extraction: Web scraping",
		],
		["ContentCoding", "4848ed5", "Content coding"],
		["Transcription", "df9aac3", "Transcription"],
		["CompilationSynthesis", "6decc77", "Compilation/Synthesis"],
		["Summary", "2906121", "Summary"],
		["Aggregation", "d9ceca6", "Aggregation"],
		["Simulation", "4f502b5", "Simulation"],
		["MeasurementsAndTests", "38ceaa4", "Measurements and tests"],
		[
			"MeasurementsAndTests.Cognitive",
			"47bfda9",
			"Cognitive measurements and tests",
		],
		[
			"MeasurementsAndTests.Educational",
			"4b9776b",
			"Educational measurements and tests",
		],
		[
			"MeasurementsAndTests.Physical",
			"c2a25a6",
			"Physical measurements and tests",
		],
		[
			"MeasurementsAndTests.Psychological",
			"27daf03",
			"Psychological measurements and tests",
		],
		["Other", "6311ae1", "Other"],
	],
};

export const DATA_SOURCE_TYPE: Vocabulary = {
	name: "DataSourceType",
	version: "1.0.2",
	noun: "source",
	codes: [
		["RegistersRecordsAccounts", "1ba0788", "Registers/Records/Accounts"],
		[
			"RegistersRecordsAccounts.Administrative",
			"3d07703",
			"Registers/Records/Accounts: Administrative",
		],
		[
			"RegistersRecordsAccounts.Historical",
			"57cdabd",
			"Registers/Records/Accounts: Historical",
		],
		[
			"RegistersRecordsAccounts.Legal",
			"aa93f04",
			"Registers/Records/Accounts: Legal",
		],
		[
			"RegistersRecordsAccounts.MedicalClinical",
			"e037a6b",
			"Registers/Records/Accounts: Medical/Clinical",
		],
		[
			"RegistersRecordsAccounts.AcademicAptitude",
			"67df10a",
			"Registers/Records/Accounts: Academic/Aptitude",
		],
		[
			"RegistersRecordsAccounts.EconomicFinancial",
			"0b46c77",
			"Registers/Records/Accounts: Economic/Financial",
		],
		[
			"RegistersRecordsAccounts.Personal",
			"011c080",
			"Registers/Records/Accounts: Personal",
		],
		[
			"RegistersRecordsAccounts.VotingResults",
			"b7bf784",
			"Registers/Records/Accounts: Voting results",
		],
		["EventsInteractions", "83d674a", "Events/Interactions"],
		["Processes", "77ea79b", "Processes"],
		["Processes.Workflows", "66ddf0b", "Processes: Workflow(s)"],
		["Communications", "cf948ca", "Communications"],
		["Communications.Public", "42c1eb3", "Communications: Public"],
		[
			"Communications.Interpersonal",
			"2410622",
			"Communications: Interpersonal",
		],
		["ResearchData", "391214b", "Research data"],
		["ResearchData.Published", "4cacbbc", "Research data: Published"],
		["ResearchData.Unpublished", "9185b91", "Research data: Unpublished"],
		["PopulationGroup", "7fda149", "Population group"],
		["GeographicArea", "e3a81ca", "Geographic area"],
		["PhysicalObjects", "f04e4fa", "Physical objects"],
		["BiologicalSamples", "4dcbc37", "Biological samples"],
		["Other", "6311ae1", "Other"],
	],
};

export const RESPONSE_UNIT: Vocabulary = {
	name: "ResponseUnit",
	version: "1.0.2",
	noun: "unit",
	codes: [
		["Self", "ad6e765", "Self"],
		["Informant", "85c2695", "Informant"],
		["Proxy", "f56ec2a", "Proxy"],
		["Interviewer", "1b778c7", "Interviewer"],
		["Other", "6311ae1", "Other"],
	],
};

/** The vocabulary's URI without a version, as a dataset names it. */
export const vocabularyUri = (v: Vocabulary): string =>
	`http://rdf-vocabulary.ddialliance.org/cv/${v.name}/`;

/** The page that lists the version's terms, for people. */
export const termsPage = (v: Vocabulary): string =>
	`https://rdf-vocabulary.ddialliance.org/cv/${v.name}/${v.version}/`;

/** Why a text isn't a term: not in the vocabulary (with up to three it may mean), or `Other` without words. */
export type TermProblem =
	| { readonly kind: "unknown"; readonly suggestions: readonly string[] }
	| { readonly kind: "otherNeedsWords" }
	/** A map writes Other as `{ "other": … }`, never as a string: the words it gave. */
	| { readonly kind: "otherInMap"; readonly words: string };

const OTHER = /^other(?:\s*:(.*))?$/is;
const lower = (s: string) => s.toLowerCase();

/**
 * Up to three terms a text may mean, in the vocabulary's order: those equal to it but
 * for case; else those with a dot-segment equal to it but for case; else those whose
 * segments or English label contain it, case ignored. `Other` is never one: it needs words.
 */
export function suggestionsFor(v: Vocabulary, text: string): readonly string[] {
	const t = lower(text.trim());
	if (t === "") return [];
	const codes = v.codes.filter(([code]) => code !== "Other");
	const tiers = [
		codes.filter(([code]) => lower(code) === t),
		codes.filter(([code]) => code.split(".").some((s) => lower(s) === t)),
		codes.filter(
			([code, , label]) =>
				code.split(".").some((s) => lower(s).includes(t)) ||
				lower(label).includes(t),
		),
	];
	return (tiers.find((tier) => tier.length > 0) ?? [])
		.slice(0, 3)
		.map(([code]) => code);
}

/**
 * A term as an option gives it: a code value, exactly as the vocabulary spells it, or
 * `Other:<words>` (the words trimmed, and needed).
 */
export function termOf(
	v: Vocabulary,
	given: string,
): Result<Term, TermProblem> {
	const text = given.trim();
	const other = OTHER.exec(text);
	if (other !== null) {
		const words = (other[1] ?? "").trim();
		if (words === "") return err({ kind: "otherNeedsWords" });
		return text.startsWith("Other")
			? ok({ other: words })
			: err({ kind: "unknown", suggestions: [`Other:${words}`] });
	}
	return v.codes.some(([code]) => code === text)
		? ok(text)
		: err({ kind: "unknown", suggestions: suggestionsFor(v, text) });
}

/** A term as a map gives it: a code value, or `{ "other": "<words>" }` (the words trimmed, and needed). */
export function mapTermOf(v: Vocabulary, t: Term): Result<Term, TermProblem> {
	if (typeof t !== "string") {
		const words = t.other.trim();
		return words === ""
			? err({ kind: "otherNeedsWords" })
			: ok({ other: words });
	}
	const other = OTHER.exec(t.trim());
	if (other !== null)
		return err({ kind: "otherInMap", words: (other[1] ?? "").trim() });
	return termOf(v, t);
}

/** A term as DDI's CodeValueType writes it: the vocabulary without a version, and the term's own URI, with it. */
export function codeValueOf(t: Term, v: Vocabulary): JsonObject {
	const code = typeof t === "string" ? t : "Other";
	const id = v.codes.find(([c]) => c === code)?.[1];
	return {
		StringValue: code,
		...(typeof t !== "string" && { OtherValue: t.other }),
		ControlledVocabularyURI: vocabularyUri(v),
		// A term not in the table is a bug: every term is read through termOf or mapTermOf.
		...(id !== undefined && {
			ControlledVocabularyInstanceURI: `http://rdf-vocabulary.ddialliance.org/cv/${v.name}/${v.version}/${id}`,
		}),
	};
}
