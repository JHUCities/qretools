/**
 * A tolerant parser for the condition language (Pratt's top-down operator precedence),
 * after VTL 2.1's evaluation order: unary `+ - not` bind tightest, then `* /`, `+ -`,
 * the comparisons with `in` and `not_in`, `and`, then `or` and `xor`. Total: any text
 * parses. Something missing is a hole, as an empty field is; something wrong is a
 * problem at its place, and parsing carries on around it.
 */
import type { Range } from "../findings.ts";
import {
	type BinaryOp,
	type Expr,
	type Fn,
	FUNCTIONS,
	type Problem,
} from "./ast.ts";
import { KEYWORDS, MISTAKES, type Token, tokenize } from "./lex.ts";

export interface ParsedCondition {
	readonly expr: Expr;
	readonly problems: readonly Problem[];
}

/** Binding power of each infix operator: higher binds tighter. */
const INFIX: Readonly<Record<string, number>> = {
	or: 1,
	xor: 1,
	and: 2,
	"=": 3,
	"<>": 3,
	"<": 3,
	"<=": 3,
	">": 3,
	">=": 3,
	in: 3,
	not_in: 3,
	"+": 4,
	"-": 4,
	"*": 5,
	"/": 5,
};
const PREFIX = 6;

export function parseCondition(text: string): ParsedCondition {
	const tokens = tokenize(text);
	const problems: Problem[] = [];
	let at = 0;
	const peek = (): Token => tokens[at] ?? (tokens.at(-1) as Token);
	const next = (): Token => {
		const t = peek();
		if (t.kind !== "end") at++;
		return t;
	};
	const span = (a: Range, b: Range): Range => [a[0], b[1]];
	const point = (): Range => [peek().range[0], peek().range[0]];
	/** The operator a token is, VTL's own for one written as another language writes it. */
	const infixOf = (t: Token): string | undefined => {
		if (t.kind !== "op" && !(t.kind === "name" && KEYWORDS.has(t.text)))
			return undefined;
		const op = MISTAKES[t.text] ?? t.text;
		return op in INFIX ? op : undefined;
	};
	/** Say that VTL writes an operator otherwise, with the fix. */
	const mistake = (t: Token) => {
		const own = MISTAKES[t.text];
		if (own !== undefined)
			problems.push({
				kind: "syntax",
				message: `Conditions write \`${own}\`, not \`${t.text}\`.`,
				range: t.range,
				replace: own === "not" ? "not " : own,
			});
	};

	function expr(min: number): Expr {
		let left = prefix();
		for (;;) {
			const op = infixOf(peek());
			const power = op === undefined ? undefined : INFIX[op];
			if (op === undefined || power === undefined || power <= min) return left;
			mistake(next());
			if (op === "in" || op === "not_in") {
				const set = valueSet();
				left = {
					kind: "member",
					negated: op === "not_in",
					operand: left,
					set: set.items,
					range: span(left.range, set.range),
				};
				continue;
			}
			const right = expr(power);
			left = {
				kind: "binary",
				op: op as BinaryOp,
				left,
				right,
				range: span(left.range, right.range),
			};
		}
	}

	function prefix(): Expr {
		const t = peek();
		if (t.kind === "op" && (t.text === "-" || t.text === "+")) {
			next();
			const operand = expr(PREFIX);
			return {
				kind: "unary",
				op: t.text,
				operand,
				range: span(t.range, operand.range),
			};
		}
		if (
			(t.kind === "name" && t.text === "not") ||
			(t.kind === "op" && t.text === "!")
		) {
			mistake(next());
			const operand = expr(PREFIX);
			return {
				kind: "unary",
				op: "not",
				operand,
				range: span(t.range, operand.range),
			};
		}
		return primary();
	}

	function primary(): Expr {
		const t = peek();
		switch (t.kind) {
			case "string":
				next();
				if (t.open)
					problems.push({
						kind: "syntax",
						message: "This text has no closing quote.",
						hint: 'Codes and text are written in double quotes: "1".',
						range: t.range,
					});
				return { kind: "string", value: t.text, range: t.range };
			case "number":
				next();
				return {
					kind: "number",
					value: Number(t.text),
					text: t.text,
					range: t.range,
				};
			case "(": {
				next();
				const inner = expr(0);
				const close = peek();
				if (close.kind === ")") next();
				else
					problems.push({
						kind: "syntax",
						message: "This `(` isn't closed.",
						range: t.range,
					});
				return inner;
			}
			case "name": {
				if (t.text === "true" || t.text === "false") {
					next();
					return { kind: "boolean", value: t.text === "true", range: t.range };
				}
				if (t.text === "null") {
					next();
					return { kind: "null", range: t.range };
				}
				// An operator where a value goes: the value is still to be written.
				if (KEYWORDS.has(t.text)) return { kind: "hole", range: point() };
				next();
				if (peek().kind === "(") return call(t);
				return { kind: "name", name: t.text, range: t.range };
			}
			case "{": {
				const set = valueSet();
				problems.push({
					kind: "syntax",
					message: "A set of values goes after `in` or `not_in`.",
					range: set.range,
				});
				return { kind: "hole", range: set.range };
			}
			case "invalid":
				next();
				problems.push({
					kind: "syntax",
					message: `\`${t.text}\` isn't part of a condition.`,
					hint: 'Conditions compare answers: `bas.x = "1"`, `bas.n >= 18`, `x in {"1", "2"}`.',
					range: t.range,
				});
				return { kind: "hole", range: t.range };
			default:
				// `)`, `,`, `}`, an operator, or the end: the value is still to be written.
				return { kind: "hole", range: point() };
		}
	}

	function call(name: Token): Expr {
		const open = next();
		const args: Expr[] = [];
		if (peek().kind !== ")")
			for (;;) {
				args.push(expr(0));
				if (peek().kind !== ",") break;
				next();
			}
		const close = peek();
		if (close.kind === ")") next();
		else
			problems.push({
				kind: "syntax",
				message: "This `(` isn't closed.",
				range: open.range,
			});
		const range = span(
			name.range,
			close.kind === ")" ? close.range : (args.at(-1)?.range ?? open.range),
		);
		if (!(FUNCTIONS as readonly string[]).includes(name.text)) {
			problems.push({
				kind: "syntax",
				message: `\`${name.text}\` isn't a function conditions can use.`,
				hint: `Functions: ${FUNCTIONS.join(", ")}.`,
				range: name.range,
			});
			return { kind: "hole", range };
		}
		const fn = name.text as Fn;
		const arity = fn === "isnull" ? 1 : 3;
		// Too few is still being written: holes. Too many is a mistake.
		while (args.length < arity)
			args.push({ kind: "hole", range: [range[1], range[1]] });
		if (args.length > arity)
			problems.push({
				kind: "syntax",
				message:
					fn === "isnull"
						? "`isnull` takes one value: `isnull(bas.x)`."
						: "`between` takes a value and two bounds: `between(bas.n, 18, 64)`.",
				range,
			});
		return { kind: "call", fn, args, range };
	}

	function valueSet(): { items: Expr[]; range: Range } {
		const open = peek();
		if (open.kind !== "{") {
			problems.push({
				kind: "syntax",
				message: "`in` takes a set of values in braces.",
				hint: 'For example `bas.x in {"1", "2"}`.',
				range: point(),
			});
			return { items: [{ kind: "hole", range: point() }], range: point() };
		}
		next();
		const items: Expr[] = [];
		if (peek().kind !== "}")
			for (;;) {
				items.push(expr(3));
				if (peek().kind !== ",") break;
				next();
			}
		const close = peek();
		if (close.kind === "}") next();
		else
			problems.push({
				kind: "syntax",
				message: "This `{` isn't closed.",
				range: open.range,
			});
		if (items.length === 0)
			problems.push({
				kind: "syntax",
				message: "A set needs at least one value.",
				range: open.range,
			});
		const end =
			close.kind === "}" ? close.range : (items.at(-1)?.range ?? open.range);
		return { items, range: [open.range[0], end[1]] };
	}

	const parsed = expr(0);
	const rest = peek();
	if (rest.kind === "invalid")
		problems.push({
			kind: "syntax",
			message: `\`${rest.text}\` isn't part of a condition.`,
			hint: 'Conditions compare answers: `bas.x = "1"`, `bas.n >= 18`, `x in {"1", "2"}`.',
			range: rest.range,
		});
	else if (rest.kind !== "end")
		problems.push({
			kind: "syntax",
			message: `\`${text.slice(rest.range[0], text.length).trim().split(/\s/)[0]}\` doesn't follow from what's before it.`,
			hint: "Join conditions with `and` or `or`.",
			range: [rest.range[0], text.length],
		});
	// An empty condition is one hole at the start.
	return { expr: parsed, problems };
}
