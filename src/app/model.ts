/**
 * The Elm Architecture, by hand. The Model is everything the app knows; a Msg is
 * everything that can happen; a Cmd is an effect described as data.
 *
 * Model, Msg and Cmd are plain data: no functions, no DOM, nothing that cannot be
 * logged, compared, or serialised. The Model holds the source text and nothing
 * derived from it; a stored parse next to the text could disagree with it.
 */
import type { Finding, Range, Target } from "../core/findings.js";
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
	{ label: "blank", text: "" },
];

/** Placeholder agency until the project chooses its registered DDI agency identifier. */
const AGENCY = "org.example.qretools";

export const init: readonly [Model, readonly Cmd[]] = [
	{ source: nhdSat, agency: AGENCY, ddiSchema: { kind: "loading" } },
	[{ kind: "loadDdiSchema" }],
];
