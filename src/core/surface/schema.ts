/**
 * The surface language: the flat YAML document a question-maker writes.
 *
 * This Zod schema is the boundary shape. Its JSON Schema drives editor completion
 * and hover documentation, and it is what a finished question must satisfy. It stays
 * flat because YAML has no tags; the core `Draft` (see draft.ts) is the typed value
 * the rest of the program reasons about.
 */
import { z } from "zod";
import { NAME_RULE_TEXT } from "../copy.js";
import { EMPTY_ENV, type Env } from "./env.js";
import type { Scale } from "./scales.js";

export const NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * A name made from words, for a shared entry created from what a question wrote:
 * "Racial identification" → `racial_identification`. Always a valid name: `fallback`
 * when no letters or digits are left, and prefixed by it when the words start with one.
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
		min: z.number().optional().describe("Smallest acceptable value."),
		max: z.number().optional().describe("Largest acceptable value."),
		unit: z
			.string()
			.optional()
			.describe(
				"Unit of measure shown to the respondent, e.g. years, dollars.",
			),
		decimals: z
			.int()
			.min(0)
			.optional()
			.describe("Decimal places allowed. Omit or 0 for whole numbers."),
	})
	.describe("A numeric answer, such as years, dollars, or a count.");

export const OpenDomainSchema = z
	.strictObject({
		max_length: z
			.int()
			.positive()
			.optional()
			.describe("Maximum number of characters accepted."),
	})
	.describe("A free-text answer.");

export const OptionSchema = z
	.strictObject({
		label: z.string().describe("Text shown to the respondent for this option."),
		title: z
			.string()
			.optional()
			.describe(
				"For select all that apply: the codebook title of this option's own variable, e.g. Services used -- Library.",
			),
		variable: z
			.string()
			.regex(NAME_PATTERN, NAME_RULE_TEXT)
			.optional()
			.describe(
				"For select all that apply: this option's variable name when it isn't <name>_<code>.",
			),
		note: z
			.string()
			.optional()
			.describe("Documentation for this option, not shown to the respondent."),
	})
	.describe("A response option with its own documentation.");

export const QuestionSchema = z
	.strictObject({
		name: z
			.string()
			.regex(NAME_PATTERN, NAME_RULE_TEXT)
			.describe(
				"Variable name used in the dataset and codebook. Lowercase, starts with a letter, e.g. service_satisfaction.",
			),
		title: z
			.string()
			.optional()
			.describe("Short codebook title, e.g. Overall satisfaction."),
		text: z
			.string()
			.describe(
				"The question exactly as the respondent will read it. Same stimulus for everyone.",
			),
		intent: z
			.string()
			.describe(
				"What you want to learn from this question: the construct it measures and whether it serves a hypothesis or estimates prevalence. Becomes the DDI QuestionIntent.",
			),
		concept: z
			.string()
			.optional()
			.describe(
				"The concept measured, e.g. satisfaction with services. Becomes a DDI Concept.",
			),
		universe: z
			.string()
			.optional()
			.describe(
				"Who answers this question, e.g. All respondents, or Owners only.",
			),
		// Documentation and JSON Schema only: parse.ts reads responses from the YAML
		// AST (author order, original code spelling), not through this record.
		responses: z
			.union([
				z.string().describe("The name of a shared scale, e.g. satisfied5."),
				z.record(z.string(), z.union([z.string(), OptionSchema])),
			])
			.optional()
			.describe(
				"Response options as code: label pairs (e.g. 1: Very satisfied), or the name of a shared scale. Options must be mutually exclusive and together exhaustive. Becomes a DDI CodeList.",
			),
		select: z
			.enum(["one", "many"])
			.optional()
			.describe(
				"Whether the respondent picks one response or may select all that apply. Default one.",
			),
		number: NumberDomainSchema.optional().describe(
			"Numeric answer. Use instead of responses/open.",
		),
		open: OpenDomainSchema.optional().describe(
			"Free-text answer. Use instead of responses/number.",
		),
		instruction: z
			.string()
			.optional()
			.describe(
				"Instruction shown with the question, e.g. Select all that apply.",
			),
		source: z
			.string()
			.optional()
			.describe(
				"Where the question comes from, e.g. Original, or a published survey question.",
			),
		note: z
			.string()
			.optional()
			.describe(
				"Documentation not shown to the respondent: fills, randomization, history.",
			),
		variant_of: z
			.record(z.string().regex(NAME_PATTERN, NAME_RULE_TEXT), z.string())
			.optional()
			.describe(
				"Questions this one deliberately resembles, each with why they differ, e.g. dem_inclo: split ballot, lower range. Silences the duplicate finding for that pair.",
			),
		legacy: z
			.record(z.string(), z.unknown())
			.optional()
			.describe(
				"Fields carried over from an older format, kept verbatim and not checked.",
			),
	})
	.describe(
		"A survey question and its documentation. It is answered exactly one way: responses, number, or open.",
	);

