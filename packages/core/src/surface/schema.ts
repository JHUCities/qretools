/**
 * The surface language: the flat YAML a question's author writes.
 *
 * This Zod schema is the shape at the boundary. Its JSON Schema drives the editor's
 * completion and descriptions, and a finished question must satisfy it. It stays flat
 * because YAML has no tags; the core `Draft` (see draft.ts) is the typed value the rest
 * of the program works with.
 */
import { z } from "zod";
import { NAME_RULE_TEXT } from "../copy.ts";
import {
	EMPTY_ENV,
	type Env,
	FIELD_OF,
	inScope,
	type NamedScheme,
} from "./env.ts";
import type { Scale } from "./scales.ts";

export const NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * A name made from words, for a shared file created from what a question wrote:
 * "Racial identification" → `racial_identification`. Always a valid name: `fallback`
 * when no letters or digits are left, and `fallback` in front when the words start
 * with a digit.
 */
export function nameFrom(words: string, fallback: string): string {
	const slug = words
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, 60)
		.replace(/_+$/, "");
	if (slug === "") return fallback;
	return /^[a-z]/.test(slug) ? slug : `${fallback}_${slug}`;
}

export const NumberDomainSchema = z
	.strictObject({
		min: z.number().optional().describe("The smallest answer allowed."),
		max: z.number().optional().describe("The largest answer allowed."),
		unit: z
			.string()
			.optional()
			.describe("The unit: the name of a shared unit, such as days."),
		decimals: z
			.int()
			.min(0)
			.optional()
			.describe("Decimal places allowed. Leave out, or 0, for whole numbers."),
	})
	.describe("A number answer, such as years, dollars, or a count.");

export const OpenDomainSchema = z
	.strictObject({
		max_length: z
			.int()
			.positive()
			.optional()
			.describe("The most characters allowed."),
	})
	.describe("A free-text answer.");

export const OptionSchema = z
	.strictObject({
		label: z.string().describe("The text respondents see for this option."),
		title: z
			.string()
			.optional()
			.describe(
				"For select all that apply: the codebook title of this option's variable, such as Services used -- Library.",
			),
		variable: z
			.string()
			.regex(NAME_PATTERN, NAME_RULE_TEXT)
			.optional()
			.describe(
				"For select all that apply: this option's variable name, if it isn't <name>_<code>.",
			),
		note: z
			.string()
			.optional()
			.describe("A note on this option. Respondents don't see it."),
	})
	.describe("An option with its own notes.");

/** What a fill holds: a number, or words. The one list; the parser reads it too. */
export const FILL_TYPES = ["number", "text"] as const;

export const QuestionSchema = z
	.strictObject({
		name: z
			.string()
			.regex(NAME_PATTERN, NAME_RULE_TEXT)
			.describe(
				"The variable name in the dataset and codebook, such as service_satisfaction.",
			),
		title: z
			.string()
			.optional()
			.describe(
				"A short title for the codebook, such as Overall satisfaction.",
			),
		text: z
			.string()
			.describe(
				"The question exactly as respondents read it. Everyone sees the same words.",
			),
		intent: z
			.string()
			.describe(
				"What you want to learn from this question, and why you ask it.",
			),
		concept: z
			.string()
			.optional()
			.describe(
				"What the question measures: the name of a shared concept, such as service_satisfaction.",
			),
		universe: z
			.string()
			.optional()
			.describe(
				"Who is asked this question, such as All respondents, or Owners only.",
			),
		// For descriptions and JSON Schema only: parse.ts reads responses from the YAML
		// AST (in the author's order and spelling), not through this record.
		responses: z
			.union([
				z.string().describe("The name of a shared scale, such as satisfied5."),
				z.record(z.string(), z.union([z.string(), OptionSchema])),
			])
			.optional()
			.describe(
				'The options, one code: label line each (such as "1": Very satisfied), or the name of a shared scale.',
			),
		select: z
			.enum(["one", "many"])
			.optional()
			.describe(
				"one: respondents pick one option (the default). many: select all that apply.",
			),
		number: NumberDomainSchema.optional().describe(
			"A number answer. Use instead of responses or open.",
		),
		open: OpenDomainSchema.optional().describe(
			"A free-text answer. Use instead of responses or number.",
		),
		instruction: z
			.string()
			.optional()
			.describe(
				"An instruction shown with the question, such as Select all that apply.",
			),
		source: z
			.string()
			.optional()
			.describe(
				"Where the question comes from, such as Original, or a published survey.",
			),
		note: z
			.string()
			.optional()
			.describe("Notes respondents don't see, such as its history."),
		fills: z
			.record(
				z.string().regex(NAME_PATTERN, NAME_RULE_TEXT),
				z.enum(FILL_TYPES),
			)
			.optional()
			.describe(
				"Gaps in the text that an instrument fills in when it asks the question, each with its type, such as rent: number. Write {{rent}} in the text.",
			),
		variant_of: z
			.record(z.string().regex(NAME_PATTERN, NAME_RULE_TEXT), z.string())
			.optional()
			.describe(
				"Questions this one is meant to be like, each with why they differ, such as dem_inclo: split ballot, lower range. Stops the findings that call them duplicates.",
			),
		legacy: z
			.record(z.string(), z.unknown())
			.optional()
			.describe(
				"Fields kept as they were from an older format. They aren't checked.",
			),
	})
	.describe(
		"A survey question and its documentation. It's answered one way: responses, number, or open.",
	);

