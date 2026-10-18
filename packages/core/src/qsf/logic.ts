/**
 * A condition as Qualtrics logic. Qualtrics writes a condition as a flat list of tests
 * joined by And and Or, And first, with no brackets and no not: an Or of And-groups (DNF).
 * Ours are three-valued (an unanswered question is null; a condition that is null isn't
 * true; Kleene's `and`, `or`, `not`), so a condition compiles to four such lists:
 *
 * - `t`: it is true;  `f`: it is false (answered, and false);
 * - `n`: it is not true (false or null: what `else` takes);  `p`: it is not false.
 *
 * `not` swaps t with f and n with p; De Morgan does the rest. Each test is exact under
 * Qualtrics' measured behaviour on a question not answered (experiments 2 and 4, owner's
 * account, 2026-10-18): Selected, EqualTo, GreaterThan(OrEqual), LessThan(OrEqual) and
 * NotEmpty are false; NotSelected, NotEqualTo and Empty are true. Anything Qualtrics can't
 * say exactly is a finding, never an approximation.
 *
 * Measured in experiment 6: a typed number is compared as a number; text is compared
 * exactly (case and spaces); an embedded field never set, or set to an empty answer, is
 * tested as a question not answered is. An embedded field is ordered as a number but
 * EqualTo compares its text ("05" isn't 5), so a number is tested for equality by >= and <=.
 * An ask not shown has no answer, even one given before going Back (experiment 6b).
 * Ordering text is refused: unmeasured.
 * The writer's part: `$e{}` over an empty answer writes "{Invalid Expression}" (experiment 4),
 * so a computed field is set only where its operands are answered, else left unset.
 */
import type { BinaryOp, Expr } from "../cond/ast.ts";
import type { Cond, Domain, Source } from "./read.ts";

export type Operator =
	| "Selected"
	| "NotSelected"
	| "EqualTo"
	| "NotEqualTo"
	| "GreaterThan"
	| "GreaterThanOrEqual"
	| "LessThan"
	| "LessThanOrEqual"
	| "Empty"
	| "NotEmpty";

/** What a test reads: one ask's answer (by its DDI ID), or an embedded field by name. */
export type Subject =
	| {
			readonly kind: "ask";
			readonly ask: string;
			/** One round of a Qualtrics loop, read from outside it; absent: as asked, or the current round. */
			readonly row?: number;
	  }
	| { readonly kind: "field"; readonly name: string };

/** One Qualtrics test: a choice selected or not, or a value compared. */
export interface Atom {
	readonly subject: Subject;
	readonly op: Operator;
	/** The choice's code for Selected/NotSelected; the value compared with otherwise. */
	readonly value?: string;
}

/** An Or of And-groups: `[]` is never true, `[[]]` always. */
export type Dnf = readonly (readonly Atom[])[];

/** A form, or `too-large` when it would take more than MAX_TESTS tests. */
export type Form = Dnf | "too-large";

export interface Forms {
	readonly t: Form;
	readonly f: Form;
	readonly n: Form;
	readonly p: Form;
}

export const NEVER: Dnf = [];
export const ALWAYS: Dnf = [[]];

/** More tests than this in one condition is more than an author should read in Qualtrics. */
export const MAX_TESTS = 200;
/** Groups multiplied out before simplifying: bounds the work, as `n` of k `or`s has 2^k. */
const MAX_PRODUCT = 4 * MAX_TESTS;

const size = (d: Dnf) => d.reduce((n, g) => n + g.length, 0);
const keyOf = (a: Atom) => JSON.stringify([a.subject, a.op, a.value]);
const sameSubject = (a: Atom, b: Atom) =>
	JSON.stringify(a.subject) === JSON.stringify(b.subject);
/** A group that can't hold: a test with its negation, or Empty with a test of an answer. */
const contradicts = (g: readonly Atom[]) =>
	g.some((a) =>
		g.some(
			(b) =>
				sameSubject(a, b) &&
				((b.op === NEGATION[a.op] && b.value === a.value) ||
					(a.op === "Empty" && FALSE_WHEN_SKIPPED.has(b.op))),
		),
	);
