/**
 * Reading an instrument: its header, the banks it uses, its inputs and its flow, with
 * every name resolved against the banks it is given and every condition parsed and
 * typed. Total, like the question parser: a draft with holes and findings, never an
 * exception. What depends on the order of the flow (asked before it's read, asked
 * twice, reachable) is the checks' business, not this parse's.
 */
import {
	type Document,
	isMap,
	isScalar,
	isSeq,
	parseDocument,
	type Scalar,
	type YAMLMap,
	type Node as YamlNode,
} from "yaml";
import { BINARY } from "../binary.ts";
import { holesOf, moveRanges, namesOf, type Problem } from "../cond/ast.ts";
import { KEYWORDS } from "../cond/lex.ts";
import { parseCondition } from "../cond/parse.ts";
import { type Type, typeCondition, typeOf } from "../cond/type.ts";
import type { Bank } from "../evaluate.ts";
import type { Finding, Range } from "../findings.ts";
import { readCodeMap } from "../surface/codes.ts";
import { type Code, definedVariables } from "../surface/draft.ts";
import { EMPTY_ENV } from "../surface/env.ts";
import { readNumber, readOpen } from "../surface/parse.ts";
import { clampRange, yamlErrors } from "../surface/read.ts";
import { NAME_PATTERN } from "../surface/schema.ts";
import type {
	Check,
	Cond,
	FillBinding,
	Input,
	InstrumentDraft,
	Named,
	Node,
	Order,
	QuestionRef,
	Severity,
	UniverseRef,
	Use,
	ValueDomain,
} from "./draft.ts";
import { SEVERITIES } from "./draft.ts";
import { scalarMap } from "./scalar.ts";

export interface ParsedInstrument {
	readonly draft: InstrumentDraft;
	readonly findings: readonly Finding[];
	/** Every path's range in the source, list items included (`flow.2.then.0`). */
	readonly ranges: Readonly<Record<string, Range>>;
	/** Every name the instrument's conditions and fills may read, resolved. */
	readonly scope: ReadonlyMap<string, Named>;
}

const TOP = [
	"name",
	"title",
	"description",
	"universe",
	"uses",
	"inputs",
	"flow",
];
const CONSTRUCTS = [
	"ask",
	"say",
	"section",
	"if",
	"stop",
	"compute",
	"roster",
	"each",
] as const;
/** What each construct may carry besides its own key. */
const FIELDS: Readonly<Record<string, readonly string[]>> = {
	ask: ["as", "universe", "options", "seconds", "fill", "checks"],
	say: [],
	section: ["flow", "order"],
	if: ["then", "else"],
	stop: ["say"],
	compute: ["value"],
	roster: ["count", "more", "flow"],
	each: ["flow"],
};
const ORDERS: readonly Order[] = ["random", "rotate"];

/**
 * An instrument read against the banks it uses, each given by its alias (`bas`), already
 * evaluated (`bankOf`). Fetching them is the caller's: the core is given values.
 */
export function parseInstrument(
	source: string,
	banks: Readonly<Record<string, Bank>>,
): ParsedInstrument {
	const doc = parseDocument(source, { prettyErrors: false });
	const ranges = indexInstrument(doc, source.length);
	const findings: Finding[] = [...yamlErrors(doc.errors, source.length)];
	const empty: InstrumentDraft = { uses: [], inputs: [], flow: [] };
	const top = doc.contents;
	if (!isMap(top)) {
		findings.push(
			problem(
				"not-a-map",
				"error",
				"",
				"An instrument is a list of `field: value` lines.",
				`Fields: ${TOP.join(", ")}.`,
			),
		);
		return { draft: empty, findings, ranges, scope: new Map() };
	}
	const say = (f: Finding) => findings.push(f);
	for (const key of keysOf(top))
		if (!TOP.includes(key))
			say(
				problem(
					"unknown-key",
					"error",
					key,
					`\`${key}\` isn't an instrument field.`,
					`Fields: ${TOP.join(", ")}.`,
				),
			);

	const text = (node: unknown, path: string, required: boolean) =>
		readText(node, path, required, say);
	const name = text(top.get("name", true), "name", true);
	if (name !== undefined && !NAME_PATTERN.test(name))
		say(
			problem(
				"wrong-type",
				"error",
				"name",
				`\`${name}\` isn't a valid name.`,
				"Lowercase letters, digits and underscores, starting with a letter.",
			),
		);
	const title = text(top.get("title", true), "title", false);
	const description = text(top.get("description", true), "description", false);

	const uses = readUses(top.get("uses", true), banks, say);
	// Only the banks `uses` names are in reach, whatever else was given.
	const available: Readonly<Record<string, Bank>> = Object.fromEntries(
		uses.flatMap((u) => {
			const bank = banks[u.alias];
			return bank === undefined ? [] : [[u.alias, bank]];
		}),
	);
	const inputs = readInputs(doc, top.get("inputs", true), available, say);

	// Names first, then the flow: what a name means doesn't depend on where it's written.
	const scope = new Map<string, Named>();
	const declare = (name: string, named: Named, path: string) => {
		if (KEYWORDS.has(name))
			return say(
				problem(
					"name-clash",
					"error",
					path,
					`\`${name}\` is a word conditions use, so it can't be a name.`,
				),
			);
		if (scope.has(name) || uses.some((u) => u.alias === name))
			return say(
				problem(
					"name-clash",
					"error",
					path,
					`\`${name}\` already names something in this instrument.`,
					"Give each input, computed value and answer asked again its own name.",
				),
			);
		scope.set(name, named);
	};
	for (const input of inputs)
		declare(
			input.name,
			{ kind: "input", input, type: typeOfDomain(input.domain) },
			input.path,
		);

	const ctx: Context = {
		source,
		doc,
		banks: available,
		uses,
		scope,
		say,
		declare,
		pending: [],
		computes: [],
	};
	const universe = readUniverse(top.get("universe", true), "universe", ctx);
	const flowNode = top.get("flow", true);
	const flow =
		flowNode === undefined
			? nothing<Node>(
					say,
					problem(
						"hole",
						"hole",
						"flow",
						"`flow` is required: the steps the instrument takes.",
					),
				)
			: readFlow(flowNode, "flow", ctx, true);

	// Conditions are typed once every name is declared, computes first.
	typeComputes(ctx);
	for (const typeIt of ctx.pending) typeIt();

	const draft: InstrumentDraft = {
		...(name !== undefined && { name }),
		...(title !== undefined && { title }),
		...(description !== undefined && { description }),
		...(universe !== undefined && { universe }),
		uses,
		inputs,
		flow,
	};
	return { draft, findings, ranges, scope };
}

