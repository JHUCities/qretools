/**
 * The condition language's types, checked against the questions' own: a coded answer
 * is one of its codes (text, written in quotes), a number is a number. Checking is
 * total and local: a name or part already wrong is `unknown`, which fits anywhere, so
 * one mistake is reported once, not again by everything around it.
 */
import type { Range } from "../findings.ts";
import type { Expr, Problem } from "./ast.ts";
import { printCondition } from "./print.ts";

export type Type =
	| { readonly kind: "boolean" }
	| { readonly kind: "number" }
	| { readonly kind: "string" }
	| {
			/** An answer on a code list: one of these codes, each with its label. */
			readonly kind: "code";
			readonly codes: readonly {
				readonly code: string;
				readonly label: string;
			}[];
	  }
	| { readonly kind: "unknown" };

const BOOLEAN: Type = { kind: "boolean" };
const NUMBER: Type = { kind: "number" };
const STRING: Type = { kind: "string" };
const UNKNOWN: Type = { kind: "unknown" };

/** What a name means in a condition: its type, or undefined when nothing has that name. */
export type Scope = (name: string) => Type | undefined;

export interface Typed {
	readonly type: Type;
	readonly problems: readonly Problem[];
}

/** How a type is said in a message. */
export const describe = (t: Type): string =>
	t.kind === "code"
		? "a coded answer"
		: t.kind === "boolean"
			? "a condition"
			: t.kind === "number"
				? "a number"
				: t.kind === "string"
					? "text"
					: "a value";

const listCodes = (t: Extract<Type, { kind: "code" }>): string =>
	t.codes.map((c) => `"${c.code}" ${c.label}`).join(", ");

