/**
 * A read instrument written as a Qualtrics survey (QSF). Two passes, both pure: `number`
 * gives every ask and statement its QID in flow order (rosters included, so later steps
 * never renumber), then `layout` turns the flow into blocks, and `toQsf` serialises them
 * with a neutral skeleton (no account's IDs: Qualtrics assigns its own on import). Every
 * shape written is one the owner's exports showed (context: experiments 1–6b). Anything
 * the export can't write yet, or can't write exactly, is a finding at its DDI ID.
 */
import { printCondition } from "../cond/print.ts";
import type { Finding } from "../findings.ts";
import { type Atom, and, compileCondition, type Dnf, NEVER } from "./logic.ts";
import type {
	Cond,
	Part,
	Question,
	ReadInstrument,
	Source,
	Step,
} from "./read.ts";
import { SETTINGS } from "./settings.ts";

/** QSF's JSON: unlike the DDI's, it has nulls. */
export type Qsf =
	| string
	| number
	| boolean
	| null
	| readonly Qsf[]
	| { readonly [key: string]: Qsf };
type QsfObject = { readonly [key: string]: Qsf };

/** Each ask and statement's QID and each ask's question, by DDI ID; the asks inside a roster's rows; every name the data has. */
interface Numbering {
	readonly qids: ReadonlyMap<string, string>;
	readonly questions: ReadonlyMap<string, Question>;
	readonly looped: ReadonlySet<string>;
	readonly names: ReadonlySet<string>;
}

/** QIDs in flow order, depth first, over every flow a step holds. */
function number(instrument: ReadInstrument): Numbering {
	const qids = new Map<string, string>();
	const questions = new Map<string, Question>();
	const looped = new Set<string>();
	const names = new Set(instrument.inputs.map((i) => i.variable));
	const go = (steps: readonly Step[], inLoop: boolean): void => {
		for (const s of steps) {
			switch (s.kind) {
				case "ask":
				case "say":
					qids.set(s.id, `QID${qids.size + 1}`);
					if (inLoop) looped.add(s.id);
					if (s.kind === "ask") {
						questions.set(s.id, s.question);
						for (const r of s.records) names.add(r.variable);
					}
					break;
				case "compute":
					names.add(s.variable);
					break;
				case "if":
					for (const b of s.branches) go(b.then, inLoop);
					go(s.else ?? [], inLoop);
					break;
				case "stop":
					go(s.say, inLoop);
					break;
				case "loop":
				case "repeat":
					go(s.flow, true);
					break;
				case "section":
					go(s.flow, inLoop);
					break;
				default:
					s satisfies never;
			}
		}
	};
	go(instrument.flow, false);
	return { qids, questions, looped, names };
}

/** The survey's flow: blocks of questions (one to a page), branches, fields set, the end. */
type Node =
	| {
			readonly kind: "block";
			readonly description?: string;
			readonly questions: readonly QsfObject[];
	  }
	| {
			readonly kind: "branch";
			readonly description: string;
			readonly logic: Qsf;
			readonly flow: readonly Node[];
	  }
	| {
			readonly kind: "set";
			readonly fields: readonly {
				readonly name: string;
				readonly value: string;
			}[];
	  }
	| { readonly kind: "end" };

/** Text as Qualtrics shows it: HTML, where `${` starts a pipe. */
export const escapeText = (text: string): string =>
	text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/\$\{/g, "&#36;{")
		.replace(/\n/g, "<br>");

