/**
 * Bringing the default branch into the author's: a merge on GitHub when asked, then a
 * reload; a conflict is left to a pull request; no save runs until the reload lands.
 */
import { err, ok } from "@qretools/core";
import { describe, expect, it } from "vitest";
import { init, type Model, type Msg } from "./model.js";
import { sessionStatus, update, writeBlocked } from "./update.js";

const QUESTION =
	'name: alpha\ntext: Alpha?\nintent: Alpha.\nresponses:\n  "1": Yes\n  "2": No\n';

/** Signed in, loaded from the author's branch (or the default one), behind `trunk`. */
function loaded(from: "branch" | "default" = "branch"): Model {
	const [start] = init({
		work: ok(undefined),
		hasToken: true,
		settings: { owner: "o", repo: "r", path: "", remember: false },
	});
	const [connected] = update(start, {
		kind: "connected",
		result: ok({
			login: "iain",
			avatarUrl: "https://a/iain",
			access: { kind: "write" },
			defaultBranch: "trunk",
		}),
	});
	return update(connected, {
		kind: "workspaceLoaded",
		result: ok({
			files: [
				{ path: "bank.yaml", sha: "s0", text: "agency: org.example\n" },
				{ path: "questions/t/alpha.yaml", sha: "s1", text: QUESTION },
			],
			found: true,
			from,
			aheadBy: 1,
			behindBy: 3,
			unread: [],
		}),
	})[0];
}

const run = (m: Model, ...msgs: Msg[]) =>
	msgs.reduce<ReturnType<typeof update>>(
		([at], msg) => update(at, msg),
		[m, []],
	);

describe("bringing the default branch into the author's", () => {
	it("merges it on GitHub when asked, saying so by the branch's own name", () => {
		const [m, cmds] = update(loaded(), { kind: "updateFromDefaultRequested" });
		expect(cmds).toEqual([
			{
				kind: "updateFromDefault",
				target: {
					owner: "o",
					repo: "r",
					path: "",
					branch: "qretools-iain",
					defaultBranch: "trunk",
				},
			},
		]);
		expect(sessionStatus(m)).toBe("Bringing trunk into your branch…");
		// One at a time: asked again while it runs, nothing more is sent.
		expect(update(m, { kind: "updateFromDefaultRequested" })[1]).toEqual([]);
	});

	it("isn't offered before the branch exists, or while a save runs", () => {
		expect(
			update(loaded("default"), { kind: "updateFromDefaultRequested" })[1],
		).toEqual([]);
		const saving: Model = { ...loaded(), activity: { 1: { kind: "saving" } } };
		expect(update(saving, { kind: "updateFromDefaultRequested" })[1]).toEqual(
			[],
		);
	});

	it("reloads once merged, and keeps writing blocked until the reload lands", () => {
		for (const answer of ["merged", "upToDate"] as const) {
			const [m, cmds] = run(
				loaded(),
				{ kind: "updateFromDefaultRequested" },
				{ kind: "updatedFromDefault", result: ok(answer) },
			);
			expect(cmds).toEqual([
				expect.objectContaining({ kind: "loadWorkspace" }),
			]);
			expect(writeBlocked(m)).toBe("Bringing trunk into your branch…");
			const [done] = update(m, {
				kind: "workspaceLoaded",
				result: ok({
					files: [],
					found: true,
					from: "branch",
					aheadBy: 2,
					behindBy: 0,
					unread: [],
				}),
			});
			expect(writeBlocked(done)).toBeUndefined();
			expect(done.updating).toBeUndefined();
		}
	});

	it("leaves a conflict to a pull request, in the owner's words, with the way to open one", () => {
		const [m, cmds] = run(
			loaded(),
			{ kind: "updateFromDefaultRequested" },
			{ kind: "updatedFromDefault", result: ok("conflict") },
		);
		expect(cmds).toEqual([]);
		expect(m.updating).toBeUndefined();
		expect(m.failures.at(-1)).toEqual({
			kind: "conflict",
			message: "Your branch conflicts with updates to trunk.",
			hint: "Open a pull request with your changes, and the bank's owner resolves the conflicts.",
			link: {
				label: "Open a pull request",
				href: "https://github.com/o/r/compare/trunk...qretools-iain?expand=1",
			},
		});
		expect(writeBlocked(m)).toBeUndefined();
	});

	it("says a failure, and lets writing go on", () => {
		const [m] = run(
			loaded(),
			{ kind: "updateFromDefaultRequested" },
			{
				kind: "updatedFromDefault",
				result: err({ kind: "network", message: "Couldn't reach GitHub." }),
			},
		);
		expect(m.failures.at(-1)?.message).toBe("Couldn't reach GitHub.");
		expect(writeBlocked(m)).toBeUndefined();
	});
});
