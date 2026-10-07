/**
 * The commonest YAML slip: no space after a key's colon. `open:{}` is not `open` with
 * the value `{}` but one word, so YAML reports a line it can't read, the key is unknown,
 * and on a line before another field it swallows that line too (`open:{} text`). One
 * finding says what happened, with a fix that adds the space; the findings the slip
 * caused are dropped. Read from the AST, never from raw lines: a block scalar's
 * `Time:10pm` is text, and stays text. Pure.
 */
import { type Document, isMap, isScalar, Scalar } from "yaml";
import type { Finding, Range } from "../findings.ts";
import { keyText } from "./codes.ts";
import { clampRange } from "./read.ts";

/** A word, its colon, and something other than a space straight after. */
const SLIP = /^([\w-]+):(?=\S)/;

interface Slip {
	readonly path: string;
	readonly word: string;
	readonly range: Range;
}

/** Every plain key, and every plain value that starts on a later line than its key, that slips. */
function slipsIn(doc: Document, source: string): readonly Slip[] {
	const found: Slip[] = [];
	const walk = (node: unknown, prefix: string): void => {
		if (!isMap(node)) return;
		for (const pair of node.items) {
			if (!isScalar(pair.key) || !pair.key.range) continue;
			const key = keyText(pair.key);
			const path = prefix ? `${prefix}.${key}` : key;
			const plain = (n: unknown): n is Scalar =>
				isScalar(n) && n.type === Scalar.PLAIN && n.range !== undefined;
			const keyWord = plain(pair.key) ? SLIP.exec(key)?.[1] : undefined;
			if (keyWord !== undefined && pair.key.range) {
				found.push({
					path,
					word: keyWord,
					range: clampRange(
						pair.key.range[0],
						pair.key.range[1],
						source.length,
					),
				});
				continue;
			}
			// The first entry under a block key is its value, not a key: `responses:\n  1:Yes`.
			const v = pair.value;
			if (plain(v) && v.range) {
				const text = source.slice(v.range[0], v.range[1]);
				const below = source
					.slice(pair.key.range[1], v.range[0])
					.includes("\n");
				const valueWord = below ? SLIP.exec(text)?.[1] : undefined;
				if (valueWord !== undefined)
					found.push({
						path,
						word: valueWord,
						range: clampRange(v.range[0], v.range[1], source.length),
					});
			}
			walk(pair.value, path);
		}
	};
	walk(doc.contents, "");
	return found;
}

const overlaps = (a: Range, b: Range): boolean => a[0] < b[1] && b[0] < a[1];

/**
 * The findings with the slips said once: a `missing-space` finding for each, with the
 * fix, and none of the syntax errors or other findings it caused at its place.
 */
export function withSpacing(
	doc: Document,
	source: string,
	findings: readonly Finding[],
): readonly Finding[] {
	const slips = slipsIn(doc, source);
	if (slips.length === 0) return findings;
	// Whatever the slip caused at its own place (an unknown key `open:{}`, or a value
	// `1:Yes` read as a scale's name) goes with it; fixing it shows what is really there.
	const paths = new Set(slips.map((s) => s.path));
	const kept = findings.filter(
		(f) =>
			!paths.has(f.path) &&
			!(
				f.code === "yaml-syntax" &&
				f.range !== undefined &&
				slips.some((s) => overlaps(s.range, f.range as Range))
			),
	);
	return [
		...slips.map(
			(s): Finding => ({
				code: "missing-space",
				severity: "error",
				path: s.path,
				range: s.range,
				message: `Put a space after \`${s.word}:\`.`,
				hint: "Without it YAML reads the colon and what follows as one word, sometimes with the next line too.",
				fix: {
					kind: "space",
					label: `Add a space after \`${s.word}:\``,
					path: s.path,
					word: s.word,
				},
			}),
		),
		...kept,
	];
}
