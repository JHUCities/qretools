import type { Env } from "@qretools/core";
import { createContext, useContext, useMemo } from "react";
import { useStore } from "zustand";
import type { Model } from "../model.js";
import type { App } from "../store.js";
import { blockage, writeBlocked } from "../update.js";
import { type InstrumentUses, instrumentUses } from "../usedBy.js";

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

/**
 * The environment the bank's questions are read against. Keeps its identity until one
 * of its scheme files changes; see evaluations.ts.
 */
export function useEnv(): Env {
	const { evaluations } = useApp();
	const local = useModel((m) => m.local);
	const remote = useModel((m) => m.remote);
	return evaluations.env({ local, remote });
}

/**
 * Which instruments here use each bank file, by its path. Rebuilt with the workspace;
 * cheap, since each instrument's reading is cached in the evaluations.
 */
export function useInstrumentUses(): InstrumentUses {
	const { evaluations } = useApp();
	const local = useModel((m) => m.local);
	const remote = useModel((m) => m.remote);
	const remoteBanks = useModel((m) => m.remoteBanks);
	return useMemo(
		() => instrumentUses({ local, remote, remoteBanks }, evaluations),
		[local, remote, remoteBanks, evaluations],
	);
}

/** The top bar's status, which a file's inactive write buttons name as their reason. */
export const SESSION_STATUS = "session-status";

/**
 * What a button that writes to GitHub needs while writing is blocked (`blockage`): whether
 * the reason stands (then it is the button's tooltip, and a press opens its notice) or is
 * brief (then the top bar's line, with its spinner, is its description, as it passes by
 * itself), and what a press on the inactive button does.
 */
export function useBlocked(): {
	readonly reason: string | undefined;
	readonly standing: boolean;
	readonly tried: () => void;
} {
	const { dispatch } = useApp();
	const reason = useModel(writeBlocked);
	const standing = useModel((m) => blockage(m)?.kind === "standing");
	return {
		reason,
		standing,
		tried: () => dispatch({ kind: "blockedActionTried" }),
	};
}
