/**
 * An expression written back as VTL, with only the parentheses its evaluation order
 * needs. `rename` maps each name as written to the name to print (an instrument's
 * export rewrites `bas.nhd_sat` to the variable's name). A hole prints as `?`, so a
 * printed draft shows where it's incomplete.
 */
import type { Expr } from "./ast.ts";

const POWER: Readonly<Record<string, number>> = {
	or: 1,
	xor: 1,
	and: 2,
	"=": 3,
	"<>": 3,
	"<": 3,
	"<=": 3,
	">": 3,
	">=": 3,
	"+": 4,
	"-": 4,
	"*": 5,
	"/": 5,
};
const PREFIX = 6;
const MEMBER = 3;

export function printCondition(
	e: Expr,
	rename: (name: string) => string = (n) => n,
): string {
	const go = (x: Expr, min: number): string => {
		const wrap = (power: number, text: string) =>
			power < min ? `(${text})` : text;
		switch (x.kind) {
			case "hole":
				return "?";
			case "name":
				return rename(x.name);
			case "string":
				return `"${x.value}"`;
			case "number":
				return x.text;
			case "boolean":
				return String(x.value);
			case "null":
				return "null";
			case "unary":
				return wrap(
					PREFIX,
					`${x.op === "not" ? "not " : x.op}${go(x.operand, PREFIX + 1)}`,
				);
			case "binary": {
				const power = POWER[x.op] ?? 0;
				// Left-to-right: the right operand of an equal power needs parentheses.
				return wrap(
					power,
					`${go(x.left, power)} ${x.op} ${go(x.right, power + 1)}`,
				);
			}
			case "member":
				return wrap(
					MEMBER,
					`${go(x.operand, MEMBER + 1)} ${x.negated ? "not_in" : "in"} {${x.set.map((v) => go(v, MEMBER + 1)).join(", ")}}`,
				);
			case "call":
				return `${x.fn}(${x.args.map((a) => go(a, 0)).join(", ")})`;
			default:
				return x satisfies never;
		}
	};
	return go(e, 0);
}