export function typeOf(e: Expr, scope: Scope): Typed {
	const problems: Problem[] = [];
	const say = (
		message: string,
		range: Range,
		hint?: string,
		replace?: string,
		kind: Problem["kind"] = "type",
	) =>
		problems.push({
			kind,
			message: message.charAt(0).toUpperCase() + message.slice(1),
			range,
			...(hint !== undefined && { hint }),
			...(replace !== undefined && { replace }),
		});

	/** That `x` (of type `t`) is a `want`, or say why not. */
	const expect = (t: Type, want: Type["kind"], x: Expr, what: string) => {
		if (t.kind === "unknown" || t.kind === want) return;
		say(
			`${what} needs ${describe({ kind: want } as Type)}; this is ${describe(t)}.`,
			x.range,
		);
	};

	/** Two sides compared: a code with its codes, a number with a number. */
	const comparable = (a: Type, b: Type, ax: Expr, bx: Expr) => {
		if (a.kind === "unknown" || b.kind === "unknown") return;
		if (a.kind === "code" || b.kind === "code") {
			const [code, other, otherX] =
				a.kind === "code"
					? [a, b, bx]
					: [b as Extract<Type, { kind: "code" }>, a, ax];
			if (other.kind === "code") return;
			if (otherX.kind === "number") {
				const exists = code.codes.some((c) => c.code === otherX.text);
				say(
					exists
						? `A code is text: write \`"${otherX.text}"\`.`
						: `\`${otherX.text}\` isn't one of this answer's codes, which are text.`,
					otherX.range,
					`Codes: ${listCodes(code)}.`,
					exists ? `"${otherX.text}"` : undefined,
				);
				return;
			}
			if (otherX.kind === "string") {
				if (!code.codes.some((c) => c.code === otherX.value))
					say(
						`\`"${otherX.value}"\` isn't one of this answer's codes.`,
						otherX.range,
						`Codes: ${listCodes(code)}.`,
					);
				return;
			}
			if (other.kind !== "string")
				say(
					`A coded answer can't be compared with ${describe(other)}.`,
					otherX.range,
				);
			return;
		}
		if (a.kind !== b.kind)
			say(`${describe(a)} can't be compared with ${describe(b)}.`, bx.range);
	};

	const go = (x: Expr): Type => {
		switch (x.kind) {
			case "hole":
				return UNKNOWN;
			case "name": {
				const t = scope(x.name);
				if (t === undefined) {
					say(
						`Nothing is named \`${x.name}\` here.`,
						x.range,
						undefined,
						undefined,
						"unknown-name",
					);
					return UNKNOWN;
				}
				return t;
			}
			case "string":
				return STRING;
			case "number":
				return NUMBER;
			case "boolean":
				return BOOLEAN;
			case "null":
				return UNKNOWN;
			case "unary": {
				const t = go(x.operand);
				if (x.op === "not") {
					if (t.kind !== "unknown" && t.kind !== "boolean")
						say(
							"`not` applies to a condition.",
							x.range,
							'`not` binds tighter than `=`: write `not(bas.x = "1")`.',
						);
					return BOOLEAN;
				}
				expect(t, "number", x.operand, `\`${x.op}\``);
				return NUMBER;
			}
			case "binary": {
				const l = go(x.left);
				const r = go(x.right);
				switch (x.op) {
					case "and":
					case "or":
					case "xor":
						expect(l, "boolean", x.left, `\`${x.op}\``);
						expect(r, "boolean", x.right, `\`${x.op}\``);
						return BOOLEAN;
					case "+":
					case "-":
					case "*":
					case "/":
						expect(l, "number", x.left, `\`${x.op}\``);
						expect(r, "number", x.right, `\`${x.op}\``);
						return NUMBER;
					case "=":
					case "<>": {
						// Anything = null is null, never true: VTL asks with `isnull`.
						const other =
							x.right.kind === "null"
								? x.left
								: x.left.kind === "null"
									? x.right
									: undefined;
						if (other !== undefined) {
							const fixed = `${x.op === "<>" ? "not " : ""}isnull(${printCondition(other)})`;
							say(
								`\`${x.op} null\` is never true; write \`${fixed}\`.`,
								x.range,
								undefined,
								fixed,
							);
							return BOOLEAN;
						}
						comparable(l, r, x.left, x.right);
						return BOOLEAN;
					}
					default:
						// Order: numbers, or text. Codes are text, so "10" < "9": say so.
						for (const [t, side] of [
							[l, x.left],
							[r, x.right],
						] as const)
							if (t.kind === "code")
								say(
									"Codes are text, so they don't order as numbers.",
									side.range,
									'Use `in`: `bas.x in {"4", "5"}`.',
								);
						if (l.kind !== "code" && r.kind !== "code")
							comparable(l, r, x.left, x.right);
						return BOOLEAN;
				}
			}
			case "member": {
				const t = go(x.operand);
				for (const v of x.set) comparable(t, go(v), x.operand, v);
				return BOOLEAN;
			}
			case "call": {
				const args = x.args.map(go);
				if (x.fn === "between") {
					const [v, lo, hi] = args;
					const [vx, lox, hix] = x.args;
					if (v && lo && hi && vx && lox && hix) {
						expect(v, "number", vx, "`between`");
						expect(lo, "number", lox, "`between`");
						expect(hi, "number", hix, "`between`");
					}
				}
				return BOOLEAN;
			}
			default:
				return x satisfies never;
		}
	};
	return { type: go(e), problems };
}

/** A condition: typed, and true or false as a whole (`bas.x` alone is an answer, not a condition). */
export function typeCondition(e: Expr, scope: Scope): Typed {
	const typed = typeOf(e, scope);
	const { type } = typed;
	if (type.kind === "boolean" || type.kind === "unknown") return typed;
	return {
		type,
		problems: [
			...typed.problems,
			{
				kind: "type",
				message: `This is ${describe(type)}, not a condition.`,
				hint: 'Compare it: `bas.x = "1"`, `bas.n >= 18`.',
				range: e.range,
			},
		],
	};
}
