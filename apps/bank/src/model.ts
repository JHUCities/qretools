/**
 * The Elm Architecture, by hand. The Model is everything the app knows; a Msg is
 * everything that can happen; a Cmd is an effect described as data.
 *
 * Model, Msg and Cmd are plain data: no functions, no DOM nodes, no token, nothing
 * that cannot be logged, compared, or serialised. Nothing derived is stored: whether
 * a question is unsaved follows from its text and origin; what a question shows
 * follows from its text.
 */
import {
	type Address,
	type AddressKey,
	bankAt,
	bankEnv,
	compact,
	type Env,
	type Fix,
	type NamedScheme,
	parseScale,
	type Range,
	type RemoteBank,
	type Result,
	type Scales,
	type SchemeKind,
	schemeEnv,
	type Target,
} from "@qretools/core";
import agree4 from "@qretools/core/starter/scales/agree4.yaml?raw";
import satisfied5 from "@qretools/core/starter/scales/satisfied5.yaml?raw";
import choiceTemplate from "@qretools/core/templates/choice.yaml?raw";
import instrumentTemplate from "@qretools/core/templates/instrument/instrument.yaml?raw";
import numberTemplate from "@qretools/core/templates/number.yaml?raw";
import scaleTemplate from "@qretools/core/templates/scale.yaml?raw";
import selectManyTemplate from "@qretools/core/templates/select-many.yaml?raw";
import bankTemplate from "@qretools/core/templates/settings/bank.yaml?raw";
import workspaceTemplate from "@qretools/core/templates/settings/workspace.yaml?raw";
import type {
	Access,
	BankRef,
	BankSettings,
	BranchTarget,
	Change,
	CommitFailure,
	Committed,
	Failure,
	File,
	Link,
	LoadedWorkspace,
	TaggedBank,
	Updated,
	Who,
} from "@qretools/shell";
import { bankText, sameBank } from "@qretools/shell";
import type { DdiSchema } from "@qretools/shell/ui";
import { startingSettings, type Work } from "./persist.js";

export type Id = number;

/**
 * A path in the workspace (the settings' folder of the repository): GitHub's identity
 * for a file, as the store reads and writes it. Built and split only by the core's
 * `inBank` and `relIn`.
 */
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
	/** The bank it belongs to: its folder in the workspace, "" for the root. A draft's too. */
	readonly bank: string;
	readonly source: string;
	readonly base?: Base;
}

/** A scheme file: its name is its filename, chosen when it is created and never a hole. */
export interface SchemeEntry {
	readonly kind: SchemeKind;
	readonly name: string;
	readonly id: Id;
	/** The bank it belongs to: its folder in the workspace, "" for the root. */
	readonly bank: string;
	readonly source: string;
	readonly base?: Base;
}

/** An instrument of the workspace: its name is its filename, chosen when it is created. */
export interface InstrumentEntry {
	readonly kind: "instrument";
	readonly name: string;
	readonly id: Id;
	readonly source: string;
	readonly base?: Base;
}

/** The workspace's own file, `workspace.yaml`: one per workspace, as `bank.yaml` is per bank. */
export interface WorkspaceFileEntry {
	readonly kind: "workspaceFile";
	readonly id: Id;
	readonly source: string;
	readonly base?: Base;
}

/** A file of the workspace itself, in no bank. */
export type WorkspaceEntry = InstrumentEntry | WorkspaceFileEntry;

/** A file of one of the workspace's banks. */
export type BankEntry = Question | SchemeEntry;

/** Everything the browser holds. */
export type Entry = BankEntry | WorkspaceEntry;

export const isBankEntry = (e: Entry): e is BankEntry =>
	e.kind !== "instrument" && e.kind !== "workspaceFile";

/**
 * The working copies, split by kind. The split is structural, not cosmetic: the
 * local environment is built from `schemes` alone, so editing a question, which
 * replaces only `questions`, can never change it.
 */
export interface Local {
	readonly questions: Readonly<Record<Id, Question>>;
	readonly schemes: Readonly<Record<Id, SchemeEntry>>;
	/**
	 * The workspace's own files, apart from every bank's: an instrument keystroke
	 * replaces only this slice, so no bank's environment can change with it.
	 */
	readonly workspace: Readonly<Record<Id, WorkspaceEntry>>;
}

