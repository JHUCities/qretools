/**
 * The QSF column map of a fielded survey, made from its response export and a DDI: for a
 * survey whose release isn't known, or that didn't come from one. The DDI gives the map
 * `qsfMapOf` makes; each question of the export is matched to one question of that map
 * by its export tag, else by its text, and the map takes the export's ImportIds. Each match
 * is a finding, so a person can check it. Pure: text in, values out. Reads only the export's
 * three header rows and its `qretools_*` fields, never an answer.
 */
import {
	type DdiDocument,
	parseCsv,
	type ResponseFinding,
} from "@qretools/core";
import type { Column, ColumnMap } from "./columns.ts";
import type { Finding as QsfFinding } from "./findings.ts";
import { qsfOf } from "./qsf.ts";
import { expand, importIdOf, keyOf } from "./responses.ts";
import { PROVENANCE, type QsfOptions } from "./skeleton.ts";

export type FromExportCode =
	/** The file isn't a Qualtrics response export. */
	| "qsf-map-unreadable"
	/** A question of the export, matched to a question of the DDI by its export tag or its text. */
	| "qsf-map-matched"
	/** An answer column no question of the DDI matches: the map isn't written. */
	| "qsf-map-unmatched"
	/** A column the DDI's survey has that the export doesn't: the map leaves it out. */
	| "qsf-map-absent"
	/** The export's `qretools_*` fields name another instrument or DDI. */
	| "qsf-map-provenance";

export type FromExportFinding = ResponseFinding<FromExportCode>;

/** An answer column's ImportId: a choice, or typed (`_TEXT`), in a loop's round or not. */
const ANSWER = /^(?:(\d+)_)?(QID\d+)(_TEXT)?$/;
/** Any question's column, an answer or not (display order, say). */
const QUESTION = /^(\d+_)?QID\d+/;
/**
 * A question's columns that hold no answer: display order and page timing. Any other
 * question's column holds one ("other, specify" text, a matrix row), so it must be matched.
 */
// shortcut: this list of suffixes is Qualtrics' as documented, unmeasured in an export; add what a real one shows.
const NOT_ANSWER = /_(DO|FIRST_CLICK|LAST_CLICK|PAGE_SUBMIT|CLICK_COUNT)$/;

type Kind = "one" | "many" | "text";

/** One question, by its QID: as the export has it, or as the DDI's survey would. */
interface Asked {
	readonly qid: string;
	/** Its first column's name in the export (row 1), or its export tag. */
	readonly name: string;
	readonly tag: string;
	/** Its text, as row 2 of the export gives it (`plain`). */
	readonly text: string;
	readonly kind: Kind;
	/** Its select-all options' choiceIds. */
	readonly choices: readonly string[];
	/** How many rounds a loop asks it (0: not in one). */
	readonly rounds: number;
}

/** Text compared: spaces collapsed, and a piped question's QID dropped (another survey may number it otherwise). */
const squash = (text: string): string =>
	text
		.replace(/\[QID\d+-/g, "[QID-")
		.replace(/\s+/g, " ")
		.trim();

/** QSF question text as row 2 of an export gives it: tags and entities gone, a pipe as `[Field-x]`. */
const plain = (html: string): string =>
	squash(
		html
			.replace(
				/\$\{\w+:\/\/([^}]*)\}/g,
				(_, path: string) => `[${path.replaceAll("/", "-")}]`,
			)
			.replace(/<br>/g, " ")
			.replace(/<[^>]*>/g, "")
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&#36;/g, "$")
			.replace(/&amp;/g, "&"),
	);

/** Row 2 says this text: as it is, or with a select-all option's label after it. */
const says = (label: string, text: string): boolean =>
	label === text || label.startsWith(`${text} - `);

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
	a.length === b.length && a.every((x) => b.includes(x));