interface Context {
	readonly source: string;
	readonly doc: Document;
	readonly banks: Readonly<Record<string, Bank>>;
	readonly uses: readonly Use[];
	readonly scope: Map<string, Named>;
	readonly say: (f: Finding) => void;
	readonly declare: (name: string, named: Named, path: string) => void;
	/** Typing to do once every name is known. */
	readonly pending: (() => void)[];
	/** Computes' typing, run first, in the order they read each other. */
	readonly computes: {
		readonly name: string;
		readonly path: string;
		readonly reads: readonly string[];
		readonly typeIt: () => void;
	}[];
}

function problem(
	code: Finding["code"],
	severity: Finding["severity"],
	path: string,
	message: string,
	hint?: string,
	range?: Range,
): Finding {
	return {
		code,
		severity,
		path,
		message,
		...(hint !== undefined && { hint }),
		...(range !== undefined && { range }),
	};
}

/** Say `f`, and stand for nothing: a hole in a list. */
const nothing = <T>(say: (f: Finding) => void, f: Finding): readonly T[] => {
	say(f);
	return [];
};

const keysOf = (map: YAMLMap): string[] =>
	map.items.flatMap((p) => (isScalar(p.key) ? [String(p.key.value)] : []));

/** One line of text: absent, a hole when written empty (or required), else the text. */
function readText(
	node: unknown,
	path: string,
	required: boolean,
	say: (f: Finding) => void,
): string | undefined {
	if (node === undefined) {
		if (required)
			say(
				problem(
					"hole",
					"hole",
					path,
					`\`${path.split(".").at(-1)}\` is required.`,
				),
			);
		return undefined;
	}
	const value = isScalar(node) ? node.value : undefined;
	if (value === null || value === "" || value === undefined) {
		if (isScalar(node) || node === null) {
			say(
				problem(
					"hole",
					"hole",
					path,
					`\`${path.split(".").at(-1)}\` is empty.`,
				),
			);
			return undefined;
		}
		say(
			problem(
				"wrong-type",
				"error",
				path,
				`\`${path.split(".").at(-1)}\` must be text.`,
			),
		);
		return undefined;
	}
	return String(value);
}

function readUses(
	node: unknown,
	banks: Readonly<Record<string, Bank>>,
	say: (f: Finding) => void,
): readonly Use[] {
	if (node === undefined) return [];
	if (!isMap(node)) {
		say(
			problem(
				"wrong-type",
				"error",
				"uses",
				"`uses` names each bank: `alias: address`.",
			),
		);
		return [];
	}
	const uses: Use[] = [];
	for (const pair of node.items) {
		if (!isScalar(pair.key)) continue;
		const alias = String(pair.key.value);
		const path = `uses.${alias}`;
		if (!NAME_PATTERN.test(alias) || KEYWORDS.has(alias)) {
			say(
				problem(
					"wrong-type",
					"error",
					path,
					`\`${alias}\` isn't a valid alias.`,
					"Lowercase letters, digits and underscores, starting with a letter.",
				),
			);
			continue;
		}
		const address =
			isScalar(pair.value) && typeof pair.value.value === "string"
				? pair.value.value
				: undefined;
		if (address === undefined)
			say(
				problem(
					"hole",
					"hole",
					path,
					`Where is \`${alias}\`? Give the bank's address.`,
					"A repository and version, such as `owner/bank@v1`, or a folder beside this instrument.",
				),
			);
		else if (banks[alias] === undefined)
			say(
				problem(
					"unknown-bank",
					"error",
					path,
					`No bank was given for \`${alias}\`.`,
					address === undefined ? undefined : `It names ${address}.`,
				),
			);
		uses.push({ alias, ...(address !== undefined && { address }) });
	}
	return uses;
}

