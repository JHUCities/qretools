/**
 * An instrument's DDI read back into a flow: the one reader every program that runs,
 * exports or describes an instrument from its DDI starts from. Any producer's DDI is
 * read, through `ddiIndexOf` and `deref`, and its structure is kept whole:
 * - a condition is parsed when it is VTL (or says no language) and every name in it is
 *   bound, through its command's InParameter and Binding, to the OutParameter of a
 *   Variable, a computed value or a loop; otherwise it is kept as written;
 * - what elaborate.ts lowers is lifted back beside it: a check after its ask, an ask
 *   asked again until its checks hold, a roster by count or by `more`, a coded answer's
 *   words shown in a text (`label(x)`), a screen-out. Where the pattern isn't there, the
 *   construct is read as DDI says it (an `if` with its type, a `loop`), never guessed.
 * Anything it can't read is a finding at the DDI item's ID.
 */

import { DDI_FUNCTIONS, type Expr, namesOf } from "../cond/ast.ts";
import { parseCondition } from "../cond/parse.ts";
import { NOT_TICKED, TICKED } from "../ddi/elaborate.ts";
import {
	asList,
	asObj,
	DDI_DEPTH,
	type DdiIndex,
	deref,
	type Indexed,
	latestOf,
	refUrn,
	str,
	words,
} from "../ddi/read.ts";
import type { Finding } from "../findings.ts";
import { STOP } from "./draft.ts";

/** A command as written, in its program language (`VTL`) when it says. */
export interface Command {
	readonly text: string;
	readonly language?: string;
}

/** A code of a question or an input: its value as written, and its words. */
export interface Choice {
	readonly code: string;
	readonly label: string;
}

/** How a question or an input is answered. */
export type Domain =
	| {
			readonly kind: "choice";
			/** One answer, or as many as apply (one variable per option). */
			readonly many: boolean;
			readonly choices: readonly Choice[];
	  }
	| {
			readonly kind: "number";
			readonly min?: number;
			readonly max?: number;
			readonly decimals: number;
	  }
	| { readonly kind: "text"; readonly maxLength?: number };

/** A bank question, as its asks show it. */
export interface Question {
	/** Its QuestionItem's DDI ID. */
	readonly id: string;
	readonly urn: string;
	readonly name: string;
	readonly domain: Domain;
}

/** What a name in a condition or a text stands for. */
export type Source =
	| {
			readonly kind: "answer";
			/** The variable it is recorded as (the data's column). */
			readonly variable: string;
			/** The asks that record it, by DDI ID: more than one in exclusive branches. */
			readonly asks: readonly string[];
			readonly question: Question;
			/** For a select-all option: its code, and which values of the variable are a tick and none. */
			readonly option?: {
				readonly code: string;
				readonly ticked: string;
				readonly unticked: string;
			};
	  }
	| {
			readonly kind: "input";
			readonly variable: string;
			readonly domain?: Domain;
	  }
	| { readonly kind: "compute"; readonly variable: string }
	/** The row number of a loop (a roster's `index`), by the loop's DDI ID. */
	| { readonly kind: "row"; readonly loop: string };

/** A condition parsed, each of its names bound to what it stands for. */
export interface Parsed {
	readonly kind: "parsed";
	/** As the DDI writes it (for a lifted check or roster, the lowered form). */
	readonly command: Command;
	readonly expr: Expr;
	readonly sources: ReadonlyMap<string, Source>;
}

/** A condition: parsed, or kept as written (another language, or names left unbound). */
export type Condition =
	| Parsed
	| { readonly kind: "verbatim"; readonly command: Command };

/** A piece of displayed text: words, or a value piped in (a coded answer's words for `label`). */
export type Part =
	| { readonly kind: "text"; readonly text: string }
	| {
			readonly kind: "value";
			readonly source: Source;
			readonly label?: true;
	  };

export interface Check {
	readonly id: string;
	readonly urn: string;
	/** TypeOfIfThenElse as written (`blocking`, `warning`, `info`). */
	readonly severity: string;
	/** What must hold of the answers (the author's `ensure`). */
	readonly ensure: Parsed;
	readonly message?: readonly Part[];
}

