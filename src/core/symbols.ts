/**
 * The bank's symbol table. Each question defines variables and mentions scheme
 * names; "used by", "also defined by" and (later) rename are all queries over one
 * index of those. Keys are the caller's (the shell's numeric ids); names are only
 * what the index is keyed on, never an identity.
 */
import type { Finding } from "./findings.js";
import { type DefinedVariable, definedVariables } from "./surface/draft.js";
import type { Mention, NamedScheme } from "./surface/env.js";
import type { Parsed } from "./surface/parse.js";

export interface Symbols {
	readonly defines: readonly DefinedVariable[];
	readonly mentions: readonly Mention[];
}

export const symbolsOf = (parsed: Parsed): Symbols => ({
	defines: definedVariables(parsed.draft),
	mentions: parsed.mentions,
});

export interface Site<K> {
	readonly key: K;
	readonly path: string;
}

export interface Index<K> {
	/** Variable name → where it is defined. */
	readonly variables: ReadonlyMap<string, readonly Site<K>[]>;
	/** `scheme:name` → where it is mentioned. */
	readonly mentions: ReadonlyMap<string, readonly Site<K>[]>;
}

export const mentionKey = (scheme: NamedScheme, name: string): string =>
	`${scheme}:${name}`;

export function indexOf<K>(
	entries: Iterable<{ readonly key: K; readonly symbols: Symbols }>,
): Index<K> {
	const variables = new Map<string, Site<K>[]>();
	const mentions = new Map<string, Site<K>[]>();
	const push = (m: Map<string, Site<K>[]>, name: string, site: Site<K>) => {
		const sites = m.get(name);
		if (sites) sites.push(site);
		else m.set(name, [site]);
	};
	for (const { key, symbols } of entries) {
		for (const d of symbols.defines)
			push(variables, d.name, { key, path: d.path });
		for (const m of symbols.mentions)
			push(mentions, mentionKey(m.scheme, m.name), { key, path: m.path });
	}
	return { variables, mentions };
}

/** Where a scheme name is used, resolved or not. */
export const usedBy = <K>(
	index: Index<K>,
	scheme: NamedScheme,
	name: string,
): readonly Site<K>[] => index.mentions.get(mentionKey(scheme, name)) ?? [];

/**
 * Findings that span files, attached to this question at the place it defines the
 * shared name; each file involved gets its own. `label` names the others.
 */
export function bankFindings<K>(
	key: K,
	symbols: Symbols,
	index: Index<K>,
	label: (key: K) => string,
): readonly Finding[] {
	return symbols.defines.flatMap((d) => {
		const others = (index.variables.get(d.name) ?? []).filter(
			(s) => s.key !== key,
		);
		if (others.length === 0) return [];
		return [
			{
				code: "duplicate-variable",
				severity: "warning",
				path: d.path,
				message: `Variable \`${d.name}\` is also defined by ${[...new Set(others.map((s) => label(s.key)))].join(", ")}.`,
				hint: "A variable is one column in the dataset: give each question its own name.",
			} satisfies Finding,
		];
	});
}
