/**
 * The Elm Architecture, by hand. The Model is everything the app knows; a Msg is
 * everything that can happen; a Cmd is an effect described as data.
 *
 * Model, Msg and Cmd are plain data: no functions, no DOM nodes, no token, nothing
 * that cannot be logged, compared, or serialised. Nothing derived is stored: whether
 * a question is unsaved follows from its text and origin; what a question shows
 * follows from its text.
 */
import { compact } from "../core/compact.js";
import type { Finding, Fix, Range, Target } from "../core/findings.js";
import type { Result } from "../core/result.js";
import { kindAt, type SchemeKind, schemeEnv } from "../core/schemes.js";
import type { Env, NamedScheme } from "../core/surface/env.js";
import { parseScale, type Scales } from "../core/surface/scales.js";
import choiceTemplate from "../templates/choice.yaml?raw";
import numberTemplate from "../templates/number.yaml?raw";
import scaleTemplate from "../templates/scale.yaml?raw";
import selectManyTemplate from "../templates/select-many.yaml?raw";
import type { Link } from "./link.js";
import { startingSettings, type Work } from "./persist.js";
import type {
	Access,
	BankSettings,
	BranchTarget,
	Change,
	CommitFailure,
	Committed,
	Failure,
	File,
	Loaded,
	Repo,
	Who,
} from "./storage.js";

export type Id = number;

/** A repository path: GitHub's identity for a file. */
export type Path = string;

/** A file as GitHub has it: its blob sha and its text. */
export interface Blob {
	readonly sha: string;
	readonly text: string;
}

/**
 * What a working copy started from on GitHub. Needed besides `remote`, which moves
 * on every load: telling "you changed it" from "GitHub changed it" takes three
 * versions, as in git. No base means a draft, never saved.
 */
export interface Base extends Blob {
	readonly path: Path;
}

/** What is happening to a file. Absent from `Model.activity` means idle. */
export type Activity =
	| { readonly kind: "saving" }
	| { readonly kind: "deleting" }
	| { readonly kind: "failed"; readonly failure: Failure };

/** A question: its name is in its text, and may be a hole. Content only. */
export interface Question {
	readonly kind: "question";
	readonly id: Id;
	readonly source: string;
	readonly base?: Base;
}

/** A scheme file: its name is its filename, chosen when it is created and never a hole. */
export interface SchemeEntry {
	readonly kind: SchemeKind;
	readonly name: string;
	readonly id: Id;
	readonly source: string;
	readonly base?: Base;
}

/** Everything the bank browser holds. */
export type Entry = Question | SchemeEntry;

/**
 * The working copies, split by kind. The split is structural, not cosmetic: the
 * local environment is built from `schemes` alone, so editing a question, which
 * replaces only `questions`, can never change it.
 */
export interface Local {
	readonly questions: Readonly<Record<Id, Question>>;
	readonly schemes: Readonly<Record<Id, SchemeEntry>>;
}

const sameName = (a: string, b: string): boolean =>
	a.toLowerCase() === b.toLowerCase();

export const EMPTY_LOCAL: Local = { questions: {}, schemes: {} };

/** Stored working copies, as read by the persisted schema (optional fields may be undefined). */
const localOf = (stored: Pick<Work, "questions" | "schemes">): Local => ({
	questions: Object.fromEntries(
		stored.questions.map((q) => [q.id, compact(q) as Question]),
	),
	schemes: Object.fromEntries(
		stored.schemes.map((e) => [e.id, compact(e) as SchemeEntry]),
	),
});

/**
 * GitHub as last loaded or saved, by path, split by kind for the same reason: a
 * question saved or reloaded must not replace the scheme slice.
 */
export interface Remote {
	readonly questions: Readonly<Record<Path, Blob>>;
	readonly schemes: Readonly<Record<Path, Blob>>;
}

