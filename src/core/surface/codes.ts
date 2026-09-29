/**
 * Reading a `code: label` map from the YAML AST, shared by question responses
 * and scale files. The AST, not `toJS()`, so codes keep the author's order and
 * spelling (`010` stays `010`, and a quoted `'0'` is `0`).
 */
import type { Document, Scalar } from "yaml";
import { isMap, isScalar } from "yaml";
import { compact } from "../compact.js";
import type { Finding } from "../findings.js";
import type { Code } from "./draft.js";
import {
	error,
	fail,
	hole,
	isPlainObject,
	issueSentence,
	ok,
	opened,
	type Read,
} from "./read.js";
import { OptionSchema } from "./schema.js";

export const EXAMPLE = "Example:\n  1: Yes\n  2: No";

/** The code as the author spelled it (`010` stays `010`), not as YAML typed it (`10`). */
export const keyText = (key: Scalar): string => key.source ?? String(key.value);

/**
 * Every pair of a map node becomes a Code. A label may be plain text or, when
 * `options` is allowed, a small map with `label`, `title`, `variable`, `note`.
 * Findings are addressed under `path` (e.g. `responses.3`).
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
	for (const pair of node.items) {
		if (!isScalar(pair.key)) continue;
		const code = keyText(pair.key);
		const at = `${path}.${code}`;
		if (isScalar(pair.value)) {
			const label = pair.value.value;
			if (label === null || label === undefined || label === "") {
				findings.push(hole(at, `Response \`${code}\` has no label.`));
			} else if (typeof label !== "string") {
				findings.push(
					error(
						"wrong-type",
						at,
						`Label for \`${code}\` must be text.`,
						`Quote it: ${code}: "${String(label)}"`,
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
				// Written empty, the hole is the `label` line itself; absent, it is the option.
				findings.push(
					hole(
						label === undefined ? at : `${at}.label`,
						`Option \`${code}\` has no label.`,
						"Add `label: ...` under it.",
					),
				);
				continue;
			}
			// The label is present, so any other key written empty is its own hole.
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
			findings.push(hole(at, `Response \`${code}\` has no label.`));
		} else {
			findings.push(
				error("wrong-type", at, `Label for \`${code}\` must be text.`),
			);
		}
	}
	return ok(codes, ...findings);
}