/** Every step's DDI ID (for findings) and URN (for links). */
interface At {
	readonly id: string;
	readonly urn: string;
}

export type Step =
	| (At & {
			readonly kind: "ask";
			readonly question: Question;
			/** What it records: each variable, and an option's code for a select-all. */
			readonly records: readonly {
				readonly variable: string;
				readonly code?: string;
			}[];
			/** The question's text with its fills piped in. */
			readonly text: readonly Part[];
			/** Its `ResponseSequence.ItemSequenceType` (`Random`, `Rotate`), verbatim. */
			readonly responseOrder?: string;
			readonly checks: readonly Check[];
	  })
	| (At & { readonly kind: "say"; readonly text: readonly Part[] })
	| (At & {
			readonly kind: "compute";
			readonly variable: string;
			readonly value: Condition;
	  })
	| (At & {
			readonly kind: "if";
			/** TypeOfIfThenElse as written: a check not read as one has its severity here. */
			readonly type?: string;
			readonly branches: readonly {
				readonly cond: Condition;
				readonly then: readonly Step[];
			}[];
			readonly else?: readonly Step[];
	  })
	/** Screen out: say its words, then end; `else` is the rest of the flow. */
	| (At & {
			readonly kind: "stop";
			readonly cond: Condition;
			readonly say: readonly Step[];
			readonly else: readonly Step[];
	  })
	/** A roster by count, or an `each` over one: rows 1 to the count, at most `max`. */
	| (At & {
			readonly kind: "count";
			readonly count: Parsed;
			readonly max?: number;
			readonly flow: readonly Step[];
	  })
	/** A roster by `more`: rows while `more` holds after each, at most `max`. */
	| (At & {
			readonly kind: "repeat";
			readonly more: Parsed;
			readonly max: number;
			readonly flow: readonly Step[];
	  })
	/** A loop read as DDI says it, not as a roster: its condition is LoopWhile, UntilCondition or WhileCondition. */
	| (At & {
			readonly kind: "loop";
			readonly construct: "Loop" | "RepeatUntil" | "RepeatWhile";
			readonly cond: Condition;
			readonly flow: readonly Step[];
	  })
	| (At & {
			readonly kind: "section";
			readonly name?: string;
			readonly label?: string;
			/** Its `ItemSequenceType` (`Random`, `Rotate`), verbatim. */
			readonly order?: string;
			readonly flow: readonly Step[];
	  });

export interface Instrument extends At {
	readonly name?: string;
	readonly label?: string;
	readonly description?: string;
	readonly flow: readonly Step[];
}

export interface ReadInstruments {
	/** Each instrument, its newest version, in document order. */
	readonly instruments: readonly Instrument[];
	/** The values given before a survey starts: Variables no question records. */
	readonly inputs: readonly Extract<Source, { kind: "input" }>[];
}

export type ReadCode = "ddi-unread" | "ddi-verbatim";

/**
 * Every instrument in a DDI index, as a flow. Words are in `lang` where the DDI has them.
 * Total: what can't be read is left out of the flow with an error at its item (`ddi-unread`),
 * and a condition kept as written says why (`ddi-verbatim`, advice).
 */