export function writeQsf(
	instrument: ReadInstrument,
	options: {
		readonly name: string;
		/** When the survey is made, `YYYY-MM-DD hh:mm:ss`: Qualtrics requires one (the core has no clock). */
		readonly created: string;
	},
): { readonly qsf: QsfObject; readonly findings: readonly Finding[] } {
	const findings: Finding[] = [];
	const note = (
		code: Finding["code"],
		severity: Finding["severity"],
		path: string,
		message: string,
	) => findings.push({ code, severity, path, message });
	const notYet = (path: string, what: string) =>
		note(
			"qsf-inexpressible",
			"error",
			path,
			`${what} isn't exported to Qualtrics yet: it's left out.`,
		);
	const numbering = number(instrument);
	const { qids, looped } = numbering;
	const qidOf = (id: string) => qids.get(id) ?? "";

	/** A value piped into text, or undefined (with a finding) where Qualtrics can't show it. */
	const pipe = (
		source: Source,
		label: boolean,
		at: string,
	): string | undefined => {
		switch (source.kind) {
			case "input":
			case "compute":
				return `\${e://Field/${source.variable}}`;
			case "row":
				notYet(at, "A row number outside a roster");
				return undefined;
			case "answer": {
				if (source.option !== undefined) {
					note(
						"qsf-inexpressible",
						"error",
						at,
						`\`${source.variable}\` is one option of a select-all question: Qualtrics can't show it.`,
					);
					return undefined;
				}
				if (source.asks.some((a) => looped.has(a))) {
					notYet(at, `\`${source.variable}\`, read from a roster's rows,`);
					return undefined;
				}
				const what =
					source.question.domain.kind !== "choice"
						? "ChoiceTextEntryValue"
						: label
							? "ChoiceGroup/SelectedChoices"
							: "SelectedChoicesRecode";
				// Exclusive asks: only the one shown has an answer (experiment 6b), so joining
				// their pipes shows it.
				return source.asks.map((a) => `\${q://${qidOf(a)}/${what}}`).join("");
			}
			default:
				return source satisfies never;
		}
	};
	const textOf = (parts: readonly Part[], at: string): string =>
		parts
			.map((p) =>
				p.kind === "text"
					? escapeText(p.text)
					: (pipe(p.source, p.label === true, at) ?? ""),
			)
			.join("");

	// Export tags: a variable's name, shared only by the asks that record it.
	const tags = new Map<string, string>();
	const tag = (wanted: string, owner: string, qid: string, at: string) => {
		const held = tags.get(wanted);
		if (held === undefined || held === owner) {
			tags.set(wanted, owner);
			return wanted;
		}
		note(
			"qsf-note",
			"info",
			at,
			`\`${wanted}\` is already another question's export tag in Qualtrics: this one's is ${qid}.`,
		);
		return qid;
	};

	const common = (qid: string, text: string, exportTag: string) => ({
		QuestionText: text,
		DataExportTag: exportTag,
		DataVisibility: { Private: false, Hidden: false },
		Configuration: { QuestionDescriptionOption: "UseText" },
		QuestionDescription: text,
		Language: [],
		NextAnswerId: 1,
		QuestionID: qid,
	});
	const askQuestion = (s: Extract<Step, { kind: "ask" }>): QsfObject => {
		const qid = qidOf(s.id);
		const text = textOf(s.text, s.id);
		const q: Question = s.question;
		const domain = q.domain;
		if (domain.kind === "choice") {
			const keys = domain.choices.map((_, i) => String(i + 1));
			const exportTag = domain.many
				? tag(q.name, s.id, qid, s.id)
				: tag(
						s.records[0]?.variable ?? qid,
						`v:${s.records[0]?.variable}`,
						qid,
						s.id,
					);
			return {
				...common(qid, text, exportTag),
				QuestionType: "MC",
				Selector: domain.many ? "MAVR" : "SAVR",
				SubSelector: "TX",
				Choices: Object.fromEntries(
					domain.choices.map((c, i) => [
						keys[i] ?? "",
						{ Display: escapeText(c.label) },
					]),
				),
				ChoiceOrder: keys,
				Validation: { Settings: { ForceResponse: "OFF", Type: "None" } },
				NextChoiceId: keys.length + 1,
				RecodeValues: Object.fromEntries(
					domain.choices.map((c, i) => [keys[i] ?? "", c.code]),
				),
				...(domain.many && {
					VariableNaming: Object.fromEntries(
						domain.choices.map((c, i) => [
							keys[i] ?? "",
							s.records.find((r) => r.code === c.code)?.variable ?? c.code,
						]),
					),
				}),
			};
		}
		const variable = s.records[0]?.variable ?? qid;
		const exportTag = tag(variable, `v:${variable}`, qid, s.id);
		if (domain.kind === "number")
			return {
				...common(qid, text, exportTag),
				QuestionType: "TE",
				Selector: "SL",
				Validation: {
					Settings: {
						ForceResponse: "OFF",
						ForceResponseType: "ON",
						Type: "ContentType",
						MinChars: "1",
						ContentType: "ValidNumber",
						ValidNumber: {
							Min: domain.min === undefined ? "" : String(domain.min),
							Max: domain.max === undefined ? "" : String(domain.max),
							NumDecimals: String(domain.decimals),
						},
					},
				},
			};
		if (domain.maxLength !== undefined)
			note(
				"qsf-note",
				"info",
				s.id,
				`Qualtrics doesn't limit this answer to ${domain.maxLength} characters.`,
			);
		return {
			...common(qid, text, exportTag),
			QuestionType: "TE",
			Selector: "SL",
			Validation: { Settings: { ForceResponse: "OFF", Type: "None" } },
		};
	};
	const statement = (s: Extract<Step, { kind: "say" }>): QsfObject => {
		const qid = qidOf(s.id);
		const text = textOf(s.text, s.id);
		return {
			...common(qid, text, qid),
			QuestionType: "DB",
			Selector: "TB",
			ChoiceOrder: [],
			Validation: { Settings: { Type: "None" } },
		};
	};

	/** One Qualtrics test, as the owner's exports write it. */
	const expression = (a: Atom): QsfObject => {
		const right = a.value === undefined ? {} : { RightOperand: a.value };
		if (a.subject.kind === "field")
			return {
				LogicType: "EmbeddedField",
				LeftOperand: a.subject.name,
				Operator: a.op,
				...right,
				Type: "Expression",
				Description: "",
			};
		const qid = qidOf(a.subject.ask);
		const domain = numbering.questions.get(a.subject.ask)?.domain;
		const chosen = a.op === "Selected" || a.op === "NotSelected";
		// A choice is tested by its place in the question, its code being only the recode.
		const locator = chosen
			? `q://${qid}/SelectableChoice/${
					domain?.kind === "choice"
						? domain.choices.findIndex((c) => c.code === a.value) + 1
						: 0
				}`
			: `q://${qid}/ChoiceTextEntryValue`;
		return {
			LogicType: "Question",
			QuestionID: qid,
			QuestionIsInLoop: "no",
			ChoiceLocator: locator,
			Operator: a.op,
			QuestionIDFromLocator: qid,
			LeftOperand: locator,
			...(chosen ? {} : right),
			Type: "Expression",
			Description: "",
		};
	};
	/** An Or of And-groups as Qualtrics' flat list: And binds first (experiment 2). */
	const logicOf = (d: Dnf): Qsf => {
		const list = d.flatMap((group, g) =>
			group.map((a, k) => ({
				...expression(a),
				...((g > 0 || k > 0) && { Conjuction: k === 0 ? "Or" : "And" }),
			})),
		);
		return {
			"0": {
				...Object.fromEntries(list.map((x, k) => [String(k), x])),
				Type: "If",
			},
			Type: "BooleanExpression",
		};
	};
	/** The condition's "is true" list, or undefined with a finding where it can't be written. */
	const whenTrue = (cond: Cond, at: string): Dnf | undefined => {
		const asked = [...cond.sources.values()].flatMap((s) =>
			s.kind === "answer" ? s.asks : [],
		);
		if (asked.some((a) => looped.has(a))) {
			notYet(at, "A condition on a roster's rows");
			return undefined;
		}
		const compiled = compileCondition(cond);
		if (compiled.kind === "problem") {
			note("qsf-inexpressible", "error", at, compiled.message);
			return undefined;
		}
		if (compiled.forms.t === "too-large") {
			note(
				"qsf-too-large",
				"error",
				at,
				"This condition takes more tests than Qualtrics logic should hold.",
			);
			return undefined;
		}
		return compiled.forms.t;
	};
	/** Steps behind a condition: as they are when it always holds, nothing when never. */
	const behind = (
		d: Dnf,
		description: string,
		flow: readonly Node[],
		at: string,
	): Node[] => {
		if (d.length === 0) {
			note(
				"qsf-note",
				"info",
				at,
				"This condition never holds, so what it leads to isn't in the survey.",
			);
			return [];
		}
		if (d.some((g) => g.length === 0)) return [...flow];
		return flow.length === 0
			? []
			: [{ kind: "branch", description, logic: logicOf(d), flow }];
	};

	// Each if with more than one way through marks the way it took, so later arms test one field.
	let flags = 0;
	const flagFor = (at: string): string => {
		let name = "";
		do name = `qretools_branch_${++flags}`;
		while (numbering.names.has(name));
		note(
			"qsf-note",
			"info",
			at,
			`Qualtrics records which way this branch went in the field \`${name}\`.`,
		);
		return name;
	};

	/** The flow as Qualtrics' flow: a run of asks and statements is one block. */
	const layout = (flow: readonly Step[], description?: string): Node[] => {
		const nodes: Node[] = [];
		let current: QsfObject[] = [];
		let title = description;
		const flush = () => {
			if (current.length > 0)
				nodes.push({
					kind: "block",
					...(title !== undefined && { description: title }),
					questions: current,
				});
			current = [];
			title = undefined;
		};
		for (const s of flow) {
			switch (s.kind) {
				case "ask":
					if (s.checks.length > 0) notYet(s.id, "A check");
					if (s.options !== undefined) notYet(s.id, "Option order");
					current.push(askQuestion(s));
					break;
				case "say":
					current.push(statement(s));
					break;
				case "section":
					flush();
					if (s.order !== undefined) notYet(s.id, "A section's order");
					nodes.push(...layout(s.flow, s.title));
					break;
				case "compute":
					notYet(s.id, "A computed value");
					break;
				case "if": {
					flush();
					nodes.push(...branches(s));
					break;
				}
				case "stop": {
					flush();
					const d = whenTrue(s.cond, s.id);
					if (d !== undefined)
						nodes.push(
							...behind(
								d,
								`stop if ${printCondition(s.cond.expr)}`,
								[...layout(s.say), { kind: "end" }],
								s.id,
							),
						);
					break;
				}
				case "loop":
				case "repeat":
					notYet(s.id, "A roster");
					break;
				default:
					s satisfies never;
			}
		}
		flush();
		return nodes;
	};

	/**
	 * An if as survey-flow branches. One arm: a branch on its condition. More: each arm sets a
	 * flag first, and every later arm (and the else) also requires the flag empty, so exactly
	 * the first arm whose condition holds runs, whatever the arms themselves change.
	 */
	const branches = (s: Extract<Step, { kind: "if" }>): Node[] => {
		const conds = s.branches.map((b) => whenTrue(b.cond, s.id));
		if (conds.some((d) => d === undefined)) return [];
		const arms = s.branches.map((b, i) => ({
			d: conds[i],
			label: printCondition(b.cond.expr),
			flow: layout(b.then),
		}));
		const elseFlow = layout(s.else ?? []);
		if (arms.length === 1 && s.else === undefined) {
			const [arm] = arms;
			return arm?.d === undefined
				? []
				: behind(arm.d, `if ${arm.label}`, arm.flow, s.id);
		}
		const flag = flagFor(s.id);
		const unset: Dnf = [
			[{ subject: { kind: "field", name: flag }, op: "Empty" }],
		];
		const taken: Node = { kind: "set", fields: [{ name: flag, value: "1" }] };
		const nodes: Node[] = [];
		for (const [i, arm] of arms.entries()) {
			const d = i === 0 ? arm.d : and(unset, arm.d ?? NEVER);
			if (d === "too-large" || d === undefined) {
				note(
					"qsf-too-large",
					"error",
					s.id,
					"This condition takes more tests than Qualtrics logic should hold.",
				);
				return [];
			}
			nodes.push(
				...behind(
					d,
					`${i === 0 ? "if" : "elif"} ${arm.label}`,
					[taken, ...arm.flow],
					s.id,
				),
			);
		}
		if (s.else !== undefined)
			nodes.push(...behind(unset, "else", elseFlow, s.id));
		return nodes;
	};

	const nodes = layout(instrument.flow);
	return {
		qsf: toQsf(nodes, instrument, options),
		findings,
	};
}

