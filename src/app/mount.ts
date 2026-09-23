/**
 * The one place the shell holds hidden state: the stable DOM skeleton, the editor,
 * the token and the store built from it, the compiled DDI validator, and small
 * caches. Built once; `view(model)` redraws from the Model, and `exec` runs the
 * commands `update` describes and reports their results as messages.
 */
import type { Validator } from "../core/ddi/validate.js";
import { makeValidator } from "../core/ddi/validate.js";
import { type Evaluation, evaluate } from "../core/evaluate.js";
import { type Finding, status } from "../core/findings.js";
import { err } from "../core/result.js";
import { questionJsonSchema } from "../core/surface/schema.js";
import { toDiagnostics } from "./diagnostics.js";
import { createEditor } from "./editor.js";
import { h } from "./h.js";
import { isUnsaved } from "./merge.js";
import {
	type Cmd,
	DEFAULT_SETTINGS,
	type Dispatch,
	EXAMPLES,
	type Id,
	type Model,
} from "./model.js";
import {
	ddiBadge,
	type Row,
	statusBadge,
	viewBankStatus,
	viewCodebook,
	viewDdi,
	viewFindings,
	viewList,
	viewQuestionHeader,
	viewRespondent,
} from "./panes.js";
import { STORAGE_KEY } from "./persist.js";
import type { Mounted } from "./runtime.js";
import type { BankSettings, MakeStore, Store, TokenStore } from "./storage.js";

export interface Deps {
	readonly makeStore: MakeStore;
	readonly tokenStore: TokenStore;
}

