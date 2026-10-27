/**
 * Reads a `code: label` map from the YAML AST, for a question's responses and for
 * scale files. It reads the AST, not `toJS()`, so codes keep the author's order and
 * spelling (`010` stays `010`, and a quoted `'0'` is `0`).
 */
import type { Document } from "yaml";
import { isMap, isScalar, Scalar } from "yaml";
import { compact } from "../compact.ts";
import type { Finding } from "../findings.ts";
import type { Code } from "./draft.ts";
import {
	error,
	fail,
	hole,
	isPlainObject,
	issueSentence,
	ok,
	opened,
	type Read,
} from "./read.ts";
import { OptionSchema } from "./schema.ts";

export const EXAMPLE = 'Example:\n  "1": Yes\n  "2": No';

/**
 * Whether YAML reads a code as something other than text: a plain `1`, `010`, `-8`,
 * `true` or `~`. A code is text (DDI's `StringValue`, compared as text in conditions),
 * so it goes in quotes. Words (`DK`, `opt1`) already read as text.
 */
const unquoted = (key: Scalar): boolean =>
	key.type === Scalar.PLAIN && typeof key.value !== "string";

/** The advice on an unquoted code: underlines just the code, with a fix that quotes it. */
function unquotedCode(key: Scalar, code: string, at: string): Finding {
	const quoted = JSON.stringify(code);
	return compact({
		code: "unquoted-code",
		severity: "info",
		path: at,
		message: `Put the code \`${code}\` in quotes: \`${quoted}\`.`,
		hint: "Without quotes, `01` and `1` count as the same code.",
		// AST ranges are offsets into this text, so they fall inside it.
		range: key.range ? ([key.range[0], key.range[1]] as const) : undefined,
		fix: { kind: "quote", label: `Quote \`${code}\``, path: at, code },
	});
}

/** The code as the author spelled it (`010` stays `010`), not as YAML typed it (`10`). */
export const keyText = (key: Scalar): string => key.source ?? String(key.value);

/**
 * Each pair in the map becomes a Code. A label is text or, when `options` is
 * allowed, a small map with `label`, `title`, `variable` and `note`.
 * Findings sit under `path` (e.g. `responses.3`).
 */
export function readCodeMap(
	doc: Document,
	node: unknown,
	path: string,
	options: boolean,
): Read<readonly Code[]> {
	if (!isMap(node))
		return fail(
			error(
				"wrong-type",
				path,
				`\`${path}\` must be a list of \`code: label\` lines.`,
				EXAMPLE,
			),
		);
	const codes: Code[] = [];
	const findings: Finding[] = [];
	// The first key of each spelling: `"1"` and `1` are one code to us but two keys to YAML.
	const seen = new Map<string, Scalar>();
	for (const pair of node.items) {
		if (!isScalar(pair.key)) continue;
		const code = keyText(pair.key);
		const at = `${path}.${code}`;
		const first = seen.get(code);
		if (first === undefined) seen.set(code, pair.key);
		// YAML already reports two keys with one value; we report only those it sees as different.
		else if (first.value !== pair.key.value)
			findings.push(
				compact({
					...error(
						"duplicate-code",
						at,
						`The code \`${code}\` is written twice.`,
						"Give each option its own code.",
					),
					// Underline the second key; the path covers both.
					range: pair.key.range
						? ([pair.key.range[0], pair.key.range[1]] as const)
						: undefined,
				}),
			);
		if (unquoted(pair.key)) findings.push(unquotedCode(pair.key, code, at));
		if (isScalar(pair.value)) {
			const label = pair.value.value;
			if (label === null || label === undefined || label === "") {
				findings.push(
					hole(
						at,
						`Option \`${code}\` has no label.`,
						"Write the text respondents see after the colon.",
					),
				);
			} else if (typeof label !== "string") {
				findings.push(
					error(
						"wrong-type",
						at,
						`Option \`${code}\`'s label must be text.`,
						`Put it in quotes: \`${JSON.stringify(code)}: "${String(label)}"\`.`,
					),
				);
			} else {
				codes.push({ code, label });
			}
		} else if (options && isMap(pair.value)) {
			const raw: unknown = pair.value.toJS(doc);
			const obj = isPlainObject(raw) ? raw : {};
			const label = obj.label;
			if (label === undefined || label === null || label === "") {
				// Written empty, the hole is the `label` line; left out, it's the option.
				findings.push(
					hole(
						label === undefined ? at : `${at}.label`,
						`Option \`${code}\` has no label.`,
						`Add \`label:\` under option \`${code}\`, with the text respondents see.`,
					),
				);
				continue;
			}
			// The label is there, so any other key written empty is its own hole.
			const { rest, holes } = opened(obj, at);
			const result = OptionSchema.safeParse(rest);
			if (!result.success) {
				for (const issue of result.error.issues) {
					if (issue.code === "unrecognized_keys") {
						for (const k of issue.keys)
							findings.push(
								error(
									"unknown-key",
									`${at}.${k}`,
									`Option \`${code}\`: \`${k}\` isn't an option field.`,
									"An option has `label`, `title`, `variable` and `note`.",
								),
							);
						continue;
					}
					const sub = issue.path.map(String).join(".");
					const said = issueSentence(sub || "label", issue);
					findings.push(
						compact({
							...error(
								"wrong-type",
								sub ? `${at}.${sub}` : at,
								`Option \`${code}\`: ${said.message}`,
								said.hint,
							),
							detail: said.detail,
						}),
					);
				}
				findings.push(...holes);
				continue;
			}
			findings.push(...holes);
			codes.push({ code, ...compact(result.data) });
		} else if (pair.value === null || pair.value === undefined) {
			findings.push(
				hole(
					at,
					`Option \`${code}\` has no label.`,
					"Write the text respondents see after the colon.",
				),
			);
		} else {
			findings.push(
				error(
					"wrong-type",
					at,
					`Option \`${code}\`'s label must be text.`,
					`Write the label on the same line: \`${JSON.stringify(code)}: Yes\`.`,
				),
			);
		}
	}
	return ok(codes, ...findings);
}
