/**
 * The instrument app's Model, its messages and its commands: plain data, as the bank
 * app's are. No token, no DOM: the credentials live in the effects.
 *
 * A toy, read only: it signs in to a project (a repository folder holding
 * `instruments/` and `project.yaml`), reads them from the default branch, and lists
 * the instruments. Which one is open follows the address, as links do natively.
 */
import type { Range, Result, Target } from "@qretools/core";
import type {
	BankRef,
	BankSettings,
	BranchTarget,
	Failure,
	File,
	Link,
	Loaded,
	Who,
} from "@qretools/shell";

/** This app's keys in the browser's storage: its own, beside the bank app's. */
export const THEME_KEY = "qretools.instrument.theme";
export const SETTINGS_KEY = "qretools.instrument.settings";

export type ThemeChoice = "system" | "light" | "dark";

export type Session =
	| { readonly kind: "anonymous" }
	/** `toGitHub`: the page is leaving for GitHub's sign-in page. */
	| { readonly kind: "connecting"; readonly toGitHub?: true }
	| {
			readonly kind: "connected";
			readonly login: string;
			readonly avatarUrl: string;
			/** The project as published: the repository's default branch, the one read. */
			readonly defaultBranch: string;
	  }
	| { readonly kind: "failed"; readonly failure: Failure };

/** What a project load reads: its instruments' folder (null: none) and its own file (null: none). */
export interface ProjectFiles {
	readonly instruments: readonly File[] | null;
	readonly project: File | null;
}

export type Project =
	| { readonly kind: "idle" }
	| { readonly kind: "loading" }
	| { readonly kind: "failed"; readonly failure: Failure }
	| {
			readonly kind: "loaded";
			/** By path in the project (`instruments/x.yaml`), in name order. */
			readonly instruments: Readonly<Record<string, File>>;
			/** Whether the project has an instruments folder at all. */
			readonly hasFolder: boolean;
			readonly file?: File;
	  };

/** A bank an instrument uses, as read: its files, or why it couldn't be. */
export type BankLoad =
	| { readonly kind: "failed"; readonly failure: Failure }
	| {
			readonly kind: "loaded";
			readonly files: readonly File[];
			/** Whether its folder is there at all: one that isn't is no bank. */
			readonly found: boolean;
	  };

export interface Model {
	/** Which project, and whether to remember the sign-in on this device. */
	readonly settings: BankSettings;
	readonly session: Session;
	readonly project: Project;
	/** The open instrument's path, from the address. */
	readonly open?: string;
	/** The banks read so far, by `owner/repo/folder` (`bankText`), kept for the session. */
	readonly banks: Readonly<Record<string, BankLoad>>;
	/**
	 * Edits, by instrument path, kept in this tab only: the toy doesn't save, and the
	 * browser asks before a tab with edits closes.
	 */
	readonly working: Readonly<Record<string, string>>;
	/** A link that arrived before the project loaded: opened once it has. */
	readonly pendingLink?: Link;
	readonly theme: ThemeChoice;
	/** Said once and dismissed: what went wrong that isn't the session's or the project's. */
	readonly failures: readonly Failure[];
}

export type Msg =
	| { readonly kind: "signInRequested"; readonly settings: BankSettings }
	/** Signing in with a pasted token (development): the effects already hold it. */
	| { readonly kind: "connectRequested"; readonly settings: BankSettings }
	| { readonly kind: "connected"; readonly result: Result<Who, Failure> }
	| {
			readonly kind: "projectLoaded";
			readonly result: Result<ProjectFiles, Failure>;
	  }
	| { readonly kind: "projectReloadRequested" }
	/** The open instrument's text, as typed. */
	| { readonly kind: "edited"; readonly text: string }
	| {
			readonly kind: "bankLoaded";
			readonly key: string;
			readonly result: Result<Loaded, Failure>;
	  }
	/** Read a bank again that couldn't be read or wasn't there. */
	| { readonly kind: "bankRetried"; readonly key: string }
	/** A finding chosen: go to its place in the source. */
	| { readonly kind: "locationClicked"; readonly target: Target }
	| { readonly kind: "hashChanged"; readonly hash: string }
	| { readonly kind: "themeChosen"; readonly theme: ThemeChoice }
	| { readonly kind: "signOutRequested" }
	| { readonly kind: "failureDismissed"; readonly index: number };

export type Cmd =
	| { readonly kind: "signIn"; readonly remember: boolean }
	| { readonly kind: "connect"; readonly repo: BankRef }
	| { readonly kind: "loadProject"; readonly target: BranchTarget }
	/** Read these banks; the latest request replaces one not yet sent (typing an address). */
	| { readonly kind: "loadBanks"; readonly targets: readonly BranchTarget[] }
	| {
			readonly kind: "revealRange";
			readonly range: Range;
			readonly complete?: boolean;
	  }
	| { readonly kind: "saveSettings"; readonly settings: BankSettings }
	| { readonly kind: "applyTheme"; readonly theme: ThemeChoice }
	| { readonly kind: "forgetToken" };

export type Dispatch = (msg: Msg) => void;

export interface Flags {
	readonly settings?: BankSettings;
	readonly theme?: ThemeChoice;
	/** Whether a token is on hand, so signing in can start at once. */
	readonly hasToken: boolean;
	/** A return from GitHub that was refused: only a message, never the session's. */
	readonly signInFailure?: Failure;
}

export const NO_SETTINGS: BankSettings = {
	owner: "",
	repo: "",
	path: "",
	remember: false,
};

export function init(flags: Flags): readonly [Model, readonly Cmd[]] {
	const settings = flags.settings ?? NO_SETTINGS;
	const signingIn = flags.hasToken && settings.repo !== "";
	return [
		{
			settings,
			session: signingIn ? { kind: "connecting" } : { kind: "anonymous" },
			project: { kind: "idle" },
			banks: {},
			working: {},
			theme: flags.theme ?? "system",
			failures: flags.signInFailure === undefined ? [] : [flags.signInFailure],
		},
		signingIn ? [{ kind: "connect", repo: repoOf(settings) }] : [],
	];
}

export const repoOf = ({ owner, repo, path }: BankSettings): BankRef => ({
	owner,
	repo,
	path,
});

/**
 * Whether leaving the page would lose something: edits exist only in this tab. Not while
 * leaving for GitHub's sign-in, which comes back (and keeps no edits yet: signing in
 * starts from the project as read).
 */
export const warnOnLeave = (model: Model): boolean =>
	Object.keys(model.working).length > 0 &&
	!(model.session.kind === "connecting" && model.session.toGitHub === true);
