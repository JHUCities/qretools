import { bankPath, describeChange } from "../core/bank.js";
import { compact } from "../core/compact.js";
import { evaluate } from "../core/evaluate.js";
import { locate } from "../core/findings.js";
import { parseSurface } from "../core/surface/parse.js";
import { parseScales } from "../core/surface/scales.js";
import { mergeBank } from "./merge.js";
import {
	type Cmd,
	EXAMPLE_SCALES,
	type Id,
	type Model,
	type Msg,
	type Question,
	toPersisted,
} from "./model.js";
import type { Failure } from "./storage.js";

type Step = readonly [Model, readonly Cmd[]];

/** Pure. Every state change in the app is one case here. */
export function update(model: Model, msg: Msg): Step {
	switch (msg.kind) {
		case "edited":
			return model.screen.kind === "editing"
				? persist(patch(model, model.screen.id, { source: msg.text }))
				: [model, []];

		case "locationClicked": {
			// A click names a place in the document's terms. It becomes a range here,
			// against the text as it is now.
			const q = current(model);
			if (!q) return [model, []];
			const { ranges } = evaluate(q.source, model.agency, model.scales);
			return [
				model,
				[{ kind: "revealRange", range: locate(msg.target, ranges) }],
			];
		}

		case "ddiSchemaLoaded":
			return [{ ...model, ddiSchema: msg.result }, []];

		case "listOpened":
			return [{ ...model, screen: { kind: "blank" } }, []];

		case "questionOpened":
			return model.questions[msg.id]
				? [{ ...model, screen: { kind: "editing", id: msg.id } }, []]
				: [model, []];

		case "filterChanged":
			return [
				{ ...model, browser: { ...model.browser, filter: msg.text } },
				[],
			];

		case "folderToggled": {
			const open = model.browser.expanded.includes(msg.folder);
			const expanded = open
				? model.browser.expanded.filter((f) => f !== msg.folder)
				: [...model.browser.expanded, msg.folder];
			return [{ ...model, browser: { ...model.browser, expanded } }, []];
		}

		case "settingsToggled":
			return [
				{ ...model, browser: { ...model.browser, settingsOpen: msg.open } },
				[],
			];

		case "questionCreated": {
			const [next, id] = add(model, msg.text);
			return persist([{ ...next, screen: { kind: "editing", id } }, []]);
		}

		case "filesUploaded": {
			let next = model;
			for (const f of msg.files) [next] = add(next, f.text);
			return persist([next, []]);
		}

		case "deleteRequested": {
			const q = model.questions[msg.id];
			if (!q) return [model, []];
			if (model.browser.confirmDelete !== msg.id)
				return [
					{ ...model, browser: { ...model.browser, confirmDelete: msg.id } },
					[],
				];
			const cleared = { ...model, browser: withoutConfirm(model.browser) };
			if (q.origin.kind === "draft")
				return persist([without(cleared, msg.id), []]);
			if (!canWrite(model)) return [cleared, []];
			const before = parseSurface(q.origin.original, model.scales).draft;
			return [
				patch(cleared, msg.id, { activity: { kind: "deleting" } })[0],
				[
					{
						kind: "deleteFile",
						id: msg.id,
						settings: model.settings,
						path: q.origin.path,
						sha: q.origin.sha,
						message: describeChange(before, undefined),
					},
				],
			];
		}

		case "deleteCancelled":
			return [{ ...model, browser: withoutConfirm(model.browser) }, []];

		case "saveRequested": {
			const q = model.questions[msg.id];
			if (!q || !canWrite(model)) return [model, []];
			const after = parseSurface(q.source, model.scales).draft;
			const path =
				q.origin.kind === "bank"
					? { ok: true as const, value: q.origin.path }
					: bankPath(after);
			if (!path.ok) {
				return [
					patch(model, msg.id, {
						activity: failed({
							kind: "refused",
							message: path.error.message,
							...(path.error.hint && { hint: path.error.hint }),
						}),
					})[0],
					[],
				];
			}
			// A new draft must not silently overwrite a bank file of the same name.
			const taken =
				q.origin.kind === "draft" &&
				Object.values(model.questions).some(
					(o) => o.origin.kind === "bank" && o.origin.path === path.value,
				);
			if (taken) {
				return [
					patch(model, msg.id, {
						activity: failed({
							kind: "refused",
							message: `A question named \`${after.name}\` already exists in the bank.`,
							hint: "Open the bank's copy to change it, or give this draft another name.",
						}),
					})[0],
					[],
				];
			}
			const before =
				q.origin.kind === "bank"
					? parseSurface(q.origin.original, model.scales).draft
					: undefined;
			return [
				patch(model, msg.id, { activity: { kind: "saving" } })[0],
				[
					{
						kind: "writeFile",
						id: msg.id,
						settings: model.settings,
						path: path.value,
						text: q.source,
						...(q.origin.kind === "bank" && { sha: q.origin.sha }),
						message: describeChange(before, after),
					},
				],
			];
		}

		case "saveFinished": {
			const q = model.questions[msg.id];
			if (!q) return [model, []];
			if (!msg.result.ok)
				return [
					patch(model, msg.id, { activity: failed(msg.result.error) })[0],
					[],
				];
			return persist(
				patch(model, msg.id, {
					activity: { kind: "idle" },
					origin: {
						kind: "bank",
						path: msg.path,
						sha: msg.result.value.sha,
						original: msg.text,
					},
				}),
			);
		}

		case "deleteFinished":
			if (!msg.result.ok)
				return [
					patch(model, msg.id, { activity: failed(msg.result.error) })[0],
					[],
				];
			return persist([without(model, msg.id), []]);

		case "reloadRequested": {
			const q = model.questions[msg.id];
			if (q?.origin.kind !== "bank") return [model, []];
			return [
				model,
				[
					{
						kind: "readFile",
						id: msg.id,
						settings: model.settings,
						path: q.origin.path,
					},
				],
			];
		}

		case "fileReloaded": {
			if (!msg.result.ok)
				return [
					patch(model, msg.id, { activity: failed(msg.result.error) })[0],
					[],
				];
			const f = msg.result.value;
			return persist(
				patch(model, msg.id, {
					source: f.text,
					activity: { kind: "idle" },
					origin: { kind: "bank", path: f.path, sha: f.sha, original: f.text },
				}),
			);
		}

		case "downloadRequested": {
			const q = model.questions[msg.id];
			if (!q) return [model, []];
			const ev = evaluate(q.source, model.agency, model.scales);
			const stem = ev.draft.name ?? `question-${msg.id}`;
			return [
				model,
				[
					msg.format === "yaml"
						? {
								kind: "download",
								filename: `${stem}.yaml`,
								text: q.source,
								mime: "application/yaml",
							}
						: {
								kind: "download",
								filename: `${stem}.ddi.json`,
								text: JSON.stringify(ev.ddi, null, 2),
								mime: "application/json",
							},
				],
			];
		}

		case "connectRequested":
			return persist([
				{
					...model,
					settings: msg.settings,
					session: { kind: "connecting" },
					failures: [],
					browser: { ...model.browser, settingsOpen: false },
				},
				[{ kind: "connect", settings: msg.settings }],
			]);

		case "connected":
			if (!msg.result.ok)
				return [
					{ ...model, session: { kind: "failed", failure: msg.result.error } },
					[],
				];
			return [
				{
					...model,
					session: { kind: "connected", ...msg.result.value },
					bank: { kind: "loading" },
				},
				[{ kind: "loadBank", settings: model.settings }],
			];

		case "bankLoaded": {
			if (!msg.result.ok)
				return [
					{
						...model,
						bank: { kind: "bundled" },
						failures: [...model.failures, msg.result.error],
					},
					[],
				];
			const merged = mergeBank(
				model.questions,
				msg.result.value.questions,
				model.nextId,
			);
			const scales = parseScales(
				msg.result.value.scales.map((f) => ({
					name: f.path.replace(/^scales\//, "").replace(/\.yaml$/, ""),
					text: f.text,
				})),
			);
			return persist([
				{
					...model,
					...merged,
					scales: scales.scales,
					bank: { kind: "loaded", scaleFindings: scales.findings },
				},
				[],
			]);
		}

		case "disconnected":
			return [
				{
					...model,
					session: { kind: "anonymous" },
					bank: { kind: "bundled" },
					scales: EXAMPLE_SCALES,
				},
				[{ kind: "forgetToken" }],
			];

		case "failureDismissed":
			return [
				{
					...model,
					failures: model.failures.filter((_, i) => i !== msg.index),
				},
				[],
			];

		default:
			return msg satisfies never;
	}
}

const withoutConfirm = (browser: Model["browser"]): Model["browser"] =>
	compact({
		filter: browser.filter,
		expanded: browser.expanded,
		settingsOpen: browser.settingsOpen,
	});

const current = (model: Model): Question | undefined =>
	model.screen.kind === "editing"
		? model.questions[model.screen.id]
		: undefined;

const canWrite = (model: Model): boolean =>
	model.session.kind === "connected" && model.session.canWrite;

const failed = (failure: Failure) => ({ kind: "failed" as const, failure });

function patch(model: Model, id: Id, changes: Partial<Question>): Step {
	const q = model.questions[id];
	return q
		? [
				{
					...model,
					questions: { ...model.questions, [id]: { ...q, ...changes } },
				},
				[],
			]
		: [model, []];
}

function without(model: Model, id: Id): Model {
	const { [id]: _, ...rest } = model.questions;
	return {
		...model,
		questions: rest,
		screen:
			model.screen.kind === "editing" && model.screen.id === id
				? { kind: "blank" }
				: model.screen,
	};
}

function add(model: Model, text: string): [Model, Id] {
	const id = model.nextId;
	const q: Question = {
		id,
		source: text,
		origin: { kind: "draft" },
		activity: { kind: "idle" },
	};
	return [
		{ ...model, questions: { ...model.questions, [id]: q }, nextId: id + 1 },
		id,
	];
}

/** Every change to what should survive a reload ends with a persist command. */
const persist = ([model, cmds]: Step): Step => [
	model,
	[...cmds, { kind: "persist", data: toPersisted(model) }],
];
