import { createContext, useContext, useMemo } from "react";
import { useStore } from "zustand";
import type { Env } from "../../core/surface/env.js";
import { envOf, type Model } from "../model.js";
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

/** The environment questions are read in, rebuilt only when the schemes change, so caches keyed on it hold. */
export function useEnv(): Env {
	const scales = useModel((m) => m.scales);
	return useMemo(() => envOf({ scales }), [scales]);
}