function readInputs(
	doc: Document,
	node: unknown,
	banks: Readonly<Record<string, Bank>>,
	say: (f: Finding) => void,
): readonly Input[] {
	if (node === undefined) return [];
	if (!isMap(node)) {
		say(
			problem(
				"wrong-type",
				"error",
				"inputs",
				"`inputs` names each value from outside, with its type.",
			),
		);
		return [];
	}
	const inputs: Input[] = [];
	for (const pair of node.items) {
		if (!isScalar(pair.key)) continue;
		const name = String(pair.key.value);
		const path = `inputs.${name}`;
		if (!NAME_PATTERN.test(name)) {
			say(
				problem(
					"wrong-type",
					"error",
					path,
					`\`${name}\` isn't a valid name.`,
					"Lowercase letters, digits and underscores, starting with a letter.",
				),
			);
			continue;
		}
		const value = pair.value;
		if (!isMap(value)) {
			say(
				problem(
					"hole",
					"hole",
					path,
					`Input \`${name}\` has no type.`,
					"Give it `responses`, `number` or `open`, as a question has.",
				),
			);
			inputs.push({ name, path });
			continue;
		}
		const description = readText(
			value.get("description", true),
			`${path}.description`,
			false,
			say,
		);
		const kinds = keysOf(value).filter(
			(k) => k === "responses" || k === "number" || k === "open",
		);
		for (const k of keysOf(value))
			if (!["responses", "number", "open", "description"].includes(k))
				say(
					problem(
						"unknown-key",
						"error",
						`${path}.${k}`,
						`\`${k}\` isn't a field of an input.`,
						"An input has `responses`, `number` or `open`, and `description`.",
					),
				);
		if (kinds.length === 0)
			say(
				problem(
					"hole",
					"hole",
					path,
					`Input \`${name}\` has no type.`,
					"Give it `responses`, `number` or `open`, as a question has.",
				),
			);
		if (kinds.length > 1)
			say(
				problem(
					"too-many-domains",
					"error",
					`${path}.${kinds[1]}`,
					`Input \`${name}\` has more than one type.`,
				),
			);
		const domain =
			kinds[0] === undefined
				? undefined
				: readDomain(
						doc,
						value.get(kinds[0], true),
						kinds[0],
						`${path}.${kinds[0]}`,
						banks,
						say,
					);
		inputs.push({
			name,
			path,
			...(domain !== undefined && { domain }),
			...(description !== undefined && { description }),
		});
	}
	return inputs;
}

/** An input's type, in the question language's syntax: codes, a shared scale, a number or text. */
function readDomain(
	doc: Document,
	node: unknown,
	kind: string,
	path: string,
	banks: Readonly<Record<string, Bank>>,
	say: (f: Finding) => void,
): ValueDomain | undefined {
	if (kind === "responses") {
		if (isScalar(node) && typeof node.value === "string") {
			const [alias, scale] = node.value.split(".");
			const found =
				alias !== undefined && scale !== undefined
					? banks[alias]?.env.scales[scale]
					: undefined;
			if (found === undefined) {
				say(
					problem(
						"unknown-name",
						"hole",
						path,
						`\`${node.value}\` names no shared scale.`,
						"Name a bank's scale with its alias, such as `bas.agree4`, or write the codes.",
					),
				);
				return undefined;
			}
			return { kind: "responses", codes: found.codes, scale: node.value };
		}
		const read = readCodeMap(doc, node, path, false);
		for (const f of read.findings) say(f);
		return read.value === undefined
			? undefined
			: { kind: "responses", codes: read.value };
	}
	// Read as a question's `number` or `open` is, with its findings under this input.
	if (isScalar(node) && (node.value === null || node.value === "")) {
		say(
			problem(
				"hole",
				"hole",
				path,
				`\`${kind}\` is empty.`,
				kind === "open"
					? "Write `open: {}` for any text."
					: "Write `number: {}` for any number, or give `min` and `max`.",
			),
		);
		return undefined;
	}
	const js = isMap(node) ? node.toJS(doc) : isScalar(node) ? node.value : node;
	const read = kind === "open" ? readOpen(js) : readNumber(js, EMPTY_ENV);
	for (const f of read.findings)
		say({ ...f, path: `${path.slice(0, -kind.length)}${f.path}` });
	const domain = read.value;
	if (domain === undefined) return undefined;
	if (domain.kind === "open")
		return {
			kind: "open",
			...(domain.maxLength !== undefined && { maxLength: domain.maxLength }),
		};
	if (domain.kind !== "number") return undefined;
	return {
		kind: "number",
		...(domain.min !== undefined && { min: domain.min }),
		...(domain.max !== undefined && { max: domain.max }),
		...(domain.decimals !== undefined && { decimals: domain.decimals }),
	};
}

/** What a value of a domain is to a condition. */
function typeOfDomain(
	domain: ValueDomain | undefined,
	missing: readonly Code[] = [],
): Type {
	if (domain === undefined) return { kind: "unknown" };
	if (domain.kind === "number") return { kind: "number" };
	if (domain.kind === "open") return { kind: "string" };
	return { kind: "code", codes: [...domain.codes, ...missing] };
}

