/**
 * A condition's value given its names' values: three-valued, as VTL is. An unanswered
 * question is `null`; `and`, `or` and `not` follow Kleene's logic (false and null is
 * false, true or null is true), anything else with a null operand is null, and a
 * condition that comes out null is not true. For checking an instrument's paths, and
 * as the core of a simulator.
 *
 * A hole is neither: its value is `UNKNOWN`, "not written yet", which spreads as null
 * does but never stands for an answer, so a branch on a hole is undecided (both paths
 * possible), never false. Operands of the wrong type (which typing reports) give null,
 * not JavaScript's coercions.
 */
import type { Expr } from "./ast.ts";

/** The value of a hole: what it will be isn't written yet. */
export const UNKNOWN: unique symbol = Symbol("unknown");

export type Value = number | string | boolean | null | typeof UNKNOWN;

const same = (a: Value, b: Value): boolean =>
	typeof a === typeof b && (typeof a === "number" || typeof a === "string");

export function evaluateCondition(
	e: Expr,
	lookup: (name: string) => Value,
): Value {
	const go = (x: Expr): Value => {
		switch (x.kind) {
			case "hole":
				return UNKNOWN;
			case "null":
				return null;
			case "name":
				return lookup(x.name);
			case "string":
			case "number":
			case "boolean":
				return x.value;
			case "unary": {
				const v = go(x.operand);
				if (v === UNKNOWN || v === null) return v;
				if (x.op === "not") return typeof v === "boolean" ? !v : null;
				return typeof v === "number" ? (x.op === "-" ? -v : v) : null;
			}
			case "binary": {
				const l = go(x.left);
				const r = go(x.right);
				const logical = (v: Value) =>
					v === UNKNOWN || v === null || typeof v === "boolean";
				switch (x.op) {
					case "and":
						if (!logical(l) || !logical(r)) return null;
						if (l === false || r === false) return false;
						if (l === UNKNOWN || r === UNKNOWN) return UNKNOWN;
						return l === null || r === null ? null : true;
					case "or":
						if (!logical(l) || !logical(r)) return null;
						if (l === true || r === true) return true;
						if (l === UNKNOWN || r === UNKNOWN) return UNKNOWN;
						return l === null || r === null ? null : false;
					case "xor":
						if (!logical(l) || !logical(r)) return null;
						if (l === UNKNOWN || r === UNKNOWN) return UNKNOWN;
						return l === null || r === null ? null : l !== r;
					default:
						break;
				}
				if (l === UNKNOWN || r === UNKNOWN) return UNKNOWN;
				if (l === null || r === null) return null;
				switch (x.op) {
					case "=":
						return typeof l === typeof r ? l === r : null;
					case "<>":
						return typeof l === typeof r ? l !== r : null;
					case "<":
						return same(l, r) ? l < r : null;
					case "<=":
						return same(l, r) ? l <= r : null;
					case ">":
						return same(l, r) ? l > r : null;
					case ">=":
						return same(l, r) ? l >= r : null;
				}
				if (typeof l !== "number" || typeof r !== "number") return null;
				switch (x.op) {
					case "+":
						return l + r;
					case "-":
						return l - r;
					case "*":
						return l * r;
					default:
						return r === 0 ? null : l / r;
				}
			}
			case "member": {
				const v = go(x.operand);
				if (v === UNKNOWN || v === null) return v;
				const values = x.set.map(go);
				if (values.some((s) => s === v)) return !x.negated;
				if (values.includes(UNKNOWN)) return UNKNOWN;
				return x.negated;
			}
			case "call": {
				const args = x.args.map(go);
				if (args.includes(UNKNOWN)) return UNKNOWN;
				if (x.fn === "isnull") return args[0] === null;
				const [v, lo, hi] = args;
				if (v == null || lo == null || hi == null) return null;
				if (!same(v, lo) || !same(v, hi)) return null;
				return (
					(v as number | string) >= (lo as number | string) &&
					(v as number | string) <= (hi as number | string)
				);
			}
			default:
				return x satisfies never;
		}
	};
	return go(e);
}
