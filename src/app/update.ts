import {
	bankLocation,
	describeChange,
	describeChangeSet,
	describeMove,
	describeSchemeChange,
	FOLDER_PATTERN,
	saveableName,
} from "../core/bank.js";
import { compact } from "../core/compact.js";
import { FOLDER_RULE_TEXT, NAME_RULE_TEXT, SCHEME_NAME } from "../core/copy.js";
import { locate } from "../core/findings.js";
import { mentionAt } from "../core/inspect.js";
import {
	labelledSource,
	MISSING_NAME,
	SHAPE,
	schemePath,
	textEntrySource,
} from "../core/schemes.js";
import { addSpace, applyEdits, renameEdits } from "../core/surface/edit.js";
import type { NamedScheme } from "../core/surface/env.js";
import { EMPTY_ENV } from "../core/surface/env.js";
import { parseSurface, rangesOf } from "../core/surface/parse.js";
import { NAME_PATTERN } from "../core/surface/schema.js";
import { formatLink, type Link, parseLink } from "./link.js";
import {
	type Activity,
	allFiles,
	type Blob,
	type Cmd,
	EMPTY_LOCAL,
	EMPTY_REMOTE,
	type Entry,
	envOf,
	fileOf,
	hasOwnWork,
	type Id,
	type Model,
	type Msg,
	type Naming,
	otherAuthor,
	otherBank,
	ownWork,
	type Path,
	type Question,
	type Remote,
	SCHEME_TEMPLATES,
	type SchemeEntry,
	schemeFileNamed,
	signedOut,
	toWork,
} from "./model.js";
import type { BankSettings, BranchTarget, Change, Failure } from "./storage.js";
import {
	claimOf,
	dependencies,
	rebase,
	remoteBlob,
	remoteOf,
	sliceOf,
	syncOf,
} from "./sync.js";
import { openFolder } from "./tree.js";

type Step = readonly [Model, readonly Cmd[]];

/**
 * Pure. Every state change in the app is one case of `step`; this wrapper keeps the
 * address bar naming what is open, and the open file's folder in view. A different
 * file open adds a history entry (so Back works); anything else (a draft gets its
 * path, a file moves) replaces it.
 */
export function update(model: Model, msg: Msg): Step {
	if (stale(model, msg)) return [model, []];
	const lapsed = authFailure(msg);
	const [stepped, cmds] =
		lapsed === undefined ? step(model, msg) : sessionLapsed(model, lapsed);
	const next = revealOpen(model, stepped);
	const before = linkOf(model);
	const after = linkOf(next);
	if (after === undefined || after === before) return [next, cmds];
	return [
		next,
		[...cmds, { kind: "setLink", hash: after, push: openChanged(model, next) }],
	];
}

/**
 * When the open file changes, or moves to another folder (a draft saved, a question
 * moved), its folder opens, once: it is added to `browser.expanded`, so the user can
 * close it again while the file stays open.
 */
function revealOpen(before: Model, after: Model): Model {
	const folder = openFolder(after);
	if (folder === undefined || after.browser.expanded.includes(folder))
		return after;
	const unchanged =
		before.screen.kind === "editing" &&
		after.screen.kind === "editing" &&
		before.screen.id === after.screen.id &&
		openFolder(before) === folder;
	if (unchanged) return after;
	return {
		...after,
		browser: {
			...after.browser,
			expanded: [...after.browser.expanded, folder],
		},
	};
}

