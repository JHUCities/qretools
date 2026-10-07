/**
 * What an instrument's flow says about itself, in QL's tradition: whether every name
 * is asked or computed before it's read, whether a question is asked twice on one path,
 * whether every branch can be taken, what a check reads, and whether fills fit. One
 * structured pass over the flow, as a compiler checks definite assignment: through an
 * `if`, a name is asked for certain only if every branch asks it, and possibly if any
 * does. Exclusive branches may each ask the same question.
 */
import { type Expr, namesOf } from "../cond/ast.ts";
import { evaluateCondition, UNKNOWN } from "../cond/eval.ts";
import { typeOf } from "../cond/type.ts";
import type { Finding, Range } from "../findings.ts";
import { type Named as BankNamed, definedVariables } from "../surface/draft.ts";
import type { TextEntry } from "../surface/env.ts";
import type {
	Cond,
	InstrumentDraft,
	Named,
	Node,
	Placeholder,
	QuestionRef,
	UniverseRef,
} from "./draft.ts";
import type { ParsedInstrument } from "./parse.ts";

/** What has been asked or computed on the way to a step: for certain, or on some path. */
interface Seen {
	readonly definite: ReadonlySet<string>;
	readonly possible: ReadonlySet<string>;
}

const NONE: Seen = { definite: new Set(), possible: new Set() };

const add = (s: Seen, keys: readonly string[]): Seen => ({
	definite: new Set([...s.definite, ...keys]),
	possible: new Set([...s.possible, ...keys]),
});

/** After branches: certain only where every branch is, possible where any is. */
const merge = (branches: readonly Seen[]): Seen => {
	const [first, ...rest] = branches;
	if (first === undefined) return NONE;
	return {
		definite: new Set(
			[...first.definite].filter((k) => rest.every((b) => b.definite.has(k))),
		),
		possible: new Set(branches.flatMap((b) => [...b.possible])),
	};
};

/** A question asked, as a key: asking it again on one path needs `as:`. */
const askedKey = (q: QuestionRef): string => `ask:${q.alias}.${q.name}`;

/** The variables an ask records, as names in conditions read them. */
const recorded = (q: QuestionRef): readonly string[] =>
	definedVariables(q.evaluation.draft).map((d) => `${q.alias}.${d.name}`);

