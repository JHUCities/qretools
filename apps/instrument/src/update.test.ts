import { err, ok } from "@qretools/core";
import type { File, Who } from "@qretools/shell";
import { describe, expect, it } from "vitest";
import { workspaceFiles } from "./effects.ts";
import { init, type Model, type Msg, warnOnLeave } from "./model.ts";
import { instrumentHref, update } from "./update.ts";

const SETTINGS = { owner: "o", repo: "r", path: "p", remember: false };
const WHO: Who = {
	login: "me",
	avatarUrl: "https://a/me",
	access: { kind: "readOnly" },
	defaultBranch: "main",
};
const file = (path: string): File => ({ path, sha: "s", text: `name: x\n` });

const run = (model: Model, ...msgs: Msg[]) =>
	msgs.reduce<{ model: Model; cmds: unknown[] }>(
		(acc, msg) => {
			const [next, cmds] = update(acc.model, msg);
			return { model: next, cmds: [...acc.cmds, ...cmds] };
		},
		{ model, cmds: [] },
	);

const signedIn = (): Model =>
	run(init({ settings: SETTINGS, hasToken: true })[0], {
		kind: "connected",
		result: ok(WHO),
	}).model;

const loaded = (): Model =>
	run(signedIn(), {
		kind: "workspaceLoaded",
		result: ok({
			instruments: [file("instruments/b.yaml"), file("instruments/a.yaml")],
			workspace: file("workspace.yaml"),
		}),
	}).model;

describe("signing in to a workspace", () => {
	it("starts at once with a token on hand, and only with a workspace chosen", () => {
		expect(init({ settings: SETTINGS, hasToken: true })).toEqual([
			expect.objectContaining({ session: { kind: "connecting" } }),
			[
				{ kind: "loadDdiSchema" },
				{ kind: "connect", repo: { owner: "o", repo: "r", path: "p" } },
			],
		]);
		expect(init({ hasToken: true })[1]).toEqual([{ kind: "loadDdiSchema" }]);
		expect(init({ settings: SETTINGS, hasToken: false })[0].session).toEqual({
			kind: "anonymous",
		});
	});

	it("once signed in, reads the workspace from its default branch", () => {
		const [model, cmds] = update(
			init({ settings: SETTINGS, hasToken: true })[0],
			{
				kind: "connected",
				result: ok(WHO),
			},
		);
		expect(model.workspace).toEqual({ kind: "loading" });
		expect(cmds).toEqual([
			{
				kind: "loadWorkspace",
				target: {
					owner: "o",
					repo: "r",
					path: "p",
					branch: "main",
					defaultBranch: "main",
				},
			},
		]);
	});

	it("saves the chosen workspace, and leaves for GitHub", () => {
		const [model, cmds] = update(init({ hasToken: false })[0], {
			kind: "signInRequested",
			settings: SETTINGS,
		});
		expect(model.session).toEqual({ kind: "connecting", toGitHub: true });
		expect(cmds).toEqual([
			{ kind: "saveSettings", settings: SETTINGS },
			{ kind: "signIn", remember: false },
		]);
	});

	it("ignores GitHub's replies once they no longer belong: after a sign-out, or twice", () => {
		const out = update(signedIn(), { kind: "signOutRequested" });
		expect(out[1]).toEqual([{ kind: "forgetToken" }]);
		const late = run(
			out[0],
			{ kind: "connected", result: ok(WHO) },
			{
				kind: "workspaceLoaded",
				result: ok({ instruments: [], workspace: null }),
			},
		);
		expect(late.model).toBe(out[0]);
		expect(late.cmds).toEqual([]);
		const twice = loaded();
		expect(
			update(twice, {
				kind: "workspaceLoaded",
				result: ok({ instruments: [], workspace: null }),
			})[0],
		).toBe(twice);
	});
});