function step(model: Model, msg: Msg): Step {
	switch (msg.kind) {
		case "edited":
			return model.screen.kind === "editing"
				? persist([withSource(model, model.screen.id, msg.text), []])
				: [model, []];

		case "themeChosen":
			return model.theme === msg.theme
				? [model, []]
				: [
						{ ...model, theme: msg.theme },
						[{ kind: "applyTheme", theme: msg.theme }],
					];

		case "fixApplied": {
			// Like typing: only the open file, which the author can edit. A path the text
			// no longer has (it changed since the fix was offered) changes nothing.
			const q = current(model);
			if (!q || q.id !== msg.id) return [model, []];
			const { fix } = msg;
			// A shared entry to create: the name dialog, prefilled, pointed back at this place.
			if (fix.kind === "create") {
				const { scheme, name, text, path } = fix.create;
				return [
					{
						...model,
						browser: {
							...model.browser,
							naming: {
								kind: scheme,
								name,
								text,
								purpose: { kind: "create", use: { id: q.id, path } },
							},
						},
					},
					[],
				];
			}
			if (fix.kind === "space") {
				const spaced = addSpace(q.source, fix.path, fix.word);
				if (spaced === undefined) return [model, []];
				// Focus follows the fix, as an edit's does: the caret after the new space.
				let at = 0;
				while (spaced[at] === q.source[at]) at++;
				return persist([
					withSource(model, q.id, spaced),
					[{ kind: "revealRange", range: [at + 1, at + 1] }],
				]);
			}
			const text = applyEdits(q.source, fix.edits);
			if (text === undefined || text === q.source) return [model, []];
			// Focus follows the change into the source (the fix's button goes with its
			// finding): the caret where the earliest edit starts, the same offset before and
			// after the fix, whichever text the editor holds when this runs.
			const ranges = rangesOf(text);
			const at = Math.min(
				...fix.edits.map(
					(e) => locate({ path: e.path, severity: "info" }, ranges)[0],
				),
			);
			return persist([
				withSource(model, q.id, text),
				[{ kind: "revealRange", range: [at, at] }],
			]);
		}

		case "locationClicked": {
			// A click names a place in the document's terms. It becomes a range here,
			// against the text as it is now.
			const q = current(model);
			if (!q) return [model, []];
			const range = locate(msg.target, rangesOf(q.source));
			// A hole at an empty value is a point where the value goes (its own zero-width
			// range, from the parser): offer what can go there (completion writes the space
			// after the colon, never the click). A field not written at all has no range.
			const own = msg.target.range;
			const hole =
				msg.target.severity === "hole" &&
				own !== undefined &&
				own[0] === own[1];
			return [
				model,
				[{ kind: "revealRange", range, ...(hole && { complete: true }) }],
			];
		}

		case "cursorMoved":
			return model.screen.kind === "editing"
				? [
						{ ...model, cursor: { id: model.screen.id, offset: msg.offset } },
						[],
					]
				: [model, []];

		case "hashChanged": {
			const link = parseLink(msg.hash);
			// Our own writes come back as hashchange events; the current link is a no-op.
			if (link === undefined || formatLink(link) === linkOf(model))
				return [model, []];
			return openLink(model, link);
		}

		case "foreignLoaded": {
			const screen = model.screen;
			// A link opened since has moved on; this reply is stale.
			if (
				screen.kind !== "foreign" ||
				screen.branch !== msg.branch ||
				screen.path !== msg.path
			)
				return [model, []];
			if (!msg.result.ok)
				return [
					{
						...model,
						screen: { kind: "blank" },
						failures: [...model.failures, msg.result.error],
					},
					[],
				];
			const { file } = msg.result.value;
			// Their version is exactly the one you started from: open your own copy.
			const own = claimant(model, file.path);
			if (own?.base?.sha === file.sha)
				return [{ ...model, screen: { kind: "editing", id: own.id } }, []];
			const schemes = Object.fromEntries(
				msg.result.value.schemes.map((f) => [
					f.path,
					{ sha: f.sha, text: f.text },
				]),
			);
			return [{ ...model, screen: { ...screen, file, schemes } }, []];
		}

		case "ddiSchemaLoaded":
			return [{ ...model, ddiSchema: msg.result }, []];

		case "listOpened":
			// Going back to the bank also stops waiting to open a link: it would
			// otherwise pull the author away once the bank loads.
			return [
				compact({
					...model,
					screen: { kind: "blank" },
					pendingLink: undefined,
				}),
				[],
			];

		case "definitionRequested": {
			// Only the author's own open question: another author's names resolve against
			// their environment, never this one's.
			const q = current(model);
			if (!q || q.id !== msg.id || q.kind !== "question") return [model, []];
			// The names written, resolved or not; the file decides whether there is one.
			const parsed = parseSurface(q.source, EMPTY_ENV);
			const m = mentionAt(parsed.ranges, parsed.mentions, q.source, msg.offset);
			const target =
				m === undefined
					? undefined
					: schemeFileNamed(model.local.schemes, m.scheme, m.name);
			return target === undefined
				? [model, []]
				: step(model, { kind: "fileOpened", id: target.id });
		}

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
							naming: {
								kind: msg.scheme,
								name: msg.name ?? "",
								text: "",
								purpose: {
									kind: "create",
									...(msg.use !== undefined && { use: msg.use }),
								},
							},
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

		case "schemeRenameOpened": {
			// Only a draft: a saved file's name is its path on GitHub, and other branches'.
			const e = model.local.schemes[msg.id];
			if (!e || e.kind === "missing" || e.base !== undefined)
				return [model, []];
			return [
				{
					...model,
					browser: {
						...model.browser,
						naming: {
							kind: e.kind,
							name: e.name,
							text: "",
							purpose: { kind: "rename", id: e.id },
						},
					},
				},
				[],
			];
		}

		case "schemeNameChanged":
		case "schemeTextChanged": {
			const naming = model.browser.naming;
			if (naming === undefined) return [model, []];
			const changed =
				msg.kind === "schemeNameChanged"
					? { ...naming, name: msg.name }
					: { ...naming, text: msg.text };
			return [{ ...model, browser: { ...model.browser, naming: changed } }, []];
		}

		case "schemeNamingCancelled":
			return [{ ...model, browser: withoutNaming(model.browser) }, []];

		case "schemeNamingConfirmed": {
			const naming = model.browser.naming;
			if (naming === undefined || namingProblem(model, naming) !== undefined)
				return [model, []];
			const closed = { ...model, browser: withoutNaming(model.browser) };
			if (naming.purpose.kind === "rename") {
				const { id } = naming.purpose;
				const e = model.local.schemes[id];
				if (!e || e.kind === "missing" || e.base !== undefined)
					return [closed, []];
				const renamed = withFile(closed, { ...e, name: naming.name });
				return persist([
					renameReferences(renamed, e.kind, e.name, naming.name),
					[],
				]);
			}
			const written = naming.text.trim() !== "";
			const shape = SHAPE[naming.kind];
			const source = !written
				? SCHEME_TEMPLATES[naming.kind]
				: shape === "labelled"
					? labelledSource(naming.text)
					: shape === "text"
						? textEntrySource(naming.text)
						: SCHEME_TEMPLATES[naming.kind];
			const [added, id] = add(closed, {
				kind: naming.kind,
				name: naming.name,
				source,
			});
			// The question that named it now names the file, whatever name was chosen.
			const { use } = naming.purpose;
			const q = use === undefined ? undefined : added.local.questions[use.id];
			const used =
				use === undefined || q === undefined
					? added
					: withSource(
							added,
							q.id,
							applyEdits(q.source, [{ path: use.path, value: naming.name }]) ??
								q.source,
						);
			// A universe or instruction is complete with its text: stay on the question.
			// A scale needs its labels written, so it opens.
			const stay =
				use !== undefined && q !== undefined && naming.kind !== "scale";
			return persist([
				stay ? used : { ...used, screen: { kind: "editing", id } },
				[],
			]);
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
			// once, deliberately: it decides the folder, and git would create an
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
			// Where it goes is the author's choice: the dialog opens with none chosen.
			const name = saveableName(
				parseSurface(q.source, envOf(model.local.schemes, model.remote.schemes))
					.draft,
			);
			if (!name.ok)
				return [refuse(model, msg.id, name.error.message, name.error.hint), []];
			return [
				{
					...model,
					browser: { ...model.browser, saving: { id: msg.id, folder: "" } },
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
						"Open the bank's copy to change it, or choose another name or folder.",
					),
					[],
				];
			}
			return write(closed, as, saving.id, q, where.value.path);
		}

		case "moveRequested": {
			const q = model.local.questions[msg.id];
			if (q?.base === undefined) return [model, []];
			return [
				{
					...model,
					browser: {
						...model.browser,
						moving: {
							id: msg.id,
							folder: msg.folder ?? folderOfPath(q.base.path),
						},
					},
				},
				[],
			];
		}

		case "moveFolderChanged":
			return model.browser.moving === undefined
				? [model, []]
				: [
						{
							...model,
							browser: {
								...model.browser,
								moving: { ...model.browser.moving, folder: msg.folder },
							},
						},
						[],
					];

		case "moveCancelled":
			return [
				{ ...model, browser: compact({ ...model.browser, moving: undefined }) },
				[],
			];

		case "moveConfirmed": {
			const moving = model.browser.moving;
			const q =
				moving === undefined ? undefined : model.local.questions[moving.id];
			const as = writable(model);
			if (moving === undefined || q?.base === undefined || as === undefined)
				return [model, []];
			const closed = {
				...model,
				browser: compact({ ...model.browser, moving: undefined }),
			};
			const problem = moveProblem(model, q, moving.folder);
			if (problem !== undefined) return [refuse(closed, q.id, problem), []];
			const to = movedPath(q.base.path, moving.folder);
			// A move also saves (owner, 2026-09-29): the working text at the new path,
			// the old path deleted, and the scheme files it names, as a save would.
			const env = envOf(model.local.schemes, model.remote.schemes);
			const subject = describeMove(
				parseSurface(q.base.text, env).draft,
				parseSurface(q.source, env).draft,
				fileName(q.base.path),
				moving.folder,
				q.source !== q.base.text,
			);
			return write(closed, as, q.id, q, to, subject);
		}

		case "committed": {
			const ids = msg.changes.flatMap((c) =>
				c.id === undefined ? [] : [c.id],
			);
			// Saving before signing out: the dialog reports, never a file.
			const leaving = model.browser.signingOut?.phase === "saving";
			const primary = leaving ? undefined : ids[0];
			const idle = ids.reduce<Model>(
				(m, id) => withActivity(m, id, undefined),
				model,
			);
			if (!msg.result.ok) {
				const { failure, seen } = msg.result.error;
				const reported = (m: Model): Model =>
					leaving
						? {
								...m,
								browser: {
									...m.browser,
									signingOut: { phase: "asking", failure },
								},
							}
						: m;
				// GitHub's answer is the ground truth: the app cannot write here (never
				// installed, uninstalled mid-session, or without Contents write).
				if (
					failure.kind === "notInstalled" &&
					model.session.kind === "connected"
				) {
					const blocked: Model = {
						...idle,
						session: { ...model.session, access: { kind: "notInstalled" } },
					};
					return [
						primary === undefined
							? reported(blocked)
							: withActivity(blocked, primary, failed(failure)),
						[],
					];
				}
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
						? reported({ ...absorbed, local, nextId })
						: withActivity(
								{ ...absorbed, local, nextId },
								primary,
								failed(failure),
							);
				return seen === undefined ? [failedAt, []] : persist([failedAt, []]);
			}
			const { shas } = msg.result.value;
			const done = msg.changes.reduce<Model>((m, c) => {
				// A delete with no working file is the old path of a move: GitHub only.
				if (c.text === null)
					return withGitHub(
						c.id === undefined ? m : without(m, c.id),
						c.path,
						undefined,
					);
				const sha = shas[c.path];
				if (sha === undefined) return m;
				const blob = { sha, text: c.text };
				const f = c.id === undefined ? undefined : fileOf(m, c.id);
				// The base becomes what was committed, not what is in the editor now:
				// typing during the save correctly shows as unsaved.
				const based = f
					? withFile(m, { ...f, base: { path: c.path, ...blob } })
					: m;
				return withGitHub(based, c.path, blob);
			}, idle);
			// Everything saveable is saved; drafts without a folder go, as the dialog said.
			return leaving
				? signOut({ ...committed(done), local: EMPTY_LOCAL })
				: persist([committed(done), []]);
		}

		case "reloadRequested": {
			// "Reload from GitHub" takes GitHub's version of the file: its text, or, if
			// GitHub deleted it, its absence. Read at the path the file claims, which covers
			// a draft GitHub also added.
			const q = fileOf(model, msg.id);
			const path = q === undefined ? undefined : claimOf(q);
			if (
				q === undefined ||
				path === undefined ||
				model.session.kind !== "connected"
			)
				return [model, []];
			if (q.base !== undefined && remoteBlob(model.remote, q) === undefined)
				return persist([without(model, msg.id), []]);
			return [
				model,
				[
					{
						kind: "readFile",
						id: msg.id,
						target: readTarget(model, model.session),
						path,
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

		case "connectRequested": {
			const [chosen, cmds] = withSettings(model, msg.settings);
			return persist([
				{ ...chosen, session: { kind: "connecting" }, failures: [] },
				[
					...cmds,
					{
						kind: "connect",
						repo: { owner: msg.settings.owner, repo: msg.settings.repo },
					},
				],
			]);
		}

		case "signInRequested": {
			// Leaving for GitHub and coming back is not leaving the work: no warning.
			const [chosen, cmds] = withSettings(model, msg.settings);
			return persist([
				{
					...chosen,
					session: { kind: "connecting", toGitHub: true },
					failures: [],
				},
				[...cmds, { kind: "signIn", remember: msg.settings.remember }],
			]);
		}

		case "connected":
			// Signed out, whatever the reason: only the author's own work stays.
			if (!msg.result.ok)
				return persist([
					{
						...signedOut(model),
						session: { kind: "failed", failure: msg.result.error },
					},
					[],
				]);
			{
				const { login, avatarUrl, access, defaultBranch } = msg.result.value;
				const session = {
					kind: "connected" as const,
					login,
					avatarUrl,
					access,
					defaultBranch,
				};
				// This person's work, never another's, before the load: someone else's
				// unsaved work in this tab is set aside, never shown to them or dropped.
				const [theirs, aside] = otherAuthor(model, login)
					? setAside(
							model,
							`Unsaved work in this tab belonged to ${model.author} and was set aside.`,
						)
					: [model, []];
				return persist([
					{
						...theirs,
						author: login,
						session,
						loading: { kind: "loading" },
					},
					[
						...aside,
						{ kind: "loadBank", target: targetOf(model.settings, session) },
					],
				]);
			}

		case "bankLoaded": {
			if (!msg.result.ok)
				return [
					compact({
						...model,
						loading: { kind: "failed", failure: msg.result.error } as const,
						pendingLink: undefined,
					}),
					[],
				];
			// Before the author's first save their branch does not exist, and `remote` is
			// the bank they will branch from; the bases stay valid either way, since blob
			// shas are content addresses.
			const { files, from, aheadBy, behindBy } = msg.result.value;
			const proposable = aheadBy > 0;
			const remote = remoteOf(model.remote, files);
			const { local, nextId } = rebase(model.local, remote, model.nextId);
			const loaded: Model = compact({
				...model,
				local,
				remote,
				nextId,
				loading: { kind: "loaded", from, proposable, behindBy } as const,
				pendingLink: undefined,
			});
			// A link that waited for the bank opens now.
			const [opened, cmds] =
				model.pendingLink === undefined
					? [loaded, []]
					: openLink(loaded, model.pendingLink);
			return persist([opened, cmds]);
		}

		case "bankReloadRequested":
			if (model.session.kind !== "connected") return [model, []];
			return [
				{ ...model, loading: { kind: "loading" } },
				[{ kind: "loadBank", target: targetOf(model.settings, model.session) }],
			];

		case "disconnected":
			return signOut(model);

		case "signOutRequested":
			// Nothing of the author's own would be left behind: sign out at once.
			return hasOwnWork(model)
				? [
						{
							...model,
							browser: { ...model.browser, signingOut: { phase: "asking" } },
						},
						[],
					]
				: signOut(model);

		case "signOutCancelled":
			return model.browser.signingOut?.phase === "asking"
				? [{ ...model, browser: withoutSigningOut(model.browser) }, []]
				: [model, []];

		case "signOutDiscardConfirmed":
			return model.browser.signingOut?.phase === "asking"
				? signOut({ ...model, local: EMPTY_LOCAL })
				: [model, []];

		case "signOutSaveConfirmed": {
			const as = writable(model);
			const plan = signOutPlan(model);
			if (
				model.browser.signingOut?.phase !== "asking" ||
				as === undefined ||
				plan.blocked.length > 0 ||
				plan.save.length === 0
			)
				return [model, []];
			return commitFiles(
				{
					...model,
					browser: { ...model.browser, signingOut: { phase: "saving" } },
				},
				as,
				claimedChanges(plan.save),
				plan.save,
			);
		}

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
	subject?: string,
): Step {
	const own = syncOf(q, remoteBlob(model.remote, q));
	if (own === "conflict")
		return [
			refuse(
				model,
				id,
				"This changed on GitHub since you started.",
				"Copy your version somewhere first if you want to keep it, then reload from GitHub.",
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
	// Saved somewhere else than its base (a move): the old path goes in the same commit.
	const moved: Change[] =
		q.base !== undefined && q.base.path !== path
			? [{ path: q.base.path, expected: q.base.sha, text: null }]
			: [];
	// The file being saved comes first: a refused commit reports on `changes[0]`.
	return commitFiles(
		model,
		as,
		[changeOf(q, path), ...claimedChanges(deps.include), ...moved],
		[q, ...deps.include],
		subject,
	);
}

/** Writing a working file at a path: expected at its base when that is the path, else not there yet. */
const changeOf = (f: Entry, path: Path): Change => ({
	id: f.id,
	path,
	expected: f.base?.path === path ? f.base.sha : null,
	text: f.source,
});

/** Changes for files whose path is settled: saved ones and scheme files (kind and name give it). */
const claimedChanges = (files: readonly Entry[]): Change[] =>
	files.flatMap((f) => {
		const at = claimOf(f);
		return at === undefined ? [] : [changeOf(f, at)];
	});

/**
 * One commit of a change set: each working file marked as saving, the message from
 * the first file with the others listed.
 */
function commitFiles(
	model: Model,
	as: Connected,
	changes: readonly Change[],
	files: readonly Entry[],
	/** The first file's line, when the caller has a better one than `messageOf` (a move). */
	subject?: string,
): Step {
	const busy = changes.reduce<Model>(
		(m, c) =>
			c.id === undefined ? m : withActivity(m, c.id, { kind: "saving" }),
		model,
	);
	const [first, ...others] = files;
	return [
		busy,
		[
			{
				kind: "commit",
				target: targetOf(model.settings, as),
				changes,
				message: describeChangeSet(
					subject ?? (first === undefined ? "" : messageOf(model, first)),
					others.map((e) => messageOf(model, e)),
				),
			},
		],
	];
}

/**
 * What signing out does with the author's own work: saved questions and shared files
 * with unsaved changes, and new shared files (their path follows from kind and name),
 * are saved in one commit; question drafts can't be (their folder is a choice) and are
 * discarded; anything GitHub also changed or deleted blocks the save until reloaded.
 */
export function signOutPlan(model: Model): {
	readonly save: readonly Entry[];
	readonly discard: readonly Question[];
	readonly blocked: readonly Entry[];
} {
	const save: Entry[] = [];
	const discard: Question[] = [];
	const blocked: Entry[] = [];
	for (const f of allFiles(model.local).filter(ownWork)) {
		if (f.kind === "question" && f.base === undefined) {
			discard.push(f);
			continue;
		}
		const sync = syncOf(f, remoteBlob(model.remote, f));
		if (sync === "conflict" || sync === "deletedOnGitHub") blocked.push(f);
		else if (sync === "draft" || sync === "unsaved") save.push(f);
	}
	return { save, discard, blocked };
}

/** Signed out: only the author's own work stays, and the credentials are forgotten. */
function signOut(model: Model): Step {
	return persist([
		{ ...signedOut(model), session: { kind: "anonymous" } },
		[{ kind: "forgetToken" }],
	]);
}

/**
 * The work in hand leaves this tab: kept in the browser's storage and said once, never
 * dropped. Clean copies of the bank's files are simply forgotten (a load brings them back).
 */
function setAside(model: Model, message: string): Step {
	const cleared: Model = compact({
		...model,
		local: EMPTY_LOCAL,
		remote: EMPTY_REMOTE,
		activity: {},
		screen: { kind: "blank" } as const,
		cursor: undefined,
		author: undefined,
	});
	if (!hasOwnWork(model)) return [cleared, []];
	return [
		{
			...cleared,
			failures: [
				...model.failures,
				{
					kind: "refused",
					message,
					hint: "It's kept in this browser's storage (`qretools.work.aside`).",
				},
			],
		},
		[{ kind: "setAside", work: toWork(model) }],
	];
}

/**
 * Settings chosen on the sign-in page: kept as the default for new tabs. Work belongs
 * to its bank, so choosing another sets this tab's work aside rather than carry it there.
 */
function withSettings(model: Model, settings: BankSettings): Step {
	const [kept, cmds] = otherBank(model, settings)
		? setAside(
				model,
				`Unsaved work in this tab for ${model.settings.owner}/${model.settings.repo} was set aside.`,
			)
		: [model, []];
	return [{ ...kept, settings }, [...cmds, { kind: "saveSettings", settings }]];
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
 * A reply saying the author is no longer signed in (the token was refused, or could
 * not be renewed), whichever command it answers. Other failures are ordinary.
 */
function authFailure(msg: Msg): Failure | undefined {
	const failure =
		msg.kind === "connected" ||
		msg.kind === "bankLoaded" ||
		msg.kind === "fileReloaded" ||
		msg.kind === "foreignLoaded"
			? msg.result.ok
				? undefined
				: msg.result.error
			: msg.kind === "committed"
				? msg.result.ok
					? undefined
					: msg.result.error.failure
				: undefined;
	return failure?.kind === "auth" ? failure : undefined;
}

/**
 * The sign-in has ended: one rule, whatever command noticed. The session says so and
 * offers to sign in again, the stored credentials are forgotten (so a dead token is not
 * retried on every load), and nothing waits on GitHub any more. Working copies stay.
 */
function sessionLapsed(model: Model, failure: Failure): Step {
	return persist([
		{ ...signedOut(model), session: { kind: "failed", failure } },
		[{ kind: "forgetToken" }],
	]);
}

/**
 * A reply from GitHub that no longer has a session to land in: sent before a sign-out,
 * it would bring the bank's files back into a signed-out browser. And a connection
 * answers only while one is being made.
 */
function stale(model: Model, msg: Msg): boolean {
	const out =
		model.session.kind === "anonymous" || model.session.kind === "failed";
	switch (msg.kind) {
		case "bankLoaded":
		case "committed":
		case "fileReloaded":
		case "foreignLoaded":
			return out;
		case "connected":
			return model.session.kind !== "connecting";
		default:
			return false;
	}
}

/** The folder of a question path: `questions/<folder>/<name>.yaml`. */
export const folderOfPath = (path: Path): string => path.split("/")[1] ?? "";
const fileName = (path: Path): string =>
	(path.split("/").at(-1) ?? path).replace(/\.yaml$/, "");
/** Only the folder changes; the filename stays, whatever unsaved edits say the name is. */
export const movedPath = (path: Path, folder: string): Path =>
	`questions/${folder}/${path.split("/").at(-1) ?? ""}`;

/** Why a bank question cannot move to `folder`, or undefined when it can. */
export function moveProblem(
	model: Model,
	q: Question,
	folder: string,
): string | undefined {
	if (q.base === undefined) return "Only a question in the bank can move.";
	if (!FOLDER_PATTERN.test(folder)) return FOLDER_RULE_TEXT;
	const to = movedPath(q.base.path, folder);
	if (to === q.base.path) return "It's already in that folder.";
	const sync = syncOf(q, remoteBlob(model.remote, q));
	if (sync === "conflict" || sync === "deletedOnGitHub")
		return "This question changed on GitHub since you started; reload it first.";
	if (taken(model, to, q.id)) return `\`${to}\` is already taken.`;
	return undefined;
}

/**
 * The link to what is open, as the address bar should show it; undefined while not
 * connected (nothing to name a branch by). The branch is the one the file was read
 * from: before the author's first save their own branch does not exist yet, so a link
 * names the default branch, which others can open.
 */
export function linkOf(model: Model): string | undefined {
	// A link being opened keeps its place in the address bar until it resolves, so a
	// link that fails is still there to copy or report.
	if (model.pendingLink !== undefined) return formatLink(model.pendingLink);
	// Before the load, whether the author's own branch exists is unknown: leave the
	// address alone rather than name a branch dishonestly.
	if (model.session.kind !== "connected" || model.loading.kind !== "loaded")
		return undefined;
	const repo = `${model.settings.owner}/${model.settings.repo}`;
	const own =
		model.loading.kind === "loaded" && model.loading.from === "default"
			? model.session.defaultBranch
			: ownBranch(model.session.login);
	const { screen } = model;
	if (screen.kind === "foreign")
		return formatLink({ repo, branch: screen.branch, file: screen.path });
	const open = screen.kind === "editing" ? fileOf(model, screen.id) : undefined;
	// A draft has no path on GitHub yet: the link names the branch alone.
	const file = open?.base?.path;
	return formatLink(
		file === undefined ? { repo, branch: own } : { repo, branch: own, file },
	);
}

/**
 * A link to a working file, for an `<a href>`: undefined while nothing names the branch
 * (not connected, not loaded) or for a draft, which is not on GitHub. The same rule as
 * `linkOf`: the branch the file was read from.
 */
export function hrefOf(model: Model, f: Entry): string | undefined {
	const branch = linkBranch(model);
	if (branch === undefined || f.base === undefined) return undefined;
	return formatLink({
		repo: `${model.settings.owner}/${model.settings.repo}`,
		branch,
		file: f.base.path,
	});
}

/** The branch links to working files name: the one the bank was read from; undefined before the load. */
export function linkBranch(model: Model): string | undefined {
	if (model.session.kind !== "connected" || model.loading.kind !== "loaded")
		return undefined;
	return model.loading.from === "default"
		? model.session.defaultBranch
		: ownBranch(model.session.login);
}

/** Whether a different file is open: a navigation, which the browser should record. */
const openChanged = (a: Model, b: Model): boolean =>
	a.screen.kind !== b.screen.kind ||
	(a.screen.kind === "editing" &&
		b.screen.kind === "editing" &&
		a.screen.id !== b.screen.id) ||
	(a.screen.kind === "foreign" &&
		b.screen.kind === "foreign" &&
		(a.screen.branch !== b.screen.branch || a.screen.path !== b.screen.path));

/** The working file that holds a path on the author's branch, if any. */
const claimant = (model: Model, path: Path): Entry | undefined =>
	allFiles(model.local).find((f) => f.base?.path === path);

/**
 * Open a link. Your own branch (or the default branch before your first save) opens
 * your local copy at once; viewing never waits for the load, only writing does.
 * Another branch shows that author's version, read only, unless it is exactly the
 * version you started from. What cannot be resolved yet waits for the bank.
 */
function openLink(model: Model, link: Link): Step {
	const repo = `${model.settings.owner}/${model.settings.repo}`;
	// GitHub's names ignore case.
	if (link.repo.toLowerCase() !== repo.toLowerCase()) {
		// Until a bank is open, a link to another bank is where to sign in: the form
		// offers its repository, and the link opens once that bank has loaded.
		if (model.session.kind !== "connected")
			return [{ ...model, pendingLink: link }, []];
		return [
			refused(
				model,
				`This link is to ${link.repo}; you are signed in to ${repo}.`,
				`Sign out, then sign in to ${link.repo} to open it.`,
			),
			[],
		];
	}
	const loaded = model.loading.kind === "loaded";
	const session =
		model.session.kind === "connected" ? model.session : undefined;
	const ownBranches = session
		? [
				ownBranch(session.login),
				...(loaded &&
				model.loading.kind === "loaded" &&
				model.loading.from === "default"
					? [session.defaultBranch]
					: []),
			]
		: [];
	const own = link.file === undefined ? undefined : claimant(model, link.file);
	// Your own copy answers a link to your own branch at once, even before the load;
	// any other branch (the default one included) waits, since whose version it is
	// cannot be known until their blob is.
	if (own !== undefined && ownBranches.includes(link.branch))
		return [
			compact({
				...model,
				screen: { kind: "editing", id: own.id } as const,
				pendingLink: undefined,
			}),
			[],
		];
	if (!loaded || session === undefined)
		return [{ ...model, pendingLink: link }, []];
	if (ownBranches.includes(link.branch))
		return link.file === undefined
			? [{ ...model, screen: { kind: "blank" } }, []]
			: [
					refused(
						model,
						`\`${link.file}\` isn't on ${link.branch}.`,
						"It may have been moved, renamed or deleted.",
					),
					[],
				];
	if (link.file === undefined) return [model, []];
	return [
		{
			...model,
			screen: { kind: "foreign", branch: link.branch, path: link.file },
		},
		[
			{
				kind: "readAt",
				target: { ...targetOf(model.settings, session), branch: link.branch },
				path: link.file,
			},
		],
	];
}

/** A link the app declined to open: said once, in the failures. */
const refused = (model: Model, message: string, hint?: string): Model => ({
	...model,
	failures: [
		...model.failures,
		compact({ kind: "refused" as const, message, hint }),
	],
});

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
	self?: Id,
): string | undefined {
	if (name === "") return "Give it a name.";
	if (!NAME_PATTERN.test(name)) return NAME_RULE_TEXT;
	return Object.values(model.local.schemes).some(
		(e) => e.kind === kind && e.name === name && e.id !== self,
	)
		? `A ${SCHEME_NAME[kind]} named \`${name}\` already exists.`
		: undefined;
}

const withoutSigningOut = (browser: Model["browser"]): Model["browser"] =>
	compact({ ...browser, signingOut: undefined });

const withoutSaving = (browser: Model["browser"]): Model["browser"] =>
	compact({ ...browser, saving: undefined });

const withoutConfirm = (browser: Model["browser"]): Model["browser"] =>
	compact({ ...browser, confirmDelete: undefined });

const withoutNaming = (browser: Model["browser"]): Model["browser"] =>
	compact({ ...browser, naming: undefined });

/**
 * What stops the name dialog's answer: the name rule, or another shared file of the
 * kind with that name. A file being renamed does not stand in its own way.
 */
export function namingProblem(
	model: Model,
	naming: Naming,
): string | undefined {
	const self = naming.purpose.kind === "rename" ? naming.purpose.id : undefined;
	return schemeNameProblem(model, naming.kind, naming.name, self);
}

/** Every question in this tab that names the file by its old name now names the new one. */
function renameReferences(
	model: Model,
	scheme: NamedScheme,
	from: string,
	to: string,
): Model {
	let next = model;
	for (const q of Object.values(model.local.questions)) {
		const edits = renameEdits(q.source, scheme, from, to);
		const text = edits.length === 0 ? undefined : applyEdits(q.source, edits);
		if (text !== undefined && text !== q.source)
			next = withSource(next, q.id, text);
	}
	return next;
}

const current = (model: Model): Entry | undefined =>
	model.screen.kind === "editing" ? fileOf(model, model.screen.id) : undefined;

/**
 * Why nothing can be written to GitHub right now, or undefined when it can. One rule
 * for `update`, which refuses on it, and for the view, which says it on the buttons.
 * Before this session's load, `remote` is only "last known, as of each base": a file
 * in conflict would look merely unsaved, so a save then would act on a wrong picture.
 */
export function writeBlocked(model: Model): string | undefined {
	if (model.session.kind !== "connected") return "Sign in to save";
	if (model.session.access.kind === "readOnly") return "Read access only";
	if (model.session.access.kind === "notInstalled")
		return "The app can't save to this bank";
	if (model.loading.kind === "failed") return "The bank didn't load";
	if (model.loading.kind !== "loaded") return "Loading the bank…";
	// One commit at a time: two in flight naming the same file would make the second
	// look stale for a save that worked. Commits to one branch are serial anyway.
	if (
		Object.values(model.activity).some(
			(a) => a.kind === "saving" || a.kind === "deleting",
		)
	)
		return "Saving…";
	return undefined;
}

/**
 * The bank is on its way from GitHub: what this browser holds is only last known, so
 * the sidebar shows the bank's shape rather than stale files. (An open file stays:
 * viewing never waits, only writing does.)
 */
export const bankLoading = (model: Model): boolean =>
	model.session.kind === "connecting" || model.loading.kind === "loading";

/**
 * The top bar's status: what the session is doing, or why nothing can be written.
 * Empty in the steady state (connected, loaded, writable, idle), since the account
 * and the repository already say who and where. A file's inactive write buttons point
 * at it, so whenever `writeBlocked` gives a reason while signed in, this says one
 * (tested); signed out there are no files and no buttons.
 */
export function sessionStatus(model: Model): string | undefined {
	const { session, loading } = model;
	switch (session.kind) {
		// Signed out there is no editor: the sign-in page says what to do, and why.
		case "anonymous":
		case "failed":
			return undefined;
		case "connecting":
			return "Signing in…";
		case "connected":
			return loading.kind === "failed"
				? `The bank didn't load: ${loading.failure.message.replace(/\.$/, "")}`
				: // What is happening now comes before a standing reason (read only).
					model.screen.kind === "foreign" && model.screen.file === undefined
					? `Loading ${model.screen.path} from ${model.screen.branch}…`
					: writeBlocked(model);
	}
}

/** The author's own branch: each author works apart and proposes with a pull request. */
const BRANCH_PREFIX = "qretools-";
export const ownBranch = (login: string): string => `${BRANCH_PREFIX}${login}`;
/**
 * Whose own branch this is, or undefined for any other branch. A hyphen, not a slash:
 * the branch reads as one segment of the header's `owner / repo / branch`, and git
 * could not hold a `qretools` ref beside `qretools/…` ones. Logins are letters,
 * digits and single hyphens, so everything after the prefix is the login.
 */
export const branchOwner = (branch: string): string | undefined =>
	branch.startsWith(BRANCH_PREFIX) && branch.length > BRANCH_PREFIX.length
		? branch.slice(BRANCH_PREFIX.length)
		: undefined;

type Connected = Extract<Model["session"], { kind: "connected" }>;

const targetOf = (
	settings: Model["settings"],
	session: Connected,
): BranchTarget => ({
	owner: settings.owner,
	repo: settings.repo,
	branch: ownBranch(session.login),
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
	[...cmds, { kind: "persist", work: toWork(model) }],
];