/** Groups no other group already covers (a group holding all of another's tests adds nothing). */
const absorbed = (d: Dnf): Dnf => {
	const keys = d.map((g) => new Set(g.map(keyOf)));
	return d.filter(
		(_, i) =>
			!keys.some(
				(k, j) =>
					j !== i &&
					[...k].every((x) => keys[i]?.has(x)) &&
					(k.size < (keys[i]?.size ?? 0) || j < i),
			),
	);
};
const capped = (d: Dnf): Form => (size(d) > MAX_TESTS ? "too-large" : d);
const or = (a: Form, b: Form): Form =>
	a === "too-large" || b === "too-large"
		? "too-large"
		: capped(absorbed([...a, ...b]));
export const and = (a: Form, b: Form): Form =>
	a === "too-large" || b === "too-large" || a.length * b.length > MAX_PRODUCT
		? "too-large"
		: capped(
				absorbed(
					a
						.flatMap((x) =>
							b.map((y) => [
								...new Map([...x, ...y].map((t) => [keyOf(t), t])).values(),
							]),
						)
						.filter((g) => !contradicts(g)),
				),
			);
const ors = (ds: readonly Form[]): Form => ds.reduce(or, NEVER);
const ands = (ds: readonly Form[]): Form => ds.reduce(and, ALWAYS);
const atom = (subject: Subject, op: Operator, value?: string): Dnf => [
	[{ subject, op, ...(value !== undefined && { value }) }],
];
const constant = (v: boolean | null): Forms =>
	v === null
		? { t: NEVER, f: NEVER, n: ALWAYS, p: ALWAYS }
		: v
			? { t: ALWAYS, f: NEVER, n: NEVER, p: ALWAYS }
			: { t: NEVER, f: ALWAYS, n: ALWAYS, p: NEVER };
const negate = (x: Forms): Forms => ({ t: x.f, f: x.t, n: x.p, p: x.n });
const both = (a: Forms, b: Forms): Forms => ({
	t: and(a.t, b.t),
	f: or(a.f, b.f),
	n: or(a.n, b.n),
	p: and(a.p, b.p),
});
const either = (a: Forms, b: Forms): Forms =>
	negate(both(negate(a), negate(b)));

/** The negated comparison, and whether Qualtrics' test is false on a question not answered. */
const NEGATION: Readonly<Record<Operator, Operator>> = {
	Selected: "NotSelected",
	NotSelected: "Selected",
	EqualTo: "NotEqualTo",
	NotEqualTo: "EqualTo",
	GreaterThan: "LessThanOrEqual",
	LessThanOrEqual: "GreaterThan",
	GreaterThanOrEqual: "LessThan",
	LessThan: "GreaterThanOrEqual",
	Empty: "NotEmpty",
	NotEmpty: "Empty",
};
const FALSE_WHEN_SKIPPED: ReadonlySet<Operator> = new Set([
	"Selected",
	"EqualTo",
	"GreaterThan",
	"GreaterThanOrEqual",
	"LessThan",
	"LessThanOrEqual",
	"NotEmpty",
]);
/** `op` true only of an answer: as Qualtrics has it, or with NotEmpty when it's true of none. */
const answered = (s: Subject, op: Operator, value?: string): Form =>
	FALSE_WHEN_SKIPPED.has(op)
		? atom(s, op, value)
		: and(atom(s, op, value), atom(s, "NotEmpty"));
