/**
 * The Elm Architecture, by hand. The Model is everything the app knows; a Msg is
 * everything that can happen; a Cmd is an effect described as data.
 *
 * Model, Msg and Cmd are plain data: no functions, no DOM nodes, no token, nothing
 * that cannot be logged, compared, or serialised. Nothing derived is stored: whether
 * a question is unsaved follows from its text and origin; what a question shows
 * follows from its text.
 */
import type { Finding, Range, Target } from "../core/findings.js";
import type { Result } from "../core/result.js";
import { EMPTY_ENV, type Env } from "../core/surface/env.js";
import { parseScale, type Scales } from "../core/surface/scales.js";
import choiceTemplate from "../templates/choice.yaml?raw";
import numberTemplate from "../templates/number.yaml?raw";
import scaleTemplate from "../templates/scale.yaml?raw";
import selectManyTemplate from "../templates/select-many.yaml?raw";
import type { Persisted } from "./persist.js";
import type { BankSettings, Failure, File } from "./storage.js";

export type Id = number;

export type Origin =
	| { readonly kind: "draft" }
	| {
			readonly kind: "bank";
			readonly path: string;
			readonly sha: string;
			readonly original: string;
	  };

export type Activity =
	| { readonly kind: "idle" }
	| { readonly kind: "saving" }
	| { readonly kind: "deleting" }
	| { readonly kind: "failed"; readonly failure: Failure };

export interface Question {
	readonly id: Id;
	readonly source: string;
	readonly origin: Origin;
	readonly activity: Activity;
}

export type Screen =
	| { readonly kind: "blank" }
	| { readonly kind: "editing"; readonly id: Id };

/** The bank browser beside the open question. Effective expansion is derived in tree.ts. */
export interface Browser {
	readonly filter: string;
	/** Folders the user opened. A folder holding the open question, or any folder while filtering, is open regardless. */
	readonly expanded: readonly string[];
	readonly confirmDelete?: Id;
	/** The bank settings dialog. */
	readonly settingsOpen: boolean;
	/** The save dialog for a draft: which question, and the topic folder being chosen. */
	readonly saving?: { readonly id: Id; readonly folder: string };
}

export type Session =
	| { readonly kind: "anonymous" }
	| { readonly kind: "connecting" }
	| {
			readonly kind: "connected";
			readonly login: string;
			readonly canWrite: boolean;
	  }
	| { readonly kind: "failed"; readonly failure: Failure };

export type Bank =
	| { readonly kind: "bundled" }
	| { readonly kind: "loading" }
	| {
			readonly kind: "loaded";
			readonly scaleFindings: readonly {
				readonly name: string;
				readonly findings: readonly Finding[];
			}[];
	  };

/** The official DDI schema is 900KB and loads lazily. The compiled validator lives in the shell. */
export type DdiSchema =
	| { readonly kind: "loading" }
	| { readonly kind: "ready" }
	| { readonly kind: "failed"; readonly finding: Finding };

export interface Model {
	readonly questions: Readonly<Record<Id, Question>>;
	readonly nextId: Id;
	readonly screen: Screen;
	readonly browser: Browser;
	readonly session: Session;
	readonly settings: BankSettings;
	readonly bank: Bank;
	readonly scales: Scales;
	readonly failures: readonly Failure[];
	readonly agency: string;
	readonly ddiSchema: DdiSchema;
}

export type Msg =
	| { readonly kind: "edited"; readonly text: string }
	| { readonly kind: "locationClicked"; readonly target: Target }
	| { readonly kind: "ddiSchemaLoaded"; readonly result: DdiSchema }
	| { readonly kind: "listOpened" }
	| { readonly kind: "questionOpened"; readonly id: Id }
	| {
			readonly kind: "filterChanged";
			readonly text: string;
	  }
	| { readonly kind: "folderToggled"; readonly folder: string }
	| { readonly kind: "settingsToggled"; readonly open: boolean }
	| { readonly kind: "questionCreated"; readonly text: string }
	| {
			readonly kind: "filesUploaded";
			readonly files: readonly {
				readonly name: string;
				readonly text: string;
			}[];
	  }
	| { readonly kind: "deleteRequested"; readonly id: Id }
	| { readonly kind: "deleteCancelled" }
	| { readonly kind: "saveRequested"; readonly id: Id }
	| { readonly kind: "saveFolderChanged"; readonly folder: string }
	| { readonly kind: "saveConfirmed" }
	| { readonly kind: "saveCancelled" }
	| {
			readonly kind: "saveFinished";
			readonly id: Id;
			readonly path: string;
			readonly text: string;
			readonly result: Result<{ readonly sha: string }, Failure>;
	  }
	| {
			readonly kind: "deleteFinished";
			readonly id: Id;
			readonly result: Result<void, Failure>;
	  }
	| { readonly kind: "reloadRequested"; readonly id: Id }
	| {
			readonly kind: "fileReloaded";
			readonly id: Id;
			readonly result: Result<File, Failure>;
	  }
	| {
			readonly kind: "downloadRequested";
			readonly id: Id;
			readonly format: "yaml" | "ddi";
	  }
	| { readonly kind: "connectRequested"; readonly settings: BankSettings }
	| {
			readonly kind: "connected";
			readonly result: Result<
				{ readonly login: string; readonly canWrite: boolean },
				Failure
			>;
	  }
	| {
			readonly kind: "bankLoaded";
			readonly result: Result<
				{
					readonly questions: readonly File[];
					readonly scales: readonly File[];
				},
				Failure
			>;
	  }
	| { readonly kind: "disconnected" }
	| { readonly kind: "failureDismissed"; readonly index: number };

