/**
 * The Elm loop on a Zustand store. The store holds the Model and nothing else;
 * `dispatch` is the only way it changes: run `update`, set the new Model (named
 * for Redux DevTools by the message's kind), then run the returned commands.
 * `dispatch` is not store state and is never wrapped in a thunk.
 */

import { devtools } from "zustand/middleware";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { SignInConfig } from "./config.js";
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
	/** "Use this template" for a new bank, if configured. */
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
	const [model, first] = init(flags);
	const store = createStore<{ model: Model }>()(
		devtools(() => ({ model }), { name: "qretools" }),
	);
	const dispatch: Dispatch = (msg) => {
		const [next, cmds] = update(store.getState().model, msg);
		store.setState({ model: next }, false, msg.kind);
		for (const c of cmds) effects.exec(c, dispatch);
	};
	for (const c of first) effects.exec(c, dispatch);
	return {
		store,
		dispatch,
		effects,
		evaluations: createEvaluations(),
		...(deps.signIn !== undefined && { signIn: deps.signIn.config }),
		...(view.template !== undefined && { template: view.template }),
	};
}
