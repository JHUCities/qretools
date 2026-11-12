/**
 * When a DDI export is refused: one rule for a bank's export and an instrument's, in
 * the CLI and in the apps alike. An export is refused, with nothing written, when it
 * would be wrong: no agency, an agency that isn't valid, an access level that can't be
 * trusted (it would publish a restricted variable as open), two things sharing one DDI
 * name, or a document the official schema rejects (or hasn't checked yet).
 * Holes don't refuse it: they leave elements out, and the findings say so.
 */
import type { Collision } from "./ddi/document.ts";
import type { Finding } from "./findings.ts";

/** What an export knows about itself before it is written. */
export interface Exportable {
	/** The agency it is published under; absent when none was given or declared. */
	readonly agency?: string;
	/** Its findings: those coded `invalid-agency`, or as `ACCESS_REFUSING`, refuse it. */
	readonly findings?: readonly Finding[];
	/** DDI names that two different things would share. */
	readonly collisions: readonly Collision<string>[];
}

/**
 * The findings that say a question's access level can't be trusted. An unknown level
 * isn't one: it's held at the most closed level, which is safe.
 */
export const ACCESS_REFUSING: readonly Finding["code"][] = [
	"access-unreadable",
	"no-access-levels",
	// An instrument's workspace that doesn't cover the levels it asks at.
	"access-undeclared",
	"access-order",
];

export type Refusal =
	| { readonly kind: "noAgency" }
	| { readonly kind: "invalidAgency"; readonly findings: readonly Finding[] }
	| { readonly kind: "access"; readonly findings: readonly Finding[] }
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
	const access = (x.findings ?? []).filter((f) =>
		ACCESS_REFUSING.includes(f.code),
	);
	if (access.length > 0) return { kind: "access", findings: access };
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
			return "A DDI agency is missing or wrong. See Findings.";
		case "access":
			return "An access level can't be read from workspace.yaml, or it doesn't declare one. See Findings.";
		case "collisions":
			return "Two things would share one DDI name. See Findings.";
		case "unchecked":
			return "The DDI hasn't been checked yet.";
		case "schema":
			return "The DDI doesn't match the official schema.";
		default:
			return r satisfies never;
	}
}