export type Cmd =
	| { readonly kind: "revealRange"; readonly range: Range }
	| { readonly kind: "loadDdiSchema" }
	| { readonly kind: "persist"; readonly data: Persisted }
	| { readonly kind: "connect"; readonly settings: BankSettings }
	| { readonly kind: "loadBank"; readonly settings: BankSettings }
	| {
			readonly kind: "readFile";
			readonly id: Id;
			readonly settings: BankSettings;
			readonly path: string;
	  }
	| {
			readonly kind: "writeFile";
			readonly id: Id;
			readonly settings: BankSettings;
			readonly path: string;
			readonly text: string;
			readonly sha?: string;
			readonly message: string;
	  }
	| {
			readonly kind: "deleteFile";
			readonly id: Id;
			readonly settings: BankSettings;
			readonly path: string;
			readonly sha: string;
			readonly message: string;
	  }
	| {
			readonly kind: "download";
			readonly filename: string;
			readonly text: string;
			readonly mime: string;
	  }
	| { readonly kind: "forgetToken" };

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
	{ label: "Shared scale", text: scaleTemplate },
	{ label: "Number", text: numberTemplate },
	{ label: "Select all that apply", text: selectManyTemplate },
];

/** The DDI agency identifier for this bank: Johns Hopkins 21st Century Cities. */
const AGENCY = "edu.jhu.21cc";

export const DEFAULT_SETTINGS: BankSettings = {
	owner: "JHUCities",
	repo: "bas-question-bank",
	branch: "main",
	remember: false,
};

const SCALE_FILES = import.meta.glob("../examples/scales/*.yaml", {
	query: "?raw",
	import: "default",
	eager: true,
}) as Readonly<Record<string, string>>;

/** Bundled example scales, named by file. A malformed example is a bug, not a user error, so it is simply absent. */
export const EXAMPLE_SCALES: Scales = Object.fromEntries(
	Object.entries(SCALE_FILES).flatMap(([path, text]) => {
		const name = path.replace(/^.*\//, "").replace(/\.yaml$/, "");
		const { scale } = parseScale(text);
		return scale === undefined ? [] : [[name, scale]];
	}),
);

export interface Flags {
	/** What the browser had saved, already validated by the shell; a failure is shown, never fatal. */
	readonly stored: Result<Persisted | undefined, Failure>;
	/** Whether a token is on hand, so connecting can start at once. */
	readonly hasToken: boolean;
}

export function init(flags: Flags): readonly [Model, readonly Cmd[]] {
	const stored = flags.stored.ok ? flags.stored.value : undefined;
	const { questions, nextId } = stored
		? {
				questions: Object.fromEntries(
					stored.questions.map((q) => [
						q.id,
						{ ...q, activity: { kind: "idle" } as const },
					]),
				),
				nextId: stored.nextId,
			}
		: // First run: an empty list. "New question" and "New from <example>" are one click
			// away; seeded example drafts would sit beside bank questions of the same name.
			{ questions: {}, nextId: 1 };
	const settings = stored?.settings ?? DEFAULT_SETTINGS;
	const model: Model = {
		questions,
		nextId,
		screen: { kind: "blank" },
		browser: { filter: "", expanded: [], settingsOpen: false },
		session: flags.hasToken ? { kind: "connecting" } : { kind: "anonymous" },
		settings,
		bank: { kind: "bundled" },
		scales: EXAMPLE_SCALES,
		failures: flags.stored.ok ? [] : [flags.stored.error],
		agency: AGENCY,
		ddiSchema: { kind: "loading" },
	};
	return [
		model,
		[
			{ kind: "loadDdiSchema" },
			...(flags.hasToken ? [{ kind: "connect", settings } as const] : []),
		],
	];
}

/** The environment questions are read against. Until the schemes live in the Model, only scales are populated. */
export const envOf = (model: Pick<Model, "scales">): Env => ({
	...EMPTY_ENV,
	scales: model.scales,
});

export const toPersisted = (model: Model): Persisted => ({
	version: 1,
	nextId: model.nextId,
	questions: Object.values(model.questions).map(({ id, source, origin }) => ({
		id,
		source,
		origin,
	})),
	settings: model.settings,
});
