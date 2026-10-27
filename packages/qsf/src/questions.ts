/** Questions and statements as Qualtrics writes them, with values piped into their text. */
import { isLogical } from "./computes.ts";
import type { Ctx } from "./number.ts";
import type {
	Check,
	Part,
	Question,
	ReadInstrument,
	Source,
	Step,
} from "./read.ts";
import type { QsfObject } from "./skeleton.ts";

/** Text as Qualtrics shows it: HTML, where `${` starts a pipe and `$e{` arithmetic. */
export const escapeText = (text: string): string =>
	text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		// `${` pipes and `$e{` computes: an author's dollar is never either.
		.replace(/\$/g, "&#36;")
		.replace(/\n/g, "<br>");

/** The question writers for one survey: export tags are shared across its questions. */
export function questionsOf(ctx: Ctx, instrument: ReadInstrument) {
	/** A value piped into text, or undefined (with a finding) where Qualtrics can't show it. */
	const pipe = (
		source: Source,
		label: boolean,
		at: string,
	): string | undefined => {
		switch (source.kind) {
			case "input":
				return `\${e://Field/${source.variable}}`;
			case "compute":
				if (isLogical(ctx, source.variable)) {
					ctx.note(
						"qsf-inexpressible",
						"error",
						at,
						`\`${source.variable}\` is true or false. Qualtrics can test it but can't show it.`,
					);
					return undefined;
				}
				return `\${e://Field/${source.variable}}`;
			// Only a roster Qualtrics loops still has a row number: the loop's own.
			case "row":
				return `\${lm://CurrentLoopNumber}`;
			case "answer": {
				if (source.option !== undefined) {
					ctx.note(
						"qsf-inexpressible",
						"error",
						at,
						`\`${source.variable}\` is one option of a select all that apply question. Qualtrics can't show it.`,
					);
					return undefined;
				}
				const row = source.row === undefined ? "" : `${source.row}_`;
				if (source.row === undefined && source.asks.some(ctx.outside)) {
					ctx.note(
						"qsf-inexpressible",
						"error",
						at,
						`\`${source.variable}\` is answered in each row of a roster. Outside the roster, Qualtrics can't tell which row to show.`,
					);
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
				return source.asks
					.map((a) => `\${q://${row}${ctx.qidOf(a)}/${what}}`)
					.join("");
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
	const fields = new Set([
		...instrument.inputs.map((i) => i.variable),
		...ctx.numbering.computes.keys(),
	]);
	const tag = (wanted: string, owner: string, qid: string, at: string) => {
		const held = tags.get(wanted);
		if (fields.has(wanted)) {
			ctx.note(
				"qsf-note",
				"info",
				at,
				`\`${wanted}\` is also an embedded data field in Qualtrics, so this question's export tag is ${qid}.`,
			);
			return qid;
		}
		if (held === undefined || held === owner) {
			tags.set(wanted, owner);
			return wanted;
		}
		ctx.note(
			"qsf-note",
			"info",
			at,
			`\`${wanted}\` is already another question's export tag in Qualtrics, so this one's is ${qid}.`,
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
		const qid = ctx.qidOf(s.id);
		const text = textOf(s.text, s.id);
		const q: Question = s.question;
		const domain = q.domain;
		if (s.options !== undefined && domain.kind !== "choice")
			ctx.note(
				"qsf-note",
				"info",
				s.id,
				"This question has no options to shuffle, so its order is ignored.",
			);
		if (s.options === "rotate" && domain.kind === "choice")
			ctx.note(
				"qsf-inexpressible",
				"warning",
				s.id,
				"Qualtrics can't rotate options, so they're shuffled instead.",
			);
		if (domain.kind === "choice") {
			const keys = domain.choices.map((_, i) => String(i + 1));
			const exportTag = domain.many
				? tag(q.name, `m:${s.records.map((r) => r.variable).join()}`, qid, s.id)
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
				// Shuffled for each respondent, as experiment 4 (E) wrote it; rotation is shuffled too.
				...(s.options !== undefined && {
					Randomization: { Type: "All", Advanced: null, TotalRandSubset: "" },
				}),
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
		if (domain.kind === "text" && domain.maxLength !== undefined)
			ctx.note(
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
		const qid = ctx.qidOf(s.id);
		const text = textOf(s.text, s.id);
		return {
			...common(qid, text, qid),
			QuestionType: "DB",
			Selector: "TB",
			ChoiceOrder: [],
			Validation: { Settings: { Type: "None" } },
		};
	};
	/** A warning check's words as a statement: its message, or a plain request to check. */
	const warning = (check: Check): QsfObject => {
		const qid = ctx.qidOf(check.id);
		const text =
			check.message === undefined
				? "Please check your answer."
				: textOf(check.message, check.id);
		return {
			...common(qid, text, qid),
			QuestionType: "DB",
			Selector: "TB",
			ChoiceOrder: [],
			Validation: { Settings: { Type: "None" } },
		};
	};
	return { askQuestion, statement, warning };
}
