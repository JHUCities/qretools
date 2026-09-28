/**
 * The cursor inspector, after Hazel's: what is at the caret, in the document's own
 * terms. A field says what it is for and what is wrong there; a reference field also
 * lists the names in scope; a name written there says what it names, or that nothing
 * by that name exists. Pure: the shell adds what needs the bank (who uses a name,
 * which file to open) around it.
 */
import type { Evaluation } from "./evaluate.js";
import { type Finding, locate, pathAt } from "./findings.js";
import type { Env, NamedScheme, TextEntry } from "./surface/env.js";
import type { Scale } from "./surface/scales.js";
import {
	describe,
	KNOWN_KEYS,
	QuestionSchema,
	type SurfaceKey,
} from "./surface/schema.js";

export interface Inspection {
	/** The most specific path at the caret, e.g. `responses.2`. */
	readonly path: string;
	/** Its field, e.g. `responses`; absent at the document level (a blank line, the end). */
	readonly key?: SurfaceKey;
	readonly description: string;
	/** Findings underlined at the caret: the ones the editor marks there. */
	readonly findings: readonly Finding[];
	/** For a field that may name a shared element: every name in scope. */
	readonly names?: readonly string[];
	/** The name written at the caret; `value` absent means nothing has that name. */
	readonly mention?: {
		readonly scheme: NamedScheme;
		readonly name: string;
		readonly value?: Scale | TextEntry;
	};
}

const SCHEME_OF: Partial<Record<SurfaceKey, NamedScheme>> = {
	responses: "scale",
	universe: "universe",
	instruction: "instruction",
};

const inScope = (
	env: Env,
	scheme: NamedScheme,
): Readonly<Record<string, Scale | TextEntry>> =>
	scheme === "scale"
		? env.scales
		: scheme === "universe"
			? env.universes
			: env.instructions;

/**
 * What is at `offset` in the evaluated text; undefined only inside a key the surface
 * does not know. Between fields and at the end is the document itself, where the holes
 * of absent required fields are placed: where the author will type them. Clamped.
 */
export function inspect(
	ev: Evaluation,
	env: Env,
	offset: number,
): Inspection | undefined {
	const [, end] = ev.ranges[""] ?? [0, 0];
	const at = Math.min(Math.max(0, offset), end);
	const path = pathAt(ev.ranges, at);
	const top = path.split(".")[0] ?? "";
	// The findings the editor underlines at the caret. An absent field's hole is placed
	// at the end of the text, so it shows exactly where the author will type the field.
	const findings = ev.findings.filter((f) => {
		const [from, to] = locate(f, ev.ranges);
		return from <= at && at <= to;
	});
	if (path === "")
		return {
			path,
			description: QuestionSchema.description ?? "",
			findings,
		};
	if (!(KNOWN_KEYS as readonly string[]).includes(top)) return undefined;
	const key = top as SurfaceKey;
	const scheme = SCHEME_OF[key];
	const written = ev.symbols.mentions.find((m) => m.path === path);
	const value =
		written === undefined
			? undefined
			: inScope(env, written.scheme)[written.name];
	return {
		path,
		key,
		description: describe(key),
		findings,
		...(scheme !== undefined && {
			names: Object.keys(inScope(env, scheme)).sort(),
		}),
		...(written !== undefined && {
			mention: {
				scheme: written.scheme,
				name: written.name,
				...(value !== undefined && { value }),
			},
		}),
	};
}