/** `x op v` on a value (a number, text or field): its four forms. */
const compared = (s: Subject, op: Operator, value: string): Forms => ({
	t: answered(s, op, value),
	f: answered(s, NEGATION[op], value),
	n: or(atom(s, NEGATION[op], value), atom(s, "Empty")),
	p: or(atom(s, op, value), atom(s, "Empty")),
});
/** `x = c` on a choice question, given its other codes. */
const chosen = (
	s: Subject,
	code: string,
	others: readonly string[],
): Forms => ({
	t: atom(s, "Selected", code),
	f: ors(others.map((o) => atom(s, "Selected", o))),
	n: atom(s, "NotSelected", code),
	p: ands(others.map((o) => atom(s, "NotSelected", o))),
});
/** A select-all option `c` ticked: others may be ticked too, so answered is any ticked. */
const ticked = (s: Subject, code: string, others: readonly string[]): Forms => {
	const none = ands(others.map((o) => atom(s, "NotSelected", o)));
	return {
		t: atom(s, "Selected", code),
		f: ors(
			others.map((o) =>
				and(atom(s, "NotSelected", code), atom(s, "Selected", o)),
			),
		),
		n: atom(s, "NotSelected", code),
		p: or(atom(s, "Selected", code), none),
	};
};
/** Nothing answered: no choice selected, or the value empty. */
const blank = (s: Subject, codes?: readonly string[]): Forms => {
	const t =
		codes === undefined
			? atom(s, "Empty")
			: ands(codes.map((c) => atom(s, "NotSelected", c)));
	const f =
		codes === undefined
			? atom(s, "NotEmpty")
			: ors(codes.map((c) => atom(s, "Selected", c)));
	return { t, f, n: f, p: t };
};
/** `x = c` for a code `x` doesn't have: never true, and false once answered. */
const nowhere = (s: Subject, codes: readonly string[]): Forms => {
	const b = blank(s, codes);
	return { t: NEVER, f: b.f, n: ALWAYS, p: b.t };
};
/**
 * Over the asks that record one variable (exclusive branches: at most one is shown), for
 * a test that is null on a skipped ask, so an ask not shown leaves it to the one that is.
 */
const overAsks = (
	asks: readonly string[],
	row: number | undefined,
	one: (s: Subject) => Forms,
): Forms => {
	const each = asks.map((ask) =>
		one({ kind: "ask", ask, ...(row !== undefined && { row }) }),
	);
	return {
		t: ors(each.map((x) => x.t)),
		f: ors(each.map((x) => x.f)),
		n: ands(each.map((x) => x.n)),
		p: ands(each.map((x) => x.p)),
	};
};

/** `isnull` of a condition: neither true nor false. */
const unknown = (x: Forms): Forms => {
	const t = and(x.n, x.p);
	const f = or(x.t, x.f);
	return { t, f, n: f, p: t };
};
/** `isnull` of a variable several asks record: null only when every one is blank. */
const allBlank = (each: readonly Forms[]): Forms => {
	const t = ands(each.map((x) => x.t));
	const f = ors(each.map((x) => x.f));
	return { t, f, n: f, p: t };
};

const COMPARISON: Partial<Record<BinaryOp, Operator>> = {
	"=": "EqualTo",
	"<>": "NotEqualTo",
	">": "GreaterThan",
	">=": "GreaterThanOrEqual",
	"<": "LessThan",
	"<=": "LessThanOrEqual",
};
/** The comparison read the other way round: `5 < x` is `x > 5`. */
const FLIPPED: Partial<Record<BinaryOp, BinaryOp>> = {
	"=": "=",
	"<>": "<>",
	">": "<",
	">=": "<=",
	"<": ">",
	"<=": ">=",
};

/** A literal's text as Qualtrics compares it, and whether it's a number; undefined for anything else. */
const literal = (
	e: Expr,
): { readonly text: string; readonly number: boolean } | undefined =>
	e.kind === "string"
		? { text: e.value, number: false }
		: e.kind === "number"
			? { text: e.text, number: true }
			: undefined;

/**
 * Why a written value can't be compared with a value of this domain this way, or undefined.
 * The DDI is read, not trusted: a code is text, a number a number, and ordering text is
 * unmeasured in Qualtrics. An input with no domain is text.
 */
const mismatch = (
	domain: Domain | undefined,
	op: Operator,
	number: boolean,
): string | undefined => {
	const ordering = op !== "EqualTo" && op !== "NotEqualTo";
	if (domain?.kind === "choice")
		return number
			? "A code is compared with a code in quotes."
			: ordering
				? "A coded answer is compared by `=` and `<>` only."
				: undefined;
	if (domain?.kind === "number")
		return number ? undefined : "A number is compared with a number.";
	if (domain?.kind === "text" && number)
		return "Text is compared with text in quotes.";
	if (domain === undefined && number)
		return "An input with no type is compared as text, in quotes.";
	return ordering && !number
		? "Qualtrics' ordering of text isn't something the export relies on."
		: undefined;
};

