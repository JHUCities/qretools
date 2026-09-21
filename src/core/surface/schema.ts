/**
 * The surface language: the flat YAML document a question-maker writes.
 *
 * This Zod schema is the boundary shape. Its JSON Schema drives editor completion
 * and hover documentation, and it is what a finished question must satisfy. It stays
 * flat because YAML has no tags; the core `Draft` (see draft.ts) is the typed value
 * the rest of the program reasons about.
 */
import { z } from "zod";

export const NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

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

export const QuestionSchema = z
	.strictObject({
		name: z
			.string()
			.regex(
				NAME_PATTERN,
				"lowercase letters, digits and underscores, starting with a letter",
			)
			.describe(
				"Variable name used in the dataset and codebook. Lowercase, starts with a letter, e.g. nhd_sat.",
			),
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
				"The concept measured, e.g. neighborhood satisfaction. Becomes a DDI Concept.",
			),
		universe: z
			.string()
			.optional()
			.describe(
				"Who answers this question, e.g. All respondents, or Renters only.",
			),
		// Documentation and JSON Schema only: parse.ts reads responses from the YAML
		// AST (author order, original code spelling), not through this record.
		responses: z
			.record(z.string(), z.string())
			.optional()
			.describe(
				"Response options as code: label pairs, e.g. 1: Very satisfied. Options must be mutually exclusive and together exhaustive. Becomes a DDI CodeList.",
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
				"Where the question comes from, e.g. DCAS 2018 Q6, or Original.",
			),
	})
	.describe(
		"A survey question and its documentation. Exactly one response domain is required: responses, number, or open.",
	);

export type Surface = z.infer<typeof QuestionSchema>;
export type SurfaceKey = keyof Surface;

export const KNOWN_KEYS = Object.keys(
	QuestionSchema.shape,
) as readonly SurfaceKey[];
export const REQUIRED_KEYS = ["name", "text", "intent"] as const;
export const DOMAIN_KEYS = ["responses", "number", "open"] as const;

/** JSON Schema of the surface, for editor completion and hover. */
export const questionJsonSchema = () => z.toJSONSchema(QuestionSchema);

export const describe = (key: SurfaceKey): string =>
	QuestionSchema.shape[key].description ?? "";