export type Screen =
	| { readonly kind: "blank" }
	| { readonly kind: "editing"; readonly id: Id }
	/**
	 * Another author's version of a file, from a link: read only, never adopted or
	 * edited (owner, 2026-09-25); `file` is absent while it loads.
	 */
	| {
			readonly kind: "foreign";
			readonly branch: string;
			readonly path: Path;
			readonly file?: File;
			/** That branch's scheme files: their question reads against these, never the viewer's. */
			readonly schemes?: Remote["schemes"];
	  };

/** The bank browser beside the open question. Effective expansion is derived in tree.ts. */
export interface Browser {
	readonly filter: string;
	/** Folders the user opened. A folder holding the open question, or any folder while filtering, is open regardless. */
	readonly expanded: readonly string[];
	readonly confirmDelete?: Id;
	/** The save dialog for a draft: which question, and the folder being chosen. */
	readonly saving?: { readonly id: Id; readonly folder: string };
	/** The move dialog for a bank question: which one, and the folder being chosen. */
	readonly moving?: { readonly id: Id; readonly folder: string };
	/**
	 * The name dialog: a new scale, universe or instruction is named before it exists
	 * (with its text, for a universe or instruction), optionally to be used at once by
	 * the question it was asked from; or a draft shared file is renamed.
	 */
	readonly naming?: Naming;
	/**
	 * Signing out with unsaved work: asking what to do with it, or saving it first. A
	 * failed save comes back here, never on a file.
	 */
	readonly signingOut?: {
		readonly phase: "asking" | "saving";
		readonly failure?: Failure;
	};
}

export type Session =
	| { readonly kind: "anonymous" }
	/** `toGitHub`: the page is leaving for GitHub's sign-in page, which is not losing work. */
	| { readonly kind: "connecting"; readonly toGitHub?: true }
	| {
			readonly kind: "connected";
			readonly login: string;
			readonly avatarUrl: string;
			readonly access: Access;
			/** The bank: the repository's default branch, which only pull requests change. */
			readonly defaultBranch: string;
	  }
	| { readonly kind: "failed"; readonly failure: Failure };

export type Bank =
	| { readonly kind: "bundled" }
	| { readonly kind: "loading" }
	/** Connected, but the bank did not load: said in the top bar, with a retry. */
	| { readonly kind: "failed"; readonly failure: Failure }
	| {
			readonly kind: "loaded";
			/** Whether the author's branch exists yet, or the bank was read instead. */
			readonly from: "branch" | "default";
			/** The author's branch has commits the bank does not: something to propose. */
			readonly proposable: boolean;
			/** Commits on the bank not in the author's branch, as GitHub counted them. */
			readonly behindBy: number;
	  };

/** The official DDI schema is 900KB and loads lazily. The compiled validator lives in the shell. */
export type DdiSchema =
	| { readonly kind: "loading" }
	| { readonly kind: "ready" }
	| { readonly kind: "failed"; readonly finding: Finding };

export interface Model {
	readonly local: Local;
	/**
	 * The author's branch as last loaded or saved (before its first save, the bank's
	 * default branch, which it will be created from): bases, sync states, conflicts and
	 * commits are against it. Before this session's load it is only "last known, as of
	 * each base", so writing waits for the load.
	 */
	readonly remote: Remote;
	/**
	 * Where the caret is, for the inspector. Plain data, never persisted; ignored when
	 * it belongs to another file, and clamped where used (a reload may shorten the text).
	 */
	readonly cursor?: { readonly id: Id; readonly offset: number };
	/** A link that needs the bank (or another branch) before it can open. Never persisted. */
	readonly pendingLink?: Link;
	/**
	 * Whose work `local` is: the login that last signed in with it in this tab. Its bank
	 * is `settings`'. Absent before anyone has.
	 */
	readonly author?: string;
	/** Per file; content never carries it, so marking a scale "saving" leaves the environment alone. */
	readonly activity: Readonly<Record<Id, Activity>>;
	readonly nextId: Id;
	readonly screen: Screen;
	readonly browser: Browser;
	readonly session: Session;
	readonly settings: BankSettings;
	readonly loading: Bank;
	readonly failures: readonly Failure[];
	readonly agency: string;
	readonly ddiSchema: DdiSchema;
	/** Light or dark as chosen on this device, or the system's (until the toggle is used). */
	readonly theme: ThemeChoice;
}

