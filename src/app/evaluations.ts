/**
 * Pure caches: one evaluation per question, recomputed only when its text or the
 * environment changes, and the JSON Schema memoised on the environment. Not state: the same
 * inputs always give the same outputs; the cache only saves work.
 */
import { type Evaluation, evaluate } from "../core/evaluate.js";
import type { Env } from "../core/surface/env.js";
import { questionJsonSchema } from "../core/surface/schema.js";
import type { Id, Question } from "./model.js";

export interface Evaluations {
	get(q: Question, agency: string, env: Env): Evaluation;
	schema(env: Env): Record<string, unknown>;
}

export function createEvaluations(): Evaluations {
	const cache = new Map<Id, { source: string; env: Env; ev: Evaluation }>();
	let lastEnv: Env | undefined;
	let lastSchema: Record<string, unknown> | undefined;
	return {
		get(q, agency, env) {
			const hit = cache.get(q.id);
			if (hit && hit.source === q.source && hit.env === env) return hit.ev;
			const ev = evaluate(q.source, agency, env);
			cache.set(q.id, { source: q.source, env, ev });
			return ev;
		},
		schema(env) {
			if (lastSchema && lastEnv === env) return lastSchema;
			lastEnv = env;
			lastSchema = questionJsonSchema(env);
			return lastSchema;
		},
	};
}
