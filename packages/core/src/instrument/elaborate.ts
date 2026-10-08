/**
 * An instrument as DDI-Lifecycle 4.0: an `Instrument` whose flow is control constructs
 * (Sequence, QuestionConstruct, IfThenElse, RepeatUntil, StatementItem,
 * ComputationItem), the Variables it records, and the bank items its questions bring
 * with them. Total, like a question's elaboration: what is present is emitted, a hole
 * emits nothing (a hole in a condition prints as `null`).
 *
 * The instrument owns the Variable of every value it records (each answer, each input),
 * each with an OutParameter that conditions and fills bind to; the banks' own default
 * Variables stay out, so one variable has one source even when branches ask the same
 * question. Conditions are VTL: names are printed as the variables' names and passed in
 * as parameters bound to those OutParameters. IDs keep DDI's one dot: everything hangs
 * off `instrument-<name>`.
 */
import { namesOf } from "../cond/ast.ts";
import { printCondition } from "../cond/print.ts";
import {
	type Collision,
	codeValue,
	collisions,
	type DdiDocument,
	documentOf,
	dynamicText,
	type Identity,
	type Item,
	identity,
	intl,
	item,
	type JsonObject,
	obj,
	ref,
	structured,
} from "../ddi/document.ts";
import { sharedUniverseItem } from "../ddi/elaborate.ts";
import { UNVERSIONED } from "../ddi/version.ts";
import { UNDECLARED_AGENCY } from "../schemes.ts";
import type { Code } from "../surface/draft.ts";
import { definedVariables } from "../surface/draft.ts";
import { placeholderSpans } from "../surface/fills.ts";
import type {
	Check,
	Cond,
	InstrumentDraft,
	Node,
	QuestionRef,
	UniverseRef,
	ValueDomain,
} from "./draft.ts";
import { SEVERITIES } from "./draft.ts";
import type { ParsedInstrument } from "./parse.ts";

export interface InstrumentOptions {
	/** Who publishes the instrument: its own agency, not necessarily its banks'. */
	readonly agency: string;
	/** Its DDI version; "1" when nothing is known of its history. */
	readonly version?: string;
}

/** The items of an instrument, keyed by who emitted them, for `collisions` and `documentOf`. */
export interface ElaboratedInstrument {
	/** The instrument's own items. */
	readonly own: readonly Item[];
	/** Each asked question's items from its bank (its default Variables left out), by bank path. */
	readonly banks: readonly (readonly [string, readonly Item[]])[];
}

/** VTL's name in DDI's `ProgramLanguage`. */
const VTL = "VTL";

/** What every condition's description says about unanswered questions. */
const NULL_RULE =
	"VTL 2.1. A question not answered reads as null, and a condition that is null is not true.";

