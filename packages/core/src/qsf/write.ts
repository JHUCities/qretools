/**
 * A read instrument written as a Qualtrics survey (QSF). Two passes, both pure: `number`
 * gives every ask and statement its QID in flow order (rosters included, so later steps
 * never renumber), then `layout` turns the flow into blocks, and `toQsf` serialises them
 * with a neutral skeleton (no account's IDs: Qualtrics assigns its own on import). Every
 * shape written is one the owner's exports showed (context: experiments 1–6b). Anything
 * the export can't write yet, or can't write exactly, is a finding at its DDI ID.
 */
import type { Expr } from "../cond/ast.ts";
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
import {
	ALWAYS,
	and,
	type Computed,
	compileCondition,
	type Dnf,
	type Form,
	type Forms,
	NEVER,
} from "./logic.ts";
import { context, number } from "./number.ts";
import { questionsOf } from "./questions.ts";
import type { Cond, ReadInstrument, Source, Step } from "./read.ts";
import { type Node, type QsfObject, toQsf } from "./skeleton.ts";
import { baseId, countedBy, unroll } from "./unroll.ts";

/** `isnull(x) or (x >= min and x <= max)` for an ask's own answer: the range its number check held. */
const numberRange = (
	s: Extract<Step, { kind: "ask" }>,
	min: number | undefined,
	max: number | undefined,
): Cond => {
	const range = [0, 0] as const;
	const x: Expr = { kind: "name", name: "x", range };
	const bound = (op: ">=" | "<=", v: number): Expr => ({
		kind: "binary",
		op,
		left: x,
		right: { kind: "number", value: v, text: String(v), range },
		range,
	});
	const bounds = [
		...(min === undefined ? [] : [bound(">=", min)]),
		...(max === undefined ? [] : [bound("<=", max)]),
	].reduce((all, b) => ({
		kind: "binary",
		op: "and",
		left: all,
		right: b,
		range,
	}));
	return {
		expr: {
			kind: "binary",
			op: "or",
			left: { kind: "call", fn: "isnull", args: [x], range },
			right: bounds,
			range,
		},
		sources: new Map<string, Source>([
			[
				"x",
				{
					kind: "answer",
					variable: s.records[0]?.variable ?? s.id,
					asks: [s.id],
					question: s.question,
				},
			],
		]),
	};
};

