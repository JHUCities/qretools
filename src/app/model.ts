/**
 * The Elm Architecture, by hand. The Model is everything the app knows; a Msg is
 * everything that can happen; a Cmd is an effect described as data.
 *
 * Model, Msg and Cmd are plain data: no functions, no DOM, nothing that cannot be
 * logged, compared, or serialised. The Model holds the source text and nothing
 * derived from it; a stored parse next to the text could disagree with it.
 */
import type { Finding, Range, Target } from "../core/findings.js";
import { parseScale, type Scales } from "../core/surface/scales.js";
import demRace from "../examples/dem_race.yaml?raw";
import nhdCohes1 from "../examples/nhd_cohes1.yaml?raw";
import nhdNyrs from "../examples/nhd_nyrs.yaml?raw";
import nhdSat from "../examples/nhd_sat.yaml?raw";

/** The official DDI schema is 900KB and loads lazily. The compiled validator lives in the shell. */
export type DdiSchema =
	| { readonly kind: "loading" }
	| { readonly kind: "ready" }
	| { readonly kind: "failed"; readonly finding: Finding };

export interface Model {
	readonly source: string;
	readonly agency: string;
	readonly ddiSchema: DdiSchema;
	/** The bank's shared scales. Bundled examples until step 5 loads them from the repository. */
	readonly scales: Scales;
}

export type Msg =
	| { readonly kind: "edited"; readonly text: string }
	| { readonly kind: "exampleChosen"; readonly text: string }
	| { readonly kind: "locationClicked"; readonly target: Target }
	| { readonly kind: "ddiSchemaLoaded"; readonly result: DdiSchema };

export type Cmd =
	| { readonly kind: "revealRange"; readonly range: Range }
	| { readonly kind: "loadDdiSchema" };

export type Dispatch = (msg: Msg) => void;

export const EXAMPLES: ReadonlyArray<{
	readonly label: string;
	readonly text: string;
}> = [
	{ label: "nhd_sat (choice)", text: nhdSat },
	{ label: "nhd_nyrs (number)", text: nhdNyrs },
	{ label: "nhd_cohes1 (shared scale)", text: nhdCohes1 },
	{ label: "dem_race (select many)", text: demRace },
	{ label: "blank", text: "" },
];

/** Placeholder agency until the project chooses its registered DDI agency identifier. */
const AGENCY = "org.example.qretools";

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

export const init: readonly [Model, readonly Cmd[]] = [
	{
		source: nhdSat,
		agency: AGENCY,
		ddiSchema: { kind: "loading" },
		scales: EXAMPLE_SCALES,
	},
	[{ kind: "loadDdiSchema" }],
];