export function checkInstrument(parsed: ParsedInstrument): readonly Finding[] {
	const { draft, names } = parsed;
	const findings: Finding[] = [];
	const say = (f: Finding) => findings.push(f);

	/** A value read here: what it means must be asked or computed by now. */
	const read = (cond: Cond | undefined, path: string, seen: Seen) => {
		if (cond === undefined) return;
		const guarded = isnullArgs(cond.expr);
		for (const { name, range } of namesOf(cond.expr))
			readName(name, range, path, seen, guarded.has(name));
	};
	const readName = (
		name: string,
		range: Range | undefined,
		path: string,
		seen: Seen,
		guarded: boolean,
	) => {
		const named = names.get(name);
		if (named === undefined || named.kind === "input") return;
		const key = keyOf(named, name);
		const what = named.kind === "compute" ? "computed" : "asked";
		if (!seen.possible.has(key))
			say({
				code: "order",
				severity: "error",
				path,
				message: `\`${name}\` is read here before it's ${what}.`,
				hint:
					named.kind === "compute"
						? "Compute it earlier in the flow."
						: "Ask it earlier, on every path that reaches here.",
				...(range !== undefined && { range }),
			});
		else if (!seen.definite.has(key) && !guarded)
			say({
				code: "order",
				severity: "info",
				path,
				message: `\`${name}\` may not be ${what} on every path here.`,
				hint: `Where it isn't, it reads as null, so the condition isn't true. Say what then with \`isnull(${name})\`.`,
				...(range !== undefined && { range }),
			});
	};
	/** `{{name}}` placeholders in a statement read their names too, each at its place. */
	const readPlaceholders = (
		reads: readonly Placeholder[],
		path: string,
		seen: Seen,
	) => {
		for (const p of reads) readName(p.name, p.range, path, seen, false);
	};

	/** A condition that comes out the same whatever is answered: a branch that's never, or always, taken. */
	const constant = (cond: Cond | undefined): boolean | undefined => {
		if (cond === undefined) return undefined;
		const v = evaluateCondition(cond.expr, () => UNKNOWN);
		return typeof v === "boolean" ? v : undefined;
	};

	/** Steps in order; after a `stop` that can stop, what follows is reached by only some. */
	const flow = (
		nodes: readonly Node[],
		seen: Seen,
		conditional: boolean,
	): Seen => {
		let at = seen;
		let some = conditional;
		for (const n of nodes) {
			at = step(n, at, some);
			if (n.kind === "stop" && constant(n.cond) !== false) some = true;
		}
		return at;
	};

	const step = (node: Node, seen: Seen, conditional: boolean): Seen => {
		switch (node.kind) {
			case "ask": {
				const q = node.question;
				for (const fill of node.fills) read(fill.source, fill.path, seen);
				// Unresolved, it still records its `as`: the hole already says what's wrong.
				if (q === undefined)
					return node.as === undefined ? seen : add(seen, [node.as]);
				const key = askedKey(q);
				if (node.as !== undefined && seen.possible.has(node.as))
					say({
						code: "name-clash",
						severity: "error",
						path: `${node.path}.as`,
						message: `\`${node.as}\` is already recorded on ${seen.definite.has(node.as) ? "this" : "a"} path here.`,
						hint: "Asked again on one path, the answer needs a name of its own.",
					});
				if (node.as === undefined && seen.possible.has(key))
					say({
						code: "name-clash",
						severity: "error",
						path: `${node.path}.ask`,
						message: `\`${q.alias}.${q.name}\` is already asked on ${seen.definite.has(key) ? "this" : "a"} path here, so its answer would be recorded twice.`,
						hint: "To ask it again, give the second answer its own name with `as:`.",
					});
				universe(node, conditional);
				fillTypes(node);
				const after = add(
					seen,
					node.as === undefined ? [key, ...recorded(q)] : [node.as],
				);
				// A check reads the answer just given, and what came before.
				for (const check of node.checks) {
					read(check.ensure, `${check.path}.ensure`, after);
					readPlaceholders(check.messageReads, `${check.path}.message`, after);
				}
				return after;
			}
			case "say":
				readPlaceholders(node.reads, `${node.path}.say`, seen);
				return seen;
			case "section":
				return flow(node.flow, seen, conditional);
			case "if": {
				const ends: Seen[] = [];
				let decided = false;
				for (const branch of node.branches) {
					read(branch.cond, `${branch.path}.if`, seen);
					const value = constant(branch.cond);
					if (decided || value === false)
						say({
							code: "unreachable",
							severity: "warning",
							path: `${branch.path}.if`,
							message: decided
								? "An earlier condition is always true, so this branch is never taken."
								: "This condition is never true, so its branch is never taken.",
						});
					ends.push(flow(branch.then, seen, true));
					if (value === true) decided = true;
				}
				if (node.else !== undefined) {
					if (decided)
						say({
							code: "unreachable",
							severity: "warning",
							path: `${node.path}.else`,
							message:
								"A condition above is always true, so `else` is never taken.",
						});
					ends.push(flow(node.else, seen, true));
				} else ends.push(seen);
				return merge(ends);
			}
			case "stop":
				read(node.cond, `${node.path}.stop`, seen);
				readPlaceholders(node.sayReads, `${node.path}.say`, seen);
				if (constant(node.cond) === true)
					say({
						code: "unreachable",
						severity: "warning",
						path: `${node.path}.stop`,
						message:
							"This condition is always true, so nothing after it is ever asked.",
					});
				return seen;
			case "compute":
				read(node.value, `${node.path}.value`, seen);
				return node.name === undefined ? seen : add(seen, [node.name]);
			case "hole":
				return seen;
			default:
				return node satisfies never;
		}
	};

	/**
	 * Whom a question is asked of, against the path that reaches it: advice, not rules.
	 * Its universe is the ask's, else its bank question's, else the instrument's.
	 */
	const universe = (
		node: Extract<Node, { kind: "ask" }>,
		conditional: boolean,
	) => {
		const q = node.question;
		const bank = q?.evaluation.draft.universe;
		const effective =
			(node.universe === undefined ? undefined : askUniverse(node.universe)) ??
			(bank === undefined || q === undefined
				? undefined
				: bankUniverse(q.alias, bank)) ??
			(draft.universe === undefined ? undefined : askUniverse(draft.universe));
		const everyone =
			draft.universe === undefined ? undefined : askUniverse(draft.universe);
		const at = `${node.path}.ask`;
		if (
			!conditional &&
			effective !== undefined &&
			effective.key !== everyone?.key
		)
			say({
				code: "universe",
				severity: "info",
				path: at,
				message: `Everyone is asked this, but its universe is ${effective.said}.`,
				hint: "Ask it under the condition that picks out its universe, or widen the universe.",
			});
		if (
			conditional &&
			(effective === undefined || effective.key === everyone?.key)
		)
			say({
				code: "universe",
				severity: "info",
				path: at,
				message:
					"Only some respondents reach this question, but its universe says everyone.",
				hint: "Say whom it's asked of with `universe:`.",
			});
	};

	/** A number fill needs a number; a text fill takes anything, a code shown as its label. */
	const fillTypes = (node: Extract<Node, { kind: "ask" }>) => {
		const declared = node.question?.evaluation.draft.fills ?? [];
		for (const fill of node.fills) {
			const want = declared.find((f) => f.name === fill.name)?.type;
			if (want !== "number" || fill.source === undefined) continue;
			const { type } = typeOf(fill.source.expr, (n) => names.get(n)?.type);
			if (type.kind !== "number" && type.kind !== "unknown")
				say({
					code: "type",
					severity: "error",
					path: fill.path,
					message: `\`${fill.name}\` is a number fill, so it needs a number to fill it.`,
					range: fill.source.expr.range,
				});
		}
	};

	flow(draft.flow, NONE, false);
	variableNames(draft, say);
	return findings;
}

