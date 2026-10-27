/**
 * An instrument's DDI read back into a small flow, to write as Qualtrics' QSF. The DDI is
 * the record of the survey, so the QSF is made from it, never from the instrument's YAML.
 * Only DDI shaped as instrument/elaborate.ts writes it is read, and only through its fields:
 * - a name in a condition goes through its command's InParameter and Binding to the
 *   OutParameter of a Variable, a computed value or a loop;
 * - an answer goes to the asks that bind into it;
 * - a select-all option goes to its code, and its tick through the Generation of the
 *   select-all list's categories.
 * Anything else is a finding at the DDI item's ID, never a guess from an identifier.
 */

import type { DdiDocument, ItemType, JsonObject } from "@qretools/core";
import {
	DDI_FUNCTIONS,
	type Expr,
	holesOf,
	NOT_TICKED,
	parseCondition,
	STOP,
	TICKED,
} from "@qretools/core";
import type { Finding } from "./findings.ts";

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
			/** Read at one round of a roster Qualtrics loops (an `each`'s row), not the current one. */
			readonly row?: number;
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

/** A condition: its expression, and what each of its names stands for. */
export interface Cond {
	readonly expr: Expr;
	readonly sources: ReadonlyMap<string, Source>;
}

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
	readonly severity: string;
	/** What must hold of the answers (the author's `ensure`). */
	readonly ensure: Cond;
	readonly message?: readonly Part[];
}

export type Step =
	| {
			readonly kind: "ask";
			readonly id: string;
			readonly question: Question;
			/** What it records: each variable, and an option's code for a select-all. */
			readonly records: readonly {
				readonly variable: string;
				readonly code?: string;
			}[];
			/** The question's text with its fills piped in. */
			readonly text: readonly Part[];
			readonly options?: "random" | "rotate";
			readonly checks: readonly Check[];
	  }
	| {
			readonly kind: "say";
			readonly id: string;
			readonly text: readonly Part[];
	  }
	| {
			readonly kind: "compute";
			readonly id: string;
			readonly variable: string;
			readonly value: Cond;
	  }
	| {
			readonly kind: "if";
			readonly id: string;
			readonly branches: readonly {
				readonly cond: Cond;
				readonly then: readonly Step[];
			}[];
			readonly else?: readonly Step[];
	  }
	/** Screen out: say its words, then end the survey (what follows is its else). */
	| {
			readonly kind: "stop";
			readonly id: string;
			readonly cond: Cond;
			readonly say: readonly Step[];
	  }
	/** A roster by count, or an `each` over one: rows 1 to the count, at most `max`. */
	| {
			readonly kind: "loop";
			readonly id: string;
			readonly count: Cond;
			readonly max?: number;
			readonly flow: readonly Step[];
	  }
	/** A roster by `more`: rows while `more` holds after each, at most `max`. */
	| {
			readonly kind: "repeat";
			readonly id: string;
			readonly more: Cond;
			readonly max: number;
			readonly flow: readonly Step[];
	  }
	| {
			readonly kind: "section";
			readonly id: string;
			readonly title?: string;
			readonly order?: "random" | "rotate";
			readonly flow: readonly Step[];
	  };

export interface ReadInstrument {
	readonly name?: string;
	readonly title?: string;
	/** Whether the bank has missing-value codes (on its variables, never a question's choices). */
	readonly missing?: true;
	readonly inputs: readonly Extract<Source, { kind: "input" }>[];
	readonly flow: readonly Step[];
}

type Obj = JsonObject;
const asObj = (j: unknown): Obj | undefined =>
	j !== null && typeof j === "object" && !Array.isArray(j)
		? (j as Obj)
		: undefined;
const asList = (j: unknown): readonly Obj[] =>
	Array.isArray(j)
		? (j.map(asObj).filter((o) => o !== undefined) as Obj[])
		: [];
