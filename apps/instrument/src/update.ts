/**
 * Every change to the Model and every effect, decided here and only here. Pure: the
 * shell runs the commands it returns and feeds their results back as messages.
 */
import { compact, instrumentOf } from "@qretools/core";
import { locate } from "@qretools/core/editor";
import {
	type BranchTarget,
	bankText,
	type Failure,
	formatLink,
	type Link,
	parseBank,
	parseLink,
	sameBank,
} from "@qretools/shell";
import {
	type Cmd,
	type Model,
	type Msg,
	type ProjectFiles,
	repoOf,
	type Session,
} from "./model.ts";
import { openText, wanted } from "./uses.ts";

type Step = readonly [Model, readonly Cmd[]];

export function update(model: Model, msg: Msg): Step {
	// A reply from GitHub that no longer has a place: after a sign-out, or a second one.
	if (stale(model, msg)) return [model, []];
	// The sign-in has ended, whichever reply noticed: one rule, as in the bank app. The
	// stored credentials are forgotten, so a dead token isn't retried on every load.
	const lapsed = authFailure(msg);
	if (lapsed !== undefined)
		return [
			signedOut(model, { kind: "failed", failure: lapsed }),
			[{ kind: "forgetToken" }],
		];
	const [next, cmds] = step(model, msg);
	// The banks the open instrument needs, asked for only when that set changes: an edit
	// that leaves the addresses alone asks for nothing.
	const before = wanted(model);
	const after = wanted(next);
	return after.length > 0 && keysOf(after) !== keysOf(before)
		? [next, [...cmds, { kind: "loadBanks", targets: after }]]
		: [next, cmds];
}

const keysOf = (targets: readonly BranchTarget[]): string =>
	targets.map(bankText).join("\n");

function authFailure(msg: Msg): Failure | undefined {
	const failure =
		(msg.kind === "connected" ||
			msg.kind === "projectLoaded" ||
			msg.kind === "bankLoaded") &&
		!msg.result.ok
			? msg.result.error
			: undefined;
	return failure?.kind === "auth" ? failure : undefined;
}

