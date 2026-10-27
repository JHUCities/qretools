/**
 * An instrument's control constructs as a tree (its map). From that same tree comes where
 * each question is asked: for each QuestionConstruct, the conditions on the way to it, the
 * loops around it, and the order of its section and options. So the map and the "Asked"
 * places can't disagree.
 * The walk starts at each instrument and follows each reference as written (the version it
 * names, else the newest). So a construct no instrument reaches is asked nowhere, and every
 * path to an ask is a place it is asked.
 * Conditions are the producer's commands as written. One in VTL (or in no language it
 * names) is also parsed, with what each of its names reads, so a page can say it in
 * words; any other language is kept verbatim.
 */

import {
	asList,
	asObj,
	DDI_DEPTH,
	DDI_FUNCTIONS,
	type DdiIndex,
	deref,
	type Expr,
	holesOf,
	type Indexed,
	latestOf,
	parseCondition,
	refUrn,
	str,
	words,
} from "@qretools/core";
import {
	dynamicTextOf,
	nameOf,
	type Ref,
	refOf,
	type Text,
	textOf,
} from "./text.ts";

/** A command as written, in its program language (`VTL`) when it says. */
export interface Command {
	readonly language?: string;
	readonly command: string;
	/** The command parsed, where it is VTL (or names no language) and reads cleanly. */
	readonly expr?: Expr;
	/**
	 * What each name in it reads, through its InParameter's Binding: the variable, computed
	 * value or loop that owns the source parameter. A name with no binding is absent.
	 */
	readonly reads?: ReadonlyMap<string, Ref>;
}

/** A condition on the way to an ask: its command, or that the command is not true. */
export interface Condition extends Command {
	readonly negated: boolean;
}

/** One place a question is asked. */
export interface Asking {
	/** The QuestionConstruct's URN. */
	readonly construct: string;
	/** Every condition that must hold for it to be asked, outermost first. */
	readonly conditions: readonly Condition[];
	/** The loops it is repeated in (Loop, RepeatUntil, RepeatWhile), nearest first. */
	readonly loops: readonly Ref[];
	/** The nearest enclosing Sequence's `ItemSequenceType` (`Random`, `Rotate`), verbatim. */
	readonly order?: string;
	/** The ask's own `ResponseSequence.ItemSequenceType`: the order its options are shown in. */
	readonly responseOrder?: string;
}

/** A question asked at one place in an instrument. */
export interface Ask {
	readonly kind: "ask";
	readonly construct: string;
	/** The question's newest URN. */
	readonly question: string;
	readonly responseOrder?: string;
	/** What each of the question's fills shows here, by its InParameter's URN, through the ask's Bindings. */
	readonly fills?: ReadonlyMap<string, Ref>;
}

/** An entry as a link names it: the anchor to go to, and its words. */
export interface Linked {
	readonly urn: string;
	readonly name?: string;
	readonly label?: Text;
}

/** An ask as the codebook draws it: with the entry recording its question, where there is one. */
export interface LinkedAsk extends Ask {
	readonly entry?: Linked;
}

/** One branch of an IfThenElse: the condition it is taken on, and what it holds. */
export interface Arm<A extends Ask = Ask> {
	readonly command?: Command;
	readonly steps: readonly Step<A>[];
}

/**
 * One construct of an instrument as a map shows it, its asks of type `A` (the walk's
 * `Ask`; the codebook's `LinkedAsk`). An unnamed Sequence with no order of its own is no
 * step: its steps are its parent's.
 */