export type Surface = z.infer<typeof QuestionSchema>;
export type SurfaceKey = keyof Surface;

export const KNOWN_KEYS = Object.keys(
	QuestionSchema.shape,
) as readonly SurfaceKey[];
export const REQUIRED_KEYS = ["name", "text", "intent"] as const;
export const DOMAIN_KEYS = ["responses", "number", "open"] as const;
/** Fields whose value is one line of text (or a name); written empty, each is a hole. */
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
 * Names in a scheme, offered as constants for completion, each carrying its
 * definition as the description the completion popup shows. On a prose-or-name
 * field the `oneOf` is a semantic lie (it says prose is invalid); nothing enforces
 * it, because the package's own linter is not used, and `examples`, the honest
 * keyword, is not completed from.
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

/** JSON Schema of the surface, for editor completion and hover, with the bank's names as constants. */
export function questionJsonSchema(
	env: Env = EMPTY_ENV,
): Record<string, unknown> {
	const schema = z.toJSONSchema(QuestionSchema) as JsonNode;
	const props = schema.properties;
	if (!props) return schema;
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
	if (props.concept)
		props.concept = withNames(
			props.concept,
			Object.keys(env.concepts),
			(n) => env.concepts[n]?.label ?? n,
		);
	if (props.universe)
		props.universe = withNames(
			props.universe,
			Object.keys(env.universes),
			(n) => env.universes[n]?.text ?? n,
		);
	if (props.instruction)
		props.instruction = withNames(
			props.instruction,
			Object.keys(env.instructions),
			(n) => env.instructions[n]?.text ?? n,
		);
	return schema;
}

/** The schema of a scale file or the missing-values file: a `labels:` map. */
export const LabelsFileSchema = z.strictObject({
	labels: z
		.record(z.string(), z.string())
		.describe(
			"Response options as code: label pairs, in the order they are shown.",
		),
});
export const labelsJsonSchema = (): Record<string, unknown> =>
	z.toJSONSchema(LabelsFileSchema) as Record<string, unknown>;

/** The schema of a concept file: its label, and what it means. */
export const ConceptFileSchema = z.strictObject({
	label: z
		.string()
		.describe("The concept as people say it, e.g. Neighborhood satisfaction."),
	definition: z
		.string()
		.optional()
		.describe(
			"What the concept means, so every question naming it measures the same thing.",
		),
});
export const conceptJsonSchema = (): Record<string, unknown> =>
	z.toJSONSchema(ConceptFileSchema) as Record<string, unknown>;

/** The schema of a universe or instruction file: one `text:` line. */
export const TextEntryFileSchema = z.strictObject({
	text: z
		.string()
		.describe("The wording, as respondents or interviewers read it."),
});
export const textEntryJsonSchema = (): Record<string, unknown> =>
	z.toJSONSchema(TextEntryFileSchema) as Record<string, unknown>;

export const describe = (key: SurfaceKey): string =>
	QuestionSchema.shape[key].description ?? "";
