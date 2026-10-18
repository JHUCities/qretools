/** The QSF document around the flow: a skeleton with nothing from any account. */
import type { ReadInstrument } from "./read.ts";
import { SETTINGS } from "./settings.ts";

/** QSF's JSON: unlike the DDI's, it has nulls. */
export type Qsf =
	| string
	| number
	| boolean
	| null
	| readonly Qsf[]
	| { readonly [key: string]: Qsf };
export type QsfObject = { readonly [key: string]: Qsf };

/** The survey's flow: blocks of questions (one to a page), branches, fields set, the end. */
export type Node =
	| {
			readonly kind: "block";
			/** Its own ID, when something else names it (a loop's block, in a condition on a round). */
			readonly id?: string;
			readonly description?: string;
			readonly questions: readonly QsfObject[];
			/** Block options: a loop's. */
			readonly options?: QsfObject;
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
export function toQsf(
	nodes: readonly Node[],
	instrument: ReadInstrument,
	{ name, created }: { readonly name: string; readonly created: string },
): QsfObject {
	const all: Extract<Node, { kind: "block" }>[] = [];
	const ids: string[] = [];
	let flowIds = 1;
	const flowId = () => `FL_${++flowIds}`;
	const serialise = (ns: readonly Node[]): QsfObject[] =>
		ns.map((n): QsfObject => {
			switch (n.kind) {
				case "block": {
					all.push(n);
					// The first block is Qualtrics' Default block.
					const id = n.id ?? blockId(all.length);
					ids.push(id);
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
		ids.push(blockId(1));
		flow.push({ Type: "Block", ID: blockId(1), FlowID: flowId() });
	}
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
					...(b.options && { Options: b.options }),
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
				// No theme: one needs a brand's skin library (experiment 5b), which only an account
				// has. Qualtrics then notes the survey uses a static theme, which is harmless.
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
