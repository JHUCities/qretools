import {
	bankLocation,
	describeChange,
	describeChangeSet,
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
	allFiles,
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
import type { BranchTarget, Change, Failure } from "./storage.js";
import {
	claimOf,
	dependencies,
	rebase,
	remoteBlob,
	remoteOf,
	sliceOf,
	syncOf,
} from "./sync.js";

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

		case "cursorMoved":
			return model.screen.kind === "editing"
				? [
						{ ...model, cursor: { id: model.screen.id, offset: msg.offset } },
						[],
					]
				: [model, []];

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
							creating: { kind: msg.scheme, name: msg.name ?? "" },
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
			const as = writable(model);
			if (as === undefined) return [cleared, []];
			return [
				withActivity(cleared, msg.id, { kind: "deleting" }),
				[
					{
						kind: "commit",
						target: targetOf(model.settings, as),
						changes: [
							{
								id: msg.id,
								path: q.base.path,
								expected: q.base.sha,
								text: null,
							},
						],
						message:
							q.kind === "question"
								? describeChange(
										parseSurface(
											q.base.text,
											envOf(model.local.schemes, model.remote.schemes),
										).draft,
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
			const as = writable(model);
			if (!q || as === undefined) return [model, []];
			// A bank file goes back to the path it was opened at. A draft's path is chosen
			// once, deliberately: it decides the topic folder, and git would create an
			// unseen folder without a word. A scheme file's path follows from its kind
			// and the name it was given at creation.
			if (q.base !== undefined) return write(model, as, msg.id, q, q.base.path);
			if (q.kind !== "question") {
				const path = schemePath(q.kind, q.name);
				return taken(model, path, msg.id)
					? [
							refuse(
								model,
								msg.id,
								`\`${path}\` already exists in the bank.`,
								"Open the bank's copy to change it.",
							),
							[],
						]
					: write(model, as, msg.id, q, path);
			}
			const where = bankLocation(
				parseSurface(q.source, envOf(model.local.schemes, model.remote.schemes))
					.draft,
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
			const as = writable(model);
			if (saving === undefined || q === undefined || as === undefined)
				return [model, []];
			const closed = { ...model, browser: withoutSaving(model.browser) };
			const where = bankLocation(
				parseSurface(q.source, envOf(model.local.schemes, model.remote.schemes))
					.draft,
				saving.folder,
			);
			if (!where.ok)
				return [
					refuse(closed, saving.id, where.error.message, where.error.hint),
					[],
				];
			// A new draft must not silently overwrite a bank file at that path.
			if (taken(model, where.value.path, saving.id)) {
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
			return write(closed, as, saving.id, q, where.value.path);
		}

		case "committed": {
			const ids = msg.changes.map((c) => c.id);
			const primary = ids[0];
			const idle = ids.reduce<Model>(
				(m, id) => withActivity(m, id, undefined),
				model,
			);
			if (!msg.result.ok) {
				const { failure, seen } = msg.result.error;
				// Stale: take what GitHub has at each touched path, so the files show as
				// changed on GitHub, with "Reload from GitHub" to take their version.
				const absorbed =
					seen === undefined
						? idle
						: Object.entries(seen).reduce<Model>(
								(m, [path, blob]) => withGitHub(m, path, blob ?? undefined),
								idle,
							);
				const { local, nextId } = rebase(
					absorbed.local,
					absorbed.remote,
					absorbed.nextId,
				);
				const failedAt =
					primary === undefined
						? { ...absorbed, local, nextId }
						: withActivity(
								{ ...absorbed, local, nextId },
								primary,
								failed(failure),
							);
				return seen === undefined ? [failedAt, []] : persist([failedAt, []]);
			}
			const { shas } = msg.result.value;
			const done = msg.changes.reduce<Model>((m, c) => {
				if (c.text === null)
					return withGitHub(without(m, c.id), c.path, undefined);
				const sha = shas[c.path];
				if (sha === undefined) return m;
				const blob = { sha, text: c.text };
				const f = fileOf(m, c.id);
				// The base becomes what was committed, not what is in the editor now:
				// typing during the save correctly shows as unsaved.
				const based = f
					? withFile(m, { ...f, base: { path: c.path, ...blob } })
					: m;
				return withGitHub(based, c.path, blob);
			}, idle);
			return persist([committed(done), []]);
		}

		case "reloadRequested": {
			const q = fileOf(model, msg.id);
			if (q?.base === undefined || model.session.kind !== "connected")
				return [model, []];
			return [
				model,
				[
					{
						kind: "readFile",
						id: msg.id,
						target: readTarget(model, model.session),
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
			const ev = evaluate(
				q.source,
				model.agency,
				envOf(model.local.schemes, model.remote.schemes),
			);
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
				[
					{
						kind: "connect",
						repo: { owner: msg.settings.owner, repo: msg.settings.repo },
					},
				],
			]);

		case "connected":
			if (!msg.result.ok)
				return [
					{ ...model, session: { kind: "failed", failure: msg.result.error } },
					[],
				];
			{
				const { login, canWrite, defaultBranch } = msg.result.value;
				const session = {
					kind: "connected" as const,
					login,
					canWrite,
					defaultBranch,
					branch: model.settings.branch.trim() || ownBranch(login),
				};
				return [
					{ ...model, session, loading: { kind: "loading" } },
					[{ kind: "loadBank", target: targetOf(model.settings, session) }],
				];
			}

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
			// Before the author's first save their branch does not exist, and `remote` is
			// the bank they will branch from; the bases stay valid either way, since blob
			// shas are content addresses.
			const { files, from, aheadBy, behindBy } = msg.result.value;
			const proposable = aheadBy > 0;
			const remote = remoteOf(model.remote, files);
			const { local, nextId } = rebase(model.local, remote, model.nextId);
			return persist([
				{
					...model,
					local,
					remote,
					nextId,
					loading: { kind: "loaded", from, proposable, behindBy },
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

/**
 * Emit the commit for a file whose path is settled. A question takes along the unsaved
 * scheme files it names (owner, 2026-09-24); one GitHub also changed stops the save
 * before any request, naming the file to reload. Nothing is sent that GitHub would
 * refuse anyway.
 */
function write(
	model: Model,
	as: Connected,
	id: Id,
	q: Entry,
	path: string,
): Step {
	const own = syncOf(q, remoteBlob(model.remote, q));
	if (own === "conflict")
		return [
			refuse(
				model,
				id,
				"This file changed on GitHub since you started.",
				"Download your version first if you want to keep it, then reload from GitHub.",
			),
			[],
		];
	const env = envOf(model.local.schemes, model.remote.schemes);
	const deps =
		q.kind === "question"
			? dependencies(
					model.local,
					model.remote,
					parseSurface(q.source, env).mentions,
				)
			: { include: [], blocked: [] };
	const [stuck] = deps.blocked;
	if (stuck !== undefined)
		return [
			refuse(
				model,
				id,
				`The ${stuck.kind} \`${stuck.name}\` this question names changed on GitHub since you started.`,
				`Open \`${stuck.name}\` and reload it from GitHub, then save again.`,
			),
			[],
		];
	const changes: Change[] = [
		{ id, path, expected: q.base?.sha ?? null, text: q.source },
		...deps.include.flatMap((e) => {
			const at = claimOf(e);
			return at === undefined
				? []
				: [
						{
							id: e.id,
							path: at,
							expected: e.base?.sha ?? null,
							text: e.source,
						},
					];
		}),
	];
	const busy = changes.reduce<Model>(
		(m, c) => withActivity(m, c.id, { kind: "saving" }),
		model,
	);
	return [
		busy,
		[
			{
				kind: "commit",
				target: targetOf(model.settings, as),
				changes,
				message: describeChangeSet(
					messageOf(model, q),
					deps.include.map((e) => messageOf(model, e)),
				),
			},
		],
	];
}

/** The app declined before any request: say so on the file. */
const refuse = (model: Model, id: Id, message: string, hint?: string): Model =>
	withActivity(model, id, failed(compact({ kind: "refused", message, hint })));

/**
 * The commit message for saving a file: what changed in a question, or which scheme file.
 * `envOf` runs uncached here, re-reading the scheme files (a few milliseconds, only on
 * the save and delete paths). `update` is pure and cannot reach the view's cache; do
 * not thread one in to save those milliseconds.
 */
function messageOf(model: Model, q: Entry): string {
	if (q.kind !== "question")
		return describeSchemeChange(
			q.kind,
			q.name,
			q.base === undefined ? "add" : "update",
		);
	const env = envOf(model.local.schemes, model.remote.schemes);
	return describeChange(
		q.base === undefined ? undefined : parseSurface(q.base.text, env).draft,
		parseSurface(q.source, env).draft,
	);
}

/**
 * Whether a path is already GitHub's or another working file's. A changed file
 * deleted on GitHub keeps its base, so it still claims its path though `remote` no
 * longer has it.
 */
const taken = (model: Model, path: Path, self?: Id): boolean =>
	path in model.remote.questions ||
	path in model.remote.schemes ||
	allFiles(model.local).some((f) => f.id !== self && claimOf(f) === path);

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

/**
 * Why nothing can be written to GitHub right now, or undefined when it can. One rule
 * for `update`, which refuses on it, and for the view, which says it on the buttons.
 * Before this session's load, `remote` is only "last known, as of each base": a file
 * in conflict would look merely unsaved, so a save then would act on a wrong picture.
 */
export function writeBlocked(model: Model): string | undefined {
	if (model.session.kind !== "connected") return "Connect to the bank to save";
	if (!model.session.canWrite) return "Read access only: download instead";
	if (model.loading.kind !== "loaded") return "Checking GitHub…";
	// One commit at a time: two in flight naming the same file would make the second
	// look stale for a save that worked. Commits to one branch are serial anyway.
	if (
		Object.values(model.activity).some(
			(a) => a.kind === "saving" || a.kind === "deleting",
		)
	)
		return "Saving…";
	// The bank changes only through a pull request: never save straight to it.
	if (model.session.branch === model.session.defaultBranch)
		return `Saves go to your own branch, not ${model.session.defaultBranch}: clear the branch in the Bank panel`;
	return undefined;
}

/** The author's own branch: each author works apart and proposes with a pull request. */
export const ownBranch = (login: string): string => `qretools/${login}`;

type Connected = Extract<Model["session"], { kind: "connected" }>;

const targetOf = (
	settings: Model["settings"],
	session: Connected,
): BranchTarget => ({
	owner: settings.owner,
	repo: settings.repo,
	branch: session.branch,
	defaultBranch: session.defaultBranch,
});

/** Where to read a file: the author's branch, or, before their first save, the bank. */
const readTarget = (model: Model, session: Connected): BranchTarget => {
	const target = targetOf(model.settings, session);
	return model.loading.kind === "loaded" && model.loading.from === "default"
		? { ...target, branch: target.defaultBranch }
		: target;
};

/** Whom to write as, once `writeBlocked` has passed; undefined means it has not. */
const writable = (model: Model): Connected | undefined =>
	writeBlocked(model) === undefined && model.session.kind === "connected"
		? model.session
		: undefined;

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

/** Record what a write, delete or reload told us about the author's branch. */
function withGitHub(model: Model, path: Path, blob: Blob | undefined): Model {
	return { ...model, remote: withBlob(model.remote, path, blob) };
}

/** A save made a commit on the author's branch: it exists now, with something to propose. */
function committed(model: Model): Model {
	return model.loading.kind === "loaded"
		? {
				...model,
				loading: { ...model.loading, from: "branch", proposable: true },
			}
		: model;
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