function readUniverse(
	node: unknown,
	path: string,
	ctx: Context,
): UniverseRef | undefined {
	const text = readText(node, path, false, ctx.say);
	if (text === undefined) return undefined;
	// `bas.renters` is a bank's shared universe; anything else is prose.
	const named = /^([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)$/.exec(text);
	if (named === null) return { kind: "text", text };
	const [, alias = "", name = ""] = named;
	const entry = ctx.banks[alias]?.env.universes[name];
	if (entry === undefined) {
		ctx.say(
			problem(
				"unknown-name",
				"hole",
				path,
				`\`${text}\` names no shared universe.`,
				"Name a bank's universe with its alias, such as `bas.adults`, or write it as a sentence.",
			),
		);
		return undefined;
	}
	return { kind: "ref", alias, name, text: entry.text };
}

function readFlow(
	node: unknown,
	path: string,
	ctx: Context,
	top = false,
): readonly Node[] {
	if (!isSeq(node)) {
		if (isScalar(node) && (node.value === null || node.value === "")) {
			ctx.say(
				problem(
					"hole",
					"hole",
					path,
					"The flow is empty.",
					"List its steps: `- ask: bas.x`, `- say: ...`.",
				),
			);
			return [];
		}
		ctx.say(
			problem(
				"wrong-type",
				"error",
				path,
				"A flow is a list of steps, each starting with `- `.",
			),
		);
		return [];
	}
	return node.items.map((item, i) => readStep(item, `${path}.${i}`, ctx, top));
}

function readStep(
	item: unknown,
	path: string,
	ctx: Context,
	top: boolean,
): Node {
	const hole: Node = { kind: "hole", path };
	if (!isMap(item)) {
		ctx.say(
			problem(
				"wrong-type",
				"error",
				path,
				"A step is one of `ask`, `say`, `section`, `if`, `stop` or `compute`, with its fields.",
			),
		);
		return hole;
	}
	const keys = keysOf(item);
	const kinds = keys.filter((k) =>
		(CONSTRUCTS as readonly string[]).includes(k),
	);
	if (kinds.length === 0) {
		ctx.say(
			problem(
				"hole",
				"hole",
				path,
				"This step does nothing yet.",
				"Start it with `ask`, `say`, `section`, `if`, `stop` or `compute`.",
			),
		);
		return hole;
	}
	// One construct, with the others it allows as fields (`stop` with its `say`).
	const kind =
		kinds.find((k) =>
			kinds.every((o) => o === k || (FIELDS[k] ?? []).includes(o)),
		) ??
		kinds[0] ??
		"";
	const others = kinds.filter(
		(k) => k !== kind && !(FIELDS[kind] ?? []).includes(k),
	);
	if (others.length > 0) {
		ctx.say(
			problem(
				"unknown-key",
				"error",
				`${path}.${others[0]}`,
				`A step does one thing: this one is already \`${kind}\`.`,
				"Start another step with `- `.",
			),
		);
	}
	const allowed = FIELDS[kind] ?? [];
	for (const k of keys)
		if (
			k !== kind &&
			!allowed.includes(k) &&
			!(CONSTRUCTS as readonly string[]).includes(k)
		)
			ctx.say(
				problem(
					"unknown-key",
					"error",
					`${path}.${k}`,
					`\`${k}\` isn't a field of \`${kind}\`.`,
					allowed.length > 0 ? `Its fields: ${allowed.join(", ")}.` : undefined,
				),
			);
	const at = `${path}.${kind}`;
	const own = item.get(kind, true);
	switch (kind) {
		case "ask":
			return readAsk(item, own, path, ctx);
		case "say": {
			const text = readText(own, at, true, ctx.say);
			if (text !== undefined)
				ctx.pending.push(() => checkFills(text, at, ctx, own));
			return { kind: "say", path, ...(text !== undefined && { text }) };
		}
		case "section": {
			const title = readText(own, at, false, ctx.say);
			const order = readOrder(item.get("order", true), `${path}.order`, ctx);
			const flow = item.get("flow", true);
			return {
				kind: "section",
				path,
				...(title !== undefined && { title }),
				...(order !== undefined && { order }),
				flow:
					flow === undefined
						? nothing<Node>(
								ctx.say,
								problem(
									"hole",
									"hole",
									`${path}.flow`,
									"A section needs its `flow`.",
								),
							)
						: readFlow(flow, `${path}.flow`, ctx),
			};
		}
		case "if":
			return readIf(item, path, ctx);
		case "stop": {
			if (!top)
				ctx.say(
					problem(
						"misplaced",
						"error",
						at,
						"`stop` ends the instrument, so it goes in the top-level flow.",
						"Inside a section or branch, put what follows under an `if` instead.",
					),
				);
			const cond = readCond(own, at, ctx, "condition");
			const sayText = readText(
				item.get("say", true),
				`${path}.say`,
				false,
				ctx.say,
			);
			if (sayText !== undefined)
				ctx.pending.push(() =>
					checkFills(sayText, `${path}.say`, ctx, item.get("say", true)),
				);
			return {
				kind: "stop",
				path,
				...(cond !== undefined && { cond }),
				...(sayText !== undefined && { say: sayText }),
			};
		}
		case "compute": {
			const name = readText(own, at, true, ctx.say);
			const value = readCond(
				item.get("value", true),
				`${path}.value`,
				ctx,
				"value",
				name === undefined ? undefined : { name, path },
			);
			if (name !== undefined) {
				if (!NAME_PATTERN.test(name))
					ctx.say(
						problem(
							"wrong-type",
							"error",
							at,
							`\`${name}\` isn't a valid name.`,
							"Lowercase letters, digits and underscores, starting with a letter.",
						),
					);
				else
					ctx.declare(
						name,
						{ kind: "compute", name, path, type: { kind: "unknown" } },
						at,
					);
			}
			return {
				kind: "compute",
				path,
				...(name !== undefined && { name }),
				...(value !== undefined && { value }),
			};
		}
		default:
			ctx.say(
				problem(
					"not-yet",
					"error",
					at,
					`\`${kind}\` isn't in this version of the instrument language yet.`,
				),
			);
			return hole;
	}
}

function readOrder(
	node: unknown,
	path: string,
	ctx: Context,
): Order | undefined {
	if (node === undefined) return undefined;
	const v = isScalar(node) ? node.value : undefined;
	if (typeof v === "string" && (ORDERS as readonly string[]).includes(v))
		return v as Order;
	ctx.say(
		problem(
			"wrong-type",
			"error",
			path,
			"Write `random` or `rotate`.",
			"Omit it to keep the order as written.",
		),
	);
	return undefined;
}

function readIf(item: YAMLMap, path: string, ctx: Context): Node {
	const branches: { path: string; cond?: Cond; then: readonly Node[] }[] = [];
	let at: YAMLMap | undefined = item;
	let atPath = path;
	let otherwise: readonly Node[] | undefined;
	// `else` holding one `if` is else-if: walk the chain into one node.
	while (at !== undefined) {
		const cond = readCond(at.get("if", true), `${atPath}.if`, ctx, "condition");
		const thenNode = at.get("then", true);
		const then =
			thenNode === undefined
				? nothing<Node>(
						ctx.say,
						problem(
							"hole",
							"hole",
							`${atPath}.then`,
							"`then` is required: what happens when the condition is true.",
						),
					)
				: readFlow(thenNode, `${atPath}.then`, ctx);
		branches.push({ path: atPath, ...(cond !== undefined && { cond }), then });
		const elseNode: unknown = at.get("else", true);
		at = undefined;
		if (elseNode === undefined) break;
		if (isMap(elseNode) && elseNode.has("if")) {
			for (const k of keysOf(elseNode))
				if (!["if", "then", "else"].includes(k))
					ctx.say(
						problem(
							"unknown-key",
							"error",
							`${atPath}.else.${k}`,
							`\`${k}\` isn't a field of \`else\`'s \`if\`.`,
						),
					);
			at = elseNode;
			atPath = `${atPath}.else`;
		} else otherwise = readFlow(elseNode, `${atPath}.else`, ctx);
	}
	return {
		kind: "if",
		path,
		branches,
		...(otherwise !== undefined && { else: otherwise }),
	};
}

function readAsk(
	item: YAMLMap,
	own: unknown,
	path: string,
	ctx: Context,
): Node {
	const at = `${path}.ask`;
	const text = readText(own, at, true, ctx.say);
	const question =
		text === undefined ? undefined : resolveQuestion(text, at, ctx);
	const asName = readText(item.get("as", true), `${path}.as`, false, ctx.say);
	if (asName !== undefined && question === undefined) {
		// Declared all the same, so what reads it says its question, not "nothing".
		if (NAME_PATTERN.test(asName))
			ctx.declare(
				asName,
				{ kind: "as", name: asName, path, type: { kind: "unknown" } },
				`${path}.as`,
			);
	} else if (asName !== undefined && question !== undefined) {
		const domain = question.evaluation.draft.domain;
		if (domain?.kind === "responses" && domain.select === "many")
			ctx.say(
				problem(
					"not-yet",
					"error",
					`${path}.as`,
					"Asking a select-all-that-apply question again under a new name isn't in this version yet.",
					"How its option variables are renamed is still to be decided.",
				),
			);
		else if (!NAME_PATTERN.test(asName))
			ctx.say(
				problem(
					"wrong-type",
					"error",
					`${path}.as`,
					`\`${asName}\` isn't a valid name.`,
					"Lowercase letters, digits and underscores, starting with a letter.",
				),
			);
		else
			ctx.declare(
				asName,
				{
					kind: "as",
					name: asName,
					path,
					question,
					type: questionType(question, ctx),
				},
				`${path}.as`,
			);
	}
	const universe = readUniverse(
		item.get("universe", true),
		`${path}.universe`,
		ctx,
	);
	const options = readOrder(item.get("options", true), `${path}.options`, ctx);
	const secondsNode = item.get("seconds", true);
	const seconds =
		isScalar(secondsNode) && typeof secondsNode.value === "number"
			? secondsNode.value
			: undefined;
	if (secondsNode !== undefined && seconds === undefined)
		ctx.say(
			problem(
				"wrong-type",
				"error",
				`${path}.seconds`,
				"`seconds` is a number: how long the question is expected to take.",
			),
		);
	const fills = readFills(
		item.get("fill", true),
		`${path}.fill`,
		question,
		ctx,
	);
	const checks = readChecks(item.get("checks", true), `${path}.checks`, ctx);
	return {
		kind: "ask",
		path,
		...(question !== undefined && { question }),
		...(asName !== undefined && { as: asName }),
		...(universe !== undefined && { universe }),
		...(options !== undefined && { options }),
		...(seconds !== undefined && { seconds }),
		fills,
		checks,
	};
}

/** `alias.name` to the bank question it names. */
function resolveQuestion(
	text: string,
	path: string,
	ctx: Context,
): QuestionRef | undefined {
	const named = /^([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)$/.exec(text.trim());
	if (named === null) {
		ctx.say(
			problem(
				"unknown-question",
				"error",
				path,
				`\`${text}\` isn't a question's name.`,
				"Name a bank question with the bank's alias: `bas.nhd_sat`.",
			),
		);
		return undefined;
	}
	const [, alias = "", name = ""] = named;
	const bank = ctx.banks[alias];
	if (bank === undefined) {
		ctx.say(
			problem(
				"unknown-bank",
				"error",
				path,
				`No bank is used as \`${alias}\`.`,
				ctx.uses.length > 0
					? `Banks: ${ctx.uses.map((u) => u.alias).join(", ")}.`
					: "Name it under `uses:`.",
			),
		);
		return undefined;
	}
	const paths = [...(bank.index.names.get(name) ?? [])].sort();
	const [first] = paths;
	if (first === undefined) {
		ctx.say(
			problem(
				"unknown-question",
				"hole",
				path,
				`\`${alias}\` has no question named \`${name}\`.`,
			),
		);
		return undefined;
	}
	if (paths.length > 1)
		ctx.say(
			problem(
				"unknown-question",
				"error",
				path,
				`\`${alias}\` has more than one question named \`${name}\`: ${paths.join(", ")}.`,
				"The bank must give each question its own name.",
			),
		);
	const evaluation = bank.questions[first];
	return evaluation === undefined
		? undefined
		: { alias, name, path: first, evaluation };
}

/** What a question's own answer is to a condition (its variable named like it). */
function questionType(q: QuestionRef, ctx: Context): Type {
	const missing = ctx.banks[q.alias]?.env.missing ?? [];
	const domain = q.evaluation.draft.domain;
	return typeOfDomain(
		domain === undefined
			? undefined
			: domain.kind === "responses"
				? { kind: "responses", codes: domain.codes }
				: domain,
		missing,
	);
}

/**
 * What a name in a condition means: `alias.variable` a bank variable (a question's own,
 * or a select-all option's), a bare name an input, compute or `as`.
 */
function lookup(name: string, ctx: Context): Named | undefined {
	const bare = ctx.scope.get(name);
	if (bare !== undefined) return bare;
	const dot = name.indexOf(".");
	if (dot === -1) return undefined;
	const alias = name.slice(0, dot);
	const variable = name.slice(dot + 1);
	const bank = ctx.banks[alias];
	if (bank === undefined) return undefined;
	const [path] = [...(bank.index.variables.get(variable) ?? [])]
		.map((s) => s.key)
		.sort();
	const evaluation = path === undefined ? undefined : bank.questions[path];
	if (path === undefined || evaluation === undefined) return undefined;
	const defined = definedVariables(evaluation.draft).find(
		(d) => d.name === variable,
	);
	const question: QuestionRef = {
		alias,
		name: evaluation.draft.name ?? variable,
		path,
		evaluation,
	};
	const type: Type =
		defined?.option !== undefined
			? { kind: "code", codes: [...BINARY, ...bank.env.missing] }
			: questionType(question, ctx);
	return { kind: "bank", alias, variable, question, type };
}

/**
 * A condition, a computed value or a fill's source: parsed now, with its ranges moved to
 * the source, and typed once every name is known (a compute's value first, in the order
 * computes depend on each other).
 */
function readCond(
	node: unknown,
	path: string,
	ctx: Context,
	as: "condition" | "value",
	compute?: { readonly name: string; readonly path: string },
): Cond | undefined {
	if (
		node === undefined ||
		(isScalar(node) && (node.value === null || node.value === ""))
	) {
		ctx.say(
			problem(
				"hole",
				"hole",
				path,
				as === "condition"
					? "The condition is still to be written."
					: "The value is still to be written.",
			),
		);
		return undefined;
	}
	if (
		!isScalar(node) ||
		(typeof node.value !== "string" &&
			typeof node.value !== "number" &&
			typeof node.value !== "boolean")
	) {
		ctx.say(
			problem(
				"condition",
				"error",
				path,
				"Write the condition on one line, as text.",
				'If it has braces, quote it: `if: "bas.x in {\\"1\\", \\"2\\"}"`.',
			),
		);
		return undefined;
	}
	const text = String(node.value);
	const parsed = parseCondition(text);
	const at = scalarMap(ctx.source, node as Scalar, text);
	const expr = moveRanges(parsed.expr, at);
	const problems = parsed.problems.map((p) => ({ ...p, range: at(p.range) }));
	for (const p of problems) report(ctx, path, p, "error");
	// A hole inside a problem already said is not said again.
	for (const range of holesOf(expr))
		if (!problems.some((p) => p.range[0] <= range[0] && range[1] <= p.range[1]))
			ctx.say(
				problem(
					"hole",
					"hole",
					path,
					"Something is still to be written here.",
					undefined,
					range,
				),
			);
	const typeIt = () => {
		const scope = (name: string) => lookup(name, ctx)?.type;
		const result =
			as === "condition" ? typeCondition(expr, scope) : typeOf(expr, scope);
		// A name nothing has is still to be written: a hole, listing what is in scope.
		for (const p of result.problems)
			report(ctx, path, p, p.kind === "unknown-name" ? "hole" : "error", expr);
		for (const n of namesOf(expr)) ambiguous(n.name, n.range, path, ctx);
		if (compute !== undefined) {
			const named = ctx.scope.get(compute.name);
			// Only the compute that holds the name: a clash left the earlier meaning.
			if (named?.kind === "compute" && named.path === compute.path)
				ctx.scope.set(compute.name, { ...named, type: result.type });
		}
	};
	if (compute === undefined) ctx.pending.push(typeIt);
	else
		ctx.computes.push({
			...compute,
			reads: namesOf(expr).map((n) => n.name),
			typeIt,
		});
	return { text, expr };
}

/** A condition's problem as a finding at its place, an unknown name with what fits here. */
function report(
	ctx: Context,
	path: string,
	p: Problem,
	severity: Finding["severity"],
	expr?: Cond["expr"],
): void {
	const name =
		p.kind === "unknown-name" && expr !== undefined
			? namesOf(expr).find(
					(n) => n.range[0] === p.range[0] && n.range[1] === p.range[1],
				)?.name
			: undefined;
	ctx.say(
		problem(
			p.kind === "unknown-name"
				? "unknown-name"
				: p.kind === "syntax"
					? "condition"
					: "type",
			severity,
			path,
			p.message,
			p.kind === "unknown-name"
				? (selectAllHint(name, ctx) ?? scopeHint(ctx))
				: p.hint,
			p.range,
		),
	);
}

/** A select-all question's own name, read as a value: its answers are its options' variables. */
function selectAllHint(
	name: string | undefined,
	ctx: Context,
): string | undefined {
	if (name === undefined) return undefined;
	const dot = name.indexOf(".");
	const bank = dot === -1 ? undefined : ctx.banks[name.slice(0, dot)];
	const [path] = bank?.index.names.get(name.slice(dot + 1)) ?? [];
	const draft = path === undefined ? undefined : bank?.questions[path]?.draft;
	if (draft?.domain?.kind !== "responses" || draft.domain.select !== "many")
		return undefined;
	const alias = name.slice(0, dot);
	return `It's a select-all-that-apply question: each option is its own answer, ${definedVariables(
		draft,
	)
		.map((d) => `\`${alias}.${d.name}\``)
		.join(", ")}, "1" when chosen.`;
}

/** A bank variable two of its questions define: which is meant can't be said. */
function ambiguous(
	name: string,
	range: Range,
	path: string,
	ctx: Context,
): void {
	const dot = name.indexOf(".");
	if (dot === -1 || ctx.scope.has(name)) return;
	const alias = name.slice(0, dot);
	const sites =
		ctx.banks[alias]?.index.variables.get(name.slice(dot + 1)) ?? [];
	const files = [...new Set(sites.map((s) => s.key))];
	if (files.length > 1)
		ctx.say(
			problem(
				"unknown-name",
				"error",
				path,
				`\`${alias}\` defines \`${name.slice(dot + 1)}\` in more than one question: ${files.sort().join(", ")}.`,
				"The bank must give each variable its own name.",
				range,
			),
		);
}