/**
 * IDs of our own, in the shapes Qualtrics' import requires (experiment 5a). It replaces the
 * survey's, the owner's, the brand and the response set's with the importer's own.
 */
const SURVEY_ID = "SV_qretoolsExport0";
const USER_ID = "UR_qretoolsExport";
const RESPONSE_SET = "RS_qretoolsExport0";
const NO_DATE = "0000-00-00 00:00:00";
const blockId = (n: number) => `BL_qretools${String(n).padStart(6, "0")}`;

const element = (
	kind: string,
	primary: string,
	secondary: string | null,
	tertiary: string | null,
	payload: Qsf,
): QsfObject => ({
	SurveyID: SURVEY_ID,
	Element: kind,
	PrimaryAttribute: primary,
	SecondaryAttribute: secondary,
	TertiaryAttribute: tertiary,
	Payload: payload,
});

/** The flow as a QSF document, on a skeleton with nothing from any account. */
function toQsf(
	nodes: readonly Node[],
	instrument: ReadInstrument,
	{ name, created }: { readonly name: string; readonly created: string },
): QsfObject {
	const all: Extract<Node, { kind: "block" }>[] = [];
	let flowIds = 1;
	const flowId = () => `FL_${++flowIds}`;
	const serialise = (ns: readonly Node[]): QsfObject[] =>
		ns.map((n): QsfObject => {
			switch (n.kind) {
				case "block": {
					all.push(n);
					// The first block is Qualtrics' Default block.
					const id = blockId(all.length);
					return all.length === 1
						? { Type: "Block", ID: id, FlowID: flowId() }
						: { Type: "Standard", ID: id, FlowID: flowId(), Autofill: [] };
				}
				case "branch": {
					const id = flowId();
					return {
						Type: "Branch",
						FlowID: id,
						Description: n.description,
						BranchLogic: n.logic,
						Flow: serialise(n.flow),
					};
				}
				case "set":
					return {
						Type: "EmbeddedData",
						FlowID: flowId(),
						EmbeddedData: n.fields.map((f) => ({
							Description: f.name,
							Type: "Custom",
							Field: f.name,
							VariableType: "String",
							DataVisibility: [],
							AnalyzeText: false,
							Value: f.value,
						})),
					};
				case "end":
					return {
						Type: "EndSurvey",
						FlowID: flowId(),
						EndingType: "Advanced",
						Options: { Advanced: "true", ResponseFlag: "Screened" },
					};
				default:
					return n satisfies never;
			}
		});
	const inputs: QsfObject[] =
		instrument.inputs.length === 0
			? []
			: [
					{
						Type: "EmbeddedData",
						FlowID: flowId(),
						EmbeddedData: instrument.inputs.map((i) => ({
							Description: i.variable,
							Type: "Recipient",
							Field: i.variable,
							VariableType: "String",
							DataVisibility: [],
							AnalyzeText: false,
						})),
					},
				];
	const flow = [...inputs, ...serialise(nodes)];
	// A survey with no questions still has its Default block.
	if (all.length === 0) {
		all.push({ kind: "block", questions: [] });
		flow.push({ Type: "Block", ID: blockId(1), FlowID: flowId() });
	}
	const ids = all.map((_, i) => blockId(i + 1));
	const questions = all.flatMap((b) => b.questions);
	return {
		SurveyEntry: {
			SurveyID: SURVEY_ID,
			SurveyName: name,
			SurveyDescription: null,
			SurveyOwnerID: USER_ID,
			SurveyBrandID: "qretools",
			DivisionID: null,
			SurveyLanguage: "EN",
			SurveyActiveResponseSet: RESPONSE_SET,
			SurveyStatus: "Inactive",
			SurveyStartDate: NO_DATE,
			SurveyExpirationDate: NO_DATE,
			SurveyCreationDate: created,
			CreatorID: USER_ID,
			LastModified: created,
			LastAccessed: NO_DATE,
			LastActivated: NO_DATE,
			Deleted: null,
		},
		SurveyElements: [
			element("BL", "Survey Blocks", null, null, [
				...all.map((b, i) => ({
					Type: i === 0 ? "Default" : "Standard",
					SubType: "",
					Description:
						b.description ??
						(i === 0 ? "Default Question Block" : `Block ${i + 1}`),
					ID: ids[i] ?? "",
					BlockElements: b.questions.flatMap((q, j) => [
						...(j === 0 ? [] : [{ Type: "Page Break" }]),
						{ Type: "Question", QuestionID: q.QuestionID ?? "" },
					]),
				})),
				{
					Type: "Trash",
					Description: "Trash / Unused Questions",
					ID: blockId(0),
				},
			]),
			element("FL", "Survey Flow", null, null, {
				Type: "Root",
				FlowID: "FL_1",
				Flow: flow,
				Properties: { Count: flowIds },
			}),
			element("PROJ", "CORE", null, "1.1.0", {
				ProjectCategory: "CORE",
				SchemaVersion: "1.1.0",
			}),
			element("RS", RESPONSE_SET, "Default Response Set", null, null),
			element("SCO", "Scoring", null, null, {
				ScoringCategories: [],
				ScoringCategoryGroups: [],
				ScoringSummaryCategory: null,
				ScoringSummaryAfterQuestions: 0,
				ScoringSummaryAfterSurvey: 0,
				DefaultScoringCategory: null,
				AutoScoringCategory: null,
			}),
			element("STAT", "Survey Statistics", null, null, {
				MobileCompatible: true,
				ID: "Survey Statistics",
			}),
			element(
				"QC",
				"Survey Question Count",
				String(questions.length),
				null,
				null,
			),
			element("SO", "Survey Options", null, null, {
				BackButton: SETTINGS.back === "allow" ? "true" : "false",
				SaveAndContinue: "true",
				SurveyProtection: "PublicSurvey",
				BallotBoxStuffingPrevention: "false",
				NoIndex: "Yes",
				SecureResponseFiles: "true",
				SurveyExpiration: "None",
				SurveyTermination: "DefaultMessage",
				Header: "",
				Footer: "",
				ProgressBarDisplay: "None",
				PartialData: "+1 week",
				ValidationMessage: "",
				PreviousButton: "",
				NextButton: "",
				// Qualtrics' simple dynamic theme, under the importer's own brand (not yet seen to stop
				// the "static theme" notice: experiment 5b).
				SkinType: "component",
				Skin: { brandingId: null, templateId: "*simple", overrides: null },
				NewScoring: 1,
			}),
			...questions.map((q) =>
				element(
					"SQ",
					String(q.QuestionID),
					String(q.QuestionDescription),
					null,
					q,
				),
			),
		],
	};
}