export function writeQsf(
	read: ReadInstrument,
	options: {
		readonly name: string;
		/** When the survey is made, `YYYY-MM-DD hh:mm:ss`: Qualtrics requires one (the core has no clock). */
		readonly created: string;
	},
): { readonly qsf: QsfObject; readonly findings: readonly Finding[] } {
	const unrolled = unroll(read);
	const instrument = unrolled.instrument;
	const findings: Finding[] = [...unrolled.findings];
	// A row's copy reports at the author's step, once for all its rows.
	const said = new Set<string>();
	const note = (
		code: Finding["code"],
		severity: Finding["severity"],
		at: string,
		message: string,
	) => {
		const path = baseId(at);
		const key = `${code} ${path} ${message}`;
		if (said.has(key)) return;
		said.add(key);
		findings.push({ code, severity, path, message });
	};
	const numbering = number(instrument);
	const ctx = context(numbering, note);
	const { notYet, placeOf } = ctx;
	const { askQuestion, statement, warning } = questionsOf(ctx, instrument);
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

	/**
	 * One of a condition's lists, or undefined with a finding where it can't be written. A
	 * check reads its answers on the question's own page (`onPage`), where a computed number
	 * set from that question on hasn't been set yet.
	 */
	const formOf = (
		cond: Cond,
		at: string,
		form: keyof Forms,
		onPage?: string,
	): Dnf | undefined => {
		// An answer read at one round of a loop is placed; any other looped answer isn't.
		const asked = [...cond.sources.values()].flatMap((s) =>
			s.kind === "answer" && s.row === undefined ? s.asks : [],
		);
		// A check on a looped question reads its own loop's answers at the current round.
		const loop =
			onPage === undefined ? undefined : numbering.loopOf.get(onPage);
		if (
			asked.some(
				(a) =>
					ctx.outside(a) &&
					(loop === undefined || numbering.loopOf.get(a) !== loop),
			)
		) {
			note(
				"qsf-inexpressible",
				"error",
				at,
				"This reads a roster's answers outside its rows: there's no one row to test.",
			);
			return undefined;
		}
		const compiled = compileCondition(cond, (v): Computed => {
			const reader = placeOf(onPage ?? at);
			const c = computedAt(ctx, v, reader);
			return onPage !== undefined &&
				c.kind === "field" &&
				(numbering.computes.get(v) ?? []).some(
					(n) => placeOf(n.step.id) >= reader,
				)
				? {
						kind: "refused",
						why: `\`${v}\` is computed after this question, so on its page it isn't this answer's.`,
					}
				: c;
		});
		if (compiled.kind === "problem") {
			note("qsf-inexpressible", "error", at, compiled.message);
			return undefined;
		}
		const d = compiled.forms[form];
		if (d === "too-large") {
			note(
				"qsf-too-large",
				"error",
				at,
				"This condition takes more tests than Qualtrics logic should hold.",
			);
			return undefined;
		}
		return d;
	};
	const whenTrue = (cond: Cond, at: string) => formOf(cond, at, "t");

	/**
	 * A question with its blocking checks as custom validation (experiment 4, J): it passes
	 * while every check's "is not false" list holds, as the DDI's check fails only on false.
	 * Custom validation replaces a number's own, so its range is folded in; Qualtrics still
	 * refuses letters there, but no longer extra decimals (test 2). It runs on an empty
	 * answer too, as the "is not false" lists model a skipped one (measured on text; a
	 * select-all assumed alike, test 2).
	 */
	const validated = (
		s: Extract<Step, { kind: "ask" }>,
		q: QsfObject,
	): QsfObject => {
		const blocking = s.checks.filter((c) => c.severity === "blocking");
		if (blocking.length === 0) return q;
		const domain = s.question.domain;
		const lists = blocking.map((c) => formOf(c.ensure, c.id, "p", s.id));
		if (lists.some((d) => d === undefined)) return q;
		const range =
			domain.kind === "number" &&
			(domain.min !== undefined || domain.max !== undefined)
				? formOf(numberRange(s, domain.min, domain.max), s.id, "p", s.id)
				: ALWAYS;
		if (range === undefined) return q;
		const passes = [...lists, range].reduce<Form>(
			(all, d) => and(all, d ?? NEVER),
			ALWAYS,
		);
		if (passes === "too-large" || passes.length === 0) {
			note(
				passes === "too-large" ? "qsf-too-large" : "qsf-inexpressible",
				"error",
				s.id,
				passes === "too-large"
					? "This question's checks take more tests than Qualtrics logic should hold."
					: "This question's checks can never pass.",
			);
			return q;
		}
		for (const c of blocking)
			if (c.message !== undefined)
				note(
					"qsf-note",
					"info",
					c.id,
					"Qualtrics shows its own message when this check fails: a custom validation's message comes from a library.",
				);
		if (passes.some((g) => g.length === 0)) return q;
		if (domain.kind === "number")
			note(
				"qsf-inexpressible",
				"warning",
				s.id,
				`With its checks, Qualtrics no longer refuses an answer here with ${domain.decimals === 0 ? "decimals" : `more than ${domain.decimals} decimal place${domain.decimals === 1 ? "" : "s"}`}.`,
			);
		return {
			...q,
			Validation: {
				Settings: {
					ForceResponse: "OFF",
					ForceResponseType: "ON",
					Type: "CustomValidation",
					MinChars: "1",
					ContentType: null,
					ValidDateType: "DateWithFormat",
					ValidPhoneType: "ValidUSPhone",
					ValidZipType: "ValidUSZip",
					ValidNumber: { Min: "", Max: "", NumDecimals: "" },
					CustomValidation: {
						Logic: logicOf(ctx, passes),
						Message: {
							messageID: null,
							subMessageID: "VE_VALIDATION_FAILED",
							libraryID: null,
							description: "Validation Failed",
						},
					},
				},
			},
		};
	};

	/**
	 * A question's warning checks: each a statement on its page, shown live while the check
	 * fails (its "is false" list as in-page display logic, experiment 4), in its own words.
	 * `guarded`: the question is shown under a condition of a looped roster, which the
	 * warning can't also carry while it reads more than this answer.
	 */
	const warnings = (
		s: Extract<Step, { kind: "ask" }>,
		guarded = false,
	): QsfObject[] =>
		s.checks.flatMap((c): QsfObject[] => {
			if (c.severity === "blocking") return [];
			if (c.severity === "info")
				note("qsf-note", "info", c.id, "An info check is shown as a warning.");
			const own = (x: Source) => x.kind === "answer" && x.asks.includes(s.id);
			if (
				c.message?.some((p) => p.kind === "value" && own(p.source)) === true
			) {
				note(
					"qsf-inexpressible",
					"error",
					c.id,
					"This warning shows the answer it checks, which Qualtrics shows blank on that answer's page. Leave the answer out of the message.",
				);
				return [];
			}
			// A computed number set from this question on isn't set yet on its page.
			const stale = (x: Source) =>
				x.kind === "compute" &&
				(numbering.computes.get(x.variable) ?? []).some(
					(n) => placeOf(n.step.id) >= placeOf(s.id),
				);
			if (
				c.message?.some((p) => p.kind === "value" && stale(p.source)) === true
			) {
				note(
					"qsf-inexpressible",
					"error",
					c.id,
					"This warning shows a value computed after its question, which isn't set yet on its page.",
				);
				return [];
			}
			const others = [...c.ensure.sources.values()].some((x) => !own(x));
			if (others && guarded) {
				note(
					"qsf-inexpressible",
					"error",
					c.id,
					"This warning reads more than its question's answer, under a condition in a looped roster: Qualtrics can't hold both.",
				);
				return [];
			}
			const fails = formOf(c.ensure, c.id, "f", s.id);
			if (fails === undefined || fails.length === 0) return [];
			const statement = warning(c);
			return fails.some((g) => g.length === 0)
				? [statement]
				: [
						{
							...statement,
							InPageDisplayLogic: {
								...(logicOf(ctx, fails) as QsfObject),
								inPage: true,
							},
						},
					];
		});
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
		let current: QsfObject[][] = [];
		let title = description;
		const flush = () => {
			if (current.length > 0)
				nodes.push({
					kind: "block",
					...(title !== undefined && { description: title }),
					pages: current,
				});
			current = [];
			title = undefined;
		};
		for (const s of flow) {
			switch (s.kind) {
				case "ask":
					current.push([validated(s, askQuestion(s)), ...warnings(s)]);
					break;
				case "say":
					current.push([statement(s)]);
					break;
				case "section":
					flush();
					nodes.push(...section(s));
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
					flush();
					nodes.push(...looped(s));
					break;
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
	 * A count roster Qualtrics loops (unroll.ts chose it): one Loop & Merge block on its count
	 * question (experiment 3). Its ifs can't be survey-flow branches, so each question carries
	 * its arms as display logic on the current round: arm i is its condition and no earlier
	 * arm's, the else none of them; exact, as unroll.ts checked no arm asks what they read.
	 */
	const looped = (s: Extract<Step, { kind: "loop" }>): Node[] => {
		const counted = countedBy(s);
		const qid =
			counted?.kind === "answer" ? ctx.qidOf(counted.asks[0] ?? "") : "";
		const forms = (cond: Cond, at: string) => {
			const c = compileCondition(cond);
			if (c.kind === "ok") return c.forms;
			note("qsf-inexpressible", "error", at, c.message);
			return undefined;
		};
		const shown = (q: QsfObject, guard: Form, at: string): QsfObject[][] => {
			if (guard === "too-large") {
				note(
					"qsf-too-large",
					"error",
					at,
					"The conditions this is shown under take more tests than Qualtrics logic should hold.",
				);
				return [];
			}
			if (guard.length === 0) {
				note(
					"qsf-note",
					"info",
					at,
					"This is under a condition that never holds, so it isn't in the survey.",
				);
				return [];
			}
			if (guard.some((g) => g.length === 0)) return [[q]];
			return [
				[
					{
						...q,
						DisplayLogic: {
							...(logicOf(ctx, guard) as QsfObject),
							inPage: false,
						},
					},
				],
			];
		};
		const flat = (steps: readonly Step[], guard: Form): QsfObject[][] =>
			steps.flatMap((x): QsfObject[][] => {
				switch (x.kind) {
					case "ask":
						// Its warnings share its page, shown whatever the question's own condition is
						// (a hidden question has no answer to warn about, experiment 6b).
						return shown(validated(x, askQuestion(x)), guard, x.id).map(
							(page) => [
								...page,
								...warnings(
									x,
									guard !== "too-large" && !guard.some((g) => g.length === 0),
								),
							],
						);
					case "say":
						return shown(statement(x), guard, x.id);
					case "section":
						if (x.order !== undefined) without(x.id, "its order");
						return flat(x.flow, guard);
					case "if": {
						const arms = x.branches.map((b) => forms(b.cond, x.id));
						let none: Form = ALWAYS;
						const out: QsfObject[][] = [];
						for (const [i, b] of x.branches.entries()) {
							const f = arms[i];
							if (f === undefined) return [];
							out.push(...flat(b.then, and(guard, and(none, f.t))));
							none = and(none, f.n);
						}
						out.push(...flat(x.else ?? [], and(guard, none)));
						return out;
					}
					default:
						return [];
				}
			});
		const max = s.max ?? 0;
		const pages = flat(s.flow, ALWAYS);
		if (pages.length === 0) {
			// An each row reading this roster would name a block that isn't there.
			note(
				"qsf-inexpressible",
				"error",
				s.id,
				"Nothing in this roster can be shown, so Qualtrics has no loop to write.",
			);
			return [];
		}
		const locator = `q://${qid}/LoopAndMerge/MergeOnNumericResponse`;
		return [
			{
				kind: "block",
				id: numbering.loopBlocks.get(s.id) ?? "",
				description: `rows of ${printCondition(s.count.expr)}`,
				pages,
				options: {
					BlockLocking: "false",
					RandomizeQuestions: "false",
					Looping: "Question",
					LoopingOptions: {
						Locator: `${locator}?v=${max}`,
						QID: qid,
						ChoiceGroupLocator: locator,
						Static: Object.fromEntries(
							Array.from({ length: max }, (_, i) => [
								String(i + 1),
								{ "2": "" },
							]),
						),
						Randomization: "None",
					},
				},
			},
		];
	};

	/**
	 * A section; in a random order, Qualtrics' block randomizer showing all of its blocks
	 * (iain-reference-2.qsf), which is exact when each of its steps lays out as one block.
	 */
	const section = (s: Extract<Step, { kind: "section" }>): Node[] => {
		if (s.order === undefined) return layout(s.flow, s.title);
		/** Whether a step lays out as exactly one block (a looped roster in a randomizer is unmeasured). */
		const oneBlock = (step: Step): boolean =>
			step.kind === "ask" ||
			step.kind === "say" ||
			(step.kind === "section" &&
				step.order === undefined &&
				step.flow.length > 0 &&
				step.flow.every(oneBlock));
		const each = s.flow.every(oneBlock)
			? s.flow.map((step) => layout([step]))
			: undefined;
		const blocks = (each ?? []).flatMap((nodes) =>
			nodes.length === 1 && nodes[0]?.kind === "block" ? [nodes[0]] : [],
		);
		if (each === undefined || blocks.length !== s.flow.length) {
			note(
				"qsf-inexpressible",
				"error",
				s.id,
				"Qualtrics shuffles blocks: this section holds more than questions and statements, so it's written in its order.",
			);
			return each?.flat() ?? layout(s.flow, s.title);
		}
		if (s.order === "rotate")
			note(
				"qsf-inexpressible",
				"warning",
				s.id,
				"Qualtrics can't rotate a section: it's shuffled instead.",
			);
		return blocks.length === 0
			? []
			: [
					{
						kind: "randomizer",
						blocks: blocks.map((b, k) => ({
							...b,
							...(s.title !== undefined && {
								description: `${s.title} (${k + 1} of ${blocks.length})`,
							}),
						})),
					},
				];
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