export type ThemeChoice = "system" | "light" | "dark";

export interface Naming {
	readonly kind: NamedScheme;
	readonly name: string;
	/** A universe's or instruction's wording; unused for a scale. */
	readonly text: string;
	readonly purpose:
		| {
				readonly kind: "create";
				/** The question that named it, and where: that reference is rewritten to the name chosen. */
				readonly use?: { readonly id: Id; readonly path: string };
		  }
		| { readonly kind: "rename"; readonly id: Id };
}

export type Msg =
	| { readonly kind: "edited"; readonly text: string }
	/** The theme toggle: the theme to show, named by the view (which knows the system's). */
	| { readonly kind: "themeChosen"; readonly theme: ThemeChoice }
	/** A finding's quick fix, clicked: edits in the document's terms, applied to the text as it is now. */
	| { readonly kind: "fixApplied"; readonly id: Id; readonly fix: Fix }
	| { readonly kind: "locationClicked"; readonly target: Target }
	| { readonly kind: "cursorMoved"; readonly offset: number }
	/** The browser's address changed (a pasted link, Back, Forward); read when handled. */
	| { readonly kind: "hashChanged"; readonly hash: string }
	| {
			readonly kind: "foreignLoaded";
			readonly branch: string;
			readonly path: Path;
			readonly result: Result<
				{ readonly file: File; readonly schemes: readonly File[] },
				Failure
			>;
	  }
	| { readonly kind: "ddiSchemaLoaded"; readonly result: DdiSchema }
	| { readonly kind: "listOpened" }
	| { readonly kind: "fileOpened"; readonly id: Id }
	| {
			readonly kind: "filterChanged";
			readonly text: string;
	  }
	| { readonly kind: "folderToggled"; readonly folder: string }
	| { readonly kind: "questionCreated"; readonly text: string }
	/** New scheme file: `missing` is created at once (it has one name); the others ask for a name. */
	| {
			readonly kind: "schemeCreateOpened";
			readonly scheme: SchemeKind;
			/** Prefilled, as when the inspector offers to create a name a question already uses. */
			readonly name?: string;
			/** The question and place that named it, to be pointed at the name chosen. */
			readonly use?: { readonly id: Id; readonly path: string };
	  }
	/** Rename a shared file that has never been saved: nothing on GitHub depends on its name. */
	| { readonly kind: "schemeRenameOpened"; readonly id: Id }
	| { readonly kind: "schemeNameChanged"; readonly name: string }
	| { readonly kind: "schemeTextChanged"; readonly text: string }
	| { readonly kind: "schemeNamingConfirmed" }
	| { readonly kind: "schemeNamingCancelled" }
	| { readonly kind: "deleteRequested"; readonly id: Id }
	| { readonly kind: "deleteCancelled" }
	| { readonly kind: "saveRequested"; readonly id: Id }
	| { readonly kind: "saveFolderChanged"; readonly folder: string }
	| { readonly kind: "saveConfirmed" }
	| { readonly kind: "saveCancelled" }
	| {
			readonly kind: "moveRequested";
			readonly id: Id;
			readonly folder?: string;
	  }
	| { readonly kind: "moveFolderChanged"; readonly folder: string }
	| { readonly kind: "moveConfirmed" }
	| { readonly kind: "moveCancelled" }
	/** A change set's commit came back; the changes are echoed, so nothing is looked up by path. */
	| {
			readonly kind: "committed";
			readonly changes: readonly Change[];
			readonly result: Result<Committed, CommitFailure>;
	  }
	| { readonly kind: "reloadRequested"; readonly id: Id }
	| {
			readonly kind: "fileReloaded";
			readonly id: Id;
			readonly result: Result<File, Failure>;
	  }
	| { readonly kind: "connectRequested"; readonly settings: BankSettings }
	/** Sign in with GitHub: the settings are kept, then the page leaves for GitHub. */
	| { readonly kind: "signInRequested"; readonly settings: BankSettings }
	| {
			readonly kind: "connected";
			readonly result: Result<Who, Failure>;
	  }
	| {
			readonly kind: "bankLoaded";
			readonly result: Result<Loaded, Failure>;
	  }
	/** Read the bank again, as the same session: a retry after a failed load. */
	| { readonly kind: "bankReloadRequested" }
	/** Sign out now, keeping only the author's own work (a failed session's way out). */
	| { readonly kind: "disconnected" }
	/** "Sign out" from the account menu: asks first when there is unsaved work. */
	| { readonly kind: "signOutRequested" }
	| { readonly kind: "signOutSaveConfirmed" }
	| { readonly kind: "signOutDiscardConfirmed" }
	| { readonly kind: "signOutCancelled" }
	| { readonly kind: "failureDismissed"; readonly index: number };