export function mount(
	root: HTMLElement,
	dispatch: Dispatch,
	deps: Deps,
): Mounted<Model, Cmd> {
	// ---- skeleton -------------------------------------------------------------
	const bankForm = bankPanel();
	const listHost = h("section", { class: "list-screen" });
	const editorHost = h("div", { class: "editor" });
	const qhead = h("div", { class: "qhead-host" });
	const respondent = h("div", { class: "pane-body" });
	const codebook = h("div", { class: "pane-body" });
	const findings = h("div", { class: "pane-body" });
	const ddi = h("div", { class: "pane-body" });
	const findingsTitle = h("h2", {}, "Findings");
	const ddiTitle = h("h2", {}, "DDI-Lifecycle 4.0");
	const bankStatus = h("div", { class: "pane-body" });
	const sessionSummary = h("span", { class: "sub" });
	const pane = (title: HTMLElement, body: HTMLElement) =>
		h("article", { class: "pane" }, title, body);
	const editing = h(
		"section",
		{ class: "editing-screen" },
		qhead,
		h(
			"div",
			{ class: "split" },
			h(
				"section",
				{ class: "left", "aria-label": "Question source" },
				editorHost,
			),
			h(
				"section",
				{ class: "right" },
				pane(findingsTitle, findings),
				pane(h("h2", {}, "As the respondent sees it"), respondent),
				pane(h("h2", {}, "Codebook entry"), codebook),
				h("details", { class: "pane" }, h("summary", {}, ddiTitle), ddi),
			),
		),
	);

	root.replaceChildren(
		h(
			"header",
			{ class: "bar" },
			h("h1", {}, "qretools"),
			h("span", { class: "sub" }, "question bank"),
			sessionSummary,
			h(
				"nav",
				{ class: "examples", "aria-label": "Actions" },
				h(
					"button",
					{ type: "button", onClick: () => dispatch({ kind: "listOpened" }) },
					"Questions",
				),
				h(
					"button",
					{
						type: "button",
						onClick: () => bankForm.details.toggleAttribute("open"),
					},
					"Bank…",
				),
			),
		),
		h(
			"details",
			{ class: "pane bank" },
			h("summary", {}, h("h2", {}, "Bank")),
			bankForm.details,
			bankStatus,
		),
		listHost,
		editing,
	);

	// ---- hidden state -----------------------------------------------------------
	const editor = createEditor(editorHost, (text) =>
		dispatch({ kind: "edited", text }),
	);
	let validator: Validator | undefined;
	let token: string | null = deps.tokenStore.load();
	let store: Store | undefined;
	let settingsInUse: BankSettings | undefined;
	const storeFor = (settings: BankSettings): Store | undefined => {
		if (token === null) return undefined;
		if (!store || JSON.stringify(settings) !== JSON.stringify(settingsInUse)) {
			store = deps.makeStore(settings, token);
			settingsInUse = settings;
		}
		return store;
	};
	const evaluations = evaluationCache();
	const schemaFor = memo(questionJsonSchema);
	const redraw = changeDetector();
	const persist = debouncedPersist();

	const on = {
		target: (
			target: Parameters<typeof viewFindings>[1] extends (t: infer T) => void
				? T
				: never,
		) => dispatch({ kind: "locationClicked", target }),
	};

	bankForm.connect.addEventListener("click", () => {
		const typed = bankForm.token.value.trim();
		if (typed !== "") {
			token = typed;
			bankForm.token.value = "";
		}
		const settings: BankSettings = {
			owner: bankForm.owner.value.trim() || DEFAULT_SETTINGS.owner,
			repo: bankForm.repo.value.trim() || DEFAULT_SETTINGS.repo,
			branch: bankForm.branch.value.trim() || DEFAULT_SETTINGS.branch,
			remember: bankForm.remember.checked,
		};
		if (token !== null) deps.tokenStore.save(token, settings.remember);
		dispatch({ kind: "connectRequested", settings });
	});
	bankForm.upload.addEventListener("change", () => {
		const files = [...(bankForm.upload.files ?? [])];
		bankForm.upload.value = "";
		Promise.all(
			files.map(async (f) => ({
				name: f.name,
				text: (await f.text()).replace(/\r\n?/g, "\n"),
			})),
		).then((read) => dispatch({ kind: "filesUploaded", files: read }));
	});
	for (const e of EXAMPLES) {
		bankForm.newButtons.append(
			h(
				"button",
				{
					type: "button",
					onClick: () => dispatch({ kind: "questionCreated", text: e.text }),
				},
				`New from ${e.label}`,
			),
		);
	}
	bankForm.newButtons.prepend(
		h(
			"button",
			{
				type: "button",
				class: "primary",
				onClick: () => dispatch({ kind: "questionCreated", text: "" }),
			},
			"New question",
		),
	);

	return {
		view(model) {
			bankForm.fill(model.settings);
			sessionSummary.textContent =
				model.session.kind === "connected"
					? `${model.session.login} · ${model.settings.owner}/${model.settings.repo}@${model.settings.branch}${model.session.canWrite ? "" : " (read only)"}`
					: "";
			bankStatus.replaceChildren(
				viewBankStatus(model.session, model.bank, model.failures, {
					dismiss: (index) => dispatch({ kind: "failureDismissed", index }),
					disconnect: () => dispatch({ kind: "disconnected" }),
				}),
			);
			const canWrite =
				model.session.kind === "connected" && model.session.canWrite;

			if (model.screen.kind === "list") {
				editing.hidden = true;
				listHost.hidden = false;
				const rows: Row[] = Object.values(model.questions).map((q) => {
					const ev = evaluations.get(
						q.id,
						q.source,
						model.agency,
						model.scales,
					);
					return {
						id: q.id,
						name: ev.draft.name,
						title: ev.draft.title ?? ev.draft.concept,
						folder:
							q.origin.kind === "bank"
								? q.origin.path.split("/")[1]
								: ev.draft.name?.split("_")[0],
						status: status(ev.findings),
						unsaved: isUnsaved(q),
						origin: q.origin.kind,
						activity: q.activity,
					};
				});
				rows.sort((a, b) => (a.name ?? "~").localeCompare(b.name ?? "~"));
				listHost.replaceChildren(
					bankForm.newButtons,
					viewList(rows, model.screen, canWrite, {
						open: (id) => dispatch({ kind: "questionOpened", id }),
						remove: (id) => dispatch({ kind: "deleteRequested", id }),
						cancelRemove: () => dispatch({ kind: "deleteCancelled" }),
						filter: (text, folder) =>
							dispatch({
								kind: "filterChanged",
								text,
								...(folder !== undefined && { folder }),
							}),
					}),
				);
				return;
			}

			const q = model.questions[model.screen.id];
			if (!q) return;
			listHost.hidden = true;
			editing.hidden = false;
			const id = q.id;
			const ev = evaluations.get(id, q.source, model.agency, model.scales);
			const problems: readonly Finding[] =
				model.ddiSchema.kind === "failed"
					? [model.ddiSchema.finding]
					: (validator?.(ev.ddi) ?? []);

			editor.sync({
				id,
				text: q.source,
				diagnostics: toDiagnostics(ev.findings, ev.ranges),
				schema: schemaFor(model.scales),
			});
			qhead.replaceChildren(
				viewQuestionHeader(
					{
						name: ev.draft.name,
						origin: q.origin,
						activity: q.activity,
						unsaved: isUnsaved(q),
					},
					model.session,
					{
						back: () => dispatch({ kind: "listOpened" }),
						save: () => dispatch({ kind: "saveRequested", id }),
						reload: () => dispatch({ kind: "reloadRequested", id }),
						downloadYaml: () =>
							dispatch({ kind: "downloadRequested", id, format: "yaml" }),
						downloadDdi: () =>
							dispatch({ kind: "downloadRequested", id, format: "ddi" }),
					},
				),
			);
			// Preview inputs hold DOM state (a ticked radio). Redraw a pane only when what
			// it shows has changed, so editing `intent` does not wipe the respondent's tick.
			redraw(respondent, [id, ev.respondent], () => [
				viewRespondent(ev.respondent, on.target),
			]);
			redraw(codebook, [id, ev.codebook], () => [
				viewCodebook(ev.codebook, on.target),
			]);
			findingsTitle.replaceChildren(
				"Findings",
				statusBadge(status(ev.findings)),
			);
			findings.replaceChildren(viewFindings(ev.findings, on.target));
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
				case "persist":
					persist(JSON.stringify(cmd.data));
					return;
				case "connect": {
					const s = storeFor(cmd.settings);
					if (!s) {
						dispatch({
							kind: "connected",
							result: err({
								kind: "auth",
								message:
									"No token. Paste a fine-grained personal access token and connect.",
							}),
						});
						return;
					}
					s.whoAmI().then((result) => dispatch({ kind: "connected", result }));
					return;
				}
				case "loadBank": {
					const s = storeFor(cmd.settings);
					if (!s) return;
					s.loadBank().then((result) =>
						dispatch({ kind: "bankLoaded", result }),
					);
					return;
				}
				case "readFile": {
					const s = storeFor(cmd.settings);
					if (!s) return;
					s.read(cmd.path).then((result) =>
						dispatch({ kind: "fileReloaded", id: cmd.id, result }),
					);
					return;
				}
				case "writeFile": {
					const s = storeFor(cmd.settings);
					if (!s) return;
					s.write(cmd.path, cmd.text, cmd.message, cmd.sha).then((result) =>
						dispatch({
							kind: "saveFinished",
							id: cmd.id,
							text: cmd.text,
							result,
						}),
					);
					return;
				}
				case "deleteFile": {
					const s = storeFor(cmd.settings);
					if (!s) return;
					s.remove(cmd.path, cmd.sha, cmd.message).then((result) =>
						dispatch({ kind: "deleteFinished", id: cmd.id, result }),
					);
					return;
				}
				case "download": {
					const url = URL.createObjectURL(
						new Blob([cmd.text], { type: cmd.mime }),
					);
					const a = h("a", { href: url, download: cmd.filename });
					a.click();
					setTimeout(() => URL.revokeObjectURL(url), 1000);
					return;
				}
				case "forgetToken":
					deps.tokenStore.clear();
					token = null;
					store = undefined;
					return;
				default:
					return cmd satisfies never;
			}
		},
	};
}

