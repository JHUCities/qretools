/**
 * Where an instrument names something defined elsewhere, by the place in the source
 * where the name is written: a bank's file (an `ask:`'s question, a `universe:`, an
 * input's shared scale, a bank answer a condition reads), or a name the instrument
 * declares itself (an input, a compute, an `as`, a roster's row number) that a
 * condition or `{{placeholder}}` reads. What go to definition follows, and what the
 * editor marks. Pure.
 */

import { BINARY_SCALE } from "../binary.ts";
import { type Expr, namesOf } from "../cond/ast.ts";
import { NAME_KIND } from "../copy.ts";
import type { Range } from "../findings.ts";
import { schemePath } from "../kinds.ts";
import type { Cond, Named, Node, Placeholder } from "./draft.ts";
import type { ParsedInstrument } from "./parse.ts";

export type InstrumentRef =
	| {
			readonly kind: "bank";
			/** Where the name is written: the value alone, not its key. */
			readonly range: Range;
			/** The bank, by the alias `uses` gives it. */
			readonly alias: string;
			/** The file it names, by its path in that bank. */
			readonly path: string;
	  }
	| {
			/** A name this instrument declares, read where it's written. */
			readonly kind: "here";
			readonly range: Range;
			readonly name: string;
			/** Where it's declared: its name there, in this source. */
			readonly declared: Range;
			/** What it is, in words: what the hover says. */
			readonly about: string;
			/** A code of an input's own list, not a name: drawn as a code. */
			readonly code?: true;
	  }
	| {
			/**
			 * A code a condition compares a bank answer with (`= "4"`, `in {"4", "5"}`), read
			 * where it's written, quotes and all: followed to where its list says it. Not a
			 * use of that file: the condition names the question, not its scale.
			 */
			readonly kind: "code";
			readonly range: Range;
			readonly alias: string;
			/** The file whose list holds it, by its path in that bank. */
			readonly path: string;
			/** Its place in that file (`labels.4`, `responses.4`). */
			readonly at: string;
			/** Its label and its list, in words: what the hover says. */
			readonly about: string;
	  };

/** The value of `key: value` at `path`: its own range, from where it starts to its end. */
function valueAt(
	parsed: ParsedInstrument,
	source: string,
	path: string,
): Range | undefined {
	const range = parsed.ranges[path];
	if (range === undefined) return undefined;
	const [from, to] = range;
	const colon = source.indexOf(":", from);
	if (colon === -1 || colon >= to) return undefined;
	const written = source.slice(colon + 1, to);
	const start = colon + 1 + (written.length - written.trimStart().length);
	return start < to ? [start, to] : undefined;
}

/** Every step of a flow, at any depth. */
function* steps(flow: readonly Node[]): Generator<Node> {
	for (const node of flow) {
		yield node;
		if (
			node.kind === "section" ||
			node.kind === "roster" ||
			node.kind === "each"
		)
			yield* steps(node.flow);
		else if (node.kind === "if") {
			for (const b of node.branches) yield* steps(b.then);
			if (node.else !== undefined) yield* steps(node.else);
		}
	}
}

/** What a name the instrument declares is, as its hover says it. */
function aboutOf(named: Named): string | undefined {
	switch (named.kind) {
		case "input": {
			const { description } = named.input;
			return `From outside${description === undefined ? "." : `: ${description}`}`;
		}
		case "compute":
			return `${capitalised(NAME_KIND.compute)} in this instrument.`;
		case "as":
			return named.question === undefined
				? `${capitalised(NAME_KIND.as)}.`
				: `${capitalised(NAME_KIND.as)}: \`${named.question.alias}.${named.question.name}\`.`;
		case "index":
			return `The ${NAME_KIND.index} of \`${named.roster}\`.`;
		case "bank":
			return undefined;
	}
}

const capitalised = (s: string): string =>
	s.slice(0, 1).toUpperCase() + s.slice(1);