export function elaborateInstrument(
	parsed: ParsedInstrument,
	options: InstrumentOptions,
): ElaboratedInstrument {
	const { draft, names } = parsed;
	const agency = options.agency;
	const version = options.version ?? "1";
	const base = `instrument-${draft.name ?? "untitled"}`;
	const own: Item[] = [];
	const emit = <T extends Item>(it: T): T => {
		own.push(it);
		return it;
	};
	const id = (local: string): Identity =>
		identity(agency, `${base}.${local}`, version);
	const counters = new Map<string, number>();
	/** A local name unique in this instrument: `if-1`, `if-2`; a name gets `-2` only when repeated. */
	const local = (kind: string, name?: string): string => {
		const key = name === undefined ? kind : `${kind}-${name}`;
		const n = (counters.get(key) ?? 0) + 1;
		counters.set(key, n);
		return name === undefined || n > 1 ? `${key}-${n}` : key;
	};

	// What the instrument records or computes, so nothing binds to a variable that isn't there.
	const defined = definedNames(draft);
	/**
	 * The name a variable is exported under: a bank variable's own, an input's, an `as`'s,
	 * a compute's; undefined for a name that resolves to nothing the instrument records.
	 */
	const exported = (name: string): string | undefined => {
		const named = names.get(name) ?? parsed.scope.get(name);
		if (named === undefined) return undefined;
		const v =
			named.kind === "bank"
				? named.variable
				: named.kind === "input"
					? named.input.name
					: named.kind === "index"
						? `${named.roster}_index`
						: named.name;
		return defined.has(v) ? v : undefined;
	};
	/** Where a row number is read from: the Loop or count over the rows a step is within. */
	const rowParams = new Map<string, Identity>();
	const outOf = (variable: string): Identity =>
		rowParams.get(variable) ?? id(`out-${variable}`);
	const withRow = <T>(variable: string, source: Identity, go: () => T): T => {
		const before = rowParams.get(variable);
		rowParams.set(variable, source);
		try {
			return go();
		} finally {
			if (before === undefined) rowParams.delete(variable);
			else rowParams.set(variable, before);
		}
	};

	/** A VTL command: its text, and each name it reads passed in, bound from its source. */
	const vtl = (
		content: string,
		reads: readonly { readonly alias: string; readonly source: Identity }[],
		at: string,
	): JsonObject => ({
		Description: structured(NULL_RULE),
		Command: [
			{
				ProgramLanguage: codeValue(VTL),
				CommandContent: content,
				InParameter: reads.map((r) => ({
					...id(`${at}-in-${r.alias}`),
					Alias: r.alias,
				})),
				Binding: reads.map((r) => ({
					SourceParameterReference: { ...r.source },
					TargetParameterReference: { ...id(`${at}-in-${r.alias}`) },
				})),
			},
		],
	});
	/** A condition's names as the variables they read, once each. */
	const readsOf = (cond: Cond): { alias: string; source: Identity }[] =>
		[
			...new Set(
				namesOf(cond.expr).flatMap((n) => {
					const v = exported(n.name);
					return v === undefined ? [] : [v];
				}),
			),
		].map((v) => ({ alias: v, source: outOf(v) }));
	const printed = (cond: Cond): string =>
		// A name that means nothing here is printed as a hole is: VTL's null.
		printCondition(cond.expr, (n) => exported(n) ?? "null", "null");

	/** A VTL command over a condition: its names in as parameters, bound to their variables. */
	const command = (
		cond: Cond | undefined,
		at: string,
		wrap?: (text: string) => string,
	): JsonObject | undefined => {
		if (cond === undefined) return undefined;
		const text = printed(cond);
		return vtl(wrap === undefined ? text : wrap(text), readsOf(cond), at);
	};

	/** Text with `{{name}}` placeholders, each bound to its variable's OutParameter. */
	const display = (text: string): JsonObject => {
		const parts: ({ text: string } | { parameter: Identity })[] = [];
		let at = 0;
		for (const p of placeholderSpans(text)) {
			const v = exported(p.name);
			if (v === undefined) continue;
			if (p.range[0] > at) parts.push({ text: text.slice(at, p.range[0]) });
			parts.push({ parameter: outOf(v) });
			at = p.range[1];
		}
		if (at < text.length) parts.push({ text: text.slice(at) });
		return dynamicText(parts);
	};

	const universes = new Map<string, Item>();
	/** A universe as an item: a bank's shared one under its bank's identity, prose the instrument's own. */
	const universeOf = (u: UniverseRef | undefined): Item | undefined => {
		if (u === undefined) return undefined;
		const key = u.kind === "ref" ? `${u.alias}.${u.name}` : `text:${u.text}`;
		const known = universes.get(key);
		if (known !== undefined) return known;
		const made =
			u.kind === "ref"
				? bankUniverse(u, parsed.banks, banks)
				: emit(
						item("Universe", id(local("universe")), {
							UniverseName: [intl(u.text)],
							Description: structured(u.text),
						}),
					);
		if (made !== undefined) universes.set(key, made);
		return made;
	};

	const banks = new Map<string, readonly Item[]>();
	/** A question's bank items, once, without the Variables the instrument records itself. */
	const bring = (q: QuestionRef) => {
		const key = `${q.alias}:${q.path}`;
		if (!banks.has(key))
			banks.set(
				key,
				q.evaluation.items.filter((it) => it.type !== "Variable"),
			);
	};
	const questionItem = (q: QuestionRef): Item | undefined =>
		q.evaluation.items.find((it) => it.type === "QuestionItem");

	/**
	 * The Variable the instrument records an answer in: what the bank's says about it
	 * (label, question, concept, values), under the instrument's identity and version,
	 * of whom this instrument asks it.
	 */
	const answerVariable = (
		q: QuestionRef,
		bankVariable: string,
		name: string,
		universe: Item | undefined,
	) => {
		const theirs = q.evaluation.items.find(
			(it) =>
				it.type === "Variable" && it.identity.ID === `variable-${bankVariable}`,
		);
		if (theirs === undefined) return;
		const {
			Label,
			QuestionReference,
			ConceptReference,
			VariableRepresentation,
		} = theirs.body;
		const representation = (VariableRepresentation ?? {}) as JsonObject;
		emit(
			item(
				"Variable",
				id(`var-${name}`),
				obj({
					VariableName: [intl(name)],
					Label,
					QuestionReference,
					// Whom this instrument asks it of; else whom the bank says.
					UniverseReference:
						universe === undefined
							? theirs.body.UniverseReference
							: [ref(universe)],
					ConceptReference,
					VariableRepresentation,
					OutParameter: obj({
						...outOf(name),
						ParameterName: [intl(name)],
						ValueRepresentation: representation.ValueRepresentation,
					}),
				}),
			),
		);
	};

	const recordedAnswers = new Set<string>();
	const record = (
		q: QuestionRef,
		as: string | undefined,
		universe: Item | undefined,
	) => {
		if (as !== undefined) {
			const own = definedVariables(q.evaluation.draft)[0];
			if (own !== undefined && !recordedAnswers.has(as)) {
				recordedAnswers.add(as);
				answerVariable(q, own.name, as, universe);
			}
			return;
		}
		for (const d of definedVariables(q.evaluation.draft))
			if (!recordedAnswers.has(d.name)) {
				recordedAnswers.add(d.name);
				answerVariable(q, d.name, d.name, universe);
			}
	};

	// The checks' severities: a code list of the instrument's own, which each check's
	// IfThenElse names its kind from.
	let severities: Item | undefined;
	/** A check's kind, from the severities' list; nothing while the severity is still a hole. */
	const severity = (s: Check["severity"]): JsonObject | undefined => {
		if (s === undefined) return undefined;
		if (severities === undefined) {
			const cats = SEVERITIES.map((name, i) =>
				emit(
					item("Category", id(`severity-cat-${i}`), {
						Label: [structured(name)],
					}),
				),
			);
			severities = emit(
				item("CodeList", id("severities"), {
					Label: [structured("Check severities")],
					Code: SEVERITIES.map((name, i) => ({
						...id(`severity-code-${i}`),
						Value: codeValue(name),
						CategoryReference: ref(cats[i] as Item),
					})),
				}),
			);
		}
		return {
			StringValue: s,
			ControlledVocabularyCodeListReference: ref(severities),
		};
	};

	const sequence = (
		nodes: readonly Node[],
		at: string,
		extra: JsonObject = {},
	): Item =>
		emit(
			item("Sequence", id(at), {
				...extra,
				ControlConstructReference: flow(nodes),
			}),
		);

	/** A list of steps as references to their constructs; a `stop` takes what follows into its else. */
	const flow = (nodes: readonly Node[]): JsonObject[] => {
		const refs: JsonObject[] = [];
		for (let i = 0; i < nodes.length; i++) {
			const node = nodes[i] as Node;
			if (node.kind === "stop") {
				refs.push(ref(stop(node, nodes.slice(i + 1))));
				break;
			}
			for (const c of construct(node)) refs.push(ref(c));
		}
		return refs;
	};

	const stop = (
		node: Extract<Node, { kind: "stop" }>,
		rest: readonly Node[],
	): Item => {
		const at = local("stop");
		const said = node.say === undefined ? [] : [statement(node.say)];
		const then = emit(
			item("Sequence", id(`${at}-then`), {
				ControlConstructReference: said.map((s) => ref(s)),
			}),
		);
		const otherwise = sequence(rest, `${at}-rest`);
		return emit(
			item(
				"IfThenElse",
				id(at),
				obj({
					IfCondition: command(node.cond, at),
					ThenConstructReference: ref(then),
					ElseConstructReference: ref(otherwise),
				}),
			),
		);
	};

	const statement = (text: string): Item =>
		emit(
			item("StatementItem", id(local("say")), { DisplayText: [display(text)] }),
		);

	const construct = (node: Node): readonly Item[] => {
		switch (node.kind) {
			case "ask":
				return ask(node);
			case "say":
				return node.text === undefined ? [] : [statement(node.text)];
			case "section":
				return [
					sequence(node.flow, local("section"), {
						...(node.title !== undefined && {
							ConstructName: [intl(node.title)],
						}),
						...(node.order !== undefined && {
							ConstructSequence: {
								ItemSequenceType: node.order === "random" ? "Random" : "Rotate",
							},
						}),
					}),
				];
			case "if": {
				const at = local("if");
				const [first, ...rest] = node.branches;
				if (first === undefined) return [];
				return [
					emit(
						item(
							"IfThenElse",
							id(at),
							obj({
								IfCondition: command(first.cond, at),
								ThenConstructReference: ref(sequence(first.then, `${at}-then`)),
								ElseIf:
									rest.length === 0
										? undefined
										: rest.map((b, i) =>
												obj({
													IfCondition: command(b.cond, `${at}-elif-${i + 1}`),
													ThenConstructReference: ref(
														sequence(b.then, `${at}-elif-${i + 1}-then`),
													),
												}),
											),
								ElseConstructReference:
									node.else === undefined
										? undefined
										: ref(sequence(node.else, `${at}-else`)),
							}),
						),
					),
				];
			}
			case "compute": {
				if (node.name === undefined) return [];
				const at = local("compute", node.name);
				return [
					emit(
						item(
							"ComputationItem",
							id(at),
							obj({
								CommandCode: command(node.value, at),
								AssignedVariableReference: {
									...outOf(node.name),
									ParameterName: [intl(node.name)],
								},
							}),
						),
					),
				];
			}
			case "roster":
				return roster(node);
			case "each":
				return each(node);
			case "stop":
			case "hole":
				return [];
			default:
				return node satisfies never;
		}
	};

	/** Each roster's row count, as `each` over it reads it. */
	const rosterRows = new Map<
		string,
		() => { text: string; reads: { alias: string; source: Identity }[] }
	>();

	/**
	 * A roster: with `count`, a Loop numbering rows from 1 while the number is at most the
	 * count; with `more`, a RepeatUntil whose rows start by counting themselves and end
	 * when `more` isn't true. Inside, `index` is the row's number.
	 */
	const roster = (node: Extract<Node, { kind: "roster" }>): readonly Item[] => {
		if (node.name === undefined) return [];
		const name = node.name;
		const at = local("roster", name);
		const v = `${name}_index`;
		const param = id(`out-${v}`);
		const row = { alias: v, source: param };
		if (node.end?.kind === "more") {
			const counter = emit(
				item("ComputationItem", id(`${at}-next`), {
					CommandCode: vtl(`nvl(${v}, 0) + 1`, [row], `${at}-next`),
					AssignedVariableReference: { ...param, ParameterName: [intl(v)] },
				}),
			);
			const more = node.end.cond;
			rosterRows.set(name, () => ({
				text: `${name}_rows`,
				reads: [{ alias: `${name}_rows`, source: param }],
			}));
			return withRow(v, param, () => {
				const body = emit(
					item("Sequence", id(`${at}-row`), {
						ControlConstructReference: [ref(counter), ...flow(node.flow)],
					}),
				);
				return [
					emit(
						item(
							"RepeatUntil",
							id(at),
							obj({
								UntilCondition: command(
									more,
									`${at}-until`,
									(t) => `not nvl(${t}, false)`,
								),
								UntilConstructReference: ref(body),
							}),
						),
					),
				];
			});
		}
		const count = node.end?.value;
		rosterRows.set(name, () =>
			count === undefined
				? { text: "0", reads: [] }
				: { text: printed(count), reads: readsOf(count) },
		);
		return [
			loop(
				at,
				v,
				param,
				rosterRows.get(name)?.() ?? { text: "0", reads: [] },
				node.flow,
			),
		];
	};

	/** Over an earlier roster's rows: a Loop of its own, numbering them again. */
	const each = (node: Extract<Node, { kind: "each" }>): readonly Item[] => {
		if (node.roster === undefined) return [];
		const at = local("each", node.roster);
		const v = `${node.roster}_index`;
		const rows = rosterRows.get(node.roster)?.() ?? { text: "0", reads: [] };
		return [loop(at, v, id(`${at}-out-${v}`), rows, node.flow)];
	};

	const loop = (
		at: string,
		v: string,
		param: Identity,
		rows: { text: string; reads: { alias: string; source: Identity }[] },
		nodes: readonly Node[],
	): Item => {
		const row = { alias: v, source: param };
		const body = withRow(v, param, () => sequence(nodes, `${at}-row`));
		return emit(
			item("Loop", id(at), {
				LoopVariableReference: { ...param, ParameterName: [intl(v)] },
				InitialValue: vtl("1", [], `${at}-init`),
				LoopWhile: vtl(
					`${v} <= ${rows.text}`,
					[row, ...rows.reads.filter((r) => r.alias !== v)],
					`${at}-while`,
				),
				StepValue: vtl(`${v} + 1`, [row], `${at}-step`),
				ControlConstructReference: ref(body),
			}),
		);
	};

	const ask = (node: Extract<Node, { kind: "ask" }>): readonly Item[] => {
		const q = node.question;
		if (q === undefined) return [];
		const question = questionItem(q);
		if (question === undefined) return [];
		bring(q);
		const at = local("ask", node.as ?? q.name);
		const universe = universeOf(node.universe ?? draft.universe);
		record(q, node.as, universe);
		const parameters = (question.body.InParameter ??
			[]) as readonly JsonObject[];
		const asked = emit(
			item(
				"QuestionConstruct",
				id(at),
				obj({
					QuestionReference: ref(question),
					UniverseReference:
						universe === undefined ? undefined : [ref(universe)],
					ResponseSequence:
						node.options === undefined
							? undefined
							: {
									ItemSequenceType:
										node.options === "random" ? "Random" : "Rotate",
								},
					EstimatedSecondsResponseTime: node.seconds,
					// Each fill: the question's parameter, bound to what fills it here.
					Binding: node.fills.flatMap((f) => {
						const source = f.source?.expr;
						const v =
							source?.kind === "name" ? exported(source.name) : undefined;
						const target = parameters.find((p) => p.Alias === f.name);
						return v === undefined || target === undefined
							? []
							: [
									{
										SourceParameterReference: { ...outOf(v) },
										TargetParameterReference: {
											URN: target.URN as string,
											Agency: target.Agency as string,
											ID: target.ID as string,
											Version: target.Version as string,
										},
									},
								];
					}),
				}),
			),
		);
		if (node.checks.length === 0) return [asked];
		// Each check: say its message when what it ensures isn't true. A blocking one asks
		// again until it is (an unanswered question doesn't block: `nvl(..., true)`).
		const shown = node.checks.flatMap((check, i) => {
			if (check.ensure === undefined) return [];
			const c = `${at}-check-${i + 1}`;
			const message =
				check.message === undefined ? [] : [statement(check.message)];
			return [
				emit(
					item(
						"IfThenElse",
						id(c),
						obj({
							TypeOfIfThenElse: severity(check.severity),
							IfCondition: command(
								check.ensure,
								c,
								(t) => `not nvl(${t}, true)`,
							),
							ThenConstructReference: ref(
								emit(
									item("Sequence", id(`${c}-then`), {
										ControlConstructReference: message.map((m) => ref(m)),
									}),
								),
							),
						}),
					),
				),
			];
		});
		const blocking = node.checks.filter(
			(c) => c.severity === "blocking" && c.ensure !== undefined,
		);
		if (blocking.length === 0) return [asked, ...shown];
		const until = `${at}-until`;
		const body = emit(
			item("Sequence", id(`${until}-body`), {
				ControlConstructReference: [asked, ...shown].map((c) => ref(c)),
			}),
		);
		const conditions = blocking.map((c) => c.ensure as Cond);
		const all: Cond = conditions.reduce((a, b) => ({
			text: `${a.text} and ${b.text}`,
			expr: {
				kind: "binary",
				op: "and",
				left: a.expr,
				right: b.expr,
				range: a.expr.range,
			},
		}));
		return [
			emit(
				item(
					"RepeatUntil",
					id(until),
					obj({
						UntilCondition: command(all, until, (t) => `nvl(${t}, true)`),
						UntilConstructReference: ref(body),
					}),
				),
			),
		];
	};

	// Inputs: Variables received from outside, each with its OutParameter.
	for (const input of draft.inputs) {
		const value =
			input.domain === undefined
				? undefined
				: representation(input.domain, input.name, id, emit);
		emit(
			item(
				"Variable",
				id(`var-${input.name}`),
				obj({
					VariableName: [intl(input.name)],
					Description:
						input.description === undefined
							? undefined
							: structured(input.description),
					OutParameter: obj({
						...outOf(input.name),
						ParameterName: [intl(input.name)],
						ValueRepresentation: value,
					}),
					VariableRepresentation:
						value === undefined ? undefined : { ValueRepresentation: value },
				}),
			),
		);
	}

	const top = sequence(draft.flow, "flow");
	emit(
		item(
			"Instrument",
			identity(agency, base, version),
			obj({
				InstrumentName:
					draft.name === undefined ? undefined : [intl(draft.name)],
				Label:
					draft.title === undefined ? undefined : [structured(draft.title)],
				Description:
					draft.description === undefined
						? undefined
						: structured(draft.description),
				ControlConstructReference: ref(top),
			}),
		),
	);
	return { own, banks: [...banks] };
}

