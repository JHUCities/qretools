/**
 * The one place the shell holds hidden state: the stable DOM skeleton, the editor,
 * the compiled DDI validator, and two small caches. Built once; `view(model)`
 * redraws panes from the Model, and `exec` runs the commands `update` describes.
 */
import type { Validator } from "../core/ddi/validate.js";
import { makeValidator } from "../core/ddi/validate.js";
import { evaluate } from "../core/evaluate.js";
import { type Finding, status } from "../core/findings.js";
import { questionJsonSchema } from "../core/surface/schema.js";
import { toDiagnostics } from "./diagnostics.js";
import { createEditor } from "./editor.js";
import { h } from "./h.js";
import { type Cmd, type Dispatch, EXAMPLES, type Model } from "./model.js";
import {
	ddiBadge,
	statusBadge,
	viewCodebook,
	viewDdi,
	viewFindings,
	viewRespondent,
} from "./panes.js";
import type { Mounted } from "./runtime.js";

export function mount(
	root: HTMLElement,
	dispatch: Dispatch,
): Mounted<Model, Cmd> {
	const editorHost = h("div", { class: "editor" });
	const respondent = h("div", { class: "pane-body" });
	const codebook = h("div", { class: "pane-body" });
	const findings = h("div", { class: "pane-body" });
	const ddi = h("div", { class: "pane-body" });
	const findingsTitle = h("h2", {}, "Findings");
	const ddiTitle = h("h2", {}, "DDI-Lifecycle 4.0");
	const pane = (title: HTMLElement, body: HTMLElement) =>
		h("article", { class: "pane" }, title, body);

	root.replaceChildren(
		h(
			"header",
			{ class: "bar" },
			h("h1", {}, "qretools"),
			h("span", { class: "sub" }, "question editor"),
			h(
				"nav",
				{ class: "examples", "aria-label": "Examples" },
				...EXAMPLES.map((e) =>
					h(
						"button",
						{
							type: "button",
							onClick: () => dispatch({ kind: "exampleChosen", text: e.text }),
						},
						e.label,
					),
				),
			),
		),
		h(
			"main",
			{ class: "split" },
			h(
				"section",
				{ class: "left", "aria-label": "Question source" },
				editorHost,
			),
			h(
				"section",
				{ class: "right" },
				// Findings first: what to fill in or fix is what the author acts on.
				pane(findingsTitle, findings),
				pane(h("h2", {}, "As the respondent sees it"), respondent),
				pane(h("h2", {}, "Codebook entry"), codebook),
				// Collapsed by default: the verdict in the summary is what matters at a glance,
				// and the JSON is long. Open or closed is the browser's state, like a ticked radio.
				h("details", { class: "pane" }, h("summary", {}, ddiTitle), ddi),
			),
		),
	);

	const editor = createEditor(editorHost, (text) =>
		dispatch({ kind: "edited", text }),
	);
	const onTarget = (
		target: Parameters<Parameters<typeof viewFindings>[1]>[0],
	) => dispatch({ kind: "locationClicked", target });
	const evaluated = memo(evaluate);
	const schemaFor = memo(questionJsonSchema);
	const redraw = changeDetector();
	// Written only by `exec`, just before it dispatches `ready`; read only by `view`.
	let validator: Validator | undefined;

	return {
		view(model) {
			const ev = evaluated(model.source, model.agency, model.scales);
			const problems: readonly Finding[] =
				model.ddiSchema.kind === "failed"
					? [model.ddiSchema.finding]
					: (validator?.(ev.ddi) ?? []);

			editor.sync({
				text: model.source,
				diagnostics: toDiagnostics(ev.findings, ev.ranges),
				schema: schemaFor(model.scales),
			});
			// Preview inputs hold DOM state (a ticked radio). Redraw a pane only when what
			// it shows has changed, so editing `intent` does not wipe the respondent's tick.
			redraw(respondent, ev.respondent, () => [
				viewRespondent(ev.respondent, onTarget),
			]);
			redraw(codebook, ev.codebook, () => [
				viewCodebook(ev.codebook, onTarget),
			]);
			findingsTitle.replaceChildren(
				"Findings",
				statusBadge(status(ev.findings)),
			);
			findings.replaceChildren(viewFindings(ev.findings, onTarget));
			ddiTitle.replaceChildren(
				"DDI-Lifecycle 4.0",
				ddiBadge(model.ddiSchema, problems),
			);
			ddi.replaceChildren(...viewDdi(ev.ddi, problems));
		},
		exec(cmd) {
			switch (cmd.kind) {
				case "revealRange":
					editor.reveal(cmd.range);
					return;
				case "loadDdiSchema":
					import("../ddi/ddi-lifecycle-4.0-beta4.schema.json?raw")
						.then((m) => makeValidator(JSON.parse(m.default)))
						.then((compiled) => {
							if (compiled.ok) validator = compiled.value;
							dispatch({
								kind: "ddiSchemaLoaded",
								result: compiled.ok
									? { kind: "ready" }
									: { kind: "failed", finding: compiled.error },
							});
						})
						.catch((e: unknown) =>
							dispatch({
								kind: "ddiSchemaLoaded",
								result: {
									kind: "failed",
									finding: {
										code: "ddi-invalid",
										severity: "error",
										path: "",
										message: `The DDI schema could not be loaded: ${e instanceof Error ? e.message : String(e)}`,
									},
								},
							}),
						);
					return;
				default:
					return cmd satisfies never;
			}
		},
	};
}

/** Render models are small plain data, so their JSON is a cheap and exact change test. */
function changeDetector(): (
	container: HTMLElement,
	model: unknown,
	draw: () => readonly HTMLElement[],
) => void {
	const shown = new WeakMap<HTMLElement, string>();
	return (container, model, draw) => {
		const key = JSON.stringify(model);
		if (shown.get(container) === key) return;
		shown.set(container, key);
		container.replaceChildren(...draw());
	};
}

/** One-slot memo, the hand-rolled equivalent of Elm's Html.lazy. */
function memo<A extends readonly unknown[], R>(
	fn: (...args: A) => R,
): (...args: A) => R {
	let last: { args: A; result: R } | undefined;
	return (...args) => {
		if (
			last &&
			last.args.length === args.length &&
			last.args.every((a, i) => a === args[i])
		)
			return last.result;
		last = { args, result: fn(...args) };
		return last.result;
	};
}
