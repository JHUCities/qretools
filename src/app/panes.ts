/**
 * Panes: functions from core data to an element, with no memory. They decide
 * nothing about surveys; they draw the render models, findings and verdicts the
 * core hands them. Clicks report a Target (a place in the document's terms).
 */
import type { Finding, Status, Target } from "../core/findings.js";
import type {
	CodebookView,
	Hole,
	Input,
	RespondentView,
	Slot,
} from "../core/render.js";
import { h } from "./h.js";
import type { DdiSchema } from "./model.js";

export type OnTarget = (target: Target) => void;

/** Messages mark field names with backticks (a core/shell convention); show those as code. */
const inlineCode = (text: string): readonly (HTMLElement | string)[] =>
	text.split("`").map((part, i) => (i % 2 === 1 ? h("code", {}, part) : part));

const viewHole = (hole: Hole, onTarget: OnTarget): HTMLElement =>
	h(
		"button",
		{
			type: "button",
			class: "hole",
			title: "Go to this place in the source",
			onClick: () => onTarget({ path: hole.path, severity: "hole" }),
		},
		hole.prompt,
	);

const viewSlot = (slot: Slot, onTarget: OnTarget): HTMLElement | string =>
	slot.kind === "filled" ? slot.text : viewHole(slot, onTarget);

export function viewRespondent(
	v: RespondentView,
	onTarget: OnTarget,
): HTMLElement {
	return h(
		"fieldset",
		{ class: "respondent" },
		h("legend", {}, viewSlot(v.text, onTarget)),
		v.instruction !== undefined &&
			h("p", { class: "instruction" }, v.instruction),
		viewInput(v.input, onTarget),
	);
}

function viewInput(input: Input, onTarget: OnTarget): HTMLElement {
	switch (input.kind) {
		case "hole":
			return viewHole(input, onTarget);
		case "choice":
			// Inputs sit inside their labels, and the group name is constant: author-spelled
			// codes (`1.5`, `010`) make poor ids, and `name` may still be a hole.
			return h(
				"div",
				{ class: "options" },
				...input.options.map((o) =>
					h(
						"label",
						{},
						h("input", {
							type: input.select === "one" ? "radio" : "checkbox",
							name: "response",
							value: o.code,
						}),
						` ${o.label}`,
					),
				),
			);
		case "number":
			return h(
				"label",
				{ class: "number" },
				h("input", {
					type: "number",
					min: input.min,
					max: input.max,
					step: input.step,
					"aria-label": "Answer",
				}),
				input.unit !== undefined && ` ${input.unit}`,
			);
		case "text":
			return h("textarea", {
				rows: 3,
				maxlength: input.maxLength,
				"aria-label": "Answer",
			});
		default:
			return input satisfies never;
	}
}

export function viewCodebook(v: CodebookView, onTarget: OnTarget): HTMLElement {
	return h(
		"div",
		{ class: "codebook" },
		h(
			"p",
			{ class: "cb-title" },
			viewSlot(v.title, onTarget),
			" ",
			h(
				"span",
				{ class: "cb-var" },
				"Variable: ",
				viewSlot(v.variable, onTarget),
			),
		),
		h("p", { class: "cb-text" }, viewSlot(v.text, onTarget)),
		v.values.kind === "hole"
			? viewHole(v.values, onTarget)
			: h(
					"ul",
					{ class: "cb-values" },
					...v.values.lines.map((l) => h("li", {}, l)),
				),
		v.universe !== undefined &&
			h("p", { class: "cb-meta" }, h("b", {}, "Universe: "), v.universe),
		v.source !== undefined &&
			h("p", { class: "cb-meta" }, h("b", {}, "Source: "), v.source),
		...v.notes.map((n) =>
			h("p", { class: "cb-meta" }, h("b", {}, "Note: "), n),
		),
	);
}

export function viewFindings(
	findings: readonly Finding[],
	onTarget: OnTarget,
): HTMLElement {
	if (findings.length === 0)
		return h(
			"p",
			{ class: "quiet" },
			"Nothing to fill in, fix, or reconsider.",
		);
	return h(
		"ul",
		{ class: "findings" },
		...findings.map((f) =>
			h(
				"li",
				{},
				h(
					"button",
					{
						type: "button",
						class: `finding ${f.severity}`,
						onClick: () => onTarget(f),
					},
					h("span", { class: "sev" }, f.severity),
					h("span", { class: "msg" }, ...inlineCode(f.message)),
					f.hint !== undefined && h("span", { class: "hint" }, f.hint),
				),
			),
		),
	);
}

export function viewDdi(
	document: unknown,
	problems: readonly Finding[],
): readonly HTMLElement[] {
	return [
		...problems.map((f) =>
			h("p", { class: "finding error" }, ...inlineCode(f.message)),
		),
		h("pre", { class: "json" }, JSON.stringify(document, null, 2)),
	];
}

export function statusBadge(s: Status): HTMLElement {
	switch (s.kind) {
		case "complete":
			return h("span", { class: "badge ok" }, "complete");
		case "advice":
			return h(
				"span",
				{ class: "badge" },
				s.count === 1 ? "1 piece of advice" : `${s.count} pieces of advice`,
			);
		case "incomplete":
			return h(
				"span",
				{ class: `badge ${s.errors > 0 ? "error" : "hole"}` },
				[
					s.holes > 0 && `${s.holes} to fill in`,
					s.errors > 0 && `${s.errors} to fix`,
				]
					.filter(Boolean)
					.join(", "),
			);
		default:
			return s satisfies never;
	}
}

export function ddiBadge(
	schema: DdiSchema,
	problems: readonly Finding[],
): HTMLElement {
	if (schema.kind === "loading")
		return h("span", { class: "badge" }, "loading schema…");
	return problems.length === 0
		? h("span", { class: "badge ok" }, "valid against the official schema")
		: h(
				"span",
				{ class: "badge error" },
				problems.length === 1
					? "1 schema problem"
					: `${problems.length} schema problems`,
			);
}
