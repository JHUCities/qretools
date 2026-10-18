/** Computed values in Qualtrics: numbers set with `$e{}`, true-or-false ones inlined where exact. */
import { type Expr, namesOf } from "../cond/ast.ts";
import type { Computed } from "./logic.ts";
import type { Ctx } from "./number.ts";
import type { Cond } from "./read.ts";

/** Whether an expression is true or false, rather than a number. */
export const logical = (
	ctx: Ctx,
	e: Expr,
	seen: ReadonlySet<string> = new Set(),
): boolean => {
	switch (e.kind) {
		case "boolean":
		case "member":
			return true;
		case "unary":
			return e.op === "not";
		case "binary":
			return !["+", "-", "*", "/"].includes(e.op);
		case "call":
			return e.fn === "isnull" || e.fn === "between";
		case "name":
			return (
				!seen.has(e.name) && isLogical(ctx, e.name, new Set([...seen, e.name]))
			);
		default:
			return false;
	}
};
export const isLogical = (
	ctx: Ctx,
	variable: string,
	seen?: ReadonlySet<string>,
): boolean =>
	(ctx.numbering.computes.get(variable) ?? []).some((c) =>
		logical(ctx, c.step.value.expr, seen),
	);

/**
 * What a computed name is where it's read. A number is a field. A true-or-false value is
 * inlined, which is exact only when it holds the value it had when computed: it is
 * computed once, on every path, before its reader; every answer it reads was asked before
 * it and outside a roster; every number it reads was computed only before it; and the same
 * holds, from its own place, for every true-or-false value it reads.
 */
export const computedAt = (
	ctx: Ctx,
	variable: string,
	reader: number,
	seen: ReadonlySet<string> = new Set(),
): Computed => {
	const cs = ctx.numbering.computes.get(variable) ?? [];
	const [c] = cs;
	const refuse = (why: string): Computed => ({
		kind: "refused",
		why: `\`${variable}\` ${why}, so Qualtrics can't test it here.`,
	});
	if (c === undefined) return refuse("isn't computed");
	if (!isLogical(ctx, variable)) return { kind: "field" };
	if (cs.length > 1) return refuse("is computed more than once");
	if (seen.has(variable)) return refuse("is computed from itself");
	if (!c.everyPath)
		return refuse("is computed only on some paths through the survey");
	const at = ctx.placeOf(c.step.id);
	if (at > reader) return refuse("is read before it's computed");
	const reads = new Set(namesOf(c.step.value.expr).map((n) => n.name));
	for (const name of reads) {
		const s = c.step.value.sources.get(name);
		if (s === undefined) continue;
		if (s.kind === "answer" && s.row === undefined && s.asks.some(ctx.outside))
			return refuse("reads a roster's rows");
		if (s.kind === "answer" && s.asks.some((a) => ctx.placeOf(a) > at))
			return refuse("reads an answer asked after it");
		if (s.kind !== "compute") continue;
		const inner = computedAt(ctx, s.variable, at, new Set([...seen, variable]));
		if (inner.kind === "refused") return inner;
		if (
			inner.kind === "field" &&
			(ctx.numbering.computes.get(s.variable) ?? []).some(
				(n) => ctx.placeOf(n.step.id) > at,
			)
		)
			return refuse(`reads \`${s.variable}\`, computed after it`);
	}
	return { kind: "inline", value: c.step.value };
};

/** An arithmetic value in Qualtrics' `$e{}`, or undefined with a finding. */
export const arithmetic = (
	ctx: Ctx,
	e: Expr,
	value: Cond,
	at: string,
): string | undefined => {
	const go = (x: Expr): string | undefined => {
		switch (x.kind) {
			case "number":
				return x.text;
			case "name": {
				const s = value.sources.get(x.name);
				if (s?.kind === "input" || s?.kind === "compute")
					return `\${e://Field/${s.variable}}`;
				if (
					s?.kind === "answer" &&
					s.question.domain.kind === "number" &&
					s.asks.length === 1 &&
					(s.row !== undefined || !s.asks.some(ctx.outside))
				)
					return `\${q://${s.row === undefined ? "" : `${s.row}_`}${ctx.qidOf(s.asks[0] ?? "")}/ChoiceTextEntryValue}`;
				return undefined;
			}
			case "unary": {
				const v = go(x.operand);
				return v === undefined ? undefined : x.op === "-" ? `-(${v})` : v;
			}
			case "binary": {
				if (!["+", "-", "*", "/"].includes(x.op)) return undefined;
				const l = go(x.left);
				const r = go(x.right);
				return l === undefined || r === undefined
					? undefined
					: `(${l} ${x.op} ${r})`;
			}
			default:
				return undefined;
		}
	};
	const written = go(e);
	if (written === undefined)
		ctx.note(
			"qsf-inexpressible",
			"error",
			at,
			"Qualtrics computes with numbers typed in one question, inputs and computed values: this reads something else.",
		);
	return written;
};
export const divides = (e: Expr): boolean =>
	e.kind === "binary"
		? e.op === "/" || divides(e.left) || divides(e.right)
		: e.kind === "unary" && divides(e.operand);
/** Every name the value reads, answered: else `$e{}` writes "{Invalid Expression}" (experiment 4). */
export const answeredAll = (value: Cond): Cond => {
	const names = [...new Set(namesOf(value.expr).map((n) => n.name))];
	const range = value.expr.range;
	const answered = (name: string): Expr => ({
		kind: "unary",
		op: "not",
		operand: {
			kind: "call",
			fn: "isnull",
			args: [{ kind: "name", name, range }],
			range,
		},
		range,
	});
	const expr = names
		.map(answered)
		.reduce<Expr | undefined>(
			(all, x) =>
				all === undefined
					? x
					: { kind: "binary", op: "and", left: all, right: x, range },
			undefined,
		);
	return {
		expr: expr ?? { kind: "boolean", value: true, range },
		sources: value.sources,
	};
};