export type Step<A extends Ask = Ask> =
	| A
	| { readonly kind: "say"; readonly construct: string; readonly text?: Text }
	| {
			readonly kind: "compute";
			readonly construct: string;
			readonly command?: Command;
			readonly assigns: readonly Ref[];
	  }
	| {
			readonly kind: "branch";
			readonly construct: string;
			/** TypeOfIfThenElse as written (`warning`, for an edit check). */
			readonly type?: string;
			/** The if, then each else-if, in order. */
			readonly arms: readonly Arm<A>[];
			readonly otherwise?: readonly Step<A>[];
	  }
	| {
			readonly kind: "loop";
			readonly construct: string;
			readonly ref: Ref;
			readonly loop: "Loop" | "RepeatUntil" | "RepeatWhile";
			/** LoopWhile, UntilCondition or WhileCondition. */
			readonly command?: Command;
			/** A Loop's counter, where it counts the common way: from a constant, up by one. */
			readonly counter?: { readonly name: string; readonly from: number };
			readonly steps: readonly Step<A>[];
	  }
	| {
			readonly kind: "section";
			readonly construct: string;
			readonly name?: string;
			readonly label?: Text;
			/** Its `ItemSequenceType` (`Random`, `Rotate`), verbatim. */
			readonly order?: string;
			readonly steps: readonly Step<A>[];
	  };

/** An instrument as a tree of steps. */
export interface Outline<A extends Ask = Ask> {
	readonly urn: string;
	readonly name?: string;
	readonly label?: Text;
	readonly description?: Text;
	readonly steps: readonly Step<A>[];
}

/** A CommandCode's first command; `owner` names the item a bound parameter belongs to. */
// shortcut: a CommandCode may hold the same command in several languages; the first is shown.
export function commandOf(
	code: unknown,
	owner?: (parameter: unknown) => Ref | undefined,
): Command | undefined {
	const c = asList(asObj(code)?.Command)[0];
	const command = str(c?.CommandContent);
	const language = str(asObj(c?.ProgramLanguage)?.StringValue);
	if (command === undefined) return undefined;
	const parsed =
		language === undefined || /^vtl/i.test(language)
			? parseCondition(command, DDI_FUNCTIONS)
			: undefined;
	const expr =
		parsed === undefined ||
		parsed.problems.length > 0 ||
		holesOf(parsed.expr).length > 0
			? undefined
			: parsed.expr;
	const reads = new Map<string, Ref>();
	for (const p of asList(c?.InParameter)) {
		const alias = str(p.Alias);
		const binding = asList(c?.Binding).find(
			(b) =>
				refUrn(b.TargetParameterReference) !== undefined &&
				refUrn(b.TargetParameterReference) === refUrn(p),
		);
		const ref =
			binding === undefined
				? undefined
				: owner?.(binding.SourceParameterReference);
		if (alias !== undefined && ref !== undefined) reads.set(alias, ref);
	}
	return {
		command,
		...(language !== undefined && { language }),
		...(expr !== undefined && { expr }),
		...(reads.size > 0 && { reads }),
	};
}

/** Every step in a tree of steps, in order, each before the steps it holds. */
export function allStepsOf<A extends Ask>(
	steps: readonly Step<A>[],
): Step<A>[] {
	return steps.flatMap((s): Step<A>[] => {
		switch (s.kind) {
			case "branch":
				return [
					s,
					...s.arms.flatMap((a) => allStepsOf(a.steps)),
					...allStepsOf(s.otherwise ?? []),
				];
			case "loop":
			case "section":
				return [s, ...allStepsOf(s.steps)];
			default:
				return [s];
		}
	});
}

export interface Flow {
	/** Each instrument as a tree, newest versions, in document order. */
	readonly instruments: readonly Outline[];
	/** Every place a question is asked, by the URN of the question's newest version. */
	readonly asked: ReadonlyMap<string, readonly Asking[]>;
	/** Each question's position in the instruments' flow, by the URN of its newest version. */
	readonly position: ReadonlyMap<string, number>;
}

/** What holds on the way down to a construct. */
interface Context {
	readonly conditions: readonly Condition[];
	readonly loops: readonly Ref[];
	readonly order?: string;
}

