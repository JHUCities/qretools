/**
 * A condition or computed value, parsed: an expression of the VTL subset, with holes
 * where something is still to be written. Every node has its range in the text.
 */
import type { Range } from "../findings.ts";

export type BinaryOp =
	| "="
	| "<>"
	| "<"
	| "<="
	| ">"
	| ">="
	| "+"
	| "-"
	| "*"
	| "/"
	| "and"
	| "or"
	| "xor";

export type UnaryOp = "not" | "-" | "+";

/** VTL's scalar functions in the subset. */
export type Fn = "isnull" | "between";
export const FUNCTIONS: readonly Fn[] = ["isnull", "between"];

export type Expr =
	| { readonly kind: "hole"; readonly range: Range }
	| { readonly kind: "name"; readonly name: string; readonly range: Range }
	| { readonly kind: "string"; readonly value: string; readonly range: Range }
	| {
			readonly kind: "number";
			readonly value: number;
			/** As written: `1.50` stays `1.50` when printed. */
			readonly text: string;
			readonly range: Range;
	  }
	| { readonly kind: "boolean"; readonly value: boolean; readonly range: Range }
	| { readonly kind: "null"; readonly range: Range }
	| {
			readonly kind: "unary";
			readonly op: UnaryOp;
			readonly operand: Expr;
			readonly range: Range;
	  }
	| {
			readonly kind: "binary";
			readonly op: BinaryOp;
			readonly left: Expr;
			readonly right: Expr;
			readonly range: Range;
	  }
	| {
			/** `x in {"1", "2"}`, or `not_in`. */
			readonly kind: "member";
			readonly negated: boolean;
			readonly operand: Expr;
			readonly set: readonly Expr[];
			readonly range: Range;
	  }
	| {
			readonly kind: "call";
			readonly fn: Fn;
			readonly args: readonly Expr[];
			readonly range: Range;
	  };

/**
 * What is wrong with a condition as written, at its place in the text: how it's
 * written, a type that doesn't fit, or a name nothing has (which an instrument shows as
 * a hole listing the names in scope).
 */
export interface Problem {
	readonly kind: "syntax" | "type" | "unknown-name";
	readonly message: string;
	readonly hint?: string;
	readonly range: Range;
	/** A replacement for the text at `range` that would fix it, when there's one. */
	readonly replace?: string;
}

/** Every hole in an expression, in order: what is still to be written. */
export function holesOf(e: Expr): readonly Range[] {
	switch (e.kind) {
		case "hole":
			return [e.range];
		case "unary":
			return holesOf(e.operand);
		case "binary":
			return [...holesOf(e.left), ...holesOf(e.right)];
		case "member":
			return [...holesOf(e.operand), ...e.set.flatMap(holesOf)];
		case "call":
			return e.args.flatMap(holesOf);
		default:
			return [];
	}
}

/** Every name an expression reads, in order, with where each is written. */
export function namesOf(
	e: Expr,
): readonly { readonly name: string; readonly range: Range }[] {
	switch (e.kind) {
		case "name":
			return [{ name: e.name, range: e.range }];
		case "unary":
			return namesOf(e.operand);
		case "binary":
			return [...namesOf(e.left), ...namesOf(e.right)];
		case "member":
			return [...namesOf(e.operand), ...e.set.flatMap(namesOf)];
		case "call":
			return e.args.flatMap(namesOf);
		default:
			return [];
	}
}

/** The same expression with every range moved by `at` (from the text's offsets to a source's). */
export function moveRanges(e: Expr, at: (r: Range) => Range): Expr {
	const go = (x: Expr): Expr => {
		const range = at(x.range);
		switch (x.kind) {
			case "unary":
				return { ...x, operand: go(x.operand), range };
			case "binary":
				return { ...x, left: go(x.left), right: go(x.right), range };
			case "member":
				return { ...x, operand: go(x.operand), set: x.set.map(go), range };
			case "call":
				return { ...x, args: x.args.map(go), range };
			default:
				return { ...x, range };
		}
	};
	return go(e);
}