// ---- pieces ---------------------------------------------------------------------

/** The bank form is static: built once, its handlers read its inputs. */
function bankPanel() {
	const owner = h("input", {
		type: "text",
		"aria-label": "Owner",
		placeholder: DEFAULT_SETTINGS.owner,
	}) as HTMLInputElement;
	const repo = h("input", {
		type: "text",
		"aria-label": "Repository",
		placeholder: DEFAULT_SETTINGS.repo,
	}) as HTMLInputElement;
	const branch = h("input", {
		type: "text",
		"aria-label": "Branch",
		placeholder: DEFAULT_SETTINGS.branch,
	}) as HTMLInputElement;
	const token = h("input", {
		type: "password",
		"aria-label": "Token",
		placeholder: "fine-grained personal access token",
		autocomplete: "off",
	}) as HTMLInputElement;
	const remember = h("input", { type: "checkbox" }) as HTMLInputElement;
	const connect = h("button", { type: "button", class: "primary" }, "Connect");
	const upload = h("input", {
		type: "file",
		accept: ".yaml,.yml",
		multiple: true,
		"aria-label": "Upload YAML files",
	}) as HTMLInputElement;
	const newButtons = h("div", { class: "new-buttons" });
	const details = h(
		"div",
		{ class: "bank-form" },
		h("label", {}, "Owner ", owner),
		h("label", {}, "Repository ", repo),
		h("label", {}, "Branch ", branch),
		h("label", {}, "Token ", token),
		h("label", { class: "check" }, remember, " Remember on this device"),
		connect,
		h(
			"p",
			{ class: "quiet" },
			"Create a fine-grained token on GitHub limited to the bank repository with Contents and Pull requests read and write. It stays in this browser and is never sent anywhere but GitHub.",
		),
		h("label", { class: "upload" }, "Upload YAML ", upload),
	);
	let filled: BankSettings | undefined;
	return {
		details,
		owner,
		repo,
		branch,
		token,
		remember,
		connect,
		upload,
		newButtons,
		/** Show the Model's settings, without clobbering what the user is typing. */
		fill(settings: BankSettings) {
			if (JSON.stringify(settings) === JSON.stringify(filled)) return;
			filled = settings;
			owner.value = settings.owner;
			repo.value = settings.repo;
			branch.value = settings.branch;
			remember.checked = settings.remember;
		},
	};
}

/** One evaluation per question, recomputed only when its text or the scales change. */
function evaluationCache() {
	const cache = new Map<
		Id,
		{ source: string; scales: unknown; ev: Evaluation }
	>();
	return {
		get(
			id: Id,
			source: string,
			agency: string,
			scales: Model["scales"],
		): Evaluation {
			const hit = cache.get(id);
			if (hit && hit.source === source && hit.scales === scales) return hit.ev;
			const ev = evaluate(source, agency, scales);
			cache.set(id, { source, scales, ev });
			return ev;
		},
	};
}

/** Persist at most every 300 ms, and flush when the page is hidden. */
function debouncedPersist(): (json: string) => void {
	let pending: string | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const flush = () => {
		if (pending === undefined) return;
		try {
			localStorage.setItem(STORAGE_KEY, pending);
		} catch {
			// Storage unavailable (private window, quota): the Model is still correct; drafts are just not kept.
		}
		pending = undefined;
	};
	window.addEventListener("pagehide", flush);
	return (json) => {
		pending = json;
		if (timer !== undefined) clearTimeout(timer);
		timer = setTimeout(flush, 300);
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
