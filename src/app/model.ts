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
import type { Finding, Range, Target } from "../core/findings.js";
import type { Result } from "../core/result.js";
import { type SchemeKind, schemeEnv } from "../core/schemes.js";
import { EMPTY_ENV, type Env, type NamedScheme } from "../core/surface/env.js";
import { parseScale, type Scales } from "../core/surface/scales.js";
import choiceTemplate from "../templates/choice.yaml?raw";
import numberTemplate from "../templates/number.yaml?raw";
import scaleTemplate from "../templates/scale.yaml?raw";
import selectManyTemplate from "../templates/select-many.yaml?raw";
import type { Persisted } from "./persist.js";
import type { BankSettings, Failure, File } from "./storage.js";

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
	/** The name dialog for a new scale, universe or instruction: a scheme file is named before it exists. */
	readonly creating?: { readonly kind: NamedScheme; readonly name: string };
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
	| { readonly kind: "loaded" };

/** The official DDI schema is 900KB and loads lazily. The compiled validator lives in the shell. */
export type DdiSchema =
	| { readonly kind: "loading" }
	| { readonly kind: "ready" }
	| { readonly kind: "failed"; readonly finding: Finding };

export interface Model {
	readonly local: Local;
	/** The author's branch: bases, sync states, conflicts and commits are against it. */
	readonly remote: Remote;
	/**
	 * `main`, the bank itself: "not in the bank yet" is against it. The same object as
	 * `remote` while the author has no branch of their own (step 9d adds branches).
	 */
	readonly bank: Remote;
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
}

export type Msg =
	| { readonly kind: "edited"; readonly text: string }
	| { readonly kind: "locationClicked"; readonly target: Target }
	| { readonly kind: "ddiSchemaLoaded"; readonly result: DdiSchema }
	| { readonly kind: "listOpened" }
	| { readonly kind: "fileOpened"; readonly id: Id }
	| {
			readonly kind: "filterChanged";
			readonly text: string;
	  }
	| { readonly kind: "folderToggled"; readonly folder: string }
	| { readonly kind: "settingsToggled"; readonly open: boolean }
	| { readonly kind: "questionCreated"; readonly text: string }
	/** New scheme file: `missing` is created at once (it has one name); the others ask for a name. */
	| { readonly kind: "schemeCreateOpened"; readonly scheme: SchemeKind }
	| { readonly kind: "schemeNameChanged"; readonly name: string }
	| { readonly kind: "schemeCreateConfirmed" }
	| { readonly kind: "schemeCreateCancelled" }
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
			readonly result: Result<readonly File[], Failure>;
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

/**
 * What a new scheme file starts as: every value empty, so it opens as holes. The
 * missing template shows the shape codes take (quoted, since `-8` is not a key YAML keeps as text).
 */
export const SCHEME_TEMPLATES: Readonly<Record<SchemeKind, string>> = {
	scale: "labels:\n  1:\n  2:\n",
	universe: "text:\n",
	instruction: "text:\n",
	missing: 'labels:\n  "-8":\n',
};

/** The DDI agency identifier for this bank: Johns Hopkins 21st Century Cities. A constant for now; see FEATURES.md, "Generality". */
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
const EXAMPLE_SCALES: Scales = Object.fromEntries(
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

export const EMPTY_REMOTE: Remote = { questions: {}, schemes: {} };

export function init(flags: Flags): readonly [Model, readonly Cmd[]] {
	const stored = flags.stored.ok ? flags.stored.value : undefined;
	// First run: an empty list. A template is one click away; seeded example drafts
	// would sit beside bank questions of the same name.
	// Zod types an absent optional as possibly-undefined; `compact` makes it absent.
	const local: Local = stored
		? {
				questions: Object.fromEntries(
					stored.questions.map((q) => [q.id, compact(q) as Question]),
				),
				schemes: Object.fromEntries(
					stored.schemes.map((e) => [e.id, compact(e) as SchemeEntry]),
				),
			}
		: { questions: {}, schemes: {} };
	const remote = remoteOfBases(local);
	const settings = stored?.settings ?? DEFAULT_SETTINGS;
	const model: Model = {
		local,
		// The last GitHub state this browser knew is exactly what its bases record.
		remote,
		bank: remote,
		activity: {},
		nextId: stored?.nextId ?? 1,
		screen: { kind: "blank" },
		browser: { filter: "", expanded: [], settingsOpen: false },
		session: flags.hasToken ? { kind: "connecting" } : { kind: "anonymous" },
		settings,
		loading: { kind: "bundled" },
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
 * once (owner, step 9). With no scheme files at all (no bank yet), the bundled example
 * scales stand in.
 */
export function envOf(schemes: Readonly<Record<Id, SchemeEntry>>): Env {
	const files = Object.values(schemes);
	return files.length === 0
		? { ...EMPTY_ENV, scales: EXAMPLE_SCALES }
		: schemeEnv(
				files.map((e) => ({ kind: e.kind, name: e.name, text: e.source })),
			);
}

export const toPersisted = (model: Model): Persisted => ({
	version: 3,
	nextId: model.nextId,
	questions: Object.values(model.local.questions),
	schemes: Object.values(model.local.schemes),
	settings: model.settings,
});