export type Compiled =
	| { readonly kind: "ok"; readonly forms: Forms }
	| { readonly kind: "problem"; readonly message: string };

/**
 * What a computed name is in Qualtrics: a true-or-false value inlined where it's read (it
 * has no field), a field holding a number, or neither, and why.
 */
export type Computed =
	| { readonly kind: "inline"; readonly value: Cond }
	| { readonly kind: "field" }
	| { readonly kind: "refused"; readonly why: string };

/** A condition's four forms, or why Qualtrics can't say it. */
export function compileCondition(
	cond: Cond,
	computed: (variable: string) => Computed = () => ({ kind: "field" }),
): Compiled {
	// The first problem met is the one reported; the walk goes on with a placeholder.
	let problem: string | undefined;
	const fail = (why: string): Forms => {
		problem ??= why;
		return constant(null);
	};
	// The computed names being inlined, so one that reads itself is refused, not looped on.
	const inlining = new Set<string>();
	const inline = (variable: string, value: Cond): Forms => {
		if (inlining.has(variable))
			return fail(`\`${variable}\` is computed from itself.`);
		inlining.add(variable);
		const forms = go(value.expr, value.sources);
		inlining.delete(variable);
		return forms;
	};

	const go = (e: Expr, sources: Cond["sources"]): Forms => {
		switch (e.kind) {
			case "boolean":
				return constant(e.value);
			case "null":
				return constant(null);
			case "name": {
				const s = sources.get(e.name);
				if (s?.kind === "compute") {
					const c = computed(s.variable);
					return c.kind === "inline"
						? inline(s.variable, c.value)
						: fail(
								c.kind === "refused"
									? c.why
									: `\`${s.variable}\` is a number, not true or false.`,
							);
				}
				return fail(
					`\`${e.name}\` alone isn't a condition Qualtrics can test.`,
				);
			}
			case "unary":
				return e.op === "not"
					? negate(go(e.operand, sources))
					: fail(
							"Arithmetic in a condition isn't something Qualtrics can test.",
						);
			case "binary": {
				if (e.op === "and")
					return both(go(e.left, sources), go(e.right, sources));
				if (e.op === "or")
					return either(go(e.left, sources), go(e.right, sources));
				if (e.op === "xor") {
					const a = go(e.left, sources);
					const b = go(e.right, sources);
					return either(both(a, negate(b)), both(negate(a), b));
				}
				return comparison(e.op, e.left, e.right, sources);
			}
			case "member": {
				if (e.set.length === 0) return fail("A set to test holds values.");
				if (e.set.some((v) => literal(v) === undefined))
					return fail("A set Qualtrics can test holds written values only.");
				const any = e.set
					.map((v) => comparison("=", e.operand, v, sources))
					.reduce(either);
				return e.negated ? negate(any) : any;
			}
			case "call": {
				const [x, lo, hi] = e.args;
				if (e.fn === "isnull" && x !== undefined) {
					// A computed condition is inlined, so it has no field to be empty.
					const s = x.kind === "name" ? sources.get(x.name) : undefined;
					const c = s?.kind === "compute" ? computed(s.variable) : undefined;
					if (s?.kind === "compute" && c?.kind === "inline")
						return unknown(inline(s.variable, c.value));
					if (c?.kind === "refused") return fail(c.why);
					const subject = subjectOf(x, sources);
					if (subject === undefined)
						return fail("`isnull` here tests something Qualtrics can't.");
					return subject.kind === "field"
						? blank(subject.subject)
						: allBlank(
								subject.asks.map((ask) =>
									blank(
										{
											kind: "ask",
											ask,
											...(subject.row !== undefined && { row: subject.row }),
										},
										subject.codes,
									),
								),
							);
				}
				if (e.fn === "between" && x && lo && hi)
					return both(
						comparison(">=", x, lo, sources),
						comparison("<=", x, hi, sources),
					);
				return fail(`\`${e.fn}\` isn't something Qualtrics can test.`);
			}
			case "string":
			case "number":
				return fail("A value alone isn't a condition.");
			case "hole":
				return fail("A condition is still to be written.");
			default:
				return e satisfies never;
		}
	};

	/** `a op b` with a name on one side and a written value on the other. */
	const comparison = (
		op: BinaryOp,
		left: Expr,
		right: Expr,
		sources: Cond["sources"],
	): Forms => {
		const flipped = literal(left) !== undefined && literal(right) === undefined;
		const [name, value, how] = flipped
			? [right, literal(left), FLIPPED[op]]
			: [left, literal(right), op];
		const operator = how === undefined ? undefined : COMPARISON[how];
		const subject = subjectOf(name, sources);
		if (value === undefined || operator === undefined || subject === undefined)
			return fail(
				"Qualtrics compares an answer with a written value, nothing else.",
			);
		const wrong = mismatch(subject.domain, operator, value.number);
		if (wrong !== undefined) return fail(wrong);
		const written = value.text;
		if (subject.kind === "field") {
			if (
				!value.number ||
				(operator !== "EqualTo" && operator !== "NotEqualTo")
			)
				return compared(subject.subject, operator, written);
			const equal = both(
				compared(subject.subject, "GreaterThanOrEqual", written),
				compared(subject.subject, "LessThanOrEqual", written),
			);
			return operator === "EqualTo" ? equal : negate(equal);
		}
		if (subject.codes !== undefined) {
			// A choice: one of its codes, or a select-all option's tick.
			const option = subject.option;
			const codes = subject.codes;
			const forms = overAsks(subject.asks, subject.row, (s) => {
				if (option === undefined)
					return codes.includes(written)
						? chosen(
								s,
								written,
								codes.filter((c) => c !== written),
							)
						: nowhere(s, codes);
				const tick = ticked(
					s,
					option.code,
					codes.filter((c) => c !== option.code),
				);
				return written === option.ticked
					? tick
					: written === option.unticked
						? negate(tick)
						: nowhere(s, codes);
			});
			return operator === "EqualTo" ? forms : negate(forms);
		}
		return overAsks(subject.asks, subject.row, (s) =>
			compared(s, operator, written),
		);
	};

	const forms = go(cond.expr, cond.sources);
	return problem === undefined
		? { kind: "ok", forms }
		: { kind: "problem", message: problem };
}