/**
 * Computes typed in the order they depend on each other, so each is typed with what it
 * reads already known; computes that need each other are a cycle, each told so.
 */
function typeComputes(ctx: Context): void {
	const byName = new Map(ctx.computes.map((c) => [c.name, c]));
	const state = new Map<string, "typing" | "typed">();
	const visit = (c: Context["computes"][number]): void => {
		if (state.get(c.name) === "typed") return;
		if (state.get(c.name) === "typing") {
			ctx.say(
				problem(
					"cycle",
					"error",
					`${c.path}.value`,
					`\`${c.name}\` depends on itself, through the computed values it reads.`,
					"A computed value can read inputs, answers and earlier computed values, never itself.",
				),
			);
			return;
		}
		state.set(c.name, "typing");
		for (const read of c.reads) {
			const next = byName.get(read);
			if (next !== undefined) visit(next);
		}
		state.set(c.name, "typed");
		c.typeIt();
	};
	for (const c of ctx.computes) visit(c);
}

/** The names a condition may use here, for a hole's hint. */
function scopeHint(ctx: Context): string {
	const names = [...ctx.scope.keys()].sort();
	const banks = ctx.uses.map((u) => `${u.alias}.…`);
	return `Names here: ${[...names, ...banks].join(", ") || "none yet"}.`;
}

