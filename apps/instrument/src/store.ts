/** The instrument app: its Elm loop (the shell's `createLoop`) and its effects, made once at startup. */
import {
	type CredentialsDeps,
	createLoop,
	type Loop,
	type SignInConfig,
} from "@qretools/shell";
import { createEffects, type Effects } from "./effects.ts";
import { type Flags, init, type Model, type Msg } from "./model.ts";
import { update } from "./update.ts";

export interface App extends Loop<Model, Msg> {
	readonly effects: Effects;
	/** Sign-in with GitHub for this build, if configured: read once, at startup. */
	readonly signIn?: SignInConfig;
}

export function createApp(flags: Flags, deps: CredentialsDeps): App {
	const effects = createEffects(deps);
	const loop = createLoop(
		init(flags),
		update,
		effects.exec,
		"qretools instrument",
	);
	return {
		...loop,
		effects,
		...(deps.signIn !== undefined && { signIn: deps.signIn.config }),
	};
}
