import { err, ok } from "@qretools/core";
import type { File, Who } from "@qretools/shell";
import { describe, expect, it } from "vitest";
import { projectFiles } from "./effects.ts";
import { init, type Model, type Msg } from "./model.ts";
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
		kind: "projectLoaded",
		result: ok({
			instruments: [file("instruments/b.yaml"), file("instruments/a.yaml")],
			project: file("project.yaml"),
		}),
	}).model;

describe("signing in to a project", () => {
	it("starts at once with a token on hand, and only with a project chosen", () => {
		expect(init({ settings: SETTINGS, hasToken: true })).toEqual([
			expect.objectContaining({ session: { kind: "connecting" } }),
			[{ kind: "connect", repo: { owner: "o", repo: "r", path: "p" } }],
		]);
		expect(init({ hasToken: true })[1]).toEqual([]);
		expect(init({ settings: SETTINGS, hasToken: false })[0].session).toEqual({
			kind: "anonymous",
		});
	});

	it("once signed in, reads the project from its default branch", () => {
		const [model, cmds] = update(
			init({ settings: SETTINGS, hasToken: true })[0],
			{
				kind: "connected",
				result: ok(WHO),
			},
		);
		expect(model.project).toEqual({ kind: "loading" });
		expect(cmds).toEqual([
			{
				kind: "loadProject",
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

	it("saves the chosen project, and leaves for GitHub", () => {
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
				kind: "projectLoaded",
				result: ok({ instruments: [], project: null }),
			},
		);
		expect(late.model).toBe(out[0]);
		expect(late.cmds).toEqual([]);
		const twice = loaded();
		expect(
			update(twice, {
				kind: "projectLoaded",
				result: ok({ instruments: [], project: null }),
			})[0],
		).toBe(twice);
	});
});

describe("a sign-in that has ended", () => {
	it("ends the session and forgets the credentials, whichever reply noticed", () => {
		const [model, cmds] = update(signedIn(), {
			kind: "projectLoaded",
			result: err({ kind: "auth", message: "Your GitHub sign-in has ended." }),
		});
		expect(model.session).toMatchObject({ kind: "failed" });
		expect(model.project).toEqual({ kind: "idle" });
		expect(cmds).toEqual([{ kind: "forgetToken" }]);
		// Any other failure is the project's, with a retry.
		const [down] = update(signedIn(), {
			kind: "projectLoaded",
			result: err({ kind: "network", message: "down" }),
		});
		expect([down.session.kind, down.project.kind]).toEqual([
			"connected",
			"failed",
		]);
	});
});

describe("the project", () => {
	it("lists its instruments in name order, with its own file", () => {
		const { project } = loaded();
		expect(
			project.kind === "loaded" && Object.keys(project.instruments),
		).toEqual(["instruments/a.yaml", "instruments/b.yaml"]);
		expect(project.kind === "loaded" && project.file?.path).toBe(
			"project.yaml",
		);
	});

	it("tells a missing instruments folder from an empty one", () => {
		const none = run(signedIn(), {
			kind: "projectLoaded",
			result: ok({ instruments: null, project: null }),
		}).model.project;
		expect(none).toEqual({ kind: "loaded", instruments: {}, hasFolder: false });
	});

	it("reads a missing project file as none, and any other failure as the load's", () => {
		const folder = ok([file("instruments/a.yaml")]);
		const missing = err({
			kind: "http" as const,
			status: 404,
			message: "gone",
		});
		expect(projectFiles(folder, missing)).toEqual(
			ok({ instruments: [file("instruments/a.yaml")], project: null }),
		);
		const down = err({ kind: "network" as const, message: "down" });
		expect(projectFiles(folder, down)).toEqual(down);
		expect(projectFiles(down, ok(file("project.yaml")))).toEqual(down);
	});
});

describe("which instrument is open", () => {
	it("follows the address, and a link that arrives first waits for the project", () => {
		const href = instrumentHref(loaded(), "main", "instruments/a.yaml");
		expect(update(loaded(), { kind: "hashChanged", hash: href })[0].open).toBe(
			"instruments/a.yaml",
		);
		const waiting = update(signedIn(), { kind: "hashChanged", hash: href })[0];
		expect(waiting.open).toBeUndefined();
		const opened = update(waiting, {
			kind: "projectLoaded",
			result: ok({ instruments: [file("instruments/a.yaml")], project: null }),
		})[0];
		expect([opened.open, opened.pendingLink]).toEqual([
			"instruments/a.yaml",
			undefined,
		]);
	});

	it("opens nothing for a file the project lacks, and says so for another project", () => {
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
			"That link is to another project, x/y.",
		]);
	});
});