export function readInstruments(
	index: DdiIndex,
	lang?: string,
): {
	readonly value: ReadInstruments;
	readonly findings: readonly Finding<ReadCode>[];
} {
	// One walk, many readers: a local list, never passed around, is simpler than threading one.
	const findings: Finding<ReadCode>[] = [];
	const unread = (at: string, message: string) =>
		findings.push({ code: "ddi-unread", severity: "error", path: at, message });
	const idOf = (it: Indexed) => str(it.item.ID) ?? it.urn;
	const said = (j: unknown) => words(j, lang);
	/** What a reference or a definition is known by: the URN of the item it names. */
	const keyOf = (j: unknown): string => {
		const urn = refUrn(j);
		return urn === undefined ? "" : (deref(index, j)?.urn ?? urn);
	};
	const items = [...index.byUrn.values()];
	const ofType = (type: string) =>
		items.filter((it) => it.type === type && it.owner === undefined);

	const domainOf = (d: JsonLike): Domain | undefined => {
		const type = str(d?.$type);
		if (type === "CodeDomain")
			return {
				kind: "choice",
				// A question's own outputs say whether it is select-all (below); an input never is.
				many: false,
				choices: asList(deref(index, d?.CodeListReference)?.item.Code).map(
					(c) => ({
						code: str(asObj(c.Value)?.StringValue) ?? "",
						label: said(deref(index, c.CategoryReference)?.item.Label) ?? "",
					}),
				),
			};
		if (type === "NumericDomain") {
			const range = asList(d?.NumberRange)[0];
			const min = asObj(range?.Low)?.DecimalValue;
			const max = asObj(range?.High)?.DecimalValue;
			return {
				kind: "number",
				...(typeof min === "number" && { min }),
				...(typeof max === "number" && { max }),
				decimals:
					typeof d?.DecimalPositions === "number" ? d.DecimalPositions : 0,
			};
		}
		if (type === "TextDomain")
			return {
				kind: "text",
				...(typeof d?.MaxLength === "number" && { maxLength: d.MaxLength }),
			};
		return undefined;
	};

	// Each question's outputs, by key: an option's code where the output is one option's.
	const outputs = new Map<string, { code?: string }>();
	const questions = new Map<string, Question>();
	for (const q of ofType("QuestionItem")) {
		let many = false;
		for (const out of asList(q.item.OutParameter)) {
			const included = asObj(
				asObj(asObj(out.ValueRepresentation)?.CodeSubsetInformation)
					?.IncludedCode,
			);
			const code = asList(included?.CodeReference)[0];
			// One output per option, each a subset of the codes: select all that apply.
			if (code !== undefined) many = true;
			const value =
				code === undefined
					? undefined
					: str(asObj(deref(index, code)?.item.Value)?.StringValue);
			const key = keyOf(out);
			if (key !== "")
				outputs.set(key, value === undefined ? {} : { code: value });
		}
		const domain = domainOf(asObj(q.item.ResponseDomain));
		if (domain === undefined) {
			unread(idOf(q), "How this question is answered can't be read.");
			continue;
		}
		questions.set(q.urn, {
			id: idOf(q),
			urn: q.urn,
			name: said(q.item.QuestionItemName) ?? idOf(q),
			domain: domain.kind === "choice" ? { ...domain, many } : domain,
		});
	}
	// Into each variable's OutParameter: the asks that record it, and the question's output.
	const recordedBy = new Map<string, { ask: string; output: string }[]>();
	for (const c of ofType("QuestionConstruct"))
		for (const b of asList(c.item.Binding)) {
			const source = keyOf(b.SourceParameterReference);
			const target = keyOf(b.TargetParameterReference);
			if (outputs.has(source))
				recordedBy.set(target, [
					...(recordedBy.get(target) ?? []),
					{ ask: idOf(c), output: source },
				]);
		}
	const ticks = tickCodes(index, items);

	// What each parameter stands for, by key: the definitions only.
	const params = new Map<string, Source>();
	const inputs: [string, Extract<Source, { kind: "input" }>][] = [];
	for (const v of ofType("Variable")) {
		const out = asObj(v.item.OutParameter);
		const variable = said(v.item.VariableName);
		const key = keyOf(out);
		if (key === "" || variable === undefined) continue;
		const reference = asList(v.item.QuestionReference)[0];
		const representation = asObj(
			asObj(v.item.VariableRepresentation)?.ValueRepresentation,
		);
		if (reference === undefined) {
			const domain = domainOf(asObj(out?.ValueRepresentation));
			const input = {
				kind: "input" as const,
				variable,
				...(domain !== undefined && { domain }),
			};
			params.set(key, input);
			if (latestOf(index, v) === v) inputs.push([key, input]);
			continue;
		}
		const question = questions.get(deref(index, reference)?.urn ?? "");
		if (question === undefined) continue;
		const asks = recordedBy.get(key) ?? [];
		const code = outputs.get(asks[0]?.output ?? "")?.code;
		const ticked =
			str(representation?.$type) === "CodeDomain"
				? ticks.get(keyOf(representation?.CodeListReference))
				: undefined;
		params.set(key, {
			kind: "answer",
			variable,
			asks: asks.map((a) => a.ask),
			question,
			...(code !== undefined &&
				ticked !== undefined && { option: { code, ...ticked } }),
		});
	}
	for (const c of ofType("ComputationItem")) {
		const assigned = asObj(c.item.AssignedVariableReference);
		const key = keyOf(assigned);
		const variable = said(assigned?.ParameterName) ?? str(assigned?.Alias);
		if (key !== "" && variable !== undefined && !params.has(key))
			params.set(key, { kind: "compute", variable });
	}
	for (const l of ofType("Loop")) {
		const key = keyOf(l.item.LoopVariableReference);
		if (key !== "") params.set(key, { kind: "row", loop: idOf(l) });
	}
	// A roster by `more` counts its rows in the first step of its body: that is its row.
	const counterOf = (r: Indexed): Indexed | undefined => {
		const first = deref(
			index,
			asList(
				deref(index, r.item.UntilConstructReference)?.item
					.ControlConstructReference,
			)[0],
		);
		return first?.type === "ComputationItem" ? first : undefined;
	};
	for (const r of ofType("RepeatUntil")) {
		const key = keyOf(counterOf(r)?.item.AssignedVariableReference);
		if (key !== "") params.set(key, { kind: "row", loop: idOf(r) });
	}

	/** A command, parsed with each name resolved through its bindings, or kept as written. */
	const conditions = new Map<unknown, Condition | undefined>();
	const conditionOf = (code: unknown, at: string): Condition | undefined => {
		// Read once: a check's command is tried as one, then as an if.
		if (conditions.has(code)) return conditions.get(code);
		const read = readCondition(code, at);
		conditions.set(code, read);
		return read;
	};
	const readCondition = (code: unknown, at: string): Condition | undefined => {
		// shortcut: a CommandCode may hold the same command in several languages; the first is read.
		const cmd = asList(asObj(code)?.Command)[0];
		const text = str(cmd?.CommandContent);
		if (cmd === undefined || text === undefined) {
			unread(at, "There's no command for a condition or value here.");
			return undefined;
		}
		const language = str(asObj(cmd.ProgramLanguage)?.StringValue);
		const command = { text, ...(language !== undefined && { language }) };
		const verbatim = (message: string): Condition => {
			findings.push({
				code: "ddi-verbatim",
				severity: "info",
				path: at,
				message,
			});
			return { kind: "verbatim", command };
		};
		if (language !== undefined && language.toUpperCase() !== "VTL")
			return verbatim(`A condition in ${language} is kept as written.`);
		const parsed = parseCondition(text, DDI_FUNCTIONS);
		if (parsed.problems.length > 0)
			return verbatim(`\`${text}\` isn't VTL this reads.`);
		const sources = new Map<string, Source>();
		for (const p of asList(cmd.InParameter)) {
			const alias = str(p.Alias);
			const binding = asList(cmd.Binding).find(
				(b) => keyOf(b.TargetParameterReference) === keyOf(p),
			);
			const source = params.get(keyOf(binding?.SourceParameterReference));
			if (alias === undefined || source === undefined)
				return verbatim(`What \`${alias ?? "?"}\` refers to can't be told.`);
			sources.set(alias, source);
		}
		const unbound = namesOf(parsed.expr).find((n) => !sources.has(n.name));
		if (unbound !== undefined)
			return verbatim(`\`${unbound.name}\` isn't bound to anything.`);
		return { kind: "parsed", command, expr: parsed.expr, sources };
	};
	const parsedOf = (code: unknown, at: string): Parsed | undefined => {
		const c = conditionOf(code, at);
		return c?.kind === "parsed" ? c : undefined;
	};

	// A coded answer's words, as the elaborator lowers `label(x)`: a reset to null, then one
	// IfThenElse per code, each assigning its words to the same text variable. Read as x's label.
	const labels = new Map<string, Source>();
	const adapters = new Set<Indexed>();
	for (const s of ofType("Sequence")) {
		const [reset, ...choices] = asList(s.item.ControlConstructReference).map(
			(r) => deref(index, r),
		);
		const assigned = keyOf(reset?.item.AssignedVariableReference);
		// Each choice exactly as the elaborator writes it: an if whose only step assigns the words.
		const assigns = (c: Indexed | undefined) => {
			const then = deref(index, c?.item.ThenConstructReference);
			return (
				c?.type === "IfThenElse" &&
				c.item.ElseIf === undefined &&
				c.item.ElseConstructReference === undefined &&
				then?.type === "ComputationItem" &&
				keyOf(then.item.AssignedVariableReference) === assigned
			);
		};
		if (
			reset?.type !== "ComputationItem" ||
			str(asList(asObj(reset.item.CommandCode)?.Command)[0]?.CommandContent) !==
				"null" ||
			assigned === "" ||
			choices.length === 0 ||
			!choices.every(assigns)
		)
			continue;
		const first = choices[0];
		const cond =
			first === undefined
				? undefined
				: parsedOf(first.item.IfCondition, idOf(first));
		const source =
			cond === undefined ? undefined : [...cond.sources.values()][0];
		if (source === undefined) continue;
		labels.set(assigned, source);
		adapters.add(s);
	}
	const pipedValue = (key: string): Part | undefined => {
		const label = labels.get(key);
		if (label !== undefined)
			return { kind: "value", source: label, label: true };
		const source = params.get(key);
		return source === undefined ? undefined : { kind: "value", source };
	};

	/** Displayed text: words and piped values. */
	const textOf = (
		dynamic: unknown,
		piped: (key: string) => Part | undefined,
		at: string,
	): readonly Part[] =>
		asList(asObj(asList(dynamic)[0])?.TextContent).flatMap((t): Part[] => {
			const literal = said(asObj(t.Text));
			if (literal !== undefined) return [{ kind: "text", text: literal }];
			const part = piped(keyOf(t.SourceParameterReference));
			if (part === undefined) {
				unread(at, "What a value in this text refers to can't be told.");
				return [];
			}
			return [part];
		});

	type Path = ReadonlySet<Indexed>;
	/** Whether a step can be read inside `path`: not one it is already within, nor nested too deep. */
	const enters = (it: Indexed, at: string, path: Path): boolean => {
		if (path.has(it)) unread(at, "A step this points to contains it.");
		else if (path.size > DDI_DEPTH)
			unread(at, "Steps are nested too deep here to read.");
		else return true;
		return false;
	};
	/** The steps a reference stands for. `path` stops a cycle; DDI_DEPTH, a document nested past reading. */
	const under = (refs: unknown, at: string, path: Path): Step[] =>
		asReferences(refs).flatMap((r) => {
			const found = deref(index, r);
			if (found === undefined) {
				unread(at, "A step this points to isn't in the DDI.");
				return [];
			}
			if (!enters(found, at, path)) return [];
			return construct(found, new Set([...path, found]));
		});

	const ask = (it: Indexed, checks: readonly Check[]): Step[] => {
		const c = it.item;
		const id = idOf(it);
		const question = questions.get(
			deref(index, c.QuestionReference)?.urn ?? "",
		);
		if (question === undefined) {
			unread(id, "The question asked here isn't in the DDI, or can't be read.");
			return [];
		}
		const fills = new Map<string, Part>();
		const records: { variable: string; code?: string }[] = [];
		for (const b of asList(c.Binding)) {
			const source = keyOf(b.SourceParameterReference);
			const target = keyOf(b.TargetParameterReference);
			const recorded = params.get(target);
			if (outputs.has(source) && recorded?.kind === "answer") {
				const code = outputs.get(source)?.code;
				records.push({
					variable: recorded.variable,
					...(code !== undefined && { code }),
				});
				continue;
			}
			const part = pipedValue(source);
			if (part === undefined)
				unread(id, "What a value in this text refers to can't be told.");
			else fills.set(target, part);
		}
		const order = str(asObj(c.ResponseSequence)?.ItemSequenceType);
		const asked = deref(index, c.QuestionReference);
		return [
			{
				kind: "ask",
				id,
				urn: it.urn,
				question,
				records,
				text: textOf(asked?.item.QuestionText, (k) => fills.get(k), id),
				...(order !== undefined && { responseOrder: order }),
				checks,
			},
		];
	};

	/** A check: `not nvl(E, true)` with its severity, the author's E read back. */
	const check = (it: Indexed, path: Path): Check | undefined => {
		const id = idOf(it);
		const cond = parsedOf(it.item.IfCondition, id);
		const e = cond?.expr;
		const inner =
			e?.kind === "unary" &&
			e.op === "not" &&
			e.operand.kind === "call" &&
			e.operand.fn === "nvl" &&
			e.operand.args[1]?.kind === "boolean" &&
			e.operand.args[1].value === true
				? e.operand.args[0]
				: undefined;
		if (cond === undefined || inner === undefined) return undefined;
		// A check says its message, or nothing: anything more isn't one the elaborator wrote.
		const then = under(it.item.ThenConstructReference, id, path);
		const message = then[0];
		if (then.length > 1 || (message !== undefined && message.kind !== "say"))
			return undefined;
		return {
			id,
			urn: it.urn,
			severity: str(asObj(it.item.TypeOfIfThenElse)?.StringValue) ?? "",
			ensure: { ...cond, expr: inner },
			...(message?.kind === "say" && { message: message.text }),
		};
	};

	/** A run of constructs: each ask followed by its typed IfThenElses takes them as checks. */
	const gather = (refs: unknown, at: string, path: Path): Step[] => {
		const found = asReferences(refs).map((r) => deref(index, r));
		const out: Step[] = [];
		for (let i = 0; i < found.length; i++) {
			const f = found[i];
			if (f === undefined) {
				unread(at, "A step this points to isn't in the DDI.");
				continue;
			}
			if (!enters(f, at, path)) continue;
			const inner = new Set([...path, f]);
			if (f.type !== "QuestionConstruct") {
				out.push(...construct(f, inner));
				continue;
			}
			const checks: Check[] = [];
			for (let next = found[i + 1]; isCheck(next); next = found[i + 1]) {
				const ch = check(next, new Set([...path, next]));
				if (ch === undefined) break;
				checks.push(ch);
				i++;
			}
			out.push(...ask(f, checks));
		}
		return out;
	};

	const construct = (it: Indexed, path: Path): Step[] => {
		const c = it.item;
		const id = idOf(it);
		const at = { id, urn: it.urn };
		switch (it.type) {
			case "QuestionConstruct":
				return ask(it, []);
			case "StatementItem":
				return [
					{ kind: "say", ...at, text: textOf(c.DisplayText, pipedValue, id) },
				];
			case "ComputationItem": {
				const value = conditionOf(c.CommandCode, id);
				const assigned = asObj(c.AssignedVariableReference);
				const variable = said(assigned?.ParameterName) ?? str(assigned?.Alias);
				if (variable === undefined)
					unread(id, "The value computed here has no name.");
				return value === undefined || variable === undefined
					? []
					: [{ kind: "compute", ...at, variable, value }];
			}
			case "Sequence": {
				if (adapters.has(it)) return [];
				const flow = gather(c.ControlConstructReference, id, path);
				const name = said(c.ConstructName);
				const label = said(c.Label);
				const order = str(asObj(c.ConstructSequence)?.ItemSequenceType);
				return name === undefined && label === undefined && order === undefined
					? flow
					: [
							{
								kind: "section",
								...at,
								...(name !== undefined && { name }),
								...(label !== undefined && { label }),
								...(order !== undefined && { order }),
								flow,
							},
						];
			}
			case "IfThenElse": {
				const type = str(asObj(c.TypeOfIfThenElse)?.StringValue);
				const first = conditionOf(c.IfCondition, id);
				if (first === undefined) return [];
				if (type === STOP)
					return [
						{
							kind: "stop",
							...at,
							cond: first,
							say: under(c.ThenConstructReference, id, path),
							else: under(c.ElseConstructReference, id, path),
						},
					];
				const arm = (cond: Condition, ref: unknown) => {
					const then = under(ref, id, path);
					return { cond, then };
				};
				const branches = [arm(first, c.ThenConstructReference)];
				for (const [i, e] of asList(c.ElseIf).entries()) {
					const cond = conditionOf(e.IfCondition, `${id}.elif-${i + 1}`);
					if (cond !== undefined)
						branches.push(arm(cond, e.ThenConstructReference));
				}
				return [
					{
						kind: "if",
						...at,
						...(type !== undefined && { type }),
						branches,
						...(c.ElseConstructReference !== undefined && {
							else: under(c.ElseConstructReference, id, path),
						}),
					},
				];
			}
			case "Loop":
				return loop(it, path);
			case "RepeatUntil":
				return repeat(it, path);
			case "RepeatWhile": {
				const cond = conditionOf(c.WhileCondition, id);
				return cond === undefined
					? []
					: [
							{
								kind: "loop",
								...at,
								construct: "RepeatWhile",
								cond,
								flow: under(c.WhileConstructReference, id, path),
							},
						];
			}
			default:
				// shortcut: Split and SplitJoin (constructs run in parallel) aren't read.
				unread(id, `A ${it.type} can't be read as a step.`);
				return [];
		}
	};

	/** A count roster or an `each`: `v <= C`, or `v <= C and v <= N` with its max. */
	const loop = (it: Indexed, path: Path): Step[] => {
		const id = idOf(it);
		const cond = conditionOf(it.item.LoopWhile, id);
		if (cond === undefined) return [];
		const flow = under(it.item.ControlConstructReference, id, path);
		const row = params.get(keyOf(it.item.LoopVariableReference));
		const parsed = cond.kind === "parsed" ? cond : undefined;
		const isRow = (x: Expr | undefined) =>
			x?.kind === "name" &&
			row?.kind === "row" &&
			parsed?.sources.get(x.name) === row;
		const atMost = (x: Expr | undefined) =>
			x?.kind === "binary" && x.op === "<=" && isRow(x.left)
				? x.right
				: undefined;
		const e = parsed?.expr;
		const limited =
			e?.kind === "binary" && e.op === "and"
				? { count: atMost(e.left), max: atMost(e.right) }
				: { count: atMost(e) };
		const max =
			"max" in limited && limited.max?.kind === "number"
				? limited.max.value
				: undefined;
		if (
			parsed === undefined ||
			limited.count === undefined ||
			("max" in limited && max === undefined)
		)
			return [{ kind: "loop", id, urn: it.urn, construct: "Loop", cond, flow }];
		return [
			{
				kind: "count",
				id,
				urn: it.urn,
				count: { ...parsed, expr: limited.count },
				...(max !== undefined && { max }),
				flow,
			},
		];
	};

	/**
	 * A roster by `more`: `nvl(v, 0) >= 1 and not nvl(M, false) or nvl(v, 0) >= N`, its body
	 * a Sequence starting with the row counter; or a check's `nvl(E, true)` around an ask.
	 */
	const repeat = (it: Indexed, path: Path): Step[] => {
		const id = idOf(it);
		const cond = conditionOf(it.item.UntilCondition, id);
		if (cond === undefined) return [];
		const body = deref(index, it.item.UntilConstructReference);
		const parts = body?.item.ControlConstructReference;
		const parsed = cond.kind === "parsed" ? cond : undefined;
		const e = parsed?.expr;
		const unlifted = (
			flow: readonly Step[] = under(it.item.UntilConstructReference, id, path),
		): Step[] => [
			{ kind: "loop", id, urn: it.urn, construct: "RepeatUntil", cond, flow },
		];
		if (body === undefined) return unlifted();
		const inBody = new Set([...path, body]);
		// A blocking check: ask again until it holds. The body is the ask and its checks.
		if (
			e?.kind === "call" &&
			e.fn === "nvl" &&
			e.args[1]?.kind === "boolean" &&
			e.args[1].value
		) {
			const flow = under(it.item.UntilConstructReference, id, path);
			const [only] = flow;
			return flow.length === 1 && only?.kind === "ask" && only.checks.length > 0
				? flow
				: unlifted(flow);
		}
		const counter = counterOf(it);
		const isCounter = (s: Source | undefined) =>
			counter !== undefined && s?.kind === "row" && s.loop === id;
		const counted = (x: Expr | undefined, op: string) =>
			x?.kind === "binary" &&
			x.op === op &&
			x.left.kind === "call" &&
			x.left.fn === "nvl" &&
			x.left.args[0]?.kind === "name" &&
			isCounter(parsed?.sources.get(x.left.args[0].name))
				? x.right
				: undefined;
		const started = e?.kind === "binary" && e.op === "or" ? e.left : undefined;
		const limit =
			e?.kind === "binary" && e.op === "or"
				? counted(e.right, ">=")
				: undefined;
		const more =
			started?.kind === "binary" &&
			started.op === "and" &&
			counted(started.left, ">=")?.kind === "number" &&
			started.right.kind === "unary" &&
			started.right.op === "not" &&
			started.right.operand.kind === "call" &&
			started.right.operand.fn === "nvl"
				? started.right.operand.args[0]
				: undefined;
		if (parsed === undefined || more === undefined || limit?.kind !== "number")
			return unlifted();
		return [
			{
				kind: "repeat",
				id,
				urn: it.urn,
				more: { ...parsed, expr: more },
				max: limit.value,
				flow: gather(asReferences(parts).slice(1), id, inBody),
			},
		];
	};

	const instruments = [...new Set(index.latest.values())]
		.filter((it) => it.type === "Instrument" && it.owner === undefined)
		.map((it): Instrument => {
			const name = said(it.item.InstrumentName);
			const label = said(it.item.Label);
			const description = said(it.item.Description);
			return {
				id: idOf(it),
				urn: it.urn,
				...(name !== undefined && { name }),
				...(label !== undefined && { label }),
				...(description !== undefined && { description }),
				flow: under(it.item.ControlConstructReference, idOf(it), new Set([it])),
			};
		});
	return {
		value: {
			instruments,
			// A coded answer's words are held in a Variable of their own: not an input.
			inputs: inputs.filter(([key]) => !labels.has(key)).map(([, i]) => i),
		},
		findings,
	};
}

