/**
 * Text folded for comparison: case, punctuation and spacing ignored, so "Days." and
 * "days" are one key. Symbols stay ("$50" is not "50%"). Used wherever the core asks
 * "is this the same?", so it has one answer.
 */
export const fold = (s: string): string =>
	s
		.normalize("NFKC")
		.toLowerCase()
		.replace(/\p{P}+/gu, " ")
		.replace(/\s+/g, " ")
		.trim();

/** A response list, the same whatever its codes: its labels folded, in order. */
export const labelsKey = (
	codes: readonly { readonly label: string }[],
): string => codes.map((c) => fold(c.label)).join(" | ");
