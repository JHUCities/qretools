/**
 * The bank app: its Elm loop (the shell's `createLoop`), its effects and its
 * evaluation cache, made once at startup.
 */

import { createLoop, type SignInConfig } from "@qretools/shell";
import type { StoreApi } from "zustand/vanilla";
import { createEffects, type Deps, type Effects } from "./effects.js";
import { createEvaluations, type Evaluations } from "./evaluations.js";
import { type Dispatch, type Flags, init, type Model } from "./model.js";
import { update } from "./update.js";

export interface App {
	readonly store: StoreApi<{ model: Model }>;
	readonly dispatch: Dispatch;
	readonly effects: Effects;
	readonly evaluations: Evaluations;
	/** Sign-in with GitHub for this build, if configured: read once, at startup. */
	readonly signIn?: SignInConfig;
	/** "Use this template" for a new workspace, if configured. */
	readonly template?: string;
}

/** What the view needs beyond the effects' dependencies: read once, at startup. */
export interface ViewConfig {
	readonly template?: string;
}

export function createApp(
	flags: Flags,
	deps: Deps,
	view: ViewConfig = {},
): App {
	const effects = createEffects(deps);
	const { store, dispatch } = createLoop(
		init(flags),
		update,
		effects.exec,
		"qretools",
	);
	return {
		store,
		dispatch,
		effects,
		evaluations: createEvaluations(),
		...(deps.signIn !== undefined && { signIn: deps.signIn.config }),
		...(view.template !== undefined && { template: view.template }),
	};
}