const str = (j: unknown): string | undefined =>
	typeof j === "string" ? j : undefined;
/** The words of an InternationalString, a Label or a Content: the first language's. */
const words = (j: unknown): string | undefined => {
	const first = Array.isArray(j) ? j[0] : j;
	const o = asObj(first);
	const m = asObj(
		asObj(asList(o?.String)[0])?.MultilingualStringValue ??
			asObj(asList(o?.Content)[0])?.MultilingualStringValue ??
			o?.MultilingualStringValue,
	);
	return str(m?.Value);
};
const urnOf = (j: unknown): string | undefined => str(asObj(j)?.URN);

export function readInstrument(ddi: DdiDocument): {
	readonly instrument: ReadInstrument;
	readonly findings: readonly Finding[];
} {
	const findings: Finding[] = [];
	const unread = (id: string, message: string) =>
		findings.push({ code: "qsf-unread", severity: "error", path: id, message });

	/** An item a reference names: `{ $type, value: [agency, id, version] }`. */
	const deref = (r: unknown): { type: ItemType; item: Obj } | undefined => {
		const o = asObj(r);
		const type = str(o?.$type) as ItemType | undefined;
		const v = o?.value;
		if (type === undefined || !Array.isArray(v)) return undefined;
		const item = ddi[type]?.[v.join(":")];
		return item === undefined ? undefined : { type, item };
	};

	// What each parameter is, by URN: the definitions only.
	const params = new Map<string, Source>();
	// Into each variable's OutParameter: the asks that record it, and the question's output.
	const recordedBy = new Map<string, { ask: string; output: string }[]>();
	const questionOf = new Map<string, Question>();
	const outputs = new Map<string, { code?: string }>();
	const ticks = tickCodes(ddi);

	const choices = (domain: Obj | undefined): readonly Choice[] =>
		asList(asObj(deref(domain?.CodeListReference)?.item)?.Code).map((c) => ({
			code: str(asObj(c.Value)?.StringValue) ?? "",
			label: words(asObj(deref(c.CategoryReference)?.item)?.Label) ?? "",
		}));
	const domainOf = (d: Obj | undefined): Domain | undefined => {
		const type = str(d?.$type);
		if (type === "CodeDomain")
			return {
				kind: "choice",
				// A question's own outputs say whether it is select-all (below); an input never is.
				many: false,
				choices: choices(d),
			};
		if (type === "NumericDomain") {
			const range = asList(d?.NumberRange)[0];
			const bound = (b: unknown) => asObj(b)?.DecimalValue;
			const min = bound(range?.Low);
			const max = bound(range?.High);
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

	for (const q of Object.values(ddi.QuestionItem ?? {})) {
		const id = str(q.ID) ?? "";
		let many = false;
		for (const out of asList(q.OutParameter)) {
			const included = asObj(
				asObj(asObj(out.ValueRepresentation)?.CodeSubsetInformation)
					?.IncludedCode,
			);
			const code = asList(included?.CodeReference)[0];
			// One output per option, each a subset of the codes: select all that apply.
			if (code !== undefined) many = true;
			const value = code === undefined ? undefined : codeValueOf(ddi, code);
			outputs.set(urnOf(out) ?? "", value === undefined ? {} : { code: value });
		}
		const domain = domainOf(asObj(q.ResponseDomain));
		if (domain === undefined) {
			unread(id, "The export can't read how this question is answered.");
			continue;
		}
		questionOf.set(id, {
			id,
			name: words(q.QuestionItemName) ?? id,
			domain: domain.kind === "choice" ? { ...domain, many } : domain,
		});
	}
	for (const c of Object.values(ddi.QuestionConstruct ?? {}))
		for (const b of asList(c.Binding)) {
			const source = urnOf(b.SourceParameterReference);
			const target = urnOf(b.TargetParameterReference);
			if (source !== undefined && target !== undefined && outputs.has(source))
				recordedBy.set(target, [
					...(recordedBy.get(target) ?? []),
					{ ask: str(c.ID) ?? "", output: source },
				]);
		}
	for (const v of Object.values(ddi.Variable ?? {})) {
		const out = asObj(v.OutParameter);
		const urn = urnOf(out);
		const variable = words(v.VariableName);
		if (urn === undefined || variable === undefined) continue;
		const question = deref(asList(v.QuestionReference)[0]);
		if (question === undefined) {
			params.set(urn, {
				kind: "input",
				variable,
				...optional("domain", domainOf(asObj(out?.ValueRepresentation))),
			});
			continue;
		}
		const asks = recordedBy.get(urn) ?? [];
		const q = questionOf.get(str(question.item.ID) ?? "");
		if (q === undefined) continue;
		const code = outputs.get(asks[0]?.output ?? "")?.code;
		const ticked = ticks.get(
			str(
				asObj(asObj(v.VariableRepresentation)?.ValueRepresentation)?.$type,
			) === "CodeDomain"
				? ((deref(
						asObj(asObj(v.VariableRepresentation)?.ValueRepresentation)
							?.CodeListReference,
					)?.item.URN as string | undefined) ?? "")
				: "",
		);
		params.set(urn, {
			kind: "answer",
			variable,
			asks: asks.map((a) => a.ask),
			question: q,
			...(code !== undefined &&
				ticked !== undefined && { option: { code, ...ticked } }),
		});
	}
	for (const c of Object.values(ddi.ComputationItem ?? {})) {
		const assigned = asObj(c.AssignedVariableReference);
		const urn = urnOf(assigned);
		const variable = words(assigned?.ParameterName);
		if (urn !== undefined && variable !== undefined && !params.has(urn))
			params.set(urn, { kind: "compute", variable });
	}
	for (const l of Object.values(ddi.Loop ?? {})) {
		const urn = urnOf(l.LoopVariableReference);
		if (urn !== undefined)
			params.set(urn, { kind: "row", loop: str(l.ID) ?? "" });
	}
	// A roster by `more` counts its rows in the first step of its body: that is its row.
	for (const r of Object.values(ddi.RepeatUntil ?? {})) {
		const first = deref(
			asList(
				deref(r.UntilConstructReference)?.item.ControlConstructReference,
			)[0],
		);
		const urn = urnOf(asObj(first?.item.AssignedVariableReference));
		if (first?.type === "ComputationItem" && urn !== undefined)
			params.set(urn, { kind: "row", loop: str(r.ID) ?? "" });
	}

	/** A command's text, parsed, and each of its names resolved through its bindings. */
	const command = (code: unknown, at: string): Cond | undefined => {
		const cmd = asList(asObj(code)?.Command)[0];
		const text = str(cmd?.CommandContent);
		if (cmd === undefined || text === undefined) {
			unread(at, "The DDI has no code for a condition or value here.");
			return undefined;
		}
		const parsed = parseCondition(text, DDI_FUNCTIONS);
		// The elaborator prints a hole as `null`: one here wasn't written by it.
		if (parsed.problems.length > 0 || holesOf(parsed.expr).length > 0) {
			unread(at, `The export can't read \`${text}\`.`);
			return undefined;
		}
		const sources = new Map<string, Source>();
		for (const p of asList(cmd.InParameter)) {
			const alias = str(p.Alias);
			const binding = asList(cmd.Binding).find(
				(b) => urnOf(b.TargetParameterReference) === urnOf(p),
			);
			const source = params.get(urnOf(binding?.SourceParameterReference) ?? "");
			if (alias === undefined || source === undefined) {
				unread(at, `The export can't tell what \`${alias ?? "?"}\` refers to.`);
				return undefined;
			}
			sources.set(alias, source);
		}
		return { expr: parsed.expr, sources };
	};

	/** Displayed text: words and piped values, `label` where a code's words are shown. */
	const textOf = (
		dynamic: unknown,
		piped: (urn: string) => Part | undefined,
		at: string,
	): readonly Part[] =>
		asList(asObj(asList(dynamic)[0])?.TextContent).flatMap((t): Part[] => {
			const literal = words(asObj(t.Text));
			if (literal !== undefined) return [{ kind: "text", text: literal }];
			const urn = urnOf(t.SourceParameterReference);
			const part = urn === undefined ? undefined : piped(urn);
			if (part === undefined) {
				unread(
					at,
					"The export can't tell what a value in this text refers to.",
				);
				return [];
			}
			return [part];
		});
	const pipedValue = (urn: string): Part | undefined => {
		const label = labels.get(urn);
		if (label !== undefined)
			return { kind: "value", source: label, label: true };
		const source = params.get(urn);
		return source === undefined ? undefined : { kind: "value", source };
	};

	// A coded answer's words, as the elaborator lowers `label(x)`: a reset to null, then one
	// IfThenElse per code assigning its words, all to one text variable. Read as the label of x.
	const labels = new Map<string, Source>();
	const adapters = new Set<string>();
	for (const s of Object.values(ddi.Sequence ?? {})) {
		const parts = asList(s.ControlConstructReference).map(deref);
		const [reset, ...choicesOf] = parts;
		const assigned = urnOf(asObj(reset?.item.AssignedVariableReference));
		const resetText = str(
			asList(asObj(reset?.item.CommandCode)?.Command)[0]?.CommandContent,
		);
		if (
			reset?.type !== "ComputationItem" ||
			resetText !== "null" ||
			assigned === undefined ||
			choicesOf.length === 0 ||
			choicesOf.some((c) => c?.type !== "IfThenElse")
		)
			continue;
		const first = choicesOf[0]?.item;
		const cond =
			first === undefined
				? undefined
				: command(first.IfCondition, str(first.ID) ?? "");
		const source =
			cond === undefined ? undefined : [...cond.sources.values()][0];
		if (source === undefined) continue;
		labels.set(assigned, source);
		adapters.add(str(s.ID) ?? "");
	}

	/** The steps a reference stands for: a plain Sequence's, in order, or one construct's. */
	const sequenceOf = (r: unknown, at: string): Step[] => {
		if (r === undefined) return [];
		const found = deref(r);
		if (found === undefined) {
			unread(at, "A step this points to isn't in the DDI.");
			return [];
		}
		return construct(found.type, found.item);
	};

	const ask = (c: Obj, checks: readonly Check[]): Step[] => {
		const id = str(c.ID) ?? "";
		const qi = deref(c.QuestionReference);
		const question = questionOf.get(str(qi?.item.ID) ?? "");
		if (qi === undefined || question === undefined) {
			unread(id, "The question asked here isn't in the DDI.");
			return [];
		}
		// One ask in two places would record its variable twice, unchecked.
		if (askPaths.has(id))
			findings.push({
				code: "qsf-inexpressible",
				severity: "error",
				path: id,
				message: "This step is in the flow more than once.",
			});
		askPaths.set(id, [...path]);
		const fills = new Map<string, Part>();
		const records: { variable: string; code?: string }[] = [];
		for (const b of asList(c.Binding)) {
			const source = urnOf(b.SourceParameterReference) ?? "";
			const target = urnOf(b.TargetParameterReference) ?? "";
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
				unread(
					id,
					"The export can't tell what a value in this text refers to.",
				);
			else fills.set(target, part);
		}
		const order = str(asObj(c.ResponseSequence)?.ItemSequenceType);
		const text = textOf(qi.item.QuestionText, (urn) => fills.get(urn), id);
		return [
			{
				kind: "ask",
				id,
				question,
				records,
				text,
				...(order === "Random" && { options: "random" as const }),
				...(order === "Rotate" && { options: "rotate" as const }),
				checks,
			},
		];
	};

	/** A check: `not nvl(E, true)` with its severity, the author's E read back. */
	const check = (b: Obj): Check | undefined => {
		const id = str(b.ID) ?? "";
		const cond = command(b.IfCondition, id);
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
		if (cond === undefined || inner === undefined) {
			unread(id, "The export can't read this check's condition.");
			return undefined;
		}
		const said = sequenceOf(b.ThenConstructReference, id).find(
			(s) => s.kind === "say",
		);
		return {
			id,
			severity: str(asObj(b.TypeOfIfThenElse)?.StringValue) ?? "",
			ensure: { expr: inner, sources: cond.sources },
			...(said?.kind === "say" && { message: said.text }),
		};
	};

	// Where each ask sits: the arm of every IfThenElse around it, outermost first.
	const path: { readonly at: string; readonly arm: number }[] = [];
	const askPaths = new Map<string, readonly (typeof path)[number][]>();
	const inArm = <T>(at: string, arm: number, f: () => T): T => {
		path.push({ at, arm });
		const result = f();
		path.pop();
		return result;
	};

	/** A branch: its condition, and the steps it leads to. */
	const branch = (cond: Cond, r: unknown, at: string, arm: number) => {
		const then = inArm(at, arm, () => sequenceOf(r, at));
		return { cond, then };
	};

	const construct = (type: ItemType, c: Obj): Step[] => {
		const id = str(c.ID) ?? "";
		switch (type) {
			case "QuestionConstruct":
				return ask(c, []);
			case "StatementItem":
				return [
					{ kind: "say", id, text: textOf(c.DisplayText, pipedValue, id) },
				];
			case "ComputationItem": {
				const value = command(c.CommandCode, id);
				const variable = words(
					asObj(c.AssignedVariableReference)?.ParameterName,
				);
				return value === undefined || variable === undefined
					? []
					: [{ kind: "compute", id, variable, value }];
			}
			case "Sequence": {
				if (adapters.has(id)) return [];
				const flow = gather(asList(c.ControlConstructReference), id);
				const name = words(c.ConstructName);
				const order = str(asObj(c.ConstructSequence)?.ItemSequenceType);
				if (name === undefined && order === undefined) return flow;
				return [
					{
						kind: "section",
						id,
						...(name !== undefined && { title: name }),
						...(order === "Random" && { order: "random" as const }),
						...(order === "Rotate" && { order: "rotate" as const }),
						flow,
					},
				];
			}
			case "IfThenElse": {
				const kind = str(asObj(c.TypeOfIfThenElse)?.StringValue);
				if (kind === STOP) {
					const cond = command(c.IfCondition, id);
					if (cond === undefined) return [];
					return [
						{
							kind: "stop",
							id,
							cond,
							say: inArm(id, 0, () => sequenceOf(c.ThenConstructReference, id)),
						},
						...inArm(id, 1, () => sequenceOf(c.ElseConstructReference, id)),
					];
				}
				if (kind !== undefined) {
					unread(id, "This check doesn't come after the question it checks.");
					return [];
				}
				const first = command(c.IfCondition, id);
				if (first === undefined) return [];
				const branches = [branch(first, c.ThenConstructReference, id, 0)];
				for (const [i, e] of asList(c.ElseIf).entries()) {
					const cond = command(e.IfCondition, `${id}.elif-${i + 1}`);
					if (cond !== undefined)
						branches.push(branch(cond, e.ThenConstructReference, id, i + 1));
				}
				return [
					{
						kind: "if",
						id,
						branches,
						...(c.ElseConstructReference !== undefined && {
							else: inArm(id, -1, () =>
								sequenceOf(c.ElseConstructReference, id),
							),
						}),
					},
				];
			}
			case "Loop":
				return loop(c);
			case "RepeatUntil":
				return repeat(c);
			default:
				unread(id, `The export can't read a ${type} as a step.`);
				return [];
		}
	};

	/** A run of constructs: each ask followed by its typed IfThenElses takes them as checks. */
	const gather = (refs: readonly Obj[], at: string): Step[] => {
		const out: Step[] = [];
		const found = refs.map(deref);
		for (let i = 0; i < found.length; i++) {
			const f = found[i];
			if (f === undefined) {
				unread(at, "A step this points to isn't in the DDI.");
				continue;
			}
			if (f.type !== "QuestionConstruct") {
				out.push(...construct(f.type, f.item));
				continue;
			}
			const checks: Check[] = [];
			while (true) {
				const next = found[i + 1];
				const kind = str(asObj(next?.item.TypeOfIfThenElse)?.StringValue);
				if (next?.type !== "IfThenElse" || kind === undefined || kind === STOP)
					break;
				const ch = check(next.item);
				if (ch !== undefined) checks.push(ch);
				i++;
			}
			out.push(...ask(f.item, checks));
		}
		return out;
	};

	/** A count roster or an `each`: `v <= C`, or `v <= C and v <= N` with its max. */
	const loop = (l: Obj): Step[] => {
		const id = str(l.ID) ?? "";
		const cond = command(l.LoopWhile, id);
		const row = urnOf(l.LoopVariableReference);
		const isRow = (x: Expr | undefined) =>
			x?.kind === "name" &&
			cond?.sources.get(x.name)?.kind === "row" &&
			params.get(row ?? "") === cond?.sources.get(x.name);
		const atMost = (x: Expr | undefined) =>
			x?.kind === "binary" && x.op === "<=" && isRow(x.left)
				? x.right
				: undefined;
		const e = cond?.expr;
		const limited =
			e?.kind === "binary" && e.op === "and"
				? { count: atMost(e.left), max: atMost(e.right) }
				: { count: atMost(e) };
		const max =
			"max" in limited && limited.max?.kind === "number"
				? limited.max.value
				: undefined;
		if (
			cond === undefined ||
			limited.count === undefined ||
			("max" in limited && max === undefined)
		) {
			unread(id, "The export can't read this loop's condition.");
			return [];
		}
		return [
			{
				kind: "loop",
				id,
				count: { expr: limited.count, sources: cond.sources },
				...(max !== undefined && { max }),
				flow: sequenceOf(l.ControlConstructReference, id),
			},
		];
	};

	/**
	 * A roster by `more`: `nvl(v, 0) >= 1 and not nvl(M, false) or nvl(v, 0) >= N`, its body
	 * a Sequence starting with the row counter; or a blocking check's `nvl(E, true)` around an ask.
	 */
	const repeat = (r: Obj): Step[] => {
		const id = str(r.ID) ?? "";
		const cond = command(r.UntilCondition, id);
		const body = deref(r.UntilConstructReference);
		const parts = asList(body?.item.ControlConstructReference);
		const e = cond?.expr;
		// A blocking check: ask again until it holds. The ask and its checks are the body.
		if (
			e?.kind === "call" &&
			e.fn === "nvl" &&
			e.args[1]?.kind === "boolean" &&
			e.args[1].value
		)
			return gather(parts, id);
		const isCounter = (s: Source | undefined) =>
			s?.kind === "row" && s.loop === id;
		const counted = (x: Expr | undefined, op: string) =>
			x?.kind === "binary" &&
			x.op === op &&
			x.left.kind === "call" &&
			x.left.fn === "nvl" &&
			x.left.args[0]?.kind === "name" &&
			isCounter(cond?.sources.get(x.left.args[0].name))
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
		if (cond === undefined || more === undefined || limit?.kind !== "number") {
			unread(id, "The export can't read this repeat's condition.");
			return [];
		}
		const [counter, ...rest] = parts;
		const counterItem = deref(counter);
		const row = urnOf(asObj(counterItem?.item.AssignedVariableReference));
		if (counterItem?.type !== "ComputationItem" || row === undefined) {
			unread(id, "The export can't read how this roster numbers its rows.");
			return [];
		}
		return [
			{
				kind: "repeat",
				id,
				more: { expr: more, sources: cond.sources },
				max: limit.value,
				flow: gather(rest, id),
			},
		];
	};

	const instrument = Object.values(ddi.Instrument ?? {})[0];
	if (instrument === undefined) {
		unread("", "The DDI has no instrument.");
		return { instrument: { inputs: [], flow: [] }, findings };
	}
	const name = words(instrument.InstrumentName);
	const title = words(instrument.Label);
	const flow = sequenceOf(
		instrument.ControlConstructReference,
		str(instrument.ID) ?? "",
	);
	// One Qualtrics question stands for a variable recorded by several asks only when no
	// respondent meets two of them: each pair must sit in different arms of one condition.
	const exclusive = (
		a: readonly { at: string; arm: number }[],
		b: typeof a,
	) => {
		for (let i = 0; i < Math.min(a.length, b.length); i++) {
			if (a[i]?.at !== b[i]?.at) return false;
			if (a[i]?.arm !== b[i]?.arm) return true;
		}
		return false;
	};
	for (const s of params.values()) {
		if (s.kind !== "answer") continue;
		const placed = s.asks.flatMap((ask) => {
			const p = askPaths.get(ask);
			return p === undefined ? [] : [{ ask, path: p }];
		});
		const clash = placed.find((b, j) =>
			placed.slice(0, j).some((a) => !exclusive(a.path, b.path)),
		);
		if (clash !== undefined)
			findings.push({
				code: "qsf-inexpressible",
				severity: "error",
				path: clash.ask,
				message: `\`${s.variable}\` is recorded in two places one respondent can both reach.`,
			});
	}
	const inputs = [...params]
		.filter(([urn]) => !labels.has(urn))
		.map(([, s]) => s)
		.filter((s): s is Extract<Source, { kind: "input" }> => s.kind === "input");
	return {
		instrument: {
			...(name !== undefined && { name }),
			...(title !== undefined && { title }),
			...(Object.keys(ddi.ManagedMissingValuesRepresentation ?? {}).length >
				0 && {
				missing: true as const,
			}),
			inputs,
			flow,
		},
		findings,
	};
}

/** `{ key: value }` when there is a value, for spreading; `{}` otherwise. */
const optional = <K extends string, V>(key: K, value: V | undefined) =>
	(value === undefined ? {} : { [key]: value }) as Partial<Record<K, V>>;

/** A code's value, from a reference to it by identity (a Code isn't an item of its own). */
function codeValueOf(ddi: DdiDocument, code: Obj): string | undefined {
	for (const list of Object.values(ddi.CodeList ?? {}))
		for (const c of asList(list.Code))
			if (c.URN === code.URN) return str(asObj(c.Value)?.StringValue);
	return undefined;
}

/** For each select-all list (by URN), the value that is a tick, as its categories say. */
function tickCodes(
	ddi: DdiDocument,
): ReadonlyMap<string, { ticked: string; unticked: string }> {
	const out = new Map<string, { ticked: string; unticked: string }>();
	for (const list of Object.values(ddi.CodeList ?? {})) {
		const qualified = (qualification: string) =>
			asList(list.Code)
				.filter((c) => {
					const v = asObj(c.CategoryReference)?.value;
					const category = Array.isArray(v)
						? ddi.Category?.[v.join(":")]
						: undefined;
					return (
						str(asObj(category?.Generation)?.Qualification) === qualification
					);
				})
				.map((c) => str(asObj(c.Value)?.StringValue))[0];
		const ticked = qualified(TICKED);
		const unticked = qualified(NOT_TICKED);
		if (ticked !== undefined && unticked !== undefined)
			out.set(str(list.URN) ?? "", { ticked, unticked });
	}
	return out;
}
