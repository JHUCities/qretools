/**
 * Shared response scales: a scale used by many questions exists once, and a
 * question names it (`responses: agree4`). Scales are a bank-level value the
 * shell loads and the core is given; one file per scale, body `labels: {code: label}`.
 */
import { parseDocument } from "yaml";
import type { Finding } from "../findings.js";
import { readCodeMap } from "./codes.js";
import type { Code } from "./draft.js";

export interface Scale {
	readonly codes: readonly Code[];
}

export type Scales = Readonly<Record<string, Scale>>;

export interface ParsedScale {
	readonly scale?: Scale;
	readonly findings: readonly Finding[];
}

export function parseScale(text: string): ParsedScale {
	const doc = parseDocument(text, { prettyErrors: false });
	const syntax: Finding[] = doc.errors.map((e) => ({
		code: "yaml-syntax",
		severity: "error",
		path: "",
		message: e.message,
	}));
	const node =
		doc.contents && typeof doc.contents === "object" && "get" in doc.contents
			? doc.contents.get("labels", true)
			: undefined;
	if (node === undefined) {
		return {
			findings: [
				...syntax,
				{
					code: "hole",
					severity: "hole",
					path: "labels",
					message: "A scale is a `labels:` map of `code: label` lines.",
				},
			],
		};
	}
	const read = readCodeMap(doc, node, "labels", false);
	return read.value === undefined
		? { findings: [...syntax, ...read.findings] }
		: { scale: { codes: read.value }, findings: [...syntax, ...read.findings] };
}

/** One line of a scale, for hover text and hints: `1 Strongly agree · 2 Agree`. */
export const scaleSummary = (scale: Scale): string =>
	scale.codes.map((c) => `${c.code} ${c.label}`).join(" · ");
