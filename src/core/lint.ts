/**
 * Lints encode survey craft as severity-graded advice: say what you want to
 * learn; give everyone the same stimulus; make options mutually exclusive and
 * exhaustive. They never block. Each rule is a small named function from a
 * Draft to findings; `lint` is their concatenation.
 *
 * Deliberately absent: duplicate codes (the YAML parse already reports them),
 * "single-select needs a residual option" (bipolar scales are exhaustive
 * without one), "text must end in ?" (stems like "Please indicate..." are fine).
 */
import type { Finding, LintCode } from "./findings.js";
import { type Code, type Draft, optionVariable } from "./surface/draft.js";
import type { Env } from "./surface/env.js";

type Rule = (draft: Draft, env: Env) => readonly Finding[];

const advise = (
	code: LintCode,
	severity: "warning" | "info",
	path: string,
	message: string,
	hint: string,
): Finding => ({
	code,
	severity,
	path,
	message,
	hint,
});

const normalise = (s: string): string =>
	s.trim().toLowerCase().replace(/\s+/g, " ");

const duplicateLabels: Rule = ({ domain }) => {
	if (domain?.kind !== "responses") return [];
	const where =
		domain.scale === undefined
			? "Responses"
			: `Scale \`${domain.scale}\`: responses`;
	const seen = new Map<string, string>();
	return domain.codes.flatMap(({ code, label }) => {
		const key = normalise(label);
		const first = seen.get(key);
		if (first === undefined) {
			seen.set(key, code);
			return [];
		}
		return [
			advise(
				"duplicate-label",
				"warning",
				`responses.${code}`,
				`${where} \`${first}\` and \`${code}\` have the same label.`,
				"Options must be mutually exclusive: a respondent should fit exactly one.",
			),
		];
	});
};

const tooFewResponses: Rule = ({ domain }) =>
	domain?.kind === "responses" && domain.codes.length < 2
		? [
				advise(
					"too-few-responses",
					"warning",
					"responses",
					domain.scale === undefined
						? "A choice needs at least two labeled responses."
						: `Scale \`${domain.scale}\` has fewer than two responses.`,
					"Options must together be exhaustive: every respondent should find one that fits.",
				),
			]
		: [];

const NONE_OPTION =
	/\b(none|nothing|neither|no one)\b|not applicable|\bn\/a\b|does(n't| not) apply/i;

const noNoneOption: Rule = ({ domain }) =>
	domain?.kind === "responses" &&
	domain.select === "many" &&
	domain.codes.length > 0 &&
	!domain.codes.some((c) => NONE_OPTION.test(c.label))
		? [
				advise(
					"no-none-option",
					"warning",
					"select",
					"This select all that apply question has no “None of these” option.",
					"Without one, a respondent to whom nothing applies can't be told apart from one who skipped the question.",
				),
			]
		: [];

/**
 * Tuned on the 161 question texts of the BAS 2025 codebook, where a bare "and"
 * test fired on 8%, almost all false: "and" in a preamble sentence, in a list of
 * examples ("such as gas, electricity, and water"), or in "you and your family".
 * So: look only at the sentence that asks, and skip those two patterns. It still
 * asks rather than asserts. `{{FILL}}` placeholders are not words the respondent reads.
 */
const asksTwoThings = (text: string): boolean => {
	const plain = text.replace(/\{\{[^}]*\}\}/g, "");
	const asking =
		plain.match(/[^.?!]*\?/g)?.find((s) => s.trim() !== "") ?? plain;
	const withoutSafeAnds = asking
		.replace(/\b(such as|like|including)\b[^?]*/i, "")
		.replace(/\byou(rself)? and your\b/gi, "you");
	return /\sand(\/or)?\s/i.test(withoutSafeAnds);
};

const doubleBarreled: Rule = ({ text }) =>
	text !== undefined && asksTwoThings(text)
		? [
				advise(
					"double-barreled",
					"info",
					"text",
					"Does this ask about two things at once?",
					"If a respondent could answer differently for each half of the “and”, split it into two questions.",
				),
			]
		: [];

