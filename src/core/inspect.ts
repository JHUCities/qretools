/**
 * The cursor inspector, after Hazel's: what is at the caret, in the document's own
 * terms. A field says what it is for; a reference field also lists the names in scope; a name written there says what it names, or that nothing
 * by that name exists. What is wrong is the Findings panel's and the editor's to say, not
 * this. Pure: the shell adds what needs the bank (who uses a name,
 * which file to open) around it.
 */
import type { Evaluation } from "./evaluate.js";
import { pathAt } from "./findings.js";
import {
	type ConceptEntry,
	type Env,
	inScope,
	type NamedScheme,
	type TextEntry,
} from "./surface/env.js";
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
	/** For a field that may name a shared element: every name in scope. */
	readonly names?: readonly string[];
	/** The name written at the caret; `value` absent means nothing has that name. */
	readonly mention?: {
		readonly scheme: NamedScheme;
		readonly name: string;
		readonly value?: Scale | TextEntry | ConceptEntry;
	};
}

const SCHEME_OF: Partial<Record<SurfaceKey, NamedScheme>> = {
	concept: "concept",
	responses: "scale",
	universe: "universe",
	instruction: "instruction",
};

/**
 * What is at `offset` in the evaluated text; undefined only inside a key the surface
 * does not know. Between top-level fields and at the end is the document itself (the
 * question's description); on an indented line under a block map (a new code under
 * `responses`), it is that map.
 * Clamped.
 * `source` is the text `ev` was evaluated from.
 */
export function inspect(
	ev: Evaluation,
	env: Env,
	source: string,
	offset: number,
): Inspection | undefined {
	const [, end] = ev.ranges[""] ?? [0, 0];
	const at = settled(source, Math.min(Math.max(0, offset), end));
	const path = pathAt(ev.ranges, at);
	const top = path.split(".")[0] ?? "";
	if (path === "")
		return {
			path,
			description: QuestionSchema.description ?? "",
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

/**
 * The caret moved back over the spaces and tabs just before it, on its own line. YAML
 * drops a plain value's trailing spaces from its range, so a caret after a space just
 * typed (`text: How are |`) would otherwise fall outside the field and read as the
 * document, flipping back with the next letter.
 */
function settled(source: string, offset: number): number {
	let at = offset;
	while (at > 0 && (source[at - 1] === " " || source[at - 1] === "\t")) at -= 1;
	return at;
}
