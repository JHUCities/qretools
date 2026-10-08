import { ok } from "@qretools/core";
import type { BranchTarget, Store } from "@qretools/shell";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEffects } from "./effects.ts";
import type { Msg } from "./model.ts";

const target = (path: string): BranchTarget => ({
	owner: "o",
	repo: "r",
	path,
	branch: "main",
	defaultBranch: "main",
});

describe("reading the banks an instrument uses", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("waits for the address to settle, reads only the latest, and never one twice at once", async () => {
		const read: string[] = [];
		const store = {
			loadBank: (t: BranchTarget) => {
				read.push(t.path);
				return Promise.resolve(
					ok({
						files: [],
						found: true,
						from: "default",
						aheadBy: 0,
						behindBy: 0,
					}),
				);
			},
		} as unknown as Store;
		const effects = createEffects({
			makeStore: () => store,
			credentialStore: {
				load: () => ({ credentials: { access: "t" }, remember: false }),
				save: () => {},
				clear: () => {},
			},
		});
		const got: Msg[] = [];
		const dispatch = (m: Msg) => got.push(m);
		effects.exec({ kind: "loadBanks", targets: [target("b/h")] }, dispatch);
		effects.exec({ kind: "loadBanks", targets: [target("b/hh")] }, dispatch);
		await vi.advanceTimersByTimeAsync(499);
		expect(read).toEqual([]);
		await vi.advanceTimersByTimeAsync(1);
		expect(read).toEqual(["b/hh"]);
		expect(got.map((m) => m.kind === "bankLoaded" && m.key)).toEqual([
			"o/r/b/hh",
		]);
	});
});