function step(model: Model, msg: Msg): Step {
	switch (msg.kind) {
		case "signInRequested":
			// Leaving for GitHub and coming back: the settings are kept for the return.
			return [
				{
					...model,
					settings: msg.settings,
					session: { kind: "connecting", toGitHub: true },
					failures: [],
				},
				[
					{ kind: "saveSettings", settings: msg.settings },
					{ kind: "signIn", remember: msg.settings.remember },
				],
			];
		case "connectRequested":
			return [
				{
					...model,
					settings: msg.settings,
					session: { kind: "connecting" },
					failures: [],
				},
				[
					{ kind: "saveSettings", settings: msg.settings },
					{ kind: "connect", repo: repoOf(msg.settings) },
				],
			];
		case "connected": {
			if (!msg.result.ok)
				return [
					signedOut(model, { kind: "failed", failure: msg.result.error }),
					[],
				];
			const { login, avatarUrl, defaultBranch } = msg.result.value;
			const session = {
				kind: "connected" as const,
				login,
				avatarUrl,
				defaultBranch,
			};
			return [
				{ ...model, session, project: { kind: "loading" } },
				[{ kind: "loadProject", target: targetOf(model, defaultBranch) }],
			];
		}
		case "projectLoaded": {
			if (!msg.result.ok)
				return [
					{
						...model,
						project: { kind: "failed", failure: msg.result.error },
					},
					[],
				];
			const loaded: Model = {
				...model,
				project: projectOf(msg.result.value),
			};
			// A link that waited for the project opens now.
			return [
				model.pendingLink === undefined
					? loaded
					: followLink(
							compact({ ...loaded, pendingLink: undefined }),
							model.pendingLink,
						),
				[],
			];
		}
		case "projectReloadRequested":
			return model.session.kind === "connected"
				? [
						// Its banks too, those that failed or weren't there: they may be now.
						{ ...model, project: { kind: "loading" }, banks: readBanks(model) },
						[
							{
								kind: "loadProject",
								target: targetOf(model, model.session.defaultBranch),
							},
						],
					]
				: [model, []];
		case "edited": {
			const path = model.open;
			if (path === undefined || model.project.kind !== "loaded")
				return [model, []];
			const read = model.project.instruments[path]?.text;
			// Back to the text as read: nothing of this tab's own is left.
			const { [path]: _, ...others } = model.working;
			return [
				{
					...model,
					working: msg.text === read ? others : { ...others, [path]: msg.text },
				},
				[],
			];
		}
		case "bankLoaded":
			return [
				{
					...model,
					banks: {
						...model.banks,
						[msg.key]: msg.result.ok
							? {
									kind: "loaded",
									files: msg.result.value.files,
									found: msg.result.value.found,
								}
							: { kind: "failed", failure: msg.result.error },
					},
				},
				[],
			];
		case "bankRetried": {
			// Forgotten, so the banks wanted are asked for again (the wrapper's rule).
			const { [msg.key]: _, ...others } = model.banks;
			return [{ ...model, banks: others }, []];
		}
		case "locationClicked": {
			// The place, resolved against the text as it is now: a range taken when the
			// list was drawn may have moved since.
			const text = openText(model);
			if (text === undefined) return [model, []];
			const { ranges } = instrumentOf(text, { banks: {} });
			return [
				model,
				[
					{
						kind: "revealRange",
						range: locate(msg.target, ranges),
						...(msg.target.severity === "hole" && { complete: true }),
					},
				],
			];
		}
		case "hashChanged": {
			const link = parseLink(msg.hash);
			if (link === undefined)
				return [compact({ ...model, open: undefined }), []];
			// Before the project has loaded, the link waits for it.
			if (model.project.kind !== "loaded")
				return [{ ...model, pendingLink: link }, []];
			return [followLink(model, link), []];
		}
		case "themeChosen":
			return [
				{ ...model, theme: msg.theme },
				[{ kind: "applyTheme", theme: msg.theme }],
			];
		case "ddiSchemaLoaded":
			return [{ ...model, ddiSchema: msg.result }, []];
		case "signOutRequested":
			return [
				signedOut(model, { kind: "anonymous" }),
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
 * A reply that arrives where it no longer belongs: a sign-in answered after a sign-out
 * (or twice), or a project read for a session that has ended.
 */
function stale(model: Model, msg: Msg): boolean {
	switch (msg.kind) {
		case "connected":
			return model.session.kind !== "connecting";
		case "projectLoaded":
			return (
				model.session.kind !== "connected" || model.project.kind !== "loading"
			);
		case "bankLoaded":
			return model.session.kind !== "connected";
		default:
			return false;
	}
}

/** The banks that were read and found: kept across a reload; the rest are read again. */
const readBanks = (model: Model): Model["banks"] =>
	Object.fromEntries(
		Object.entries(model.banks).filter(
			([, b]) => b.kind === "loaded" && b.found,
		),
	);

/** Signed out or failed: nothing of the project stays (it may be private). */
const signedOut = (model: Model, session: Session): Model =>
	compact({
		...model,
		session,
		project: { kind: "idle" } as const,
		banks: {},
		working: {},
		open: undefined,
		pendingLink: undefined,
	});

/** The project as published: its default branch, read only. */
const targetOf = (model: Model, defaultBranch: string): BranchTarget => ({
	...repoOf(model.settings),
	branch: defaultBranch,
	defaultBranch,
});

function projectOf({ instruments, project }: ProjectFiles): Model["project"] {
	const sorted = [...(instruments ?? [])].sort((a, b) =>
		a.path.localeCompare(b.path),
	);
	return {
		kind: "loaded",
		instruments: Object.fromEntries(sorted.map((f) => [f.path, f])),
		hasFolder: instruments !== null,
		...(project !== null && { file: project }),
	};
}

/**
 * Open what a link names, if it names an instrument of this project; otherwise nothing
 * opens, and a link to another project says so.
 */
function followLink(model: Model, link: Link): Model {
	const project = parseBank(link.repo);
	if (!project.ok || !sameBank(project.value, model.settings))
		return compact({
			...model,
			open: undefined,
			failures: [
				...model.failures,
				{
					kind: "refused",
					message: `That link is to another project, ${link.repo}.`,
					hint: `Sign out, then sign in to ${link.repo} to open it.`,
				},
			],
		});
	const file = link.file;
	return compact({
		...model,
		open:
			file !== undefined &&
			model.project.kind === "loaded" &&
			model.project.instruments[file] !== undefined
				? file
				: undefined,
	});
}

/** The address of an instrument of this project, as its list item links to it. */
export const instrumentHref = (
	model: Model,
	defaultBranch: string,
	path: string,
): string =>
	formatLink({
		repo: bankText(model.settings),
		branch: defaultBranch,
		file: path,
	});

/** An instrument's name, as its file is named. */
export const instrumentName = (path: string): string =>
	(path.split("/").at(-1) ?? path).replace(/\.yaml$/, "");
