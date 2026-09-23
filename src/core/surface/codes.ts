/**
 * Reading a `code: label` map from the YAML AST, shared by question responses
 * and scale files. The AST, not `toJS()`, so codes keep the author's order and
 * spelling (`010` stays `010`).
 */
import type { Document, Scalar } from "yaml";
import { isMap, isScalar } from "yaml";
import { compact } from "../compact.js";
import type { Finding } from "../findings.js";
import type { Code } from "./draft.js";
import { OptionSchema } from "./schema.js";

export interface Read<T> {
	readonly value?: T;
	readonly findings: readonly Finding[];
}

export const ok = <T>(value: T, ...findings: Finding[]): Read<T> => ({
	value,
	findings,
});
export const fail = <T>(...findings: Finding[]): Read<T> => ({ findings });

export const hole = (path: string, message: string, hint?: string): Finding =>
	compact({ code: "hole", severity: "hole", path, message, hint });

export const wrongType = (
	path: string,
	message: string,
	hint?: string,
): Finding =>
	compact({ code: "wrong-type", severity: "error", path, message, hint });

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
			wrongType(
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
					wrongType(
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
			const label =
				typeof raw === "object" && raw !== null
					? (raw as { label?: unknown }).label
					: undefined;
			if (label === undefined || label === null || label === "") {
				findings.push(
					hole(
						at,
						`Option \`${code}\` has no label.`,
						"Add `label: ...` under it.",
					),
				);
				continue;
			}
			const result = OptionSchema.safeParse(raw);
			if (!result.success) {
				for (const issue of result.error.issues) {
					const sub =
						issue.code === "unrecognized_keys"
							? issue.keys.join(", ")
							: issue.path.map(String).join(".");
					findings.push(
						wrongType(
							sub ? `${at}.${sub}` : at,
							`Option \`${code}\`: ${issue.message}`,
						),
					);
				}
				continue;
			}
			codes.push({ code, ...compact(result.data) });
		} else if (pair.value === null || pair.value === undefined) {
			findings.push(hole(at, `Response \`${code}\` has no label.`));
		} else {
			findings.push(wrongType(at, `Label for \`${code}\` must be text.`));
		}
	}
	return ok(codes, ...findings);
}

export const EXAMPLE = "Example:\n  1: Yes\n  2: No";