function readFills(
	node: unknown,
	path: string,
	question: QuestionRef | undefined,
	ctx: Context,
): readonly FillBinding[] {
	const declared = question?.evaluation.draft.fills ?? [];
	if (node === undefined) {
		// A fill the question declares and this ask leaves empty is a hole here.
		for (const f of declared)
			ctx.say(
				problem(
					"hole",
					"hole",
					path.replace(/\.fill$/, ".ask"),
					`Fill \`${f.name}\` of \`${question?.alias}.${question?.name}\` has nothing to fill it.`,
					`Add \`fill: {${f.name}: ...}\` naming an earlier answer or an input.`,
				),
			);
		return [];
	}
	if (!isMap(node)) {
		ctx.say(
			problem(
				"wrong-type",
				"error",
				path,
				"`fill` names each fill and what fills it: `rent: bas.hou_rent`.",
			),
		);
		return [];
	}
	const bindings: FillBinding[] = [];
	for (const pair of node.items) {
		if (!isScalar(pair.key)) continue;
		const name = String(pair.key.value);
		const at = `${path}.${name}`;
		if (question !== undefined && !declared.some((f) => f.name === name))
			ctx.say(
				problem(
					"unknown-name",
					"error",
					at,
					`\`${question.alias}.${question.name}\` has no fill named \`${name}\`.`,
					declared.length > 0
						? `Its fills: ${declared.map((f) => f.name).join(", ")}.`
						: "It has no fills.",
				),
			);
		const source = readCond(pair.value, at, ctx, "value");
		bindings.push({ name, path: at, ...(source !== undefined && { source }) });
	}
	for (const f of declared)
		if (!bindings.some((b) => b.name === f.name))
			ctx.say(
				problem(
					"hole",
					"hole",
					path,
					`Fill \`${f.name}\` has nothing to fill it.`,
					`Add \`${f.name}: ...\` naming an earlier answer or an input.`,
				),
			);
	return bindings;
}

