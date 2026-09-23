/**
 * Pure caches. Not state: the same inputs always give the same outputs; the caches
 * only save work, and their keys are what makes that safe.
 *
 * Env identity is a performance contract. Every question's evaluation is cached on
 * the Env object, so the Env must keep its identity until a scheme's saved text
 * changes, never merely because some file was edited. `env` is therefore keyed on
 * the saved schemes' ids and blob shas, which change only on load, save and reload.
 */
import { type Evaluation, evaluate } from "../core/evaluate.js";
import { evaluateScheme, type SchemeEvaluation } from "../core/schemes.js";
import type { Env } from "../core/surface/env.js";
import { questionJsonSchema } from "../core/surface/schema.js";
import {
	type Entry,
	envOf,
	type Id,
	type Question,
	type SchemeEntry,
	savedSchemes,
} from "./model.js";

export interface Evaluations {
	env(files: Readonly<Record<Id, Entry>>): Env;
	get(q: Question, agency: string, env: Env): Evaluation;
	scheme(e: SchemeEntry, env: Env): SchemeEvaluation;
	schema(env: Env): Record<string, unknown>;
}

export function createEvaluations(): Evaluations {
	const cache = new Map<Id, { source: string; env: Env; ev: Evaluation }>();
	const schemes = new Map<
		Id,
		{ source: string; env: Env; ev: SchemeEvaluation }
	>();
	let envKey: string | undefined;
	let lastEnv: Env | undefined;
	let schemaEnv: Env | undefined;
	let lastSchema: Record<string, unknown> | undefined;
	return {
		env(files) {
			const key = savedSchemes(files)
				.map((e) => `${e.id}:${e.origin.sha}`)
				.join(",");
			if (lastEnv && envKey === key) return lastEnv;
			envKey = key;
			lastEnv = envOf(files);
			return lastEnv;
		},
		get(q, agency, env) {
			const hit = cache.get(q.id);
			if (hit && hit.source === q.source && hit.env === env) return hit.ev;
			const ev = evaluate(q.source, agency, env);
			cache.set(q.id, { source: q.source, env, ev });
			return ev;
		},
		scheme(e, env) {
			const hit = schemes.get(e.id);
			if (hit && hit.source === e.source && hit.env === env) return hit.ev;
			const ev = evaluateScheme(e.kind, e.source, env);
			schemes.set(e.id, { source: e.source, env, ev });
			return ev;
		},
		schema(env) {
			if (lastSchema && schemaEnv === env) return lastSchema;
			schemaEnv = env;
			lastSchema = questionJsonSchema(env);
			return lastSchema;
		},
	};
}
