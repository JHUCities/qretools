/**
 * Pure caches. Not state: the same inputs always give the same outputs; the caches
 * only save work.
 *
 * Each bank's environment is memoised on the list of its own scheme entries, element
 * by element, as Elm's `lazy` does on a reference. That is exact because entries are
 * immutable values: editing a question replaces no scheme entry, and editing a scale
 * replaces only that scale's entry, so every other bank's list holds the same
 * references and keeps its environment, and its questions their evaluations.
 */
import {
	type Env,
	type Evaluation,
	evaluate,
	evaluateScheme,
	type SchemeEvaluation,
} from "@qretools/core";
import { questionJsonSchema } from "@qretools/core/editor";
import {
	envOf,
	type Id,
	knownBank,
	type Model,
	type Question,
	type SchemeEntry,
	schemesOf,
} from "./model.js";

export interface Evaluations {
	/** A bank's environment, from the model's slices it is built from. */
	env(model: Pick<Model, "local" | "remote" | "banks">, bank: string): Env;
	get(q: Question, env: Env): Evaluation;
	scheme(e: SchemeEntry, env: Env): SchemeEvaluation;
	schema(env: Env): Record<string, unknown>;
}

const sameEntries = (
	a: readonly SchemeEntry[],
	b: readonly SchemeEntry[],
): boolean => a.length === b.length && a.every((e, i) => e === b[i]);

export function createEvaluations(): Evaluations {
	const cache = new Map<Id, { source: string; env: Env; ev: Evaluation }>();
	const schemes = new Map<
		Id,
		{ source: string; name: string; env: Env; ev: SchemeEvaluation }
	>();
	const envs = new Map<
		string,
		{ entries: readonly SchemeEntry[]; known: boolean; env: Env }
	>();
	// A bank's editor schema, kept for as long as its environment is.
	const schemas = new WeakMap<Env, Record<string, unknown>>();
	return {
		env(model, bank) {
			const entries = schemesOf(model.local.schemes, bank);
			const known = knownBank(model.remote.schemes, bank, model.banks);
			const hit = envs.get(bank);
			if (hit && hit.known === known && sameEntries(hit.entries, entries))
				return hit.env;
			const env = envOf(entries, known);
			envs.set(bank, { entries, known, env });
			return env;
		},
		get(q, env) {
			const hit = cache.get(q.id);
			if (hit && hit.source === q.source && hit.env === env) return hit.ev;
			const ev = evaluate(q.source, env);
			cache.set(q.id, { source: q.source, env, ev });
			return ev;
		},
		scheme(e, env) {
			const hit = schemes.get(e.id);
			if (
				hit &&
				hit.source === e.source &&
				hit.name === e.name &&
				hit.env === env
			)
				return hit.ev;
			const ev = evaluateScheme(e.kind, e.source, env, e.name);
			schemes.set(e.id, { source: e.source, name: e.name, env, ev });
			return ev;
		},
		schema(env) {
			const kept = schemas.get(env);
			if (kept !== undefined) return kept;
			const schema = questionJsonSchema(env);
			schemas.set(env, schema);
			return schema;
		},
	};
}
