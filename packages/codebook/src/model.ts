/**
 * A codebook from a DDI-Lifecycle 4.0 document, as data: one entry per variable, as
 * every codebook lists them, and one per question no variable records. Any producer's
 * document reads, not only the core's: the input is untyped JSON, parsed once
 * (`parse`), and every field is read through DDI's own structures, never from an
 * identifier's spelling. What isn't understood is left out without a word; only a
 * reference to an item the document doesn't have is a finding. No wording: headings and
 * phrasing are the HTML layer's.
 */

import {
	asList,
	asObj,
	type Finding as CoreFinding,
	type DdiIndex,
	ddiIndexOf,
	deref,
	err,
	type Indexed,
	latestOf as latestIn,
	ok,
	type Result,
	refUrn,
	str,
	words,
} from "@qretools/core";
import { type Asking, type Command, commandOf, flowOf } from "./flow.ts";
import {
	dynamicTextOf,
	nameOf,
	type Ref,
	refOf,
	type Text,
	textOf,
} from "./text.ts";

/** Reported by the codebook. */
export type CodebookCode =
	/** The input isn't a DDI document: not a JSON object. */
	| "codebook-unreadable"
	/** A reference names an item the document doesn't have. */
	| "codebook-dangling";

/** A codebook finding. Its `path` is the URN of the item that holds the reference, not a dotted path. */
export type Finding = CoreFinding<CodebookCode>;

/** A code and its words, and whether it means the value is missing. */
export interface Row {
	readonly code: string;
	readonly label?: Text;
	readonly missing: boolean;
}

/** A shared item described in words: a concept, a universe. */
export interface Described {
	readonly urn: string;
	readonly name?: string;
	readonly label?: Text;
	readonly description?: Text;
}

/** A shared list of codes: a code list, or a missing-values representation's codes. */
export interface Listed {
	readonly urn: string;
	readonly name?: string;
	readonly label?: Text;
	readonly rows: readonly Row[];
}

export type Format =
	| {
			readonly kind: "number";
			readonly min?: number;
			readonly max?: number;
			readonly decimals?: number;
			readonly unit?: string;
	  }
	| { readonly kind: "text"; readonly maxLength?: number };

export interface Entry {
	/** The variable's URN, or the question's for a question no variable records: the anchor. */
	readonly urn: string;
	/** `Variable` or `QuestionItem`. */
	readonly type: string;
	readonly version?: string;
	readonly name?: string;
	readonly label?: Text;
	readonly question?: {
		readonly urn: string;
		readonly name?: string;
		readonly text?: Text;
		readonly instructions: readonly Text[];
	};
	/** The codes, valid ones first then missing ones, and the lists they come from. */
	readonly responses?: {
		/**
		 * The domain shown allows more than one choice (its ResponseCardinality). A
		 * variable's representation, shown when there is one, never says so: an option of
		 * a select-all question says it by `group`.
		 */
		readonly many: boolean;
		readonly rows: readonly Row[];
		readonly from: readonly Ref[];
	};
	readonly format?: Format;
	readonly universes: readonly Ref[];
	readonly concepts: readonly Ref[];
	readonly intent?: Text;
	/** The Descriptions of the variable and its question. */
	readonly notes?: Text;
	/** BasedOnObject: why, and the URNs of what it is based on. */
	readonly source?: { readonly text?: Text; readonly based: readonly string[] };
	/** Every place the question is asked in an instrument; none without one. */
	readonly asked: readonly Asking[];
	/** How a variable no question records is made: its commands, words and inputs. */
	readonly derivation?: {
		readonly commands: readonly Command[];
		readonly text?: Text;
		readonly from: readonly Ref[];
	};
	/** UserIDs and UserAttributePairs as written, on the variable and its question. */
	readonly provenance?: {
		readonly ids: readonly { readonly type?: string; readonly value: string }[];
		readonly attributes: readonly {
			readonly key: string;
			readonly value: string;
		}[];
	};
	/** One option of a question answered with several variables: its question and code. */
	readonly group?: {
		readonly question: string;
		readonly option: { readonly code: string; readonly label?: Text };
	};
}

export interface Codebook {
	/** The first instrument's label, else its name. */
	readonly title?: string;
	/** In the instruments' order where there are any, the rest in document order. */
	readonly entries: readonly Entry[];
	/** What the entries refer to, each once, in the order first referred to. */
	readonly shared: {
		readonly concepts: readonly Described[];
		readonly universes: readonly Described[];
		readonly codeLists: readonly Listed[];
		readonly missing: readonly Listed[];
	};
	readonly findings: readonly Finding[];
}

