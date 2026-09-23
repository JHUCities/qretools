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

// ---- Step 5: the list, the question header, and the bank status ----------------

import type { Activity, Bank, Id, Origin, Screen, Session } from "./model.js";
import type { Failure } from "./storage.js";

/** One row of the list: data computed in `view`, drawn here. */
export interface Row {
	readonly id: Id;
	readonly name: string | undefined;
	readonly title: string | undefined;
	readonly folder: string | undefined;
	readonly status: Status;
	readonly unsaved: boolean;
	readonly origin: Origin["kind"];
	readonly activity: Activity;
}

export interface ListActions {
	readonly open: (id: Id) => void;
	readonly remove: (id: Id) => void;
	readonly cancelRemove: () => void;
}

export function viewFailure(
	f: Failure,
	...maybeActions: readonly (HTMLElement | false | undefined)[]
): HTMLElement {
	const actions = maybeActions.filter(
		(a): a is HTMLElement => a instanceof HTMLElement,
	);
	return h(
		"div",
		{ class: "failure", role: "alert" },
		h("span", { class: "msg" }, ...inlineCode(f.message)),
		f.hint !== undefined && h("span", { class: "hint" }, ...inlineCode(f.hint)),
		actions.length > 0 && h("span", { class: "actions" }, ...actions),
	);
}

/** The rows the current filter shows. Pure, so the static toolbar and the table agree. */
export const visibleRows = (
	rows: readonly Row[],
	screen: Extract<Screen, { kind: "list" }>,
): readonly Row[] =>
	rows.filter(
		(r) =>
			(screen.folder === undefined || r.folder === screen.folder) &&
			(screen.text === "" ||
				`${r.name ?? ""} ${r.title ?? ""}`
					.toLowerCase()
					.includes(screen.text.toLowerCase())),
	);

export function viewList(
	shown: readonly Row[],
	total: number,
	screen: Extract<Screen, { kind: "list" }>,
	canWrite: boolean,
	on: ListActions,
): HTMLElement {
	if (total === 0)
		return h(
			"p",
			{ class: "quiet" },
			"No questions yet. Create one above, or connect to the bank.",
		);
	if (shown.length === 0)
		return h("p", { class: "quiet" }, "No questions match.");
	return h(
		"table",
		{ class: "rows" },
		h(
			"thead",
			{},
			h(
				"tr",
				{},
				h("th", {}, "Name"),
				h("th", {}, "Title"),
				h("th", {}, "Topic"),
				h("th", {}, "Status"),
				h("th", {}, ""),
			),
		),
		h(
			"tbody",
			{},
			...shown.map((r) =>
				h(
					"tr",
					{ class: r.unsaved ? "unsaved" : "" },
					h(
						"td",
						{},
						h(
							"button",
							{ type: "button", class: "link", onClick: () => on.open(r.id) },
							r.name ?? h("span", { class: "quiet" }, "(no name)"),
						),
					),
					h("td", {}, r.title ?? ""),
					h("td", {}, r.folder ?? ""),
					h(
						"td",
						{},
						statusBadge(r.status),
						r.unsaved &&
							h(
								"span",
								{ class: "badge hole" },
								r.origin === "draft" ? "draft" : "unsaved",
							),
						r.activity.kind === "failed" &&
							h("span", { class: "badge error" }, "failed"),
					),
					h(
						"td",
						{ class: "row-actions" },
						...(screen.confirmDelete === r.id
							? [
									h(
										"button",
										{
											type: "button",
											class: "danger",
											onClick: () => on.remove(r.id),
										},
										r.origin === "draft" ? "Delete draft" : "Delete from bank",
									),
									h(
										"button",
										{ type: "button", onClick: () => on.cancelRemove() },
										"Keep",
									),
								]
							: [
									h(
										"button",
										{
											type: "button",
											disabled: r.origin === "bank" && !canWrite,
											title:
												r.origin === "bank" && !canWrite
													? "Read access only"
													: "Delete",
											onClick: () => on.remove(r.id),
										},
										"Delete…",
									),
								]),
					),
				),
			),
		),
	);
}

