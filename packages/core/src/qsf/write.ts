/**
 * A read instrument written as a Qualtrics survey (QSF). Two passes, both pure: `number`
 * gives every ask and statement its QID in flow order (rosters included, so later steps
 * never renumber), then `layout` turns the flow into blocks, and `toQsf` serialises them
 * with a neutral skeleton (no account's IDs: Qualtrics assigns its own on import). Every
 * shape written is one the owner's exports showed (context: experiments 1–6b). Anything
 * the export can't write yet, or can't write exactly, is a finding at its DDI ID.
 */
import type { Finding } from "../findings.ts";
import type { Part, Question, ReadInstrument, Source, Step } from "./read.ts";
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

/** Each ask and statement's QID, by DDI ID, and the asks inside a roster's rows. */
interface Numbering {
	readonly qids: ReadonlyMap<string, string>;
	readonly looped: ReadonlySet<string>;
}

/** QIDs in flow order, depth first, over every flow a step holds. */
function number(flow: readonly Step[]): Numbering {
	const qids = new Map<string, string>();
	const looped = new Set<string>();
	const go = (steps: readonly Step[], inLoop: boolean): void => {
		for (const s of steps) {
			switch (s.kind) {
				case "ask":
				case "say":
					qids.set(s.id, `QID${qids.size + 1}`);
					if (inLoop) looped.add(s.id);
					break;
				case "compute":
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
	go(flow, false);
	return { qids, looped };
}

/** A block of the survey: its questions in order, one to a page. */
interface Block {
	readonly description?: string;
	readonly questions: readonly QsfObject[];
}

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
	options: { readonly name: string },
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
	const { qids, looped } = number(instrument.flow);
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

	/** The flow as blocks: a run of asks and statements is one block; a section opens its own. */
	const layout = (flow: readonly Step[], description?: string): Block[] => {
		const blocks: Block[] = [];
		let current: QsfObject[] = [];
		let title = description;
		const flush = () => {
			if (current.length > 0)
				blocks.push({
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
					blocks.push(...layout(s.flow, s.title));
					break;
				case "compute":
					notYet(s.id, "A computed value");
					break;
				case "if":
					notYet(s.id, "A branch");
					break;
				case "stop":
					notYet(s.id, "A stop");
					break;
				case "loop":
				case "repeat":
					notYet(s.id, "A roster");
					break;
				default:
					s satisfies never;
			}
		}
		flush();
		return blocks;
	};

	const blocks = layout(instrument.flow);
	return {
		qsf: toQsf(blocks, instrument, options.name),
		findings,
	};
}

/** IDs of our own, in Qualtrics' shape: Qualtrics replaces the survey's on import. */
const SURVEY_ID = "SV_qretoolsExport0";
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

/** Blocks and inputs as a QSF document, on a skeleton with nothing from any account. */
function toQsf(
	blocks: readonly Block[],
	instrument: ReadInstrument,
	name: string,
): QsfObject {
	// The first block is Qualtrics' Default block; a survey with no questions still has one.
	const all = blocks.length > 0 ? blocks : [{ questions: [] }];
	const ids = all.map((_, i) => blockId(i + 1));
	const flow: QsfObject[] = [];
	const flowId = () => `FL_${flow.length + 2}`;
	if (instrument.inputs.length > 0)
		flow.push({
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
		});
	for (const [i, id] of ids.entries())
		flow.push(
			i === 0
				? { Type: "Block", ID: id, FlowID: flowId() }
				: { Type: "Standard", ID: id, FlowID: flowId(), Autofill: [] },
		);
	const questions = all.flatMap((b) => b.questions);
	return {
		SurveyEntry: {
			SurveyID: SURVEY_ID,
			SurveyName: name,
			SurveyDescription: null,
			SurveyLanguage: "EN",
			SurveyStatus: "Inactive",
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
				Properties: { Count: flow.length + 1 },
			}),
			element("PROJ", "CORE", null, "1.1.0", {
				ProjectCategory: "CORE",
				SchemaVersion: "1.1.0",
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