describe("a sign-in that has ended", () => {
	it("ends the session and forgets the credentials, whichever reply noticed", () => {
		const [model, cmds] = update(signedIn(), {
			kind: "workspaceLoaded",
			result: err({ kind: "auth", message: "Your GitHub sign-in has ended." }),
		});
		expect(model.session).toMatchObject({ kind: "failed" });
		expect(model.workspace).toEqual({ kind: "idle" });
		expect(cmds).toEqual([{ kind: "forgetToken" }]);
		// Any other failure is the workspace's, with a retry.
		const [down] = update(signedIn(), {
			kind: "workspaceLoaded",
			result: err({ kind: "network", message: "down" }),
		});
		expect([down.session.kind, down.workspace.kind]).toEqual([
			"connected",
			"failed",
		]);
	});
});

describe("the workspace", () => {
	it("lists its instruments in name order, with its own file", () => {
		const { workspace } = loaded();
		expect(
			workspace.kind === "loaded" && Object.keys(workspace.instruments),
		).toEqual(["instruments/a.yaml", "instruments/b.yaml"]);
		expect(workspace.kind === "loaded" && workspace.file?.path).toBe(
			"workspace.yaml",
		);
	});

	it("tells a missing instruments folder from an empty one", () => {
		const none = run(signedIn(), {
			kind: "workspaceLoaded",
			result: ok({ instruments: null, workspace: null }),
		}).model.workspace;
		expect(none).toEqual({ kind: "loaded", instruments: {}, hasFolder: false });
	});

	it("reads a missing workspace file as none, and any other failure as the load's", () => {
		const folder = ok([file("instruments/a.yaml")]);
		const missing = err({
			kind: "http" as const,
			status: 404,
			message: "gone",
		});
		expect(workspaceFiles(folder, missing)).toEqual(
			ok({ instruments: [file("instruments/a.yaml")], workspace: null }),
		);
		const down = err({ kind: "network" as const, message: "down" });
		expect(workspaceFiles(folder, down)).toEqual(down);
		expect(workspaceFiles(down, ok(file("workspace.yaml")))).toEqual(down);
	});
});

describe("which instrument is open", () => {
	it("follows the address, and a link that arrives first waits for the workspace", () => {
		const href = instrumentHref(loaded(), "main", "instruments/a.yaml");
		expect(update(loaded(), { kind: "hashChanged", hash: href })[0].open).toBe(
			"instruments/a.yaml",
		);
		const waiting = update(signedIn(), { kind: "hashChanged", hash: href })[0];
		expect(waiting.open).toBeUndefined();
		const opened = update(waiting, {
			kind: "workspaceLoaded",
			result: ok({
				instruments: [file("instruments/a.yaml")],
				workspace: null,
			}),
		})[0];
		expect([opened.open, opened.pendingLink]).toEqual([
			"instruments/a.yaml",
			undefined,
		]);
	});

	it("opens nothing for a file the workspace lacks, and says so for another workspace", () => {
		const model = loaded();
		const href = instrumentHref(model, "main", "instruments/zz.yaml");
		expect(update(model, { kind: "hashChanged", hash: href })[0].open).toBe(
			undefined,
		);
		const other = update(model, {
			kind: "hashChanged",
			hash: "#repo=x%2Fy&branch=main&file=instruments%2Fa.yaml",
		})[0];
		expect(other.open).toBeUndefined();
		expect(other.failures.map((f) => f.message)).toEqual([
			"That link is to another workspace, x/y.",
		]);
	});
});

