/**
 * Pure caches. Not state: the same inputs always give the same outputs; the caches
 * only save work.
 *
 * The environment is memoised on the reference of the scheme slice it is built from,
 * as Elm's `lazy` does. That is exact because of how the Model is shaped: only a
 * change to a scheme file replaces `local.schemes`, so editing a question can never
 * rebuild the environment and so never re-evaluates the bank.
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
	type Local,
	type Question,
	type Remote,
	type SchemeEntry,
} from "./model.js";

export interface Evaluations {
	env(schemes: Local["schemes"], remoteSchemes: Remote["schemes"]): Env;
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
	let envOfSlice: Local["schemes"] | undefined;
	let envOfRemote: Remote["schemes"] | undefined;
	let lastEnv: Env | undefined;
	let schemaEnv: Env | undefined;
	let lastSchema: Record<string, unknown> | undefined;
	return {
		env(schemes, remoteSchemes) {
			if (lastEnv && envOfSlice === schemes && envOfRemote === remoteSchemes)
				return lastEnv;
			envOfSlice = schemes;
			envOfRemote = remoteSchemes;
			lastEnv = envOf(schemes, remoteSchemes);
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
