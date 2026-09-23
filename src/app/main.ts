import { makeGitHubStore } from "./github.js";
import { init } from "./model.js";
import { mount } from "./mount.js";
import {
	browserTokenStore,
	readPersisted,
	STORAGE_KEY,
	UNREADABLE_KEY,
} from "./persist.js";
import { run } from "./runtime.js";
import { update } from "./update.js";

const root = document.querySelector<HTMLElement>("#app");
if (root) {
	let raw: string | null = null;
	try {
		raw = localStorage.getItem(STORAGE_KEY);
	} catch {
		// no storage: start fresh
	}
	const stored = readPersisted(raw);
	if (!stored.ok && raw !== null) {
		// Keep what could not be read, so the first save does not destroy it.
		try {
			localStorage.setItem(UNREADABLE_KEY, raw);
		} catch {
			// nothing more to do
		}
	}
	const flags = { stored, hasToken: browserTokenStore.load() !== null };
	run(init(flags), update, (dispatch) =>
		mount(root, dispatch, {
			makeStore: makeGitHubStore,
			tokenStore: browserTokenStore,
		}),
	);
}