export type Surface = z.infer<typeof QuestionSchema>;
export type SurfaceKey = keyof Surface;

export const KNOWN_KEYS = Object.keys(
	QuestionSchema.shape,
) as readonly SurfaceKey[];
export const REQUIRED_KEYS = ["name", "text", "intent"] as const;
export const DOMAIN_KEYS = ["responses", "number", "open"] as const;
/**
 * The fields a bank can also require of its questions (`required:` in `workspace.yaml`),
 * as a team's house rule: optional one-line fields only. How a question is answered is
 * always required, and `select`, `legacy` and `variant_of` are never worth demanding.
 */
export const REQUIRABLE_KEYS = [
	"title",
	"concept",
	"universe",
	"instruction",
	"source",
	"note",
] as const satisfies readonly Exclude<
	(typeof TEXT_KEYS)[number],
	(typeof REQUIRED_KEYS)[number]
>[];
export type RequirableKey = (typeof REQUIRABLE_KEYS)[number];
/** Fields whose value is one line of text (or a name); each is a hole when written empty. */
export const TEXT_KEYS = [
	"name",
	"title",
	"text",
	"intent",
	"concept",
	"universe",
	"instruction",
	"source",
	"note",
] as const;

/** One line of a scale, for completion info: `1 Strongly agree · 2 Agree`. */
export const scaleSummary = (scale: Scale): string =>
	scale.codes.map((c) => `${c.code} ${c.label}`).join(" · ");

/**
 * The names of one kind, offered as constants for completion, each with its words as
 * the description completion shows. On a field that takes words or a name, `oneOf` is
 * untrue (it says words aren't allowed), but nothing enforces it: the package's own
 * linter isn't used, and completion doesn't read `examples`, the honest keyword.
 */
const withNames = (
	node: Record<string, unknown>,
	names: readonly string[],
	describeName: (name: string) => string,
): Record<string, unknown> =>
	names.length === 0
		? node
		: {
				...node,
				oneOf: names.map((n) => ({ const: n, description: describeName(n) })),
			};

type JsonNode = Record<string, unknown> & {
	properties?: Record<string, Record<string, unknown>>;
};

/** The JSON Schema of a question, for completion and descriptions, with the bank's names as constants. */
export function questionJsonSchema(
	env: Env = EMPTY_ENV,
): Record<string, unknown> {
	const schema = z.toJSONSchema(QuestionSchema) as JsonNode;
	const props = schema.properties;
	if (!props) return schema;
	// The bank's own required fields, marked required like name and text, for completion and the inspector.
	if (env.required.length > 0)
		schema.required = [
			...new Set([
				...((schema.required as string[] | undefined) ?? []),
				...env.required,
			]),
		];
	const responses = props.responses;
	const branches = responses?.anyOf;
	if (responses && Array.isArray(branches)) {
		responses.anyOf = branches.map((b: Record<string, unknown>) =>
			b.type === "string"
				? withNames(b, Object.keys(env.scales), (n) =>
						scaleSummary(env.scales[n] as Scale),
					)
				: b,
		);
	}
	// Every other kind at its field (`FIELD_OF`): a unit's is inside `number:`.
	for (const [kind, path] of Object.entries(FIELD_OF) as [
		NamedScheme,
		string,
	][]) {
		if (kind === "scale") continue;
		const [first, ...rest] = path.split(".");
		let parent: Record<string, Record<string, unknown>> | undefined = props;
		let key = first ?? "";
		for (const part of rest) {
			parent = (parent?.[key] as JsonNode | undefined)?.properties;
			key = part;
		}
		const node = parent?.[key];
		if (parent === undefined || node === undefined) continue;
		const entries = inScope(env, kind) as Readonly<
			Record<string, { readonly text?: string; readonly label?: string }>
		>;
		parent[key] = withNames(node, Object.keys(entries), (n) => {
			const e = entries[n];
			return e?.label ?? e?.text ?? n;
		});
	}
	return schema;
}

