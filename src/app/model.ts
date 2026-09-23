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
import { parseScale, type Scales } from "../core/surface/scales.js";
import demRace from "../examples/dem_race.yaml?raw";
import nhdCohes1 from "../examples/nhd_cohes1.yaml?raw";
import nhdNyrs from "../examples/nhd_nyrs.yaml?raw";
import nhdSat from "../examples/nhd_sat.yaml?raw";
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
	| {
			readonly kind: "list";
			readonly folder?: string;
			readonly text: string;
			readonly confirmDelete?: Id;
	  }
	| { readonly kind: "editing"; readonly id: Id };

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
			readonly folder?: string;
			readonly text: string;
	  }
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
	| {
			readonly kind: "saveFinished";
			readonly id: Id;
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

export const EXAMPLES: ReadonlyArray<{
	readonly label: string;
	readonly text: string;
}> = [
	{ label: "nhd_sat (choice)", text: nhdSat },
	{ label: "nhd_nyrs (number)", text: nhdNyrs },
	{ label: "nhd_cohes1 (shared scale)", text: nhdCohes1 },
	{ label: "dem_race (select many)", text: demRace },
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

/** First run: the bundled examples become drafts, so the list is not empty. */
const seed = (): { questions: Record<Id, Question>; nextId: Id } => {
	const questions: Record<Id, Question> = {};
	EXAMPLES.forEach((e, i) => {
		questions[i + 1] = {
			id: i + 1,
			source: e.text,
			origin: { kind: "draft" },
			activity: { kind: "idle" },
		};
	});
	return { questions, nextId: EXAMPLES.length + 1 };
};

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
		: seed();
	const settings = stored?.settings ?? DEFAULT_SETTINGS;
	const model: Model = {
		questions,
		nextId,
		screen: { kind: "list", text: "" },
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