export interface HeaderActions {
	readonly back: () => void;
	readonly save: () => void;
	readonly reload: () => void;
	readonly downloadYaml: () => void;
	readonly downloadDdi: () => void;
}

export function viewQuestionHeader(
	q: {
		readonly name: string | undefined;
		readonly origin: Origin;
		readonly activity: Activity;
		readonly unsaved: boolean;
	},
	session: Session,
	on: HeaderActions,
): HTMLElement {
	const canWrite = session.kind === "connected" && session.canWrite;
	const saveTitle =
		session.kind !== "connected"
			? "Connect to the bank to save"
			: !canWrite
				? "Read access only: download instead"
				: q.unsaved
					? "Save to the bank"
					: "Nothing to save";
	return h(
		"div",
		{ class: "qhead" },
		h("button", { type: "button", onClick: on.back }, "← Questions"),
		h(
			"span",
			{ class: "qname" },
			q.name ?? h("span", { class: "quiet" }, "(no name yet)"),
		),
		q.origin.kind === "bank"
			? h("span", { class: "badge" }, "in bank")
			: h("span", { class: "badge hole" }, "draft"),
		q.unsaved && h("span", { class: "badge hole" }, "unsaved"),
		q.activity.kind === "saving" && h("span", { class: "badge" }, "saving…"),
		q.activity.kind === "deleting" &&
			h("span", { class: "badge" }, "deleting…"),
		h("span", { class: "spacer" }),
		h("button", { type: "button", onClick: on.downloadYaml }, "Download YAML"),
		h("button", { type: "button", onClick: on.downloadDdi }, "Download DDI"),
		h(
			"button",
			{
				type: "button",
				class: "primary",
				disabled: !canWrite || !q.unsaved || q.activity.kind === "saving",
				title: saveTitle,
				onClick: on.save,
			},
			"Save",
		),
		q.activity.kind === "failed" &&
			viewFailure(
				q.activity.failure,
				q.activity.failure.kind === "stale" &&
					q.origin.kind === "bank" &&
					h(
						"button",
						{ type: "button", onClick: on.reload },
						"Reload from GitHub",
					),
			),
	);
}

export interface BankActions {
	readonly dismiss: (index: number) => void;
	readonly disconnect: () => void;
}

export function viewBankStatus(
	session: Session,
	bank: Bank,
	failures: readonly Failure[],
	on: BankActions,
): HTMLElement {
	const line = (): HTMLElement => {
		switch (session.kind) {
			case "anonymous":
				return h(
					"p",
					{ class: "quiet" },
					"Not connected. Working with local drafts and the bundled scales.",
				);
			case "connecting":
				return h("p", {}, "Connecting…");
			case "failed":
				return viewFailure(session.failure);
			case "connected":
				return h(
					"p",
					{},
					`Connected as ${session.login}, `,
					session.canWrite
						? "with write access."
						: "read access only: you can browse, draft and download.",
					" ",
					h("button", { type: "button", onClick: on.disconnect }, "Disconnect"),
				);
			default:
				return session satisfies never;
		}
	};
	const bankLine =
		bank.kind === "loading"
			? h("p", {}, "Loading the bank…")
			: bank.kind === "loaded"
				? h(
						"div",
						{},
						h(
							"p",
							{},
							`Bank loaded; ${bank.scaleFindings.length === 0 ? "all scales read cleanly." : "some scale files need attention:"}`,
						),
						...bank.scaleFindings.map((s) =>
							h(
								"p",
								{ class: "finding warning" },
								h("b", {}, `${s.name}: `),
								s.findings.map((f) => f.message).join("; "),
							),
						),
					)
				: null;
	return h(
		"div",
		{ class: "bank-status" },
		line(),
		bankLine,
		...failures.map((f, i) =>
			viewFailure(
				f,
				h(
					"button",
					{ type: "button", onClick: () => on.dismiss(i) },
					"Dismiss",
				),
			),
		),
	);
}
