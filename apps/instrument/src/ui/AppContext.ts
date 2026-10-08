import { createContext, useContext } from "react";
import { useStore } from "zustand";
import type { Model } from "../model.ts";
import type { App } from "../store.ts";

export const AppContext = createContext<App | null>(null);

export function useApp(): App {
	const app = useContext(AppContext);
	if (!app) throw new Error("AppContext is missing");
	return app;
}

/** Select from the Model. Select primitives or stable references to keep re-renders sane. */
export function useModel<T>(select: (model: Model) => T): T {
	const { store } = useApp();
	return useStore(store, (s) => select(s.model));
}

/** The top bar's status, which explains what the session is doing. */
export const SESSION_STATUS = "session-status";