export const sameName = (a: string, b: string): boolean =>
	a.toLowerCase() === b.toLowerCase();

export const EMPTY_LOCAL: Local = { questions: {}, schemes: {}, workspace: {} };

/** Stored working copies, as read by the persisted schema (optional fields may be undefined). */
const localOf = (
	stored: Pick<Work, "questions" | "schemes" | "workspace">,
): Local => ({
	questions: Object.fromEntries(
		stored.questions.map((q) => [q.id, compact(q) as Question]),
	),
	workspace: Object.fromEntries(
		stored.workspace.map((e) => [e.id, compact(e) as WorkspaceEntry]),
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
	/** The workspace's own files: its instruments and `workspace.yaml`. */
	readonly workspace: Readonly<Record<Path, Blob>>;
}

export interface AddingBank {
	readonly how: "new" | "import";
	readonly text: string;
	readonly use?: { readonly id: Id; readonly path: string };
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
	 * A bank being added: a new one in this workspace, its folder named (`banks/<text>`),
	 * or one on GitHub, its address given. From an instrument's `uses` entry, `use` is
	 * where its address is written once it's added.
	 */
	readonly addingBank?: AddingBank;
	/** A new instrument is named before it exists, as a shared file is: its name is its file's. */
	readonly namingInstrument?: {
		readonly name: string;
		/** The example instrument, built for the bank it reads, rather than a blank one. */
		readonly example?: true;
	};
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

export interface Model {
	readonly local: Local;
	/**
	 * The workspace's bank folders ("" for its root), as last loaded, or as this tab's
	 * work names them before then: what a path is classified against (`placeOf`). Set
	 * wherever `remote` is replaced whole (at start, on a load, on signing out), never
	 * on its own, so the two can't disagree. Not derived from `remote`: a path is in
	 * `remote` only once a bank holds it.
	 */
	readonly banks: readonly string[];
	/**
	 * The banks in other repositories the workspace's instruments use, by address, as
	 * read at their tags this session: being read, or read (files, or why not). Absent
	 * means not asked for yet, which an instrument reads as pending. Never persisted, and
	 * forgotten on sign-out: such a bank may be private.
	 */
	readonly remoteBanks: Readonly<Record<AddressKey, RemoteRead>>;
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
	/**
	 * The default branch is being brought into the author's: from the request until the
	 * reload after it lands, so no save is checked against the branch as it was before.
	 */
	readonly updating?: true;
	readonly ddiSchema: DdiSchema;
	/** Light or dark as chosen on this device, or the system's (until the toggle is used). */
	readonly theme: ThemeChoice;
}

export type ThemeChoice = "system" | "light" | "dark";

export interface Naming {
	readonly kind: NamedScheme;
	readonly name: string;
	/** The bank the file is in or goes to, where its name must be free and is read. */
	readonly bank: string;
	/** A universe's or instruction's wording; unused for a scale. */
	readonly text: string;
	readonly purpose:
		| {
				readonly kind: "create";
				/** The question that named it, and where: that reference is rewritten to the name chosen. */
				readonly use?: { readonly id: Id; readonly path: string };
				/** A scale made from the question's own options there, which its name replaces. */
				readonly share?: true;
		  }
		| { readonly kind: "rename"; readonly id: Id };
}

export type Msg =
	| { readonly kind: "edited"; readonly text: string }
	/** The theme toggle: the theme to show, named by the view (which knows the system's). */
	| { readonly kind: "themeChosen"; readonly theme: ThemeChoice }
	/** A finding's quick fix, clicked: edits in the document's terms, applied to the text as it is now. */
	| { readonly kind: "fixApplied"; readonly id: Id; readonly fix: Fix }
	/**
	 * A livelit's picker, chosen from: the file, the livelit by its place (its id), and
	 * the value. `update` finds the livelit again in the text as it is now and writes there.
	 */
	| {
			readonly kind: "livelitChosen";
			readonly id: Id;
			readonly livelit: string;
			/** One value, or a set chosen together. */
			readonly value: string | readonly string[];
	  }
	| { readonly kind: "locationClicked"; readonly target: Target }
	| { readonly kind: "cursorMoved"; readonly offset: number }
	/** Go to definition (Mod-click or F12 on a shared name): open the file it names. */
	| {
			readonly kind: "definitionRequested";
			readonly id: Id;
			readonly offset: number;
	  }
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
	/** A new question; in `bank` when chosen (a workspace of several), else `newBank`'s. */
	| {
			readonly kind: "questionCreated";
			readonly text: string;
			readonly bank?: string;
	  }
	/** New scheme file: `missing` is created at once (it has one name); the others ask for a name. */
	| {
			readonly kind: "schemeCreateOpened";
			readonly scheme: SchemeKind;
			/** The bank it goes to, when chosen; else the naming question's, else `newBank`'s. */
			readonly bank?: string;
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
	/** New instrument: its name first, in its own dialog. */
	/** A new instrument: blank, or the example (`exampleInstrument`), named first. */
	| { readonly kind: "instrumentCreateOpened"; readonly example?: true }
	| { readonly kind: "instrumentNameChanged"; readonly name: string }
	| { readonly kind: "instrumentNamingCancelled" }
	| { readonly kind: "instrumentNamingConfirmed" }
	/** A bank to add: a new one here (from New or a `uses` entry), or one on GitHub (from one). */
	| { readonly kind: "bankAddOpened"; readonly how: "new" }
	| { readonly kind: "bankAddChanged"; readonly text: string }
	| { readonly kind: "bankAddCancelled" }
	| { readonly kind: "bankAddConfirmed" }
	/** The workspace details: opened if they exist, else started. One per workspace. */
	| { readonly kind: "workspaceDetailsOpened" }
	/** A read of a bank in another repository has started: now it is being read. */
	| { readonly kind: "remoteBankStarted"; readonly key: AddressKey }
	| {
			readonly kind: "remoteBankLoaded";
			readonly key: AddressKey;
			readonly result: Result<TaggedBank, Failure>;
	  }
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
	/** The whole workspace as GitHub has it: its banks, and (later) its instruments. */
	| {
			readonly kind: "workspaceLoaded";
			readonly result: Result<LoadedWorkspace, Failure>;
	  }
	/** Read the bank again, as the same session: a retry after a failed load. */
	| { readonly kind: "bankReloadRequested" }
	/** Bring the default branch's changes into the author's branch ("Update"). */
	| { readonly kind: "updateFromDefaultRequested" }
	| {
			readonly kind: "updatedFromDefault";
			readonly result: Result<Updated, Failure>;
	  }
	/** Sign out now, keeping only the author's own work (a failed session's way out). */
	| { readonly kind: "disconnected" }
	/** "Sign out" from the account menu: asks first when there is unsaved work. */
	| { readonly kind: "signOutRequested" }
	| { readonly kind: "signOutSaveConfirmed" }
	| { readonly kind: "signOutDiscardConfirmed" }
	| { readonly kind: "signOutCancelled" }
	| { readonly kind: "failureDismissed"; readonly index: number };

/** A bank in another repository, as an instrument's `uses` gives it. */
export type RemoteAddress = Extract<Address, { readonly kind: "remote" }>;

/** A bank in another repository, this session: being read, or read. */
export type RemoteRead = { readonly kind: "loading" } | RemoteBank;

export type Cmd =
	/** A page elsewhere (another repository's file on GitHub), in a new tab. */
	| { readonly kind: "openExternal"; readonly url: string }
	/**
	 * Read these banks in other repositories, each at its tag. While an address is being
	 * typed its read waits for a pause (`now` false), the latest batch replacing one not
	 * sent yet; an open reads at once.
	 */
	| {
			readonly kind: "loadRemoteBanks";
			readonly addresses: readonly RemoteAddress[];
			readonly now: boolean;
	  }
	| {
			readonly kind: "revealRange";
			readonly range: Range;
			/**
			 * The file it's in, when that file is only now opening: the reveal waits for its
			 * editor. Absent means the file the editor shows now.
			 */
			readonly id?: Id;
			/** Open completion there: the place is a value still to fill in. */
			readonly complete?: boolean;
	  }
	| { readonly kind: "loadDdiSchema" }
	/** This tab's work, kept for a reload of this tab only. */
	| { readonly kind: "persist"; readonly work: Work }
	/** The bank and "remember", a default for the next new tab. */
	| { readonly kind: "saveSettings"; readonly settings: BankSettings }
	/** Show the page in this theme, and remember it on this device ("system" forgets). */
	| { readonly kind: "applyTheme"; readonly theme: ThemeChoice }
	/** Work leaving this tab (someone else's, or another bank's): kept in the browser, never dropped. */
	| { readonly kind: "setAside"; readonly work: Work }
	| { readonly kind: "connect"; readonly repo: BankRef }
	/** Read every file of the workspace, from the author's branch or, before it exists, the bank's. */
	| { readonly kind: "loadWorkspace"; readonly target: BranchTarget }
	| { readonly kind: "updateFromDefault"; readonly target: BranchTarget }
	/** Take the link out of the address, adding no history entry and loading nothing. */
	| { readonly kind: "clearLink" }
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
	/**
	 * Read one file from another author's branch, for a link, with its bank's shared
	 * files: `target` is that bank (its folder in the repository), `rel` the file's path
	 * in it, and `path` its path in the workspace, echoed in the reply.
	 */
	| {
			readonly kind: "readAt";
			readonly target: BranchTarget;
			readonly path: Path;
			readonly rel: string;
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
 * What a new scheme file starts as: every value empty, so it opens as holes. Codes are
 * written quoted, as a bank writes them (a code is text).
 */
export const SCHEME_TEMPLATES: Readonly<Record<SchemeKind, string>> = {
	concept: "label:\n",
	unit: "label:\n",
	scale: 'labels:\n  "1":\n  "2":\n',
	universe: "text:\n",
	instruction: "text:\n",
	missing: 'labels:\n  "-8":\n',
	// Its settings, explained as the template repository explains them.
	bank: bankTemplate,
};

/**
 * What a new instrument starts as: the core's template, every field empty but its name,
 * which is its file's (chosen in the dialog).
 */
export const instrumentSource = (name: string): string =>
	instrumentTemplate.replace(/^name:[ \t]*$/m, `name: ${name}`);

/** What new workspace details start as: the agency, to fill in, explained. */
export const WORKSPACE_DETAILS_TEMPLATE = workspaceTemplate;

/** The core's starter scale files, keyed by file name, as a bank names a scale. */
const SCALE_FILES: Readonly<Record<string, string>> = { agree4, satisfied5 };

/** Bundled example scales, named by file. A malformed example is a bug, not a user error, so it is simply absent. */
export const EXAMPLE_SCALES: Scales = Object.fromEntries(
	Object.entries(SCALE_FILES).flatMap(([name, text]) => {
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
	readonly defaultBank?: BankRef;
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

export const EMPTY_REMOTE: Remote = {
	questions: {},
	schemes: {},
	workspace: {},
};

export function init(flags: Flags): readonly [Model, readonly Cmd[]] {
	const stored = flags.work.ok ? flags.work.value : undefined;
	// First run: an empty list. A template is one click away; seeded example drafts
	// would sit beside bank questions of the same name.
	// Zod types an absent optional as possibly-undefined; `compact` makes it absent.
	const local: Local = stored ? localOf(stored) : EMPTY_LOCAL;
	const settings = startingSettings(flags.settings, stored, {
		...(flags.defaultBank ?? { owner: "", repo: "", path: "" }),
		remember: false,
	});
	const repo = {
		owner: settings.owner,
		repo: settings.repo,
		path: settings.path,
	};
	const opened: Model = {
		local,
		banks: banksOfLocal(local),
		remoteBanks: {},
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
	const workspace = keep(model.local.workspace);
	const local =
		questions === model.local.questions &&
		schemes === model.local.schemes &&
		workspace === model.local.workspace
			? model.local
			: { questions, schemes, workspace };
	return compact({
		...model,
		local,
		banks: banksOfLocal(local),
		remoteBanks: {},
		remote: remoteOfBases(local),
		activity: {},
		loading: { kind: "bundled" } as const,
		screen: { kind: "blank" } as const,
		cursor: undefined,
		pendingLink: undefined,
		updating: undefined,
		browser: {
			filter: model.browser.filter,
			expanded: model.browser.expanded,
		},
	});
}

/** The banks the working copies belong to; the root alone while there are none. */
export function banksOfLocal(local: Local): readonly string[] {
	const banks = [
		...new Set(
			[...Object.values(local.questions), ...Object.values(local.schemes)].map(
				(f) => f.bank,
			),
		),
	].sort();
	return banks.length === 0 ? [""] : banks;
}

/**
 * The bank a new file goes to: the open file's, else the workspace's first. A choice of
 * bank, where there are several, comes with the workspace's tree.
 */
export function newBank(model: Model): string {
	const open =
		model.screen.kind === "editing"
			? bankFileOf(model, model.screen.id)
			: undefined;
	return open?.bank ?? model.banks[0] ?? "";
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
		workspace: blobs(Object.values(local.workspace)),
	};
}

export const isScheme = (e: Entry): e is SchemeEntry =>
	isBankEntry(e) && e.kind !== "question";

/** A working file by id, whichever slice holds it. */
export const fileOf = (model: Model, id: Id): Entry | undefined =>
	model.local.questions[id] ??
	model.local.schemes[id] ??
	model.local.workspace[id];

/** A working file of one of the banks by id: a question or a shared file. */
export const bankFileOf = (model: Model, id: Id): BankEntry | undefined =>
	model.local.questions[id] ?? model.local.schemes[id];

/** The shared file of this kind and name in a bank, among the working copies, if any. */
export const schemeFileNamed = (
	schemes: Readonly<Record<Id, SchemeEntry>>,
	kind: SchemeKind,
	name: string,
	bank: string,
): SchemeEntry | undefined =>
	Object.values(schemes).find(
		(e) => e.kind === kind && e.name === name && e.bank === bank,
	);

export const allFiles = (local: Local): readonly Entry[] => [
	...Object.values(local.questions),
	...Object.values(local.schemes),
	...Object.values(local.workspace),
];

/** A bank's own shared files among the working copies. */
export const schemesOf = (
	schemes: Local["schemes"],
	bank: string,
): readonly SchemeEntry[] =>
	Object.values(schemes).filter((e) => e.bank === bank);

/** Whether GitHub's copy holds any shared file of this bank yet. */
export const knownBank = (
	remoteSchemes: Remote["schemes"],
	bank: string,
	banks: readonly string[],
): boolean => Object.keys(remoteSchemes).some((p) => bankAt(p, banks) === bank);

/**
 * A bank's environment, built from its working scheme files: what its questions are
 * shown against, so a scale edit updates its questions live and a new universe is
 * usable at once (owner, step 9). Every bank has its own: one bank's names mean nothing
 * in another. While GitHub holds none of the bank's shared files (`known` false), the
 * bundled example scales stand in beneath any local ones, so a first local scale does
 * not turn every question on an example scale into a hole.
 */
export function envOf(schemes: readonly SchemeEntry[], known: boolean): Env {
	const env = schemeEnv(
		schemes.map((e) => ({ kind: e.kind, name: e.name, text: e.source })),
	);
	return known ? env : { ...env, scales: { ...EXAMPLE_SCALES, ...env.scales } };
}

/** The environment of one of the model's banks. */
export const envIn = (
	model: Pick<Model, "local" | "remote" | "banks">,
	bank: string,
): Env =>
	envOf(
		schemesOf(model.local.schemes, bank),
		knownBank(model.remote.schemes, bank, model.banks),
	);

/** The environment of a branch as GitHub has it: for reading another author's version. */
export const envOfRemote = (schemes: Remote["schemes"]): Env =>
	bankEnv(
		Object.fromEntries(
			Object.entries(schemes).map(([path, blob]) => [path, blob.text]),
		),
	);

export const toWork = (model: Model): Work => ({
	version: 7,
	repo: bankText(model.settings),
	...(model.author !== undefined && { login: model.author }),
	nextId: model.nextId,
	questions: Object.values(model.local.questions),
	schemes: Object.values(model.local.schemes),
	workspace: Object.values(model.local.workspace),
});

/** Whether a login is someone other than the author of the work in hand. GitHub's names ignore case. */
export const otherAuthor = (model: Model, login: string): boolean =>
	model.author !== undefined && !sameName(model.author, login);

/** Whether a bank is another than the one the work in hand belongs to (a folder of one repository is its own bank). */
export const otherBank = (model: Model, settings: BankSettings): boolean =>
	!sameBank(model.settings, settings);