/** The conditions a step reads: each `if`, `stop`, value, count, `ensure` and fill. */
function* condsOf(node: Node): Generator<Cond> {
	switch (node.kind) {
		case "if":
			for (const b of node.branches) if (b.cond !== undefined) yield b.cond;
			return;
		case "stop":
			if (node.cond !== undefined) yield node.cond;
			return;
		case "compute":
			if (node.value !== undefined) yield node.value;
			return;
		case "roster":
			if (node.end?.kind === "count" && node.end.value !== undefined)
				yield node.end.value;
			if (node.end?.kind === "more" && node.end.cond !== undefined)
				yield node.end.cond;
			return;
		case "ask":
			for (const c of node.checks) if (c.ensure !== undefined) yield c.ensure;
			for (const f of node.fills) if (f.source !== undefined) yield f.source;
			return;
		default:
			return;
	}
}

/**
 * Where a condition compares a name with a code: `name = "x"` or `name <> "x"` (either
 * way round), and each code in `name in {…}`. The string keeps its source range.
 */
function* codesIn(e: Expr): Generator<{
	readonly name: string;
	readonly code: Expr & { kind: "string" };
}> {
	switch (e.kind) {
		case "binary":
			if (e.op === "=" || e.op === "<>") {
				if (e.left.kind === "name" && e.right.kind === "string")
					yield { name: e.left.name, code: e.right };
				else if (e.right.kind === "name" && e.left.kind === "string")
					yield { name: e.right.name, code: e.left };
			}
			yield* codesIn(e.left);
			yield* codesIn(e.right);
			return;
		case "member":
			if (e.operand.kind === "name")
				for (const x of e.set)
					if (x.kind === "string") yield { name: e.operand.name, code: x };
			return;
		case "unary":
			yield* codesIn(e.operand);
			return;
		case "call":
			for (const a of e.args) yield* codesIn(a);
			return;
		default:
			return;
	}
}

/** The `{{placeholders}}` a step says. */
function placeholdersOf(node: Node): readonly Placeholder[] {
	switch (node.kind) {
		case "say":
			return node.reads;
		case "stop":
			return node.sayReads;
		case "ask":
			return node.checks.flatMap((c) => c.messageReads);
		default:
			return [];
	}
}

