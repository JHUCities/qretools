/**
 * The facts of one run or one ingest, as a harness gives them to `qretools provenance`: a
 * public contract, defined once here. Its JSON Schema (`provenanceFactsJsonSchema`) is what
 * another harness, in any language, writes against; `parseFacts` reads the file once, at
 * the boundary, and nothing downstream checks its shape again. Pure.
 *
 * The facts say nothing about models: a model's settings are key-value pairs, written
 * unread. Every term of our own (a variable's role, a file's role) comes from the facts.
 */
import { z } from "zod";
import type { Finding } from "../findings.ts";
import { err, ok, type Result } from "../result.ts";
import { AGENCY_PATTERN } from "../surface/bankfile.ts";

/** The parts of a DDI URN with its version, as qretools writes one: `urn:ddi:<agency>:<id>:<version>`. */
export const URN =
	/^urn:ddi:([a-zA-Z0-9-]{1,63}(?:\.[a-zA-Z0-9-]{1,63})*):([A-Za-z0-9*@$_-]+(?:\.[A-Za-z0-9*@$_-]+)?):([0-9]+(?:\.[0-9]+)*)$/;

const urn = z
	.string()
	.regex(URN)
	.describe(
		"A DDI URN with its version, `urn:ddi:<agency>:<id>:<version>`, as `qretools build` writes it.",
	);

const sha256 = z
	.string()
	.regex(/^[0-9a-f]{64}$/)
	.describe("The file's SHA-256 digest: 64 lowercase hexadecimal digits.");

/** A date, or a date and time with its offset (ISO 8601). */
const when = z
	.union([z.iso.date(), z.iso.datetime({ offset: true })])
	.describe(
		"An ISO 8601 date (`2026-11-12`), or a date and time with its offset.",
	);

/** A metadata variable's name: letters, digits and `_`, as a question's. */
const NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

const term = z
	.union([
		z
			.string()
			.min(1)
			.describe("A term of the DDI controlled vocabulary, as its notation."),
		z
			.strictObject({
				other: z
					.string()
					.min(1)
					.describe(
						"A term of your own, for something the DDI vocabulary has no term for.",
					),
			})
			.describe("DDI's `Other`, with a term of your own."),
	])
	.describe('A DDI vocabulary term, or `{ "other": <your term> }`.');

export type Term = z.infer<typeof term>;

const pairs = z
	.record(z.string().min(1), z.string())
	.describe(
		"Key-value pairs that qretools writes unread, as DDI UserAttributePairs. Values are strings, written byte for byte; the order of the keys isn't kept.",
	);

const file = z.strictObject({
	path: z
		.string()
		.min(1)
		.describe("The file's path, relative to the facts file."),
	sha256,
	url: z.url().optional().describe("Where the file is published, if it is."),
});

const roleFile = file.extend({
	role: z
		.string()
		.min(1)
		.describe(
			"What the file is, in your own term: `traces`, `config`, `column-map`.",
		),
});

/** What every metadata variable has, beside its codes, number format or text. */
const metadataCommon = {
	name: z
		.string()
		.regex(NAME)
		.describe(
			"The variable's name, such as `mode`. Its URN is `urn:ddi:<agency>:variable-<provenance name>.<name>:1`.",
		),
	label: z.string().min(1).optional(),
	description: z.string().min(1).optional(),
	role: z
		.string()
		.min(1)
		.optional()
		.describe(
			"What the variable is for, in your own term (`weight`, `mode`, `design`).",
		),
	source_unit: term
		.optional()
		.describe(
			'Who gave the value: a DDI ResponseUnit term (`Interviewer`), or `{ "other": <your term> }`.',
		),
	modes: z
		.array(z.strictObject({ code: z.string().min(1), term }))
		.optional()
		.describe(
			"For the variable that records each case's mode: each code, with the DDI ModeOfCollection term it stands for.",
		),
	weighting: z
		.strictObject({
			description: z
				.string()
				.min(1)
				.optional()
				.describe("How the weight was made."),
			usage: z
				.string()
				.min(1)
				.optional()
				.describe(
					"When to use it, in the publisher's words, with where and when they said it. qretools never chooses a weight.",
				),
		})
		.optional()
		.describe(
			"Present if the variable is a weight. Give every weight the source publishes.",
		),
};

/** Exactly one of `codes`, `number` or `text`, said in the JSON Schema too. */
const metadataVariable = z
	.union([
		z.strictObject({
			...metadataCommon,
			codes: z
				.array(
					z.strictObject({
						code: z.string().min(1),
						label: z.string().min(1),
					}),
				)
				.min(1)
				.describe("Its codes, each with its label, in order."),
		}),
		z.strictObject({
			...metadataCommon,
			number: z
				.strictObject({
					min: z.number().optional(),
					max: z.number().optional(),
					decimals: z
						.number()
						.int()
						.min(0)
						.optional()
						.describe("0 for whole numbers; absent if not known."),
				})
				.describe("Its number format, for a number (a weight)."),
		}),
		z.strictObject({
			...metadataCommon,
			text: z
				.literal(true)
				.describe("`true` for free text, such as a start time."),
		}),
	])
	.describe(
		"A per-respondent column that no one is asked (mode, sample phase, ballot, weight, response status). The provenance defines it.",
	);