type JsonLike = Readonly<Record<string, unknown>> | undefined;

/** A field's references, one or a list. */
const asReferences = (refs: unknown): readonly unknown[] =>
	Array.isArray(refs) ? refs : refs === undefined ? [] : [refs];

/** Whether a construct is a typed IfThenElse other than a screen-out: a check, if it reads as one. */
const isCheck = (it: Indexed | undefined): it is Indexed => {
	const type = str(asObj(it?.item.TypeOfIfThenElse)?.StringValue);
	return it?.type === "IfThenElse" && type !== undefined && type !== STOP;
};

/** For each select-all list (by URN), the value that is a tick, as its categories say. */
function tickCodes(
	index: DdiIndex,
	items: readonly Indexed[],
): ReadonlyMap<string, { ticked: string; unticked: string }> {
	const out = new Map<string, { ticked: string; unticked: string }>();
	for (const list of items) {
		if (list.type !== "CodeList" || list.owner !== undefined) continue;
		const qualified = (qualification: string) =>
			asList(list.item.Code)
				.filter(
					(c) =>
						str(
							asObj(deref(index, c.CategoryReference)?.item.Generation)
								?.Qualification,
						) === qualification,
				)
				.map((c) => str(asObj(c.Value)?.StringValue))[0];
		const ticked = qualified(TICKED);
		const unticked = qualified(NOT_TICKED);
		if (ticked !== undefined && unticked !== undefined)
			out.set(list.urn, { ticked, unticked });
	}
	return out;
}
