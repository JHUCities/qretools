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
import { fixLabel, SCHEME_LABELS, SCHEME_NAME } from "./copy.ts";
import type { Finding, Fix, LintCode } from "./findings.ts";
import { fold, labelsKey, unitKey } from "./fold.ts";
import {
	type Code,
	type Draft,
	type Named,
	optionVariable,
} from "./surface/draft.ts";
import {
	type Env,
	FIELD_OF,
	inScope,
	type LabelledEntry,
} from "./surface/env.ts";
import { withoutFills } from "./surface/fills.ts";
import { nameFrom } from "./surface/schema.ts";

type Rule = (draft: Draft, env: Env) => readonly Finding[];

const advise = (
	code: LintCode,
	severity: "warning" | "info",
	path: string,
	message: string,
	hint: string,
	fix?: Fix,
): Finding => ({
	code,
	severity,
	path,
	message,
	hint,
	...(fix !== undefined && { fix }),
});

/** Name a shared entry in place of what is written at `path`. */
const nameFix = (path: string, name: string): Fix => ({
	kind: "edit",
	label: fixLabel(name),
	edits: [{ path, value: name }],
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
	const plain = withoutFills(text);
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

/** An inline list that duplicates a shared scale: the extract-to-shared refactoring, offered, not forced. */
const matchesScale: Rule = ({ domain }, env) => {
	if (
		domain?.kind !== "responses" ||
		domain.scale !== undefined ||
		domain.codes.length === 0
	)
		return [];
	// The same definition of "the same list" as the bank index: labels folded, codes aside.
	const key = labelsKey(domain.codes);
	const matching = Object.entries(env.scales).filter(
		([, s]) => labelsKey(s.codes) === key,
	);
	const matches = matching.map(([n]) => n);
	if (matches.length === 0) return [];
	const codes = (cs: readonly Code[]) => cs.map((c) => c.code).join(" ");
	const apart = matching.every(
		([, s]) => codes(s.codes) === codes(domain.codes),
	)
		? ""
		: " (apart from codes)";
	const which =
		matches.length === 1
			? `the shared scale \`${matches[0]}\``
			: `the shared scales ${matches.map((m) => `\`${m}\``).join(", ")}`;
	// Offered only when naming the scale loses nothing: one match, the same codes (or
	// the stored values would change), and no option carrying its own documentation or
	// variable name, which the scale cannot hold.
	const only = matches.length === 1 ? matches[0] : undefined;
	const plain = domain.codes.every(
		(c) =>
			c.title === undefined && c.variable === undefined && c.note === undefined,
	);
	return [
		advise(
			"matches-scale",
			"warning",
			"responses",
			`These responses match ${which}${apart}.`,
			`Write \`responses: ${matches[0]}\` to share it, so a change to the scale reaches every question that uses it.`,
			only !== undefined && apart === "" && plain
				? nameFix("responses", only)
				: undefined,
		),
	];
};

/**
 * A universe or instruction written out that a shared one already says: a duplicate
 * of a shared entry, so "use the name". Compared folded (case and punctuation ignored).
 */
const matchesShared =
	(key: "universe" | "instruction"): Rule =>
	(draft, env) => {
		const value = draft[key];
		if (value?.kind !== "text") return [];
		const entries = key === "universe" ? env.universes : env.instructions;
		const folded = fold(value.text);
		const matches = Object.entries(entries)
			.filter(([, e]) => fold(e.text) === folded)
			.map(([n]) => n);
		if (matches.length === 0) return [];
		return [
			advise(
				key === "universe" ? "matches-universe" : "matches-instruction",
				"warning",
				key,
				`This is the shared ${key} ${matches.map((m) => `\`${m}\``).join(", ")}.`,
				`Write \`${key}: ${matches[0]}\` to share it, so a change reaches every question that uses it.`,
				matches.length === 1 && matches[0] !== undefined
					? nameFix(key, matches[0])
					: undefined,
			),
		];
	};

/**
 * A concept or a unit is shared by nature (DDI: a Concept in a ConceptScheme; a
 * MeasurementUnit is a term from a vocabulary): one written in words is advice. When a
 * shared one already has that label, name it; else make it one, the dialog prefilled
 * with a name made from the words and the words as its label.
 */
const writtenOut =
	(
		scheme: "concept" | "unit",
		read: (draft: Draft) => Named<LabelledEntry> | undefined,
		same: (s: string) => string,
	): Rule =>
	(draft, env) => {
		const value = read(draft);
		if (value?.kind !== "text") return [];
		const path = FIELD_OF[scheme];
		const wanted = same(value.text);
		const matches = Object.entries(inScope(env, scheme))
			.filter(([, e]) => same(e.label) === wanted)
			.map(([n]) => n);
		const what = SCHEME_NAME[scheme];
		if (matches.length > 0)
			return [
				advise(
					scheme === "concept" ? "matches-concept" : "matches-unit",
					"warning",
					path,
					`This is the ${what} ${matches.map((m) => `\`${m}\``).join(", ")}.`,
					`Write \`${path.split(".").at(-1)}: ${matches[0]}\`, so questions using it are found together.`,
					matches.length === 1 && matches[0] !== undefined
						? nameFix(path, matches[0])
						: undefined,
				),
			];
		const name = nameFrom(value.text, scheme);
		return [
			advise(
				scheme === "concept" ? "concept-prose" : "unit-prose",
				"warning",
				path,
				`${SCHEME_LABELS[scheme]} are shared: this one is written only here.`,
				`Make it a ${what}, so every question using it names the same one.`,
				{
					kind: "create",
					label: `Make it a ${what} \`${name}\``,
					create: { scheme, name, text: value.text.trim(), path },
				},
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
	matchesShared("universe"),
	matchesShared("instruction"),
	writtenOut("concept", (d) => d.concept, fold),
	writtenOut(
		"unit",
		(d) => (d.domain?.kind === "number" ? d.domain.unit : undefined),
		unitKey,
	),
	missingCode,
];

export const lint = (draft: Draft, env: Env): readonly Finding[] =>
	RULES.flatMap((rule) => rule(draft, env));