export const ProvenanceFactsSchema = z
	.strictObject({
		qretools_provenance: z
			.literal(1)
			.describe("The version of this contract: 1."),
		name: z
			.string()
			.regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/)
			.describe(
				"The run's or the ingest's name, unique under the agency: part of every DDI ID in the provenance.",
			),
		agency: z
			.string()
			.regex(AGENCY_PATTERN)
			.optional()
			.describe(
				"The DDI agency of the provenance's own items. Default: the instrument's.",
			),
		purpose: z.string().min(1).optional(),
		instrument: z
			.strictObject({
				urn: urn.describe("The URN of the DDI Instrument, with its version."),
				ddi: file.describe(
					"The instrument's DDI, as `qretools build` wrote it.",
				),
				workspace: z
					.string()
					.min(1)
					.describe(
						"The workspace and tag it was built from: `owner/repo@v1`.",
					),
			})
			.describe("The instrument that was asked."),
		asked_by: z
			.array(term)
			.min(1)
			.describe(
				"How the instrument was administered: DDI ModeOfCollection terms (`Simulation`, `SelfAdministeredQuestionnaire.CAWI`), one for each mode that occurs.",
			),
		answered_by: z
			.strictObject({
				source: term.describe(
					'Who answered: a DDI DataSourceType term (`ResearchData.Published`), or `{ "other": <your term> }`.',
				),
				description: z.string().min(1).optional(),
				citation: z
					.string()
					.min(1)
					.optional()
					.describe("The source as its publisher cites it."),
				url: z.url().optional().describe("Where the source publishes it."),
			})
			.describe("Who answered."),
		dates: z
			.strictObject({ start: when.optional(), end: when.optional() })
			.optional()
			.describe("When the answers were collected or made."),
		situation: z
			.string()
			.min(1)
			.optional()
			.describe(
				"The situation of collection, in your own term (`interview`, `item`).",
			),
		software: z
			.array(
				z.strictObject({
					name: z.string().min(1),
					version: z.string().min(1).optional(),
					accessed: when.optional(),
					description: z.string().min(1).optional(),
				}),
			)
			.default([])
			.describe(
				"The software that collected or made the answers: a survey platform, a model, a publisher's own.",
			),
		dataset: file
			.extend({
				present: z
					.array(urn)
					.describe(
						"The instrument's Variables the dataset holds. Its metadata variables are added.",
					),
				removed: z
					.array(
						z.strictObject({
							urn,
							reason: z.enum(["filtered", "not-published"]),
						}),
					)
					.default([])
					.describe(
						"The instrument's Variables the dataset doesn't hold: removed by the access filter (`filtered`), or not published by the source (`not-published`).",
					),
			})
			.describe(
				"The dataset: long CSV, `respondent,variable,row,value`, as `qretools responses` writes it.",
			),
		data: z
			.array(roleFile)
			.default([])
			.describe(
				"Other data files, such as the traces of a run or the source file of an ingest.",
			),
		materials: z
			.array(roleFile)
			.default([])
			.describe("Files that aren't data: a config, a column map."),
		metadata: z.array(metadataVariable).default([]),
		weight: z
			.string()
			.regex(NAME)
			.optional()
			.describe(
				"The weight in use, if the researcher has chosen one: the name of a metadata variable with `weighting`. qretools never chooses.",
			),
		access: z
			.strictObject({
				level: z
					.string()
					.min(1)
					.describe(
						"The access level the filter applied, as the workspace names it.",
					),
				policy: z
					.string()
					.min(1)
					.optional()
					.describe("A URN or URL of the policy that defines the levels."),
			})
			.optional(),
		prompts: z
			.array(
				z.strictObject({
					question: urn.describe(
						"The URN of the QuestionItem, with its version.",
					),
					text: z.string().min(1),
				}),
			)
			.default([])
			.describe(
				"Text for a model about one question, beyond the question's own words.",
			),
		planned: pairs.optional().describe("Settings as planned, before the run."),
		attributes: pairs
			.optional()
			.describe(
				"Facts of the run or the ingest: settings as accepted, counts of runs and respondents.",
			),
	})
	.describe("The facts of one run or one ingest, for `qretools provenance`.");

export type ProvenanceFacts = z.infer<typeof ProvenanceFactsSchema>;

/** What `provenance` reports, its own vocabulary. */
export type ProvenanceCode =
	| "provenance-facts"
	| "provenance-weight"
	| "provenance-unknown"
	| "provenance-digest"
	| "provenance-workspace";

/** The contract as JSON Schema, for a harness to write against: the input's shape (defaults optional). */
export const provenanceFactsJsonSchema = (): Record<string, unknown> =>
	z.toJSONSchema(ProvenanceFactsSchema, { io: "input" }) as Record<
		string,
		unknown
	>;

/** The facts read once from JSON, or what is wrong with them, at its path. */
export function parseFacts(
	json: unknown,
): Result<ProvenanceFacts, readonly Finding<ProvenanceCode>[]> {
	const r = ProvenanceFactsSchema.safeParse(json);
	return r.success
		? ok(r.data)
		: err(
				r.error.issues.map((i) => ({
					code: "provenance-facts",
					severity: "error",
					path: i.path.join("."),
					message: i.message,
				})),
			);
}
