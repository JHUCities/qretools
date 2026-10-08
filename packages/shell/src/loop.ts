/**
 * The Elm loop on a Zustand store. The store holds the Model and nothing else;
 * `dispatch` is the only way it changes: run `update`, set the new Model (named
 * for Redux DevTools by the message's kind), then run the returned commands.
 * `dispatch` is not store state and is never wrapped in a thunk.
 */
import { devtools } from "zustand/middleware";
import { createStore, type StoreApi } from "zustand/vanilla";

export interface Loop<Model, Msg> {
	readonly store: StoreApi<{ model: Model }>;
	readonly dispatch: (msg: Msg) => void;
}

export function createLoop<Model, Msg extends { readonly kind: string }, Cmd>(
	first: readonly [Model, readonly Cmd[]],
	update: (model: Model, msg: Msg) => readonly [Model, readonly Cmd[]],
	exec: (cmd: Cmd, dispatch: (msg: Msg) => void) => void,
	/** The store's name in Redux DevTools. */
	name: string,
): Loop<Model, Msg> {
	const [model, cmds] = first;
	const store = createStore<{ model: Model }>()(
		devtools(() => ({ model }), { name }),
	);
	const dispatch = (msg: Msg) => {
		const [next, out] = update(store.getState().model, msg);
		store.setState({ model: next }, false, msg.kind);
		for (const c of out) exec(c, dispatch);
	};
	for (const c of cmds) exec(c, dispatch);
	return { store, dispatch };
}
