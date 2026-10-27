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

/** The value of a hole: what it will be isn't written yet. A registered symbol, so a copy of the evaluator in a page has the same one. */
export const UNKNOWN: unique symbol = Symbol.for("qretools.unknown");

export type Value = number | string | boolean | null | typeof UNKNOWN;

/**
 * Self-contained, so a page can run it as written (`evaluateCondition.toString()`): it
 * names nothing outside itself, which a bundler could rename.
 */
export function evaluateCondition(
	e: Expr,
	lookup: (name: string) => Value,
): Value {
	// The same symbol as UNKNOWN: the type names it, the code doesn't.
	const hole: typeof UNKNOWN = Symbol.for("qretools.unknown") as typeof UNKNOWN;
	const same = (a: Value, b: Value): boolean =>
		typeof a === typeof b && (typeof a === "number" || typeof a === "string");
	const go = (x: Expr): Value => {
		switch (x.kind) {
			case "hole":
				return hole;
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
				if (v === hole || v === null) return v;
				if (x.op === "not") return typeof v === "boolean" ? !v : null;
				return typeof v === "number" ? (x.op === "-" ? -v : v) : null;
			}
			case "binary": {
				const l = go(x.left);
				const r = go(x.right);
				const logical = (v: Value) =>
					v === hole || v === null || typeof v === "boolean";
				switch (x.op) {
					case "and":
						if (!logical(l) || !logical(r)) return null;
						if (l === false || r === false) return false;
						if (l === hole || r === hole) return hole;
						return l === null || r === null ? null : true;
					case "or":
						if (!logical(l) || !logical(r)) return null;
						if (l === true || r === true) return true;
						if (l === hole || r === hole) return hole;
						return l === null || r === null ? null : false;
					case "xor":
						if (!logical(l) || !logical(r)) return null;
						if (l === hole || r === hole) return hole;
						return l === null || r === null ? null : l !== r;
					default:
						break;
				}
				if (l === hole || r === hole) return hole;
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
				if (v === hole || v === null) return v;
				const values = x.set.map(go);
				if (values.some((s) => s === v)) return !x.negated;
				if (values.includes(hole)) return hole;
				return x.negated;
			}
			case "call": {
				// A code's words are its bank's, which a condition's evaluation isn't given.
				if (x.fn === "label") return hole;
				const args = x.args.map(go);
				// The value, or the default when the value is null (a hole stays undecided).
				if (x.fn === "nvl")
					return args[0] === null ? (args[1] ?? null) : (args[0] ?? null);
				if (args.includes(hole)) return hole;
				switch (x.fn) {
					case "isnull":
						return args[0] === null;
					case "between": {
						const [v, lo, hi] = args;
						if (v == null || lo == null || hi == null) return null;
						if (!same(v, lo) || !same(v, hi)) return null;
						return (
							(v as number | string) >= (lo as number | string) &&
							(v as number | string) <= (hi as number | string)
						);
					}
					default:
						return x.fn satisfies never;
				}
			}
			default:
				return x satisfies never;
		}
	};
	return go(e);
}
