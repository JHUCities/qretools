/**
 * When a DDI export is refused: one rule for a bank's export and an instrument's, in
 * the CLI and in the apps alike. An export is refused, with nothing written, when it
 * would be wrong: no agency to publish under, an agency that isn't one, two items under
 * one identity, or a document the official schema rejects (or hasn't checked yet).
 * Holes don't refuse it: they leave elements out, and the findings say so.
 */
import type { Collision } from "./ddi/document.ts";
import type { Finding } from "./findings.ts";

/** What an export knows about itself before it is written. */
export interface Exportable {
	/** The agency it is published under; absent when none was given or declared. */
	readonly agency?: string;
	/** Its findings: those coded `invalid-agency` refuse it. */
	readonly findings?: readonly Finding[];
	/** Identities two different items would share. */
	readonly collisions: readonly Collision<string>[];
}

export type Refusal =
	| { readonly kind: "noAgency" }
	| { readonly kind: "invalidAgency"; readonly findings: readonly Finding[] }
	| {
			readonly kind: "collisions";
			readonly collisions: readonly Collision<string>[];
	  }
	| { readonly kind: "unchecked" }
	| { readonly kind: "schema"; readonly problems: readonly Finding[] };

/**
 * The first reason the export is refused, in the order they are checked, or undefined
 * when it may be written. `schemaProblems` is undefined while the official schema
 * hasn't checked the document (it loads lazily in a browser).
 */
export function exportRefusal(
	x: Exportable,
	schemaProblems: readonly Finding[] | undefined,
): Refusal | undefined {
	if (x.agency === undefined) return { kind: "noAgency" };
	const agencies = (x.findings ?? []).filter(
		(f) => f.code === "invalid-agency",
	);
	if (agencies.length > 0) return { kind: "invalidAgency", findings: agencies };
	if (x.collisions.length > 0)
		return { kind: "collisions", collisions: x.collisions };
	if (schemaProblems === undefined) return { kind: "unchecked" };
	if (schemaProblems.length > 0)
		return { kind: "schema", problems: schemaProblems };
	return undefined;
}

/** A refusal as an app says it, beside the inactive download. */
export function refusalReason(r: Refusal): string {
	switch (r.kind) {
		case "noAgency":
			return "There's no DDI agency to publish it under yet.";
		case "invalidAgency":
			return "Every item needs a real DDI agency.";
		case "collisions":
			return "Two different items would share an identity.";
		case "unchecked":
			return "The DDI hasn't been checked against the official schema yet.";
		case "schema":
			return "The DDI doesn't match the official schema.";
		default:
			return r satisfies never;
	}
}