export type Cmd =
	| { readonly kind: "revealRange"; readonly range: Range }
	| { readonly kind: "loadDdiSchema" }
	/** This tab's work, kept for a reload of this tab only. */
	| { readonly kind: "persist"; readonly work: Work }
	/** The bank and "remember", a default for the next new tab. */
	| { readonly kind: "saveSettings"; readonly settings: BankSettings }
	/** Show the page in this theme, and remember it on this device ("system" forgets). */
	| { readonly kind: "applyTheme"; readonly theme: ThemeChoice }
	/** Work leaving this tab (someone else's, or another bank's): kept in the browser, never dropped. */
	| { readonly kind: "setAside"; readonly work: Work }
	| { readonly kind: "connect"; readonly repo: Repo }
	| { readonly kind: "loadBank"; readonly target: BranchTarget }
	| {
			readonly kind: "readFile";
			readonly id: Id;
			readonly target: BranchTarget;
			readonly path: string;
	  }
	/** Every save and delete: one commit of a change set on the author's branch. */
	| {
			readonly kind: "commit";
			readonly target: BranchTarget;
			readonly changes: readonly Change[];
			readonly message: string;
	  }
	| { readonly kind: "forgetToken" }
	/** Leave for GitHub's sign-in page; the credentials come back to the effects, never here. */
	| { readonly kind: "signIn"; readonly remember: boolean }
	/** Put a link in the address bar: a new history entry, or in place. */
	| { readonly kind: "setLink"; readonly hash: string; readonly push: boolean }
	/** Read one file from another author's branch, for a link. */
	| {
			readonly kind: "readAt";
			readonly target: BranchTarget;
			readonly path: Path;
	  };

export type Dispatch = (msg: Msg) => void;

/**
 * Starting points for a new question, one per response domain. They are named for
 * the shape they show, not for any question in the bank: a template must not
 * arrive carrying a real variable name, which would collide with the bank's copy.
 * Every required field is left empty, so a new question opens as a list of holes.
 */
export const TEMPLATES: ReadonlyArray<{
	readonly label: string;
	readonly text: string;
}> = [
	{ label: "Single choice", text: choiceTemplate },
	{ label: "Using a shared scale", text: scaleTemplate },
	{ label: "Number", text: numberTemplate },
	{ label: "Select all that apply", text: selectManyTemplate },
];

/**
 * What a new scheme file starts as: every value empty, so it opens as holes. The
 * missing template shows the shape codes take (quoted, since `-8` is not a key YAML keeps as text).
 */
export const SCHEME_TEMPLATES: Readonly<Record<SchemeKind, string>> = {
	concept: "label:\n",
	unit: "label:\n",
	scale: "labels:\n  1:\n  2:\n",
	universe: "text:\n",
	instruction: "text:\n",
	missing: 'labels:\n  "-8":\n',
};

/** The DDI agency identifier for this bank: Johns Hopkins 21st Century Cities. A constant for now; see FEATURES.md, "Generality". */
const AGENCY = "edu.jhu.21cc";