/** A document's items, indexed once. Refused only when it isn't a JSON object. */
export function parse(json: unknown): Result<DdiIndex, readonly Finding[]> {
	return asObj(json) === undefined
		? err([
				{
					code: "codebook-unreadable",
					severity: "error",
					path: "",
					message: "This isn't a DDI document: it isn't a JSON object.",
				},
			])
		: ok(ddiIndexOf(json));
}

const num = (j: unknown): number | undefined =>
	typeof j === "number" ? j : undefined;

/** A Code's value: its CodeValue's string, or the value itself where a producer writes it bare. */
const codeValue = (code: Record<string, unknown>): string | undefined => {
	const value = asObj(code.Value)?.StringValue ?? code.Value;
	return str(value) ?? (typeof value === "number" ? String(value) : undefined);
};

export function codebookOf(
	index: DdiIndex,
	{ lang }: { readonly lang?: string } = {},
): Codebook {
	const findings = new Map<string, Finding>();
	/** The item a reference names, reporting one that names nothing here. */
	const follow = (from: Indexed, r: unknown): Indexed | undefined => {
		const found = deref(index, r);
		const urn = refUrn(r);
		if (found === undefined && urn !== undefined)
			findings.set(`${from.urn} ${urn}`, {
				code: "codebook-dangling",
				severity: "error",
				path: from.urn,
				message: `\`${urn}\` isn't in the document.`,
			});
		return found;
	};
	const followAll = (from: Indexed, r: unknown): Indexed[] =>
		(Array.isArray(r) ? r : r === undefined ? [] : [r]).flatMap((x) => {
			const it = follow(from, x);
			return it === undefined ? [] : [it];
		});
	const text = (j: unknown) => textOf(words(j, lang));
	/** Whether two references name one item, however each is written. */
	const same = (a: unknown, b: unknown): boolean => {
		const x = deref(index, a);
		return x !== undefined
			? x === deref(index, b)
			: refUrn(a) !== undefined && refUrn(a) === refUrn(b);
	};
	/** The highest version of an item: a question's flow is keyed by it, whichever version is cited. */
	const latestOf = (it: Indexed): Indexed => latestIn(index, it);
	const flow = flowOf(index, follow, lang);

	const concepts = new Map<string, Described>();
	const universes = new Map<string, Described>();
	const codeLists = new Map<string, Listed>();
	const missing = new Map<string, Listed>();
	const described = (it: Indexed): Described => {
		const name = nameOf(it, lang);
		const label = text(it.item.Label);
		const description = text(it.item.Description);
		return {
			urn: it.urn,
			...(name !== undefined && { name }),
			...(label !== undefined && { label }),
			...(description !== undefined && { description }),
		};
	};
	const share = (into: Map<string, Described>, its: readonly Indexed[]) => {
		for (const it of its)
			if (!into.has(it.urn)) into.set(it.urn, described(it));
		return its.map((it) => refOf(it, lang));
	};

	const rowsOf = (list: Indexed, isMissing: boolean): Row[] =>
		asList(list.item.Code).map((c) => {
			const category = follow(list, c.CategoryReference);
			const label =
				category === undefined ? undefined : text(category.item.Label);
			return {
				code: codeValue(c) ?? "",
				...(label !== undefined && { label }),
				missing: isMissing || category?.item.IsMissing === true,
			};
		});
	const listed = (it: Indexed, rows: readonly Row[]): Listed => {
		const { description: _, ...rest } = described(it);
		return { ...rest, rows };
	};

	/** A domain's codes (a CodeDomain's list, then the missing values'), or its format. */
	const valuesOf = (
		from: Indexed,
		domain: Record<string, unknown> | undefined,
		missingRef: unknown,
	): Pick<Entry, "responses" | "format"> => {
		const from_: Ref[] = [];
		const rows: Row[] = [];
		const list =
			domain?.CodeListReference === undefined
				? undefined
				: follow(from, domain.CodeListReference);
		if (list !== undefined) {
			const own = rowsOf(list, false);
			if (!codeLists.has(list.urn)) codeLists.set(list.urn, listed(list, own));
			rows.push(...own);
			from_.push(refOf(list, lang));
		}
		const representation =
			missingRef === undefined ? undefined : follow(from, missingRef);
		if (representation !== undefined) {
			// shortcut: missing values given as numeric or text ranges aren't read, only codes.
			const own = asList(representation.item.MissingCodeRepresentation).flatMap(
				(m) => {
					const l = follow(representation, m.CodeListReference);
					return l === undefined ? [] : rowsOf(l, true);
				},
			);
			if (!missing.has(representation.urn))
				missing.set(representation.urn, listed(representation, own));
			rows.push(...own);
			from_.push(refOf(representation, lang));
		}
		const many =
			(num(asObj(domain?.ResponseCardinality)?.MaximumResponses) ?? 1) > 1;
		const responses =
			list !== undefined || rows.length > 0
				? { responses: { many, rows, from: from_ } }
				: {};
		const type = str(domain?.$type);
		if (type === "NumericDomain" || domain?.NumberRange !== undefined) {
			const range = asList(domain?.NumberRange)[0];
			const min = num(asObj(range?.Low)?.DecimalValue);
			const max = num(asObj(range?.High)?.DecimalValue);
			const decimals = num(domain?.DecimalPositions);
			const unit = str(asObj(domain?.MeasurementUnit)?.StringValue);
			return {
				...responses,
				format: {
					kind: "number",
					...(min !== undefined && { min }),
					...(max !== undefined && { max }),
					...(decimals !== undefined && { decimals }),
					...(unit !== undefined && { unit }),
				},
			};
		}
		if (type === "TextDomain" || domain?.MaxLength !== undefined) {
			const maxLength = num(domain?.MaxLength);
			return {
				...responses,
				format: { kind: "text", ...(maxLength !== undefined && { maxLength }) },
			};
		}
		return responses;
	};

	const provenanceOf = (its: readonly Indexed[]): Entry["provenance"] => {
		const ids = its.flatMap((it) =>
			asList(it.item.UserID).flatMap((u) => {
				const value = str(u.StringValue);
				const type = str(asObj(u.TypeOfUserID)?.StringValue);
				return value === undefined
					? []
					: [{ value, ...(type !== undefined && { type }) }];
			}),
		);
		const attributes = its.flatMap((it) =>
			asList(it.item.UserAttributePair).flatMap((p) => {
				const key = str(asObj(p.AttributeKey)?.StringValue);
				const value = str(asObj(p.AttributeValue)?.StringValue);
				return key === undefined || value === undefined ? [] : [{ key, value }];
			}),
		);
		return ids.length === 0 && attributes.length === 0
			? undefined
			: { ids, attributes };
	};

	/** The option a variable records, when its source is a subset of its question's codes. */
	const groupOf = (v: Indexed, question: Indexed): Entry["group"] => {
		const source = v.item.SourceParameterReference;
		const parameter = source === undefined ? undefined : follow(v, source);
		const included = asObj(
			asObj(asObj(parameter?.item.ValueRepresentation)?.CodeSubsetInformation)
				?.IncludedCode,
		);
		const codes = asList(included?.CodeReference);
		const code =
			parameter === undefined || codes.length !== 1
				? undefined
				: follow(parameter, codes[0]);
		if (code === undefined) return undefined;
		const value = codeValue(code.item);
		const category =
			code.owner === undefined
				? undefined
				: follow(code.owner, code.item.CategoryReference);
		const label =
			category === undefined ? undefined : text(category.item.Label);
		return value === undefined
			? undefined
			: {
					question: latestOf(question).urn,
					option: { code: value, ...(label !== undefined && { label }) },
				};
	};

	const computations = [...new Set(index.latest.values())].filter(
		(it) => it.type === "ComputationItem",
	);
	const derivationOf = (v: Indexed): Entry["derivation"] => {
		const commands: Command[] = [];
		// What assigns the variable's own parameter, or the one it holds.
		const assigned = computations.find((c) =>
			[v.item.OutParameter, v.item.SourceParameterReference].some(
				(p) => p !== undefined && same(c.item.AssignedVariableReference, p),
			),
		);
		const assignedBy = commandOf(assigned?.item.CommandCode);
		if (assignedBy !== undefined) commands.push(assignedBy);
		const representation = asObj(v.item.VariableRepresentation);
		const instruction =
			representation?.ProcessingInstructionReference === undefined
				? undefined
				: follow(v, representation.ProcessingInstructionReference);
		for (const c of asList(instruction?.item.CommandCode)) {
			const cmd = commandOf(c);
			if (cmd !== undefined) commands.push(cmd);
		}
		const from = [
			...followAll(v, v.item.SourceVariableReference),
			...(instruction === undefined
				? []
				: followAll(instruction, instruction.item.InputVariableReference)),
		].map((it) => refOf(it, lang));
		const said =
			instruction === undefined
				? undefined
				: text(instruction.item.Description);
		return commands.length === 0 && from.length === 0 && said === undefined
			? undefined
			: { commands, from, ...(said !== undefined && { text: said }) };
	};

	const entryOf = (v: Indexed | undefined, q: Indexed | undefined): Entry => {
		const principal = (v ?? q) as Indexed;
		const representation = asObj(v?.item.VariableRepresentation);
		const domain =
			asObj(representation?.ValueRepresentation) ??
			asObj(q?.item.ResponseDomain);
		// Where the question is asked; where an ask binds its answer into this variable, only there.
		const all = q === undefined ? [] : (flow.asked.get(latestOf(q).urn) ?? []);
		const out = v?.item.OutParameter;
		const bound = all.filter((a) =>
			asList(flow.constructs.get(a.construct)?.item.Binding).some(
				(b) => out !== undefined && same(b.TargetParameterReference, out),
			),
		);
		const asked = bound.length > 0 ? bound : all;
		const askedUniverses = asked.flatMap((a) => {
			const c = flow.constructs.get(a.construct);
			return c === undefined ? [] : followAll(c, c.item.UniverseReference);
		});
		const unique = (its: readonly Indexed[]) => [...new Set(its)];
		const name = nameOf(principal, lang);
		const label = text(principal.item.Label);
		const notes = [
			...(text(v?.item.Description) ?? []),
			...(q === undefined ? [] : (text(q.item.Description) ?? [])),
		];
		const intent = q === undefined ? undefined : text(q.item.QuestionIntent);
		const based = asObj(q?.item.BasedOnObject);
		const why = text(based?.BasedOnRationaleDescription);
		const basedOn = asList(based?.BasedOnReference).flatMap((r) => {
			const u = refUrn(r);
			return u === undefined ? [] : [u];
		});
		const version = str(principal.item.Version);
		const provenance = provenanceOf([v, q].filter((x) => x !== undefined));
		const group =
			v === undefined || q === undefined ? undefined : groupOf(v, q);
		const derivation =
			v !== undefined && q === undefined ? derivationOf(v) : undefined;
		const question =
			q === undefined
				? undefined
				: (() => {
						const qname = nameOf(q, lang);
						const qtext = dynamicTextOf(
							q.item.QuestionText,
							(r) => follow(q, r),
							lang,
						);
						return {
							urn: q.urn,
							...(qname !== undefined && { name: qname }),
							...(qtext !== undefined && { text: qtext }),
							instructions: asList(q.item.InterviewerInstructionAttachment)
								.flatMap((a) => followAll(q, a.InterviewerInstructionReference))
								.flatMap((i) => {
									const t = dynamicTextOf(
										i.item.InstructionText,
										(r) => follow(i, r),
										lang,
									);
									return t === undefined ? [] : [t];
								}),
						};
					})();
		return {
			urn: principal.urn,
			type: principal.type,
			...(version !== undefined && { version }),
			...(name !== undefined && { name }),
			...(label !== undefined && { label }),
			...(question !== undefined && { question }),
			...valuesOf(principal, domain, representation?.MissingValuesReference),
			universes: share(
				universes,
				unique([
					...(v === undefined ? [] : followAll(v, v.item.UniverseReference)),
					...askedUniverses,
				]),
			),
			concepts: share(
				concepts,
				unique([
					...(v === undefined ? [] : followAll(v, v.item.ConceptReference)),
					...(q === undefined ? [] : followAll(q, q.item.ConceptReference)),
				]),
			),
			...(intent !== undefined && { intent }),
			...(notes.length > 0 && { notes }),
			...((why !== undefined || basedOn.length > 0) && {
				source: { based: basedOn, ...(why !== undefined && { text: why }) },
			}),
			asked,
			...(derivation !== undefined && { derivation }),
			...(provenance !== undefined && { provenance }),
			...(group !== undefined && { group }),
		};
	};

	// Each item once, at the highest version the document holds of it.
	const current = new Set(index.latest.values());
	const items = [...index.byUrn.values()].filter((it) => current.has(it));
	const recorded = new Set<Indexed>();
	const entries: { entry: Entry; question?: Indexed }[] = [];
	for (const v of items.filter((it) => it.type === "Variable")) {
		// shortcut: a variable recorded by several questions is listed under its first.
		const q = followAll(v, v.item.QuestionReference)[0];
		if (q !== undefined) recorded.add(latestOf(q));
		entries.push({
			entry: entryOf(v, q),
			...(q !== undefined && { question: q }),
		});
	}
	for (const q of items.filter((it) => it.type === "QuestionItem"))
		if (!recorded.has(q))
			entries.push({ entry: entryOf(undefined, q), question: q });
	// Stable: in each instrument's order, then what no instrument asks in document order.
	const at = (q: Indexed | undefined) =>
		(q === undefined ? undefined : flow.position.get(latestOf(q).urn)) ??
		Number.POSITIVE_INFINITY;
	entries.sort((a, b) => {
		const [x, y] = [at(a.question), at(b.question)];
		return x === y ? 0 : x - y;
	});

	const instrument = items.find((it) => it.type === "Instrument");
	const title =
		instrument === undefined
			? undefined
			: (words(instrument.item.Label, lang) ??
				words(instrument.item.InstrumentName, lang));
	return {
		...(title !== undefined && { title }),
		entries: entries.map((e) => e.entry),
		shared: {
			concepts: [...concepts.values()],
			universes: [...universes.values()],
			codeLists: [...codeLists.values()],
			missing: [...missing.values()],
		},
		findings: [...findings.values()],
	};
}