/** A parameter written in place (an assigned variable) as a reference to it. */
function parameterRef(p: unknown, lang?: string): Ref[] {
	const o = asObj(p);
	const urn = str(o?.URN);
	if (o === undefined || urn === undefined) return [];
	const name = nameOf({ type: "Parameter", urn, item: o }, lang);
	return [
		{
			kind: "ref",
			type: "Parameter",
			urn,
			...(name !== undefined && { name }),
		},
	];
}

/**
 * The flow of every instrument in the index, its newest version: each as a tree, and from
 * that tree every place a question is asked, so the map and the "Asked" lines can't disagree.
 */
export function flowOf(index: DdiIndex, lang?: string): Flow {
	const follow = (r: unknown) => deref(index, r);
	/** The item a parameter belongs to, at its newest version. */
	const owner = (p: unknown): Ref | undefined => {
		const it = follow(p)?.owner;
		return it === undefined ? undefined : refOf(latestOf(index, it), lang);
	};
	// `path` stops a cycle; DDI_DEPTH, a document nested past reading.
	// shortcut: a construct reached by several paths is expanded on each; memoise if a real document is slow.
	const under = (refs: unknown, path: ReadonlySet<Indexed>): Step[] =>
		path.size > DDI_DEPTH
			? []
			: (Array.isArray(refs) ? refs : refs === undefined ? [] : [refs]).flatMap(
					(r) => {
						const child = follow(r);
						return child === undefined || path.has(child)
							? []
							: stepsOf(child, new Set([...path, child]));
					},
				);
	const stepsOf = (node: Indexed, path: ReadonlySet<Indexed>): Step[] => {
		const o = node.item;
		const construct = node.urn;
		switch (node.type) {
			case "QuestionConstruct": {
				const found = follow(o.QuestionReference);
				if (found === undefined) return [];
				const responseOrder = str(asObj(o.ResponseSequence)?.ItemSequenceType);
				const fills = new Map(
					asList(o.Binding).flatMap((b): [string, Ref][] => {
						const to = refUrn(b.TargetParameterReference);
						const from = owner(b.SourceParameterReference);
						return to === undefined || from === undefined ? [] : [[to, from]];
					}),
				);
				return [
					{
						kind: "ask",
						construct,
						question: latestOf(index, found).urn,
						...(responseOrder !== undefined && { responseOrder }),
						...(fills.size > 0 && { fills }),
					},
				];
			}
			case "StatementItem": {
				const text = dynamicTextOf(o.DisplayText, follow, lang);
				return [
					{ kind: "say", construct, ...(text !== undefined && { text }) },
				];
			}
			case "ComputationItem": {
				const command = commandOf(o.CommandCode, owner);
				return [
					{
						kind: "compute",
						construct,
						...(command !== undefined && { command }),
						assigns: asList(o.AssignedVariableReference).flatMap((p) =>
							parameterRef(p, lang),
						),
					},
				];
			}
			case "IfThenElse": {
				const type = str(asObj(o.TypeOfIfThenElse)?.StringValue);
				const arm = (condition: unknown, then: unknown): Arm => {
					const command = commandOf(condition, owner);
					return {
						...(command !== undefined && { command }),
						steps: under(then, path),
					};
				};
				return [
					{
						kind: "branch",
						construct,
						...(type !== undefined && { type }),
						arms: [
							arm(o.IfCondition, o.ThenConstructReference),
							...asList(o.ElseIf).map((e) =>
								arm(e.IfCondition, e.ThenConstructReference),
							),
						],
						...(o.ElseConstructReference !== undefined && {
							otherwise: under(o.ElseConstructReference, path),
						}),
					},
				];
			}
			case "Loop":
			case "RepeatUntil":
			case "RepeatWhile": {
				const [condition, body] =
					node.type === "Loop"
						? [o.LoopWhile, o.ControlConstructReference]
						: node.type === "RepeatUntil"
							? [o.UntilCondition, o.UntilConstructReference]
							: [o.WhileCondition, o.WhileConstructReference];
				const command = commandOf(condition, owner);
				const variable = asObj(o.LoopVariableReference);
				const name =
					variable === undefined
						? undefined
						: words(variable.ParameterName, lang);
				const start = commandOf(o.InitialValue)?.command.trim();
				const step = commandOf(o.StepValue)
					?.command.replace(/\s+/g, " ")
					.trim();
				// shortcut: any other start or step keeps the loop's condition alone; say it if a bank needs it.
				const counter =
					name !== undefined &&
					start !== undefined &&
					/^-?\d+$/.test(start) &&
					step === `${name} + 1`
						? { name, from: Number(start) }
						: undefined;
				return [
					{
						kind: "loop",
						construct,
						ref: refOf(node, lang),
						loop: node.type,
						...(command !== undefined && { command }),
						...(counter !== undefined && { counter }),
						steps: under(body, path),
					},
				];
			}
			case "Sequence": {
				const steps = under(o.ControlConstructReference, path);
				const name = nameOf(node, lang);
				const label = textOf(words(o.Label, lang));
				const order = str(asObj(o.ConstructSequence)?.ItemSequenceType);
				return name === undefined && label === undefined && order === undefined
					? steps
					: [
							{
								kind: "section",
								construct,
								...(name !== undefined && { name }),
								...(label !== undefined && { label }),
								...(order !== undefined && { order }),
								steps,
							},
						];
			}
			default:
				// shortcut: Split and SplitJoin (constructs run in parallel) aren't shown.
				return [];
		}
	};
	const instruments = [...new Set(index.latest.values())]
		.filter((it) => it.type === "Instrument")
		.map((it): Outline => {
			const name = nameOf(it, lang);
			const label = textOf(words(it.item.Label, lang));
			const description = textOf(words(it.item.Description, lang));
			return {
				urn: it.urn,
				...(name !== undefined && { name }),
				...(label !== undefined && { label }),
				...(description !== undefined && { description }),
				steps: under(it.item.ControlConstructReference, new Set([it])),
			};
		});

	// Depth first, so questions are positioned in the order first asked.
	const asked = new Map<string, Asking[]>();
	const position = new Map<string, number>();
	const visit = (steps: readonly Step[], at: Context): void => {
		for (const s of steps)
			switch (s.kind) {
				case "ask":
					if (!position.has(s.question))
						position.set(s.question, position.size);
					asked.set(s.question, [
						...(asked.get(s.question) ?? []),
						{
							construct: s.construct,
							conditions: at.conditions,
							loops: at.loops,
							...(at.order !== undefined && { order: at.order }),
							...(s.responseOrder !== undefined && {
								responseOrder: s.responseOrder,
							}),
						},
					]);
					break;
				case "branch": {
					// Every arm before the one taken is false; its own condition (an else has none) true.
					const not = (arms: readonly Arm[]): Condition[] =>
						arms.flatMap((a) =>
							a.command === undefined ? [] : [{ ...a.command, negated: true }],
						);
					s.arms.forEach((arm, i) => {
						visit(arm.steps, {
							...at,
							conditions: [
								...at.conditions,
								...not(s.arms.slice(0, i)),
								...(arm.command === undefined
									? []
									: [{ ...arm.command, negated: false }]),
							],
						});
					});
					if (s.otherwise !== undefined)
						visit(s.otherwise, {
							...at,
							conditions: [...at.conditions, ...not(s.arms)],
						});
					break;
				}
				case "loop":
					visit(s.steps, { ...at, loops: [s.ref, ...at.loops] });
					break;
				case "section":
					visit(s.steps, {
						...at,
						...((s.order ?? at.order) !== undefined && {
							order: s.order ?? at.order,
						}),
					});
					break;
			}
	};
	for (const i of instruments) visit(i.steps, { conditions: [], loops: [] });
	return { instruments, asked, position };
}
