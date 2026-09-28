/**
 * Shared response scales: a scale used by many questions exists once, and a
 * question names it (`responses: agree4`). Scales are a bank-level value the
 * shell loads and the core is given; one file per scale, body `labels: {code: label}`.
 */
import { isMap, parseDocument } from "yaml";
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
	const node = isMap(doc.contents)
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

export interface ParsedScales {
	readonly scales: Scales;
	/** Findings of the scales that did not parse cleanly, by name. */
	readonly findings: readonly {
		readonly name: string;
		readonly findings: readonly Finding[];
	}[];
}

/** The bank's scale files, by name. A scale that yields findings is reported and, if unusable, absent. */
export function parseScales(
	files: readonly { readonly name: string; readonly text: string }[],
): ParsedScales {
	const scales: Record<string, Scale> = {};
	const findings: { name: string; findings: readonly Finding[] }[] = [];
	for (const f of files) {
		const parsed = parseScale(f.text);
		if (parsed.scale !== undefined) scales[f.name] = parsed.scale;
		if (parsed.findings.length > 0)
			findings.push({ name: f.name, findings: parsed.findings });
	}
	return { scales, findings };
}
