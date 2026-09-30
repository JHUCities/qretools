/**
 * The cursor inspector, after Hazel's: what is at the caret, in the document's own
 * terms. A field says what it is for; a reference field also lists the names in scope; a name written there says what it names, or that nothing
 * by that name exists. What is wrong is the Findings panel's and the editor's to say, not
 * this. Pure: the shell adds what needs the bank (who uses a name,
 * which file to open) around it.
 */
import type { Evaluation } from "./evaluate.js";
import { pathAt, type Range } from "./findings.js";
import {
	type Env,
	FIELD_OF,
	inScope,
	type LabelledEntry,
	type Mention,
	type NamedScheme,
	type TextEntry,
} from "./surface/env.js";
import type { Scale } from "./surface/scales.js";
import {
	describePath,
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
	/** For a field that may name a shared element: which kind, and every name in scope. */
	readonly scheme?: NamedScheme;
	readonly names?: readonly string[];
	/** The name written at the caret; `value` absent means nothing has that name. */
	readonly mention?: {
		readonly scheme: NamedScheme;
		readonly name: string;
		readonly value?: Scale | TextEntry | LabelledEntry;
	};
}

/** Which kind a path names: `FIELD_OF` read backwards. */
const SCHEME_AT: ReadonlyMap<string, NamedScheme> = new Map(
	(Object.entries(FIELD_OF) as [NamedScheme, string][]).map(([k, p]) => [p, k]),
);

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
	const path = pathNear(ev.ranges, source, offset);
	const top = path.split(".")[0] ?? "";
	if (path === "")
		return {
			path,
			description: QuestionSchema.description ?? "",
		};
	if (!(KNOWN_KEYS as readonly string[]).includes(top)) return undefined;
	const key = top as SurfaceKey;
	const scheme = SCHEME_AT.get(path);
	const written = mentionAt(ev.ranges, ev.symbols.mentions, source, offset);
	const value =
		written === undefined
			? undefined
			: inScope(env, written.scheme)[written.name];
	return {
		path,
		key,
		description: describePath(path, key),
		...(scheme !== undefined && {
			scheme,
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

/** The path at the caret, clamped, the caret settled back over trailing spaces. */
function pathNear(
	ranges: Readonly<Record<string, Range>>,
	source: string,
	offset: number,
): string {
	const [, end] = ranges[""] ?? [0, 0];
	return pathAt(ranges, settled(source, Math.min(Math.max(0, offset), end)));
}

/**
 * The shared name written at `offset`, resolved or not: what the inspector describes
 * and what "go to definition" follows. One lookup for both.
 */
export function mentionAt(
	ranges: Readonly<Record<string, Range>>,
	mentions: readonly Mention[],
	source: string,
	offset: number,
): Mention | undefined {
	const path = pathNear(ranges, source, offset);
	return mentions.find((m) => m.path === path);
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