/** The key a name is asked or computed under. */
const keyOf = (named: Named, name: string): string =>
	named.kind === "bank" ? `${named.alias}.${named.variable}` : name;

/** Names read inside `isnull(...)`: reading them where they may be unanswered is the point. */
function isnullArgs(e: Expr): ReadonlySet<string> {
	const out = new Set<string>();
	const walk = (x: Expr, inside: boolean): void => {
		if (x.kind === "name") {
			if (inside) out.add(x.name);
		} else if (x.kind === "unary") walk(x.operand, inside);
		else if (x.kind === "binary") {
			walk(x.left, inside);
			walk(x.right, inside);
		} else if (x.kind === "member") {
			walk(x.operand, inside);
			for (const s of x.set) walk(s, inside);
		} else if (x.kind === "call")
			for (const a of x.args) walk(a, inside || x.fn === "isnull");
	};
	walk(e, false);
	return out;
}

/** A universe as a key to compare and words to say: a shared one by name, prose by its text. */
interface UniverseKey {
	readonly key: string;
	readonly said: string;
}
const askUniverse = (u: UniverseRef): UniverseKey =>
	u.kind === "ref"
		? { key: `${u.alias}.${u.name}`, said: `\`${u.alias}.${u.name}\`` }
		: { key: `text:${u.text}`, said: `"${u.text}"` };
const bankUniverse = (alias: string, u: BankNamed<TextEntry>): UniverseKey =>
	u.kind === "ref"
		? { key: `${alias}.${u.name}`, said: `\`${alias}.${u.name}\`` }
		: { key: `text:${u.text}`, said: `"${u.text}"` };

/**
 * Every variable the instrument records has its own name in the export: two banks'
 * questions recording one name, or an `as` reusing one, would be two columns of one name.
 */
function variableNames(
	draft: InstrumentDraft,
	say: (f: Finding) => void,
): void {
	const owner = new Map<string, string>();
	const claim = (name: string, by: string, path: string) => {
		const earlier = owner.get(name);
		if (earlier === undefined) owner.set(name, by);
		else if (earlier !== by)
			say({
				code: "name-clash",
				severity: "error",
				path,
				message: `The variable \`${name}\` would be recorded by ${earlier} and by ${by}.`,
				hint: "Ask one of them under another name with `as:`.",
			});
	};
	for (const input of draft.inputs)
		claim(input.name, `the input \`${input.name}\``, input.path);
	const walk = (nodes: readonly Node[]): void => {
		for (const node of nodes)
			switch (node.kind) {
				case "ask": {
					const q = node.question;
					if (q === undefined) break;
					const by = `\`${q.alias}.${q.name}\``;
					if (node.as !== undefined)
						claim(node.as, `${by} asked again`, `${node.path}.as`);
					else
						for (const d of definedVariables(q.evaluation.draft))
							claim(d.name, by, `${node.path}.ask`);
					break;
				}
				case "section":
					walk(node.flow);
					break;
				case "if":
					for (const b of node.branches) walk(b.then);
					if (node.else !== undefined) walk(node.else);
					break;
				case "compute":
					// Computed values aren't recorded in v1.
					break;
			}
	};
	walk(draft.flow);
}