/** An input's type as a value representation; codes become a list of the instrument's own. */
function representation(
	domain: ValueDomain,
	name: string,
	id: (local: string) => Identity,
	emit: (it: Item) => Item,
): JsonObject {
	if (domain.kind === "number")
		return obj({
			$type: "NumericDomain",
			NumericTypeCode: codeValue(domain.decimals ? "Decimal" : "Integer"),
			DecimalPositions: domain.decimals,
		});
	if (domain.kind === "open")
		return obj({ $type: "TextDomain", MaxLength: domain.maxLength });
	const codes: readonly Code[] = domain.codes;
	const cats = codes.map((c, i) =>
		emit(
			item("Category", id(`input-${name}-cat-${i}`), {
				Label: [structured(c.label)],
			}),
		),
	);
	const list = emit(
		item("CodeList", id(`input-${name}-codes`), {
			Code: codes.map((c, i) => ({
				...id(`input-${name}-code-${i}`),
				Value: codeValue(c.code),
				CategoryReference: ref(cats[i] as Item),
			})),
		}),
	);
	return { $type: "CodeDomain", CodeListReference: ref(list) };
}

/** A bank's shared universe, as the bank publishes it (`universe-<name>`), from whichever question emits it. */
function bankUniverse(
	u: Extract<UniverseRef, { kind: "ref" }>,
	inReach: ParsedInstrument["banks"],
	brought: Map<string, readonly Item[]>,
): Item | undefined {
	const bank = inReach[u.alias];
	const entry = bank?.env.universes[u.name];
	if (bank === undefined || entry === undefined) return undefined;
	const path = `universes/${u.name}.yaml`;
	// Built as the bank builds it, at the version it was evaluated at, so it's the same item.
	const made = sharedUniverseItem(
		u.name,
		entry,
		bank.agency ?? UNDECLARED_AGENCY,
		bank.versions?.[path] ?? UNVERSIONED,
	);
	brought.set(`${u.alias}:${path}`, [made]);
	return made;
}

