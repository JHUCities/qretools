/**
 * A read instrument written as a Qualtrics survey (QSF). Two passes, both pure: `number`
 * gives every ask and statement its QID in flow order (rosters included, so later steps
 * never renumber), then `layout` turns the flow into blocks, and `toQsf` serialises them
 * with a neutral skeleton (no account's IDs: Qualtrics assigns its own on import). Every
 * shape written is one the owner's exports showed (context: experiments 1–6b). Anything
 * the export can't write yet, or can't write exactly, is a finding at its DDI ID.
 */
import { printCondition } from "../cond/print.ts";
import type { Finding } from "../findings.ts";
import {
	answeredAll,
	arithmetic,
	computedAt,
	divides,
	logical,
} from "./computes.ts";
import { logicOf } from "./flowlogic.ts";
import { and, compileCondition, type Dnf, NEVER } from "./logic.ts";
import { context, number } from "./number.ts";
import { questionsOf } from "./questions.ts";
import type { Cond, ReadInstrument, Step } from "./read.ts";
import { type Node, type QsfObject, toQsf } from "./skeleton.ts";

export function writeQsf(
	instrument: ReadInstrument,
	options: {
		readonly name: string;
		/** When the survey is made, `YYYY-MM-DD hh:mm:ss`: Qualtrics requires one (the core has no clock). */
		readonly created: string;
	},
): { readonly qsf: QsfObject; readonly findings: readonly Finding[] } {
	const findings: Finding[] = [];
	const note = (
		code: Finding["code"],
		severity: Finding["severity"],
		path: string,
		message: string,
	) => findings.push({ code, severity, path, message });
	const numbering = number(instrument);
	const ctx = context(numbering, note);
	const { looped } = numbering;
	const { notYet, placeOf } = ctx;
	const { askQuestion, statement } = questionsOf(ctx, instrument);
	const without = (path: string, what: string) =>
		note(
			"qsf-inexpressible",
			"error",
			path,
			`This is written to Qualtrics without ${what}: not exported yet.`,
		);
	if (instrument.missing)
		note(
			"qsf-note",
			"info",
			"",
			"The bank's missing-value codes aren't offered to respondents in Qualtrics.",
		);

	/** The condition's "is true" list, or undefined with a finding where it can't be written. */
	const whenTrue = (cond: Cond, at: string): Dnf | undefined => {
		const asked = [...cond.sources.values()].flatMap((s) =>
			s.kind === "answer" ? s.asks : [],
		);
		if (asked.some((a) => looped.has(a))) {
			notYet(at, "A condition on a roster's rows");
			return undefined;
		}
		const compiled = compileCondition(cond, (v) =>
			computedAt(ctx, v, placeOf(at)),
		);
		if (compiled.kind === "problem") {
			note("qsf-inexpressible", "error", at, compiled.message);
			return undefined;
		}
		if (compiled.forms.t === "too-large") {
			note(
				"qsf-too-large",
				"error",
				at,
				"This condition takes more tests than Qualtrics logic should hold.",
			);
			return undefined;
		}
		return compiled.forms.t;
	};
	/** Steps behind a condition: as they are when it always holds, nothing when never. */
	const behind = (
		d: Dnf,
		description: string,
		flow: readonly Node[],
		at: string,
	): Node[] => {
		if (d.length === 0) {
			note(
				"qsf-note",
				"info",
				at,
				"This condition never holds, so what it leads to isn't in the survey.",
			);
			return [];
		}
		if (d.some((g) => g.length === 0)) return [...flow];
		return flow.length === 0
			? []
			: [{ kind: "branch", description, logic: logicOf(ctx, d), flow }];
	};

	// Each if with more than one way through marks the way it took, so later arms test one field.
	let flags = 0;
	const flagFor = (at: string): string => {
		let name = "";
		do name = `qretools_branch_${++flags}`;
		while (numbering.names.has(name));
		note(
			"qsf-note",
			"info",
			at,
			`Qualtrics records which way this branch went in the field \`${name}\`.`,
		);
		return name;
	};

	/** The flow as Qualtrics' flow: a run of asks and statements is one block. */
	const layout = (flow: readonly Step[], description?: string): Node[] => {
		const nodes: Node[] = [];
		let current: QsfObject[] = [];
		let title = description;
		const flush = () => {
			if (current.length > 0)
				nodes.push({
					kind: "block",
					...(title !== undefined && { description: title }),
					questions: current,
				});
			current = [];
			title = undefined;
		};
		for (const s of flow) {
			switch (s.kind) {
				case "ask":
					if (s.checks.length > 0) without(s.id, "its checks");
					if (s.options !== undefined) without(s.id, "its options' order");
					current.push(askQuestion(s));
					break;
				case "say":
					current.push(statement(s));
					break;
				case "section":
					flush();
					if (s.order !== undefined) without(s.id, "its order");
					nodes.push(...layout(s.flow, s.title));
					break;
				case "compute": {
					// True or false: inlined where it's read, never stored.
					if (logical(ctx, s.value.expr)) break;
					flush();
					const value = arithmetic(ctx, s.value.expr, s.value, s.id);
					const guard = whenTrue(answeredAll(s.value), s.id);
					if (value === undefined || guard === undefined) break;
					if (divides(s.value.expr))
						note(
							"qsf-note",
							"info",
							s.id,
							"Qualtrics' arithmetic decides what dividing by zero gives.",
						);
					// Computed again: cleared first, so a skipped guard can't leave the old value.
					if ((numbering.computes.get(s.variable) ?? []).length > 1)
						nodes.push({
							kind: "set",
							fields: [{ name: s.variable, value: "" }],
						});
					nodes.push(
						...behind(
							guard,
							`compute ${s.variable}`,
							[
								{
									kind: "set",
									fields: [{ name: s.variable, value: `$e{ ${value} }` }],
								},
							],
							s.id,
						),
					);
					break;
				}
				case "if": {
					flush();
					nodes.push(...branches(s));
					break;
				}
				case "stop": {
					flush();
					const d = whenTrue(s.cond, s.id);
					if (d !== undefined)
						nodes.push(
							...behind(
								d,
								`stop if ${printCondition(s.cond.expr)}`,
								[...layout(s.say), { kind: "end" }],
								s.id,
							),
						);
					break;
				}
				case "loop":
				case "repeat":
					notYet(s.id, "A roster");
					break;
				default:
					s satisfies never;
			}
		}
		flush();
		return nodes;
	};

	/**
	 * An if as survey-flow branches. One arm: a branch on its condition. More: each arm sets a
	 * flag first, and every later arm (and the else) also requires the flag empty, so exactly
	 * the first arm whose condition holds runs, whatever the arms themselves change.
	 */
	const branches = (s: Extract<Step, { kind: "if" }>): Node[] => {
		const conds = s.branches.map((b) => whenTrue(b.cond, s.id));
		if (conds.some((d) => d === undefined)) return [];
		const arms = s.branches.map((b, i) => ({
			d: conds[i],
			label: printCondition(b.cond.expr),
			flow: layout(b.then),
		}));
		const elseFlow = layout(s.else ?? []);
		if (arms.length === 1 && s.else === undefined) {
			const [arm] = arms;
			return arm?.d === undefined
				? []
				: behind(arm.d, `if ${arm.label}`, arm.flow, s.id);
		}
		const flag = flagFor(s.id);
		const unset: Dnf = [
			[{ subject: { kind: "field", name: flag }, op: "Empty" }],
		];
		const taken: Node = { kind: "set", fields: [{ name: flag, value: "1" }] };
		const nodes: Node[] = [];
		for (const [i, arm] of arms.entries()) {
			const d = i === 0 ? arm.d : and(unset, arm.d ?? NEVER);
			if (d === "too-large" || d === undefined) {
				note(
					"qsf-too-large",
					"error",
					s.id,
					"This condition takes more tests than Qualtrics logic should hold.",
				);
				return [];
			}
			nodes.push(
				...behind(
					d,
					`${i === 0 ? "if" : "elif"} ${arm.label}`,
					[taken, ...arm.flow],
					s.id,
				),
			);
		}
		if (s.else !== undefined)
			nodes.push(...behind(unset, "else", elseFlow, s.id));
		return nodes;
	};

	const nodes = layout(instrument.flow);
	return {
		qsf: toQsf(nodes, instrument, options),
		findings,
	};
}
