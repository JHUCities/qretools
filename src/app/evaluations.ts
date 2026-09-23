/**
 * Pure caches: one evaluation per question, recomputed only when its text or the
 * scales change, and the JSON Schema memoised on the scales. Not state: the same
 * inputs always give the same outputs; the cache only saves work.
 */
import { type Evaluation, evaluate } from "../core/evaluate.js";
import type { Scales } from "../core/surface/scales.js";
import { questionJsonSchema } from "../core/surface/schema.js";
import type { Id, Question } from "./model.js";

export interface Evaluations {
	get(q: Question, agency: string, scales: Scales): Evaluation;
	schema(scales: Scales): Record<string, unknown>;
}

export function createEvaluations(): Evaluations {
	const cache = new Map<
		Id,
		{ source: string; scales: Scales; ev: Evaluation }
	>();
	let lastScales: Scales | undefined;
	let lastSchema: Record<string, unknown> | undefined;
	return {
		get(q, agency, scales) {
			const hit = cache.get(q.id);
			if (hit && hit.source === q.source && hit.scales === scales)
				return hit.ev;
			const ev = evaluate(q.source, agency, scales);
			cache.set(q.id, { source: q.source, scales, ev });
			return ev;
		},
		schema(scales) {
			if (lastSchema && lastScales === scales) return lastSchema;
			lastScales = scales;
			lastSchema = questionJsonSchema(scales);
			return lastSchema;
		},
	};
}
