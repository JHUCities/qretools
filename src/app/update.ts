import {
	bankLocation,
	describeChange,
	describeSchemeChange,
} from "../core/bank.js";
import { compact } from "../core/compact.js";
import { evaluate } from "../core/evaluate.js";
import { locate } from "../core/findings.js";
import { MISSING_NAME, schemePath } from "../core/schemes.js";
import type { NamedScheme } from "../core/surface/env.js";
import { parseSurface, rangesOf } from "../core/surface/parse.js";
import { NAME_PATTERN } from "../core/surface/schema.js";
import { mergeBank } from "./merge.js";
import {
	type Cmd,
	type Entry,
	envOf,
	type Id,
	type Model,
	type Msg,
	SCHEME_TEMPLATES,
	type SchemeEntry,
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
			return [
				model,
				[
					{
						kind: "revealRange",
						range: locate(msg.target, rangesOf(q.source)),
					},
				],
			];
		}

		case "ddiSchemaLoaded":
			return [{ ...model, ddiSchema: msg.result }, []];

		case "listOpened":
			return [{ ...model, screen: { kind: "blank" } }, []];

		case "fileOpened":
			return model.files[msg.id]
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
			const [next, id] = add(model, { kind: "question", source: msg.text });
			return persist([{ ...next, screen: { kind: "editing", id } }, []]);
		}

		case "schemeCreateOpened": {
			if (msg.scheme !== "missing")
				return [
					{
						...model,
						browser: {
							...model.browser,
							creating: { kind: msg.scheme, name: "" },
						},
					},
					[],
				];
			// One list per bank: open it if it exists, else start it.
			const existing = Object.values(model.files).find(
				(e) => e.kind === "missing",
			);
			if (existing)
				return [{ ...model, screen: { kind: "editing", id: existing.id } }, []];
			const [next, id] = add(model, {
				kind: "missing",
				name: MISSING_NAME,
				source: SCHEME_TEMPLATES.missing,
			});
			return persist([{ ...next, screen: { kind: "editing", id } }, []]);
		}

		case "schemeNameChanged":
			return model.browser.creating === undefined
				? [model, []]
				: [
						{
							...model,
							browser: {
								...model.browser,
								creating: { ...model.browser.creating, name: msg.name },
							},
						},
						[],
					];

		case "schemeCreateCancelled":
			return [{ ...model, browser: withoutCreating(model.browser) }, []];

		case "schemeCreateConfirmed": {
			const creating = model.browser.creating;
			if (
				creating === undefined ||
				schemeNameProblem(model, creating.kind, creating.name) !== undefined
			)
				return [model, []];
			const [next, id] = add(
				{ ...model, browser: withoutCreating(model.browser) },
				{
					kind: creating.kind,
					name: creating.name,
					source: SCHEME_TEMPLATES[creating.kind],
				},
			);
			return persist([{ ...next, screen: { kind: "editing", id } }, []]);
		}

		case "filesUploaded": {
			let next = model;
			for (const f of msg.files)
				[next] = add(next, { kind: "question", source: f.text });
			return persist([next, []]);
		}

		case "deleteRequested": {
			const q = model.files[msg.id];
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
			return [
				patch(cleared, msg.id, { activity: { kind: "deleting" } })[0],
				[
					{
						kind: "deleteFile",
						id: msg.id,
						settings: model.settings,
						path: q.origin.path,
						sha: q.origin.sha,
						message:
							q.kind === "question"
								? describeChange(
										parseSurface(q.origin.original, envOf(model.files)).draft,
										undefined,
									)
								: describeSchemeChange(q.kind, q.name, "delete"),
					},
				],
			];
		}

		case "deleteCancelled":
			return [{ ...model, browser: withoutConfirm(model.browser) }, []];

		case "saveRequested": {
			const q = model.files[msg.id];
			if (!q || !canWrite(model)) return [model, []];
			// A bank file goes back to the path it was opened at. A draft's path is chosen
			// once, deliberately: it decides the topic folder, and git would create an
			// unseen folder without a word. A scheme file's path follows from its kind
			// and the name it was given at creation.
			if (q.origin.kind === "bank")
				return write(model, msg.id, q, q.origin.path);
			if (q.kind !== "question") {
				const path = schemePath(q.kind, q.name);
				return taken(model, path)
					? [
							refuse(
								model,
								msg.id,
								`\`${path}\` already exists in the bank.`,
								"Open the bank's copy to change it.",
							),
							[],
						]
					: write(model, msg.id, q, path);
			}
			const where = bankLocation(
				parseSurface(q.source, envOf(model.files)).draft,
			);
			if (!where.ok)
				return [
					refuse(model, msg.id, where.error.message, where.error.hint),
					[],
				];
			return [
				{
					...model,
					browser: {
						...model.browser,
						saving: { id: msg.id, folder: where.value.folder },
					},
				},
				[],
			];
		}

		case "saveFolderChanged":
			return model.browser.saving === undefined
				? [model, []]
				: [
						{
							...model,
							browser: {
								...model.browser,
								saving: { ...model.browser.saving, folder: msg.folder },
							},
						},
						[],
					];

		case "saveCancelled":
			return [{ ...model, browser: withoutSaving(model.browser) }, []];

		case "saveConfirmed": {
			const saving = model.browser.saving;
			const q = saving === undefined ? undefined : model.files[saving.id];
			if (saving === undefined || q?.kind !== "question" || !canWrite(model))
				return [model, []];
			const closed = { ...model, browser: withoutSaving(model.browser) };
			const where = bankLocation(
				parseSurface(q.source, envOf(model.files)).draft,
				saving.folder,
			);
			if (!where.ok)
				return [
					refuse(closed, saving.id, where.error.message, where.error.hint),
					[],
				];
			// A new draft must not silently overwrite a bank file at that path.
			if (taken(model, where.value.path)) {
				return [
					refuse(
						closed,
						saving.id,
						`A question already exists at \`${where.value.path}\`.`,
						"Open the bank's copy to change it, or choose another name or topic.",
					),
					[],
				];
			}
			return write(closed, saving.id, q, where.value.path);
		}

		case "saveFinished": {
			const q = model.files[msg.id];
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
			const q = model.files[msg.id];
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
			const q = model.files[msg.id];
			if (!q) return [model, []];
			if (q.kind !== "question")
				return [
					model,
					msg.format === "yaml"
						? [
								{
									kind: "download",
									filename: `${q.name}.yaml`,
									text: q.source,
									mime: "application/yaml",
								},
							]
						: [],
				];
			const ev = evaluate(q.source, model.agency, envOf(model.files));
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
			const merged = mergeBank(model.files, msg.result.value, model.nextId);
			return persist([{ ...model, ...merged, bank: { kind: "loaded" } }, []]);
		}

		case "disconnected":
			return [
				{
					...model,
					session: { kind: "anonymous" },
					bank: { kind: "bundled" },
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

/** Emit the write for a file whose path is settled. */
function write(model: Model, id: Id, q: Entry, path: string): Step {
	return [
		patch(model, id, { activity: { kind: "saving" } })[0],
		[
			{
				kind: "writeFile",
				id,
				settings: model.settings,
				path,
				text: q.source,
				...(q.origin.kind === "bank" && { sha: q.origin.sha }),
				message: messageOf(model, q),
			},
		],
	];
}

/** The app declined before any request: say so on the question. */
const refuse = (model: Model, id: Id, message: string, hint?: string): Model =>
	patch(model, id, {
		activity: failed(compact({ kind: "refused", message, hint })),
	})[0];

/** The commit message for saving a file: what changed in a question, or which scheme file. */
function messageOf(model: Model, q: Entry): string {
	if (q.kind !== "question")
		return describeSchemeChange(
			q.kind,
			q.name,
			q.origin.kind === "bank" ? "update" : "add",
		);
	const env = envOf(model.files);
	return describeChange(
		q.origin.kind === "bank"
			? parseSurface(q.origin.original, env).draft
			: undefined,
		parseSurface(q.source, env).draft,
	);
}

/** Whether a bank file already lives at a path. */
const taken = (model: Model, path: string): boolean =>
	Object.values(model.files).some(
		(o) => o.origin.kind === "bank" && o.origin.path === path,
	);

/**
 * Why a name cannot be given to a new scheme file, or undefined when it can. The
 * dialog shows it as the user types; `update` refuses on it.
 */
export function schemeNameProblem(
	model: Model,
	kind: NamedScheme,
	name: string,
): string | undefined {
	if (name === "") return "Give it a name.";
	if (!NAME_PATTERN.test(name))
		return "A name is lower case letters, digits and `_`, starting with a letter.";
	return Object.values(model.files).some(
		(e) => e.kind === kind && e.name === name,
	)
		? `A ${kind} named \`${name}\` already exists.`
		: undefined;
}

const withoutSaving = (browser: Model["browser"]): Model["browser"] =>
	compact({ ...browser, saving: undefined });

const withoutConfirm = (browser: Model["browser"]): Model["browser"] =>
	compact({ ...browser, confirmDelete: undefined });

const withoutCreating = (browser: Model["browser"]): Model["browser"] =>
	compact({ ...browser, creating: undefined });

const current = (model: Model): Entry | undefined =>
	model.screen.kind === "editing" ? model.files[model.screen.id] : undefined;

const canWrite = (model: Model): boolean =>
	model.session.kind === "connected" && model.session.canWrite;

const failed = (failure: Failure) => ({ kind: "failed" as const, failure });

type FileChanges = Partial<Pick<Entry, "source" | "origin" | "activity">>;

function patch(model: Model, id: Id, changes: FileChanges): Step {
	const q = model.files[id];
	return q
		? [{ ...model, files: { ...model.files, [id]: { ...q, ...changes } } }, []]
		: [model, []];
}

function without(model: Model, id: Id): Model {
	const { [id]: _, ...rest } = model.files;
	return {
		...model,
		files: rest,
		screen:
			model.screen.kind === "editing" && model.screen.id === id
				? { kind: "blank" }
				: model.screen,
	};
}

type NewFile =
	| { readonly kind: "question"; readonly source: string }
	| Pick<SchemeEntry, "kind" | "name" | "source">;

function add(model: Model, file: NewFile): [Model, Id] {
	const id = model.nextId;
	const entry: Entry = {
		...file,
		id,
		origin: { kind: "draft" },
		activity: { kind: "idle" },
	};
	return [
		{ ...model, files: { ...model.files, [id]: entry }, nextId: id + 1 },
		id,
	];
}

/** Every change to what should survive a reload ends with a persist command. */
const persist = ([model, cmds]: Step): Step => [
	model,
	[...cmds, { kind: "persist", data: toPersisted(model) }],
];