function readChecks(
	node: unknown,
	path: string,
	ctx: Context,
): readonly Check[] {
	if (node === undefined) return [];
	if (!isSeq(node)) {
		ctx.say(
			problem(
				"wrong-type",
				"error",
				path,
				"`checks` is a list: `- ensure: ...` with its `severity` and `message`.",
			),
		);
		return [];
	}
	return node.items.map((item, i): Check => {
		const at = `${path}.${i}`;
		if (!isMap(item)) {
			ctx.say(
				problem(
					"wrong-type",
					"error",
					at,
					"A check has `ensure`, `severity` and `message`.",
				),
			);
			return { path: at };
		}
		for (const k of keysOf(item))
			if (!["ensure", "severity", "message", "name"].includes(k))
				ctx.say(
					problem(
						"unknown-key",
						"error",
						`${at}.${k}`,
						`\`${k}\` isn't a field of a check.`,
						"A check has `ensure`, `severity`, `message` and an optional `name`.",
					),
				);
		const ensure = readCond(
			item.get("ensure", true),
			`${at}.ensure`,
			ctx,
			"condition",
		);
		const severityNode = item.get("severity", true);
		const severityValue = isScalar(severityNode)
			? severityNode.value
			: undefined;
		const severity = (SEVERITIES as readonly unknown[]).includes(severityValue)
			? (severityValue as Severity)
			: undefined;
		if (
			severityNode === undefined ||
			severityValue === null ||
			severityValue === ""
		)
			ctx.say(
				problem(
					"hole",
					"hole",
					`${at}.severity`,
					"How serious is a failed check?",
					`Severities: ${SEVERITIES.join(", ")}.`,
				),
			);
		else if (severity === undefined)
			ctx.say(
				problem(
					"wrong-type",
					"error",
					`${at}.severity`,
					`\`${String(severityValue)}\` isn't a severity.`,
					`Severities: ${SEVERITIES.join(", ")}.`,
				),
			);
		const message = readText(
			item.get("message", true),
			`${at}.message`,
			true,
			ctx.say,
		);
		if (message !== undefined)
			ctx.pending.push(() =>
				checkFills(message, `${at}.message`, ctx, item.get("message", true)),
			);
		const name = readText(item.get("name", true), `${at}.name`, false, ctx.say);
		return {
			path: at,
			...(name !== undefined && { name }),
			...(ensure !== undefined && { ensure }),
			...(severity !== undefined && { severity }),
			...(message !== undefined && { message }),
		};
	});
}

