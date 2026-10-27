/** A codebook as lines of text, for tests to compare whole. */
import type { Asking } from "./flow.ts";
import type { Codebook, Row } from "./model.ts";
import type { Text } from "./text.ts";

/** Text on one line: paragraphs joined by ¶, a reference as <name>, a link as [url]. */
export const plain = (t: Text | undefined): string =>
	(t ?? [])
		.map((p) =>
			p
				.map((s) =>
					s.kind === "ref"
						? `<${s.name ?? s.urn}>`
						: s.kind === "link"
							? `[${s.url}]`
							: s.text,
				)
				.join(""),
		)
		.join(" ¶ ");

const row = (r: Row) => `${r.code}${r.missing ? "!" : ""}=${plain(r.label)}`;

/** One place a question is asked, on one line. */
export const asking = (a: Asking): string =>
	`${a.conditions.map((c) => `${c.negated ? "not " : ""}(${c.command})`).join(" and ") || "always"}${a.loops.length > 0 ? ` in ${a.loops.length} loop` : ""}${a.order ? ` order ${a.order}` : ""}${a.responseOrder ? ` options ${a.responseOrder}` : ""}`;

export const outline = (cb: Codebook): string[] => [
	...(cb.title === undefined ? [] : [`title ${cb.title}`]),
	...cb.entries.flatMap((e) => [
		`${e.type} ${e.name ?? e.urn}${e.label ? ` "${plain(e.label)}"` : ""}${e.question ? `: ${plain(e.question.text)}` : ""}`,
		...(e.group
			? [`  option ${e.group.option.code} ${plain(e.group.option.label)}`]
			: []),
		...(e.question?.instructions ?? []).map((i) => `  instruction ${plain(i)}`),
		...(e.responses
			? [
					`  codes${e.responses.many ? " many" : ""} ${e.responses.rows.map(row).join(", ")}`,
				]
			: []),
		...(e.format ? [`  format ${JSON.stringify(e.format)}`] : []),
		...e.asked.map((a) => `  asked ${asking(a)}`),
		...(e.universes.length > 0
			? [`  universe ${e.universes.map((u) => u.name).join(", ")}`]
			: []),
		...(e.concepts.length > 0
			? [`  concept ${e.concepts.map((c) => c.name).join(", ")}`]
			: []),
		...(e.derivation
			? [
					`  derived ${e.derivation.commands.map((c) => `${c.language ?? ""}:${c.command}`).join("; ")}${e.derivation.from.length > 0 ? ` from ${e.derivation.from.map((f) => f.name).join(", ")}` : ""} ${plain(e.derivation.text)}`.trimEnd(),
				]
			: []),
		...(e.notes ? [`  notes ${plain(e.notes)}`] : []),
	]),
];