const thinIntent: Rule = ({ intent, text }) => {
	if (intent === undefined) return [];
	const restatesText =
		text !== undefined && normalise(intent) === normalise(text);
	return restatesText || intent.trim().split(/\s+/).length < 4
		? [
				advise(
					"thin-intent",
					"info",
					"intent",
					restatesText
						? "The intent repeats the question text."
						: "The intent is very short.",
					"Say what you want to learn: the construct measured, and the hypothesis it serves or the prevalence it estimates.",
				),
			]
		: [];
};

const legacyFields: Rule = ({ legacy }) =>
	legacy === undefined || legacy.length === 0
		? []
		: [
				advise(
					"legacy-fields",
					"info",
					"legacy",
					`Legacy fields kept verbatim: ${legacy.join(", ")}.`,
					"They aren't checked and aren't exported to DDI. Move each into a real field when its meaning is settled.",
				),
			];

/** Select-many options each become a variable; two options must not become the same one. */
const optionVariables: Rule = ({ name, domain }) => {
	if (domain?.kind !== "responses" || domain.select !== "many") return [];
	const seen = new Map<string, string>();
	return domain.codes.flatMap((c) => {
		const variable = optionVariable(name, c);
		if (variable === undefined) return [];
		const out: Finding[] = [];
		const first = seen.get(variable);
		if (first === undefined) seen.set(variable, c.code);
		else
			out.push(
				advise(
					"duplicate-option-variable",
					"warning",
					`responses.${c.code}`,
					`Options \`${first}\` and \`${c.code}\` both become the variable \`${variable}\`.`,
					"In select all that apply, each option is its own variable; give one of them a different `variable`.",
				),
			);
		if (
			name !== undefined &&
			c.variable !== undefined &&
			!c.variable.startsWith(name)
		)
			out.push(
				advise(
					"option-variable-prefix",
					"info",
					`responses.${c.code}`,
					`Variable \`${c.variable}\` doesn't start with \`${name}\`.`,
					"A codebook groups an option's variable with its question by name prefix.",
				),
			);
		return out;
	});
};

const pairs = (codes: readonly { code: string; label: string }[]): string =>
	JSON.stringify(codes.map((c) => [c.code, normalise(c.label)]));

/** An inline list that duplicates a shared scale: the extract-to-shared refactoring, offered, not forced. */
const matchesScale: Rule = ({ domain }, env) => {
	if (
		domain?.kind !== "responses" ||
		domain.scale !== undefined ||
		domain.codes.length === 0
	)
		return [];
	const key = pairs(domain.codes);
	const matches = Object.entries(env.scales)
		.filter(([, s]) => pairs(s.codes) === key)
		.map(([n]) => n);
	if (matches.length === 0) return [];
	const which =
		matches.length === 1
			? `the shared scale \`${matches[0]}\``
			: `the shared scales ${matches.map((m) => `\`${m}\``).join(", ")}`;
	return [
		advise(
			"matches-scale",
			"info",
			"responses",
			`These responses match ${which}.`,
			`Write \`responses: ${matches[0]}\` to share it, so a change to the scale reaches every question that uses it.`,
		),
	];
};

/** A response code that the bank reserves for missing data would be unreadable in the dataset. */
const missingCode: Rule = ({ domain }, env) =>
	domain?.kind !== "responses" || domain.scale !== undefined
		? []
		: missingCollisions(domain.codes, env.missing, "responses");

/**
 * Codes in a list that the bank reserves for missing data. Run on a question's inline
 * options and on a scale file, never on a question naming a scale: fifty questions
 * would repeat one scale's problem.
 */
export const missingCollisions = (
	codes: readonly Code[],
	missing: readonly Code[],
	at: string,
): readonly Finding[] => {
	const reserved = new Set(missing.map((c) => c.code));
	return codes
		.filter((c) => reserved.has(c.code))
		.map((c) =>
			advise(
				"missing-code",
				"warning",
				`${at}.${c.code}`,
				`Code \`${c.code}\` is the bank's missing-value code.`,
				"Pick another code; the dataset uses this one for missing data.",
			),
		);
};

const RULES: readonly Rule[] = [
	duplicateLabels,
	tooFewResponses,
	noNoneOption,
	doubleBarreled,
	thinIntent,
	legacyFields,
	optionVariables,
	matchesScale,
	missingCode,
];

export const lint = (draft: Draft, env: Env): readonly Finding[] =>
	RULES.flatMap((rule) => rule(draft, env));