/** `{{…}}` in a statement or message: each name must mean something here. */
const PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/g;
function checkFills(
	text: string,
	path: string,
	ctx: Context,
	node: unknown,
): void {
	const at = isScalar(node) ? scalarMap(ctx.source, node, text) : undefined;
	for (const m of text.matchAll(PLACEHOLDER)) {
		const name = m[1] ?? "";
		if (lookup(name, ctx) === undefined)
			ctx.say(
				problem(
					"unknown-name",
					"hole",
					path,
					`Nothing is named \`${name}\` here, so \`{{${name}}}\` can't be filled.`,
					selectAllHint(name, ctx) ?? scopeHint(ctx),
					at?.([m.index, m.index + m[0].length]),
				),
			);
	}
}

/** Every path's range, list items included, so a finding in a flow points at its step. */
function indexInstrument(doc: Document, length: number): Record<string, Range> {
	const ranges: Record<string, Range> = { "": [0, length] };
	const walk = (node: unknown, prefix: string): void => {
		if (isMap(node))
			for (const pair of node.items) {
				if (!isScalar(pair.key) || !pair.key.range) continue;
				const path = prefix
					? `${prefix}.${String(pair.key.value)}`
					: String(pair.key.value);
				const v = pair.value as YamlNode | null;
				const to = v?.range ? v.range[1] : pair.key.range[1];
				ranges[path] = clampRange(pair.key.range[0], to, length);
				walk(v, path);
			}
		else if (isSeq(node))
			node.items.forEach((item, i) => {
				const n = item as YamlNode | null;
				const path = `${prefix}.${i}`;
				if (n?.range) ranges[path] = clampRange(n.range[0], n.range[1], length);
				walk(n, path);
			});
	};
	walk(doc.contents, "");
	return ranges;
}