describe("editing, and the banks an instrument uses", () => {
	const USES = "uses:\n  hh: ../banks/hh\nflow: []\n";
	const opened = (text = USES): Model => {
		const model = run(signedIn(), {
			kind: "workspaceLoaded",
			result: ok({
				instruments: [{ path: "instruments/a.yaml", sha: "s", text }],
				workspace: null,
			}),
		}).model;
		return update(model, {
			kind: "hashChanged",
			hash: instrumentHref(model, "main", "instruments/a.yaml"),
		})[0];
	};
	const HH = {
		owner: "o",
		repo: "r",
		path: "p/banks/hh",
		branch: "main",
		defaultBranch: "main",
	};

	it("asks for a bank once its address is written, and not again while it stays", () => {
		const [model, cmds] = update(opened("flow: []\n"), {
			kind: "edited",
			text: USES,
		});
		expect(cmds).toEqual([{ kind: "loadBanks", targets: [HH] }]);
		expect(model.working).toEqual({ "instruments/a.yaml": USES });
		expect(
			update(model, { kind: "edited", text: `${USES}# more\n` })[1],
		).toEqual([]);
		// Opening an instrument asks for its banks too.
		const listed = run(signedIn(), {
			kind: "workspaceLoaded",
			result: ok({
				instruments: [{ path: "instruments/a.yaml", sha: "s", text: USES }],
				workspace: null,
			}),
		}).model;
		const [, onOpen] = update(listed, {
			kind: "hashChanged",
			hash: instrumentHref(listed, "main", "instruments/a.yaml"),
		});
		expect(onOpen).toEqual([{ kind: "loadBanks", targets: [HH] }]);
	});

	it("keeps no edit once the text is back as read, and asks before leaving one", () => {
		const edited = update(opened(), { kind: "edited", text: "x: 1\n" })[0];
		expect([warnOnLeave(opened()), warnOnLeave(edited)]).toEqual([false, true]);
		expect(update(edited, { kind: "edited", text: USES })[0].working).toEqual(
			{},
		);
	});

	it("keeps each bank as read, ignores one read after a sign-out, and ends a lapsed sign-in", () => {
		const loaded = {
			files: [],
			found: true,
			from: "default" as const,
			aheadBy: 0,
			behindBy: 0,
		};
		const [model] = update(opened(), {
			kind: "bankLoaded",
			key: "o/r/p/banks/hh",
			result: ok(loaded),
		});
		expect(model.banks["o/r/p/banks/hh"]).toEqual({
			kind: "loaded",
			files: [],
			found: true,
		});
		const out = update(model, { kind: "signOutRequested" })[0];
		expect(out.banks).toEqual({});
		expect(
			update(out, { kind: "bankLoaded", key: "k", result: ok(loaded) })[0],
		).toBe(out);
		const [lapsed, cmds] = update(opened(), {
			kind: "bankLoaded",
			key: "k",
			result: err({ kind: "auth", message: "ended" }),
		});
		expect([lapsed.session.kind, cmds]).toEqual([
			"failed",
			[{ kind: "forgetToken" }],
		]);
	});

	it("reads a bank again that failed or wasn't there, on Try again or a workspace reload", () => {
		const failed = update(opened(), {
			kind: "bankLoaded",
			key: "o/r/p/banks/hh",
			result: err({ kind: "network", message: "down" }),
		})[0];
		expect(update(failed, { kind: "edited", text: `${USES}#\n` })[1]).toEqual(
			[],
		);
		expect(
			update(failed, { kind: "bankRetried", key: "o/r/p/banks/hh" })[1],
		).toEqual([{ kind: "loadBanks", targets: [HH] }]);
		// A reload forgets it, and asks for it again once the workspace is back.
		const [reloaded] = update(failed, { kind: "workspaceReloadRequested" });
		expect(reloaded.banks).toEqual({});
		const [, cmds] = update(reloaded, {
			kind: "workspaceLoaded",
			result: ok({
				instruments: [{ path: "instruments/a.yaml", sha: "s", text: USES }],
				workspace: null,
			}),
		});
		expect(cmds).toEqual([{ kind: "loadBanks", targets: [HH] }]);
	});

	it("goes to a finding's place in the text as it is now", () => {
		const [, cmds] = update(opened(), {
			kind: "locationClicked",
			target: { path: "uses.hh", severity: "error" },
		});
		expect(cmds).toEqual([
			{ kind: "revealRange", range: [USES.indexOf("hh"), expect.any(Number)] },
		]);
	});
});