/**
 * The instrument's DDI as one document: its own items and every asked question's bank
 * items, keyed once, with any identity two different items would share.
 */
export function instrumentDocument(e: ElaboratedInstrument): {
	readonly document: DdiDocument;
	readonly collisions: readonly Collision<string>[];
} {
	const sources: (readonly [string, readonly Item[]])[] = [
		["instrument", e.own],
		...e.banks,
	];
	return {
		document: documentOf(sources.flatMap(([, items]) => items)),
		collisions: collisions(sources),
	};
}

/** Every variable an instrument records or computes, by its exported name. */
function definedNames(draft: InstrumentDraft): ReadonlySet<string> {
	const out = new Set(draft.inputs.map((i) => i.name));
	const walk = (nodes: readonly Node[]): void => {
		for (const n of nodes)
			if (n.kind === "ask") {
				if (n.as !== undefined) out.add(n.as);
				else if (n.question !== undefined)
					for (const d of definedVariables(n.question.evaluation.draft))
						out.add(d.name);
			} else if (n.kind === "compute" && n.name !== undefined) out.add(n.name);
			else if (n.kind === "section" || n.kind === "each") walk(n.flow);
			else if (n.kind === "roster") {
				if (n.name !== undefined) out.add(`${n.name}_index`);
				walk(n.flow);
			} else if (n.kind === "if") {
				for (const b of n.branches) walk(b.then);
				walk(n.else ?? []);
			}
	};
	walk(draft.flow);
	return out;
}
