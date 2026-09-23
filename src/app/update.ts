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
import {
	type Activity,
	type Blob,
	type Cmd,
	type Entry,
	envOf,
	fileOf,
	type Id,
	type Model,
	type Msg,
	type Path,
	type Remote,
	SCHEME_TEMPLATES,
	type SchemeEntry,
	toPersisted,
} from "./model.js";
import type { Failure } from "./storage.js";
import { rebase, remoteOf, sliceOf } from "./sync.js";

type Step = readonly [Model, readonly Cmd[]];

/** Pure. Every state change in the app is one case here. */
export function update(model: Model, msg: Msg): Step {
	switch (msg.kind) {
		case "edited":
			return model.screen.kind === "editing"
				? persist([withSource(model, model.screen.id, msg.text), []])
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
			return fileOf(model, msg.id)
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
			const existing = Object.values(model.local.schemes).find(
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
			const q = fileOf(model, msg.id);
			if (!q) return [model, []];
			if (model.browser.confirmDelete !== msg.id)
				return [
					{ ...model, browser: { ...model.browser, confirmDelete: msg.id } },
					[],
				];
			const cleared = { ...model, browser: withoutConfirm(model.browser) };
			if (q.base === undefined) return persist([without(cleared, msg.id), []]);
			if (!canWrite(model)) return [cleared, []];
			return [
				withActivity(cleared, msg.id, { kind: "deleting" }),
				[
					{
						kind: "deleteFile",
						id: msg.id,
						settings: model.settings,
						path: q.base.path,
						sha: q.base.sha,
						message:
							q.kind === "question"
								? describeChange(
										parseSurface(q.base.text, envOf(model.local.schemes)).draft,
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
			const q = fileOf(model, msg.id);
			if (!q || !canWrite(model)) return [model, []];
			// A bank file goes back to the path it was opened at. A draft's path is chosen
			// once, deliberately: it decides the topic folder, and git would create an
			// unseen folder without a word. A scheme file's path follows from its kind
			// and the name it was given at creation.
			if (q.base !== undefined) return write(model, msg.id, q, q.base.path);
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
				parseSurface(q.source, envOf(model.local.schemes)).draft,
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
			const q =
				saving === undefined ? undefined : model.local.questions[saving.id];
			if (saving === undefined || q === undefined || !canWrite(model))
				return [model, []];
			const closed = { ...model, browser: withoutSaving(model.browser) };
			const where = bankLocation(
				parseSurface(q.source, envOf(model.local.schemes)).draft,
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
			const q = fileOf(model, msg.id);
			if (!msg.result.ok)
				return [withActivity(model, msg.id, failed(msg.result.error)), []];
			const blob = { sha: msg.result.value.sha, text: msg.text };
			// The base becomes what was written, not what is in the editor now: typing
			// during the save correctly shows as unsaved.
			const saved = q
				? withFile(model, { ...q, base: { path: msg.path, ...blob } })
				: model;
			return persist([
				withActivity(withGitHub(saved, msg.path, blob), msg.id, undefined),
				[],
			]);
		}

		case "deleteFinished": {
			if (!msg.result.ok)
				return [withActivity(model, msg.id, failed(msg.result.error)), []];
			const path = fileOf(model, msg.id)?.base?.path;
			const gone = without(model, msg.id);
			return persist([
				path === undefined ? gone : withGitHub(gone, path, undefined),
				[],
			]);
		}

		case "reloadRequested": {
			const q = fileOf(model, msg.id);
			if (q?.base === undefined) return [model, []];
			return [
				model,
				[
					{
						kind: "readFile",
						id: msg.id,
						settings: model.settings,
						path: q.base.path,
					},
				],
			];
		}

		case "fileReloaded": {
			const q = fileOf(model, msg.id);
			if (!msg.result.ok)
				return [withActivity(model, msg.id, failed(msg.result.error)), []];
			const { path, sha, text } = msg.result.value;
			const reloaded = q
				? withFile(model, { ...q, source: text, base: { path, sha, text } })
				: model;
			return persist([
				withActivity(
					withGitHub(reloaded, path, { sha, text }),
					msg.id,
					undefined,
				),
				[],
			]);
		}

		case "downloadRequested": {
			const q = fileOf(model, msg.id);
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
			const ev = evaluate(q.source, model.agency, envOf(model.local.schemes));
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
					loading: { kind: "loading" },
				},
				[{ kind: "loadBank", settings: model.settings }],
			];

		case "bankLoaded": {
			if (!msg.result.ok)
				return [
					{
						...model,
						loading: { kind: "bundled" },
						failures: [...model.failures, msg.result.error],
					},
					[],
				];
			// No branches yet (step 9d): the author's branch is the bank, one object.
			const remote = remoteOf(model.remote, msg.result.value);
			const { local, nextId } = rebase(model.local, remote, model.nextId);
			return persist([
				{
					...model,
					local,
					remote,
					bank: remote,
					nextId,
					loading: { kind: "loaded" },
				},
				[],
			]);
		}

		case "disconnected":
			return [
				{
					...model,
					session: { kind: "anonymous" },
					loading: { kind: "bundled" },
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
		withActivity(model, id, { kind: "saving" }),
		[
			{
				kind: "writeFile",
				id,
				settings: model.settings,
				path,
				text: q.source,
				...(q.base !== undefined && { sha: q.base.sha }),
				message: messageOf(model, q),
			},
		],
	];
}

/** The app declined before any request: say so on the file. */
const refuse = (model: Model, id: Id, message: string, hint?: string): Model =>
	withActivity(model, id, failed(compact({ kind: "refused", message, hint })));

/** The commit message for saving a file: what changed in a question, or which scheme file. */
function messageOf(model: Model, q: Entry): string {
	if (q.kind !== "question")
		return describeSchemeChange(
			q.kind,
			q.name,
			q.base === undefined ? "add" : "update",
		);
	const env = envOf(model.local.schemes);
	return describeChange(
		q.base === undefined ? undefined : parseSurface(q.base.text, env).draft,
		parseSurface(q.source, env).draft,
	);
}

/** Whether GitHub already has a file at a path. */
const taken = (model: Model, path: Path): boolean =>
	path in model.remote.questions || path in model.remote.schemes;

/**
 * Why a name cannot be given to a new scheme file, or undefined when it can. The
 * dialog shows it as the author types; `update` refuses on it.
 */
export function schemeNameProblem(
	model: Model,
	kind: NamedScheme,
	name: string,
): string | undefined {
	if (name === "") return "Give it a name.";
	if (!NAME_PATTERN.test(name))
		return "A name is lower case letters, digits and `_`, starting with a letter.";
	return Object.values(model.local.schemes).some(
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
	model.screen.kind === "editing" ? fileOf(model, model.screen.id) : undefined;

const canWrite = (model: Model): boolean =>
	model.session.kind === "connected" && model.session.canWrite;

const failed = (failure: Failure) => ({ kind: "failed" as const, failure });

/**
 * Replace one working file. Only its own slice is rebuilt: a question never touches
 * `local.schemes`, so the local environment keeps its identity while questions are
 * edited. This and `add`/`without` are the only writers of `local`.
 */
function withFile(model: Model, f: Entry): Model {
	return f.kind === "question"
		? {
				...model,
				local: {
					...model.local,
					questions: { ...model.local.questions, [f.id]: f },
				},
			}
		: {
				...model,
				local: {
					...model.local,
					schemes: { ...model.local.schemes, [f.id]: f },
				},
			};
}

function withSource(model: Model, id: Id, source: string): Model {
	const f = fileOf(model, id);
	return f === undefined || f.source === source
		? model
		: withFile(model, { ...f, source });
}

/** Activity lives beside the content, so marking a scale "saving" leaves the environment alone. */
function withActivity(
	model: Model,
	id: Id,
	activity: Activity | undefined,
): Model {
	const { [id]: _, ...rest } = model.activity;
	return {
		...model,
		activity: activity === undefined ? rest : { ...rest, [id]: activity },
	};
}

/**
 * Record what a write, delete or reload told us about GitHub. While the author has no
 * branch of their own (until step 9d), their branch is the bank, and both move together.
 */
function withGitHub(model: Model, path: Path, blob: Blob | undefined): Model {
	const remote = withBlob(model.remote, path, blob);
	return {
		...model,
		remote,
		bank: model.bank === model.remote ? remote : model.bank,
	};
}

/** GitHub's copy at one path, set or removed, in the slice the path belongs to. */
function withBlob(remote: Remote, path: Path, blob: Blob | undefined): Remote {
	const slice = sliceOf(path);
	if (slice === undefined) return remote;
	const { [path]: _, ...rest } = remote[slice];
	return {
		...remote,
		[slice]: blob === undefined ? rest : { ...rest, [path]: blob },
	};
}

function without(model: Model, id: Id): Model {
	const { [id]: _q, ...questions } = model.local.questions;
	const { [id]: _s, ...schemes } = model.local.schemes;
	const { [id]: _a, ...activity } = model.activity;
	return {
		...model,
		local: {
			questions:
				id in model.local.questions ? questions : model.local.questions,
			schemes: id in model.local.schemes ? schemes : model.local.schemes,
		},
		activity,
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
	return [{ ...withFile(model, { ...file, id }), nextId: id + 1 }, id];
}

/** Every change to what should survive a reload ends with a persist command. */
const persist = ([model, cmds]: Step): Step => [
	model,
	[...cmds, { kind: "persist", data: toPersisted(model) }],
];