/** The schema of a scale file or the missing values file: a `labels:` map. */
export const LabelsFileSchema = z.strictObject({
	labels: z
		.record(z.string(), z.string())
		.describe("The options, one code: label line each, in the order shown."),
});
export const labelsJsonSchema = (): Record<string, unknown> =>
	z.toJSONSchema(LabelsFileSchema) as Record<string, unknown>;

/** The schema of a concept or unit file: its label, and what it means. */
export const LabelledFileSchema = z.strictObject({
	label: z
		.string()
		.describe(
			"The words people use for it, such as Neighborhood satisfaction, or days.",
		),
	definition: z
		.string()
		.optional()
		.describe(
			"What it means, so every question that names it means the same thing.",
		),
});
export const labelledJsonSchema = (): Record<string, unknown> =>
	z.toJSONSchema(LabelledFileSchema) as Record<string, unknown>;

/** The schema of a universe or instruction file: one `text:` line. */
export const TextEntryFileSchema = z.strictObject({
	text: z
		.string()
		.describe("The words, as respondents or interviewers read them."),
});
export const textEntryJsonSchema = (): Record<string, unknown> =>
	z.toJSONSchema(TextEntryFileSchema) as Record<string, unknown>;

/** The schema of the workspace details, `workspace.yaml`. */
export const WorkspaceFileSchema = z.strictObject({
	agency: z
		.string()
		.describe(
			"The DDI agency for everything in this workspace: the registered code of the organization that runs it, such as `org.example`.",
		),
	required: z
		.array(z.enum(REQUIRABLE_KEYS))
		.optional()
		.describe(
			"Fields every question must have, as well as `name`, `text` and `intent`, such as `title`.",
		),
	required_in: z
		.record(z.string(), z.array(z.enum(REQUIRABLE_KEYS)))
		.optional()
		.describe(
			"Fields the questions in one folder must also have, such as `questions/health`. Adds to `required`.",
		),
	locked: z
		.record(z.string(), z.string())
		.optional()
		.describe(
			"Each tag this workspace's instruments use, with the commit it named when locked, such as `owner/repo@v1: <the commit's full sha>`. Saving or exporting an instrument fills this in. If a tag moves, you get a warning.",
		),
});
export const workspaceFileJsonSchema = (): Record<string, unknown> =>
	z.toJSONSchema(WorkspaceFileSchema) as Record<string, unknown>;

/** The schema of `select_all.yaml`: the two values a select-all-that-apply option is stored as. */
export const SelectAllFileSchema = z.strictObject({
	chosen: z
		.record(z.string(), z.string())
		.describe(
			'What\'s stored when a respondent picks the option, with its label, such as `"1": Yes`.',
		),
	not_chosen: z
		.record(z.string(), z.string())
		.describe(
			"What's stored when a respondent doesn't pick the option, with its label, such as `\"0\": No`.",
		),
});
export const selectAllFileJsonSchema = (): Record<string, unknown> =>
	z.toJSONSchema(SelectAllFileSchema) as Record<string, unknown>;

export const describe = (key: SurfaceKey): string =>
	QuestionSchema.shape[key].description ?? "";

/** The description of the field at a path: a part of `number` or `open`, else the top field. */
export function describePath(path: string, key: SurfaceKey): string {
	const sub = path.split(".")[1];
	const part =
		sub === undefined
			? undefined
			: key === "number"
				? (NumberDomainSchema.shape as Record<string, z.ZodType>)[sub]
				: key === "open"
					? (OpenDomainSchema.shape as Record<string, z.ZodType>)[sub]
					: undefined;
	return part?.description ?? describe(key);
}
