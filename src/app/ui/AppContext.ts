import { createContext, useContext } from "react";
import { useStore } from "zustand";
import type { Env } from "../../core/surface/env.js";
import type { Model } from "../model.js";
import type { App } from "../store.js";

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

/** The environment questions are read against. Keeps its identity until a scheme file changes; see evaluations.ts. */
export function useEnv(): Env {
	const { evaluations } = useApp();
	const schemes = useModel((m) => m.local.schemes);
	const remoteSchemes = useModel((m) => m.remote.schemes);
	return evaluations.env(schemes, remoteSchemes);
}
