/**
 * A link waiting for sign-in, to a bank other than the one chosen on the form: dropped,
 * and taken out of the address before sign-in saves it, so it isn't brought back from
 * GitHub to be refused once the chosen bank loads.
 */
import { ok } from "@qretools/core";
import { describe, expect, it } from "vitest";
import { init, type Model } from "./model.js";
import { update } from "./update.js";

const settings = (repo: string) => ({
	owner: "o",
	repo,
	path: "",
	remember: false,
});

/** Signed out, with a link to `o/linked` waiting, and `o/old` last chosen. */
function waiting(): Model {
	const [start] = init({
		work: ok(undefined),
		hasToken: false,
		settings: settings("old"),
	});
	const [m] = update(start, {
		kind: "hashChanged",
		hash: "#repo=o%2Flinked&branch=main",
	});
	expect(m.pendingLink?.repo).toBe("o/linked");
	return m;
}

describe("a link waiting for sign-in", () => {
	it("is dropped, and out of the address first, when another bank is chosen", () => {
		for (const kind of ["signInRequested", "connectRequested"] as const) {
			const [m, cmds] = update(waiting(), {
				kind,
				settings: settings("chosen"),
			} as never);
			expect(m.pendingLink).toBeUndefined();
			// Before the sign-in saves the address it will come back to.
			const kinds = cmds.map((c) => c.kind);
			expect(kinds[0]).toBe("clearLink");
			expect(
				kinds.indexOf(kind === "signInRequested" ? "signIn" : "connect"),
			).toBeGreaterThan(0);
		}
	});

	it("still sets aside unsaved work for the bank last chosen", () => {
		const [drafted] = update(waiting(), {
			kind: "questionCreated",
			text: "name: kept\n",
		});
		expect(Object.keys(drafted.local.questions)).toHaveLength(1);
		const [m, cmds] = update(drafted, {
			kind: "signInRequested",
			settings: settings("chosen"),
		});
		expect(cmds.map((c) => c.kind)).toContain("setAside");
		expect(m.local.questions).toEqual({});
	});

	it("still opens after signing in to the bank it names", () => {
		const [m, cmds] = update(waiting(), {
			kind: "signInRequested",
			settings: settings("linked"),
		});
		expect(m.pendingLink?.repo).toBe("o/linked");
		expect(cmds).not.toContainEqual({ kind: "clearLink" });
	});
});