export function qsfMapFromExport(
	text: string,
	ddi: DdiDocument,
	options: Pick<QsfOptions, "digest" | "version">,
):
	| {
			readonly kind: "made";
			readonly columns: ColumnMap;
			readonly findings: readonly FromExportFinding[];
			readonly survey: readonly QsfFinding[];
	  }
	| {
			readonly kind: "refused";
			/** Errors in the DDI's survey, where Qualtrics can't run it (`qsfRefusalReason`). */
			readonly errors?: number;
			readonly findings: readonly FromExportFinding[];
			readonly survey: readonly QsfFinding[];
	  } {
	const findings: FromExportFinding[] = [];
	const note = (
		code: FromExportCode,
		severity: FromExportFinding["severity"],
		message: string,
		at: { column?: string; line?: number; count?: number } = {},
	) => findings.push({ code, severity, message, ...at, count: at.count ?? 1 });

	const made = qsfOf(ddi, { ...options, name: "", created: "" });
	if (made.kind === "refused")
		return {
			kind: "refused",
			errors: made.errors,
			findings,
			survey: made.findings,
		};
	const refused = () =>
		({ kind: "refused", findings, survey: made.findings }) as const;

	const { rows: records, unclosed } = parseCsv(text);
	if (unclosed !== undefined)
		note(
			"qsf-map-unreadable",
			"error",
			"A quote opened here is never closed, so the rest of the file is read as one cell.",
			{ line: unclosed },
		);
	const [names, labels, ids, ...rows] = records;
	if (names === undefined || labels === undefined || ids === undefined) {
		note(
			"qsf-map-unreadable",
			"error",
			"This isn't a Qualtrics response export: it has fewer than three header rows.",
		);
		return refused();
	}

	// The export's questions, by QID, and its other columns' ImportIds.
	const asked = new Map<string, Asked>();
	const answers: { readonly key: string; readonly name: string }[] = [];
	const fields = new Map<string, number>();
	ids.cells.forEach((cell, i) => {
		const id = importIdOf(cell);
		const name = names.cells[i] ?? "";
		if (id === undefined) return;
		const m = ANSWER.exec(id.importId);
		if (m === null) {
			// A question's other columns (display order, say) aren't answers: left out, as metadata is.
			if (!QUESTION.test(id.importId)) fields.set(id.importId, i);
			else if (!NOT_ANSWER.test(id.importId))
				answers.push({ key: keyOf(id.importId, id.choice), name });
			return;
		}
		const [, round, qid = "", typed] = m;
		answers.push({ key: keyOf(id.importId, id.choice), name });
		const q = asked.get(qid);
		if (q !== undefined) {
			asked.set(qid, {
				...q,
				choices:
					id.choice === undefined || q.choices.includes(id.choice)
						? q.choices
						: [...q.choices, id.choice],
				rounds: Math.max(q.rounds, Number(round ?? 0)),
			});
			return;
		}
		// A loop's round leads its name (`1_tag`) and label (`1 - text`); an option's id ends its name.
		const unround = (s: string, by: string) =>
			round !== undefined && s.startsWith(`${round}${by}`)
				? s.slice(round.length + by.length)
				: s;
		const suffix = `_${id.choice}`;
		asked.set(qid, {
			qid,
			name,
			rounds: Number(round ?? 0),
			tag: unround(
				id.choice !== undefined && name.endsWith(suffix)
					? name.slice(0, -suffix.length)
					: name,
				"_",
			),
			text: squash(unround(labels.cells[i] ?? "", " - ")),
			kind:
				typed !== undefined ? "text" : id.choice !== undefined ? "many" : "one",
			choices: id.choice === undefined ? [] : [id.choice],
		});
	});

	// The DDI's survey's questions, by QID, from its map and its QSF.
	const payloads = new Map(
		(
			made.qsf.SurveyElements as {
				Element: string;
				PrimaryAttribute: string;
				Payload: Record<string, unknown>;
			}[]
		)
			.filter((e) => e.Element === "SQ")
			.map((e) => [e.PrimaryAttribute, e.Payload]),
	);
	const wanted = new Map<string, Asked>();
	for (const c of made.columns.columns) {
		const m = ANSWER.exec(c.importId);
		if (m === null) continue;
		const [, , qid = "", typed] = m;
		const q = wanted.get(qid);
		if (q !== undefined) {
			if (c.choice !== undefined)
				wanted.set(qid, { ...q, choices: [...q.choices, c.choice] });
			continue;
		}
		const p = payloads.get(qid) ?? {};
		const tag = String(p.DataExportTag ?? "");
		wanted.set(qid, {
			qid,
			name: tag,
			rounds: c.rounds ?? 0,
			tag,
			text: plain(String(p.QuestionText ?? "")),
			kind:
				typed !== undefined ? "text" : c.choice !== undefined ? "many" : "one",
			choices: c.choice === undefined ? [] : [c.choice],
		});
	}

	// Matched: the DDI's QID to the export's, one to one, only where the two have one shape.
	// Each pass takes a pair only where neither side has another candidate.
	const match = new Map<string, string>();
	const fits = (q: Asked, w: Asked) =>
		q.kind === w.kind && q.rounds === w.rounds && sameSet(q.choices, w.choices);
	const pass = (
		agree: (q: Asked, w: Asked) => boolean,
		how?: { readonly severity: "info" | "warning"; readonly by: string },
	) => {
		const taken = new Set(match.values());
		const qs = [...asked.values()].filter((q) => !taken.has(q.qid));
		const ws = [...wanted.values()].filter((w) => !match.has(w.qid));
		for (const q of qs) {
			const [w, ...more] = ws.filter((w) => fits(q, w) && agree(q, w));
			if (w === undefined || more.length > 0) continue;
			if (qs.filter((o) => fits(o, w) && agree(o, w)).length > 1) continue;
			match.set(w.qid, q.qid);
			if (how !== undefined)
				note(
					"qsf-map-matched",
					how.severity,
					`Matched to \`${w.tag}\` (${w.qid} in the DDI's survey) ${how.by}.`,
					{ column: q.name },
				);
		}
	};
	// The survey the DDI makes, as it is: said by nothing.
	pass((q, w) => q.qid === w.qid && (q.tag === w.tag || says(q.text, w.text)));
	// A tag the writer gave as a QID (a name clash) says nothing: QIDs may be numbered otherwise.
	const tagged = (q: Asked, w: Asked) =>
		!/^QID\d+$/.test(q.tag) && q.tag === w.tag;
	pass((q, w) => tagged(q, w) && says(q.text, w.text), {
		severity: "info",
		by: "by its export tag",
	});
	pass(tagged, {
		severity: "warning",
		by: "by its export tag, though its text differs",
	});
	pass((q, w) => says(q.text, w.text), {
		severity: "warning",
		by: "by its question text",
	});
	// Rows of a roster written out share their text: as many on each side, paired in order.
	const number = (qid: string) => Number(qid.slice(3));
	const taken = new Set(match.values());
	const qs = [...asked.values()].filter((q) => !taken.has(q.qid));
	const ws = [...wanted.values()].filter((w) => !match.has(w.qid));
	for (const q of qs) {
		const peers = qs.filter((o) => o.text === q.text && o.kind === q.kind);
		const others = ws.filter((w) => fits(q, w) && says(q.text, w.text));
		if (peers.length < 2 || peers.length !== others.length) continue;
		const i = peers.sort((a, b) => number(a.qid) - number(b.qid)).indexOf(q);
		const w = others.sort((a, b) => number(a.qid) - number(b.qid))[i];
		if (w === undefined || !fits(q, w)) continue;
		match.set(w.qid, q.qid);
		note(
			"qsf-map-matched",
			"warning",
			`Matched to \`${w.tag}\` (${w.qid} in the DDI's survey) by its place among ${peers.length} questions with its text.`,
			{ column: q.name },
		);
	}

	// The DDI's map, each matched question at the export's QID; what the export lacks, left out.
	const columns: Column[] = [];
	const absent = new Set<string>();
	for (const c of made.columns.columns) {
		const m = ANSWER.exec(c.importId);
		const qid = m?.[2];
		const at = qid === undefined ? undefined : match.get(qid);
		if (qid !== undefined && at !== undefined)
			columns.push({ ...c, importId: at + c.importId.slice(qid.length) });
		else if (qid === undefined && expand(c).some((e) => fields.has(e.importId)))
			columns.push(c);
		else {
			const what =
				qid === undefined ? c.importId : (wanted.get(qid)?.tag ?? qid);
			if (absent.has(what)) continue;
			absent.add(what);
			note(
				"qsf-map-absent",
				"warning",
				`The export has no column for \`${what}\`, so the map leaves it out.`,
			);
		}
	}

	// Every answer column must be one the map reads, or nothing is written.
	const read = new Set(
		columns.flatMap((c) => expand(c).map((e) => keyOf(e.importId, c.choice))),
	);
	const unread = answers.filter((a) => !read.has(a.key));
	for (const a of unread)
		note(
			"qsf-map-unmatched",
			"error",
			"No question of the DDI matches this column, so the map isn't written.",
			{ column: a.name },
		);

	// The survey's own fields: each should name this DDI.
	for (const [field, expected, what] of [
		[PROVENANCE.instrument, made.columns.instrument, "instrument"],
		[PROVENANCE.ddi, made.columns.ddi, "DDI"],
	] as const) {
		const at = fields.get(field);
		if (at === undefined || expected === undefined) {
			note(
				"qsf-map-provenance",
				"warning",
				`The export has no \`${field}\` field, so its survey's ${what} isn't known. \`responses\` won't read it with this map.`,
			);
			continue;
		}
		const differ = rows.filter((r) => (r.cells[at] ?? "") !== expected);
		const first = differ[0];
		if (first !== undefined)
			note(
				"qsf-map-provenance",
				"warning",
				`This response's \`${field}\` isn't this ${what}: its survey was made from another. \`responses\` won't read it with this map.`,
				{
					line: first.line,
					column: names.cells[at] ?? field,
					count: differ.length,
				},
			);
	}

	return findings.some((f) => f.severity === "error")
		? refused()
		: {
				kind: "made",
				columns: { ...made.columns, columns },
				findings,
				survey: made.findings,
			};
}