const COMPUTED: Domain = { kind: "number", decimals: 0 };

type Subjects =
	| {
			readonly kind: "field";
			readonly subject: Subject;
			readonly domain?: Domain;
	  }
	| {
			readonly kind: "asks";
			readonly domain: Domain;
			readonly asks: readonly string[];
			readonly row?: number;
			/** A choice question's codes (an option's question's, for a select-all option). */
			readonly codes?: readonly string[];
			readonly option?: Extract<Source, { kind: "answer" }>["option"];
	  };

/** What a name tests in Qualtrics: the asks of an answer, or an embedded field. */
function subjectOf(e: Expr, sources: Cond["sources"]): Subjects | undefined {
	if (e.kind !== "name") return undefined;
	const s: Source | undefined = sources.get(e.name);
	if (s === undefined || s.kind === "row") return undefined;
	if (s.kind === "input" || s.kind === "compute")
		return {
			kind: "field",
			subject: { kind: "field", name: s.variable },
			// A computed value is a number: `$e{}` writes nothing else (a condition is inlined).
			...(s.kind === "compute"
				? { domain: COMPUTED }
				: s.domain !== undefined && { domain: s.domain }),
		};
	const domain: Domain = s.question.domain;
	return {
		kind: "asks",
		domain,
		asks: s.asks,
		...(s.row !== undefined && { row: s.row }),
		...(domain.kind === "choice" && {
			codes: domain.choices.map((c) => c.code),
		}),
		...(s.option !== undefined && { option: s.option }),
	};
}