const SCALE_FILES = import.meta.glob("../examples/scales/*.yaml", {
	query: "?raw",
	import: "default",
	eager: true,
}) as Readonly<Record<string, string>>;

/** Bundled example scales, named by file. A malformed example is a bug, not a user error, so it is simply absent. */
const EXAMPLE_SCALES: Scales = Object.fromEntries(
	Object.entries(SCALE_FILES).flatMap(([path, text]) => {
		const name = path.replace(/^.*\//, "").replace(/\.yaml$/, "");
		const { scale } = parseScale(text);
		return scale === undefined ? [] : [[name, scale]];
	}),
);

export interface Flags {
	/** The theme chosen on this device, as stored; absent means the system's. */
	readonly theme?: ThemeChoice;
	/** This tab's work, already validated by the shell; a failure is shown, never fatal. */
	readonly work: Result<Work | undefined, Failure>;
	/** The bank settings stored on this device; the work's own bank wins over them. */
	readonly settings?: BankSettings;
	/** The build's default bank, used when nothing is stored; absent means an empty field. */
	readonly defaultBank?: Repo;
	/** Said once at startup (what an upgrade could not bring along). */
	readonly notices?: readonly Failure[];
	/** Whether a token is on hand, so connecting can start at once. */
	readonly hasToken: boolean;
	/**
	 * A return from GitHub that was refused (a stale or replayed callback, a cancel). Only
	 * a message: it never touches the session or credentials already held, since Back
	 * through GitHub's redirect replays a callback after a successful sign-in.
	 */
	readonly signInFailure?: Failure;
}

export const EMPTY_REMOTE: Remote = { questions: {}, schemes: {} };

export function init(flags: Flags): readonly [Model, readonly Cmd[]] {
	const stored = flags.work.ok ? flags.work.value : undefined;
	// First run: an empty list. A template is one click away; seeded example drafts
	// would sit beside bank questions of the same name.
	// Zod types an absent optional as possibly-undefined; `compact` makes it absent.
	const local: Local = stored ? localOf(stored) : EMPTY_LOCAL;
	const settings = startingSettings(flags.settings, stored, {
		...(flags.defaultBank ?? { owner: "", repo: "" }),
		remember: false,
	});
	const repo = { owner: settings.owner, repo: settings.repo };
	const opened: Model = {
		local,
		...(stored?.login !== undefined && { author: stored.login }),
		// The last GitHub state this browser knew is exactly what its bases record.
		remote: remoteOfBases(local),
		activity: {},
		nextId: stored?.nextId ?? 1,
		screen: { kind: "blank" },
		browser: { filter: "", expanded: [] },
		session: flags.hasToken ? { kind: "connecting" } : { kind: "anonymous" },
		settings,
		loading: { kind: "bundled" },
		failures: [
			...(flags.work.ok ? [] : [flags.work.error]),
			...(flags.notices ?? []),
			...(flags.signInFailure === undefined ? [] : [flags.signInFailure]),
		],
		agency: AGENCY,
		ddiSchema: { kind: "loading" },
		theme: flags.theme ?? "system",
	};
	// Without a sign-in, nothing of the bank stays: only the author's own work.
	const model = flags.hasToken ? opened : signedOut(opened);
	return [
		model,
		[
			{ kind: "loadDdiSchema" },
			...(flags.hasToken
				? [{ kind: "connect", repo } as const]
				: model.local !== opened.local
					? [{ kind: "persist", work: toWork(model) } as const]
					: []),
		],
	];
}

/** A file that is the author's own work: never saved, or changed since. */
export const ownWork = (f: Entry): boolean =>
	f.base === undefined || f.source !== f.base.text;

/** Whether this tab holds work that is nowhere else: closing it would lose it. */
export const hasOwnWork = (model: Model): boolean =>
	allFiles(model.local).some(ownWork);

/**
 * Whether leaving the page should ask first: there is unsaved work, which lives only in
 * this tab, and the page is not simply going to GitHub's sign-in page and back.
 */
export const warnOnLeave = (model: Model): boolean =>
	hasOwnWork(model) &&
	!(model.session.kind === "connecting" && model.session.toGitHub === true);

/**
 * Signed out, the app holds only the author's own work: drafts and unsaved edits,
 * kept for the next sign-in and hidden until then. Clean copies of the bank's files
 * are forgotten (the bank may be private; signing in reloads them), and so is
 * everything that could point at one. The session is the caller's to set.
 */
export function signedOut(model: Model): Model {
	const keep = <F extends Entry>(files: Readonly<Record<Id, F>>) =>
		Object.values(files).every(ownWork)
			? files
			: Object.fromEntries(
					Object.values(files)
						.filter(ownWork)
						.map((f) => [f.id, f]),
				);
	const questions = keep(model.local.questions);
	const schemes = keep(model.local.schemes);
	const local =
		questions === model.local.questions && schemes === model.local.schemes
			? model.local
			: { questions, schemes };
	return compact({
		...model,
		local,
		remote: remoteOfBases(local),
		activity: {},
		loading: { kind: "bundled" } as const,
		screen: { kind: "blank" } as const,
		cursor: undefined,
		pendingLink: undefined,
		browser: {
			filter: model.browser.filter,
			expanded: model.browser.expanded,
		},
	});
}

export function remoteOfBases(local: Local): Remote {
	const blobs = (files: readonly Entry[]): Record<Path, Blob> =>
		Object.fromEntries(
			files.flatMap((f) =>
				f.base === undefined
					? []
					: [[f.base.path, { sha: f.base.sha, text: f.base.text }]],
			),
		);
	return {
		questions: blobs(Object.values(local.questions)),
		schemes: blobs(Object.values(local.schemes)),
	};
}

export const isScheme = (e: Entry): e is SchemeEntry => e.kind !== "question";

/** A working file by id, whichever slice holds it. */
export const fileOf = (model: Model, id: Id): Entry | undefined =>
	model.local.questions[id] ?? model.local.schemes[id];

export const allFiles = (local: Local): readonly Entry[] => [
	...Object.values(local.questions),
	...Object.values(local.schemes),
];

/**
 * The environment built from the working scheme files: what questions are shown
 * against, so a scale edit updates its questions live and a new universe is usable at
 * once (owner, step 9). While no bank is known (`remote.schemes` empty), the bundled
 * example scales stand in beneath any local ones, so a first local scale does not
 * turn every question on an example scale into a hole.
 */
export function envOf(
	schemes: Local["schemes"],
	remoteSchemes: Remote["schemes"],
): Env {
	const env = schemeEnv(
		Object.values(schemes).map((e) => ({
			kind: e.kind,
			name: e.name,
			text: e.source,
		})),
	);
	return Object.keys(remoteSchemes).length === 0
		? { ...env, scales: { ...EXAMPLE_SCALES, ...env.scales } }
		: env;
}

/** The environment of a branch as GitHub has it: for reading another author's version. */
export function envOfRemote(schemes: Remote["schemes"]): Env {
	return schemeEnv(
		Object.entries(schemes).flatMap(([path, blob]) => {
			const at = kindAt(path);
			return at === undefined || at.kind === "question"
				? []
				: [{ kind: at.kind, name: at.name, text: blob.text }];
		}),
	);
}

export const toWork = (model: Model): Work => ({
	version: 5,
	repo: `${model.settings.owner}/${model.settings.repo}`,
	...(model.author !== undefined && { login: model.author }),
	nextId: model.nextId,
	questions: Object.values(model.local.questions),
	schemes: Object.values(model.local.schemes),
});

/** Whether a login is someone other than the author of the work in hand. GitHub's names ignore case. */
export const otherAuthor = (model: Model, login: string): boolean =>
	model.author !== undefined && !sameName(model.author, login);

/** Whether a bank is another than the one the work in hand belongs to. */
export const otherBank = (model: Model, settings: BankSettings): boolean =>
	!sameName(
		`${model.settings.owner}/${model.settings.repo}`,
		`${settings.owner}/${settings.repo}`,
	);