/** Every place the instrument names something defined elsewhere, in document order. */
export function instrumentRefs(
	parsed: ParsedInstrument,
	source: string,
): readonly InstrumentRef[] {
	const refs: InstrumentRef[] = [];
	const add = (
		path: string,
		named: { readonly alias: string; readonly path: string } | undefined,
	) => {
		const range =
			named === undefined ? undefined : valueAt(parsed, source, path);
		if (named !== undefined && range !== undefined)
			refs.push({ kind: "bank", range, alias: named.alias, path: named.path });
	};
	const flow = [...steps(parsed.draft.flow)];
	// Where a name is declared: the name itself, so the caret lands on it.
	const declaredAt = (named: Named): Range | undefined => {
		switch (named.kind) {
			case "input": {
				// An input is declared by its key under `inputs:`.
				const at = parsed.ranges[named.input.path];
				return at === undefined
					? undefined
					: [at[0], at[0] + named.input.name.length];
			}
			case "compute":
				return valueAt(parsed, source, `${named.path}.compute`);
			case "as":
				return valueAt(parsed, source, `${named.path}.as`);
			case "index": {
				const roster = flow.find(
					(n) => n.kind === "roster" && n.name === named.roster,
				);
				return roster === undefined
					? undefined
					: valueAt(parsed, source, `${roster.path}.roster`);
			}
			case "bank":
				return undefined;
		}
	};
	// A name read where it's written: a bank's answer (its question), or the instrument's own.
	const read = (name: string, range: Range) => {
		const named = parsed.names.get(name);
		if (named === undefined) return;
		if (named.kind === "bank") {
			refs.push({
				kind: "bank",
				range,
				alias: named.question.alias,
				path: named.question.path,
			});
			return;
		}
		const declared = declaredAt(named);
		const about = aboutOf(named);
		if (declared !== undefined && about !== undefined)
			refs.push({ kind: "here", range, name, declared, about });
	};
	// A code compared with a name: followed to the list it's on, its label in the hover.
	const code = (name: string, written: Expr & { kind: "string" }) => {
		const named = parsed.names.get(name);
		const value = written.value;
		if (named === undefined || named.type.kind !== "code") return;
		const known = named.type.codes.find((c) => c.code === value);
		if (known === undefined) return;
		const label = `\`${known.label}\``;
		if (named.kind === "input") {
			const domain = named.input.domain;
			if (domain?.kind !== "responses") return;
			const shared = domain.scale;
			const dot = shared?.indexOf(".") ?? -1;
			if (shared !== undefined && dot > 0) {
				const scale = shared.slice(dot + 1);
				refs.push({
					kind: "code",
					range: written.range,
					alias: shared.slice(0, dot),
					path: schemePath("scale", scale),
					at: `labels.${value}`,
					about: `${label}, on the shared scale \`${scale}\`.`,
				});
				return;
			}
			const declared = parsed.ranges[`${named.input.path}.responses.${value}`];
			if (declared !== undefined)
				refs.push({
					kind: "here",
					range: written.range,
					name,
					declared,
					about: `${label}, one of \`${named.input.name}\`'s codes.`,
					code: true,
				});
			return;
		}
		if (named.kind !== "bank") return;
		const { alias, question } = named;
		const missing = parsed.banks[alias]?.env.missing ?? [];
		const domain = question.evaluation.draft.domain;
		const on = (path: string, at: string, about: string) =>
			refs.push({ kind: "code", range: written.range, alias, path, at, about });
		if (missing.some((c) => c.code === value))
			on("missing.yaml", `labels.${value}`, `${label}, a missing value.`);
		// A select-all option's variable is coded on the binary scale, not its list.
		else if (domain?.kind === "responses" && domain.select === "many")
			on(
				schemePath("scale", BINARY_SCALE),
				`labels.${value}`,
				`${label}, on the shared scale \`${BINARY_SCALE}\`.`,
			);
		else if (domain?.kind === "responses" && domain.scale !== undefined)
			on(
				schemePath("scale", domain.scale),
				`labels.${value}`,
				`${label}, on the shared scale \`${domain.scale}\`.`,
			);
		else
			on(
				question.path,
				`responses.${value}`,
				`${label}, in \`${question.name}\`'s own list.`,
			);
	};
	const universe = parsed.draft.universe;
	if (universe?.kind === "ref")
		add("universe", {
			alias: universe.alias,
			path: schemePath("universe", universe.name),
		});
	// An input's shared scale, as `responses: alias.scale` names it.
	for (const input of parsed.draft.inputs) {
		const scale =
			input.domain?.kind === "responses" ? input.domain.scale : undefined;
		const dot = scale?.indexOf(".") ?? -1;
		if (scale !== undefined && dot > 0)
			add(`${input.path}.responses`, {
				alias: scale.slice(0, dot),
				path: schemePath("scale", scale.slice(dot + 1)),
			});
	}
	for (const node of flow) {
		for (const cond of condsOf(node)) {
			for (const n of namesOf(cond.expr)) read(n.name, n.range);
			for (const c of codesIn(cond.expr)) code(c.name, c.code);
		}
		// A placeholder's range holds its braces: the name is what's followed.
		for (const p of placeholdersOf(node)) {
			const written = source.slice(p.range[0], p.range[1]);
			const at = /[A-Za-z][A-Za-z0-9_.]*/.exec(written);
			if (at !== null)
				read(p.name, [
					p.range[0] + at.index,
					p.range[0] + at.index + at[0].length,
				]);
		}
		if (node.kind !== "ask") continue;
		add(`${node.path}.ask`, node.question);
		if (node.universe?.kind === "ref")
			add(`${node.path}.universe`, {
				alias: node.universe.alias,
				path: schemePath("universe", node.universe.name),
			});
	}
	return refs.sort((a, b) => a.range[0] - b.range[0]);
}

/** The bank file, own name or code named at `offset`, if one is written there. */
export const instrumentRefAt = (
	refs: readonly InstrumentRef[],
	offset: number,
): InstrumentRef | undefined =>
	refs.find((r) => r.range[0] <= offset && offset <= r.range[1]);
