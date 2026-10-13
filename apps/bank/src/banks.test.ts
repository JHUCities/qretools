/**
 * A workspace loaded: its own files apart from its bank's, which is its root and
 * nowhere else.
 */
import { ok, parseSurface } from "@qretools/core";
import { formatLink } from "@qretools/shell";
import { describe, expect, it } from "vitest";
import {
	type Cmd,
	envIn,
	init,
	type Model,
	type Question,
	TEMPLATES,
} from "./model.js";
import { update } from "./update.js";

describe("loading a workspace", () => {
	const file = (path: string, text = "x: 1\n") => ({
		path,
		sha: `sha-${path}`,
		text,
	});
	/** Signed in, with this workspace loaded from the author's branch. */
	function loaded(
		files: ReturnType<typeof file>[],
		unread: { path: string; reason: string }[] = [],
	): Model {
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
				defaultBranch: "main",
			}),
		});
		return update(connected, {
			kind: "workspaceLoaded",
			result: ok({
				files,
				found: true,
				from: "branch" as const,
				aheadBy: 0,
				behindBy: 0,
				unread,
			}),
		})[0];
	}
	const WORKSPACE = [
		file("workspace.yaml", "agency: org.example\n"),
		file("instruments/x.yaml", "name: x\n"),
		file("bank.yaml", "agency: org.example\n"),
		file("questions/t/q.yaml", "name: q\n"),
		file("scales/yn.yaml", 'labels:\n  "1": Yes\n'),
		// A bank file in a folder makes no bank of it: read as nothing.
		file("banks/a/bank.yaml", "agency: org.example\n"),
		file("banks/a/questions/t/q.yaml", "name: q\n"),
	];

	it("holds the workspace's own files apart from the bank's", () => {
		const m = loaded(WORKSPACE);
		expect(
			Object.values(m.local.workspace)
				.map((f) => `${f.kind} ${f.base?.path}`)
				.sort(),
		).toEqual([
			"instrument instruments/x.yaml",
			"workspaceFile workspace.yaml",
		]);
		expect(Object.keys(m.remote.workspace).sort()).toEqual([
			"instruments/x.yaml",
			"workspace.yaml",
		]);
		// GitHub changing an instrument the author hasn't touched brings it forward.
		const [again] = update(m, {
			kind: "workspaceLoaded",
			result: ok({
				files: WORKSPACE.map((f) =>
					f.path === "instruments/x.yaml"
						? { ...f, sha: "newer", text: "name: x\ntitle: X\n" }
						: f,
				),
				found: true,
				from: "branch" as const,
				aheadBy: 0,
				behindBy: 0,
				unread: [],
			}),
		});
		const x = Object.values(again.local.workspace).find(
			(f) => f.kind === "instrument",
		);
		expect(x).toMatchObject({
			name: "x",
			source: "name: x\ntitle: X\n",
			base: { sha: "newer" },
		});
		// Loading again changes nothing else: the bank's slices keep their identity.
		expect(again.local.questions).toBe(m.local.questions);
	});

	it("holds the root's bank, and no other folder's, whatever bank file it has", () => {
		const m = loaded(WORKSPACE);
		expect(m.banks).toEqual([""]);
		expect(
			[...Object.values(m.local.questions), ...Object.values(m.local.schemes)]
				.map((f) => `${f.bank} ${f.base?.path}`)
				.sort(),
		).toEqual([" bank.yaml", " questions/t/q.yaml", " scales/yn.yaml"]);
	});

	it("names the files GitHub wouldn't give as text, once however often it loads", () => {
		const unread = [{ path: "scales/big.yaml", reason: "It's too large." }];
		const m = loaded(WORKSPACE, unread);
		expect(m.failures).toEqual([
			expect.objectContaining({
				message: "`scales/big.yaml` couldn't be read, so it's left out.",
			}),
		]);
		const load = (model: Model, again: typeof unread) =>
			update(model, {
				kind: "workspaceLoaded",
				result: ok({
					files: WORKSPACE,
					found: true,
					from: "branch" as const,
					aheadBy: 0,
					behindBy: 0,
					unread: again,
				}),
			})[0];
		expect(load(m, unread).failures).toHaveLength(1);
		expect(load(m, []).failures).toEqual([]);
	});

	it("starts a template question with its bank's required fields in their places; a blank one blank", () => {
		const requiring = WORKSPACE.map((f) =>
			f.path === "bank.yaml"
				? file(f.path, "agency: org.example\nrequired: [concept]\n")
				: f,
		);
		const created = (text: string) => {
			const [m] = update(loaded(requiring), {
				kind: "questionCreated",
				text,
				bank: "",
			});
			const id = Math.max(...Object.keys(m.local.questions).map(Number));
			return { m, q: m.local.questions[id] as Question };
		};
		const { m, q } = created(TEMPLATES[0]?.text ?? "");
		expect(q.source).toMatch(/^intent:\nconcept:\nresponses:$/m);
		// Read as its bank reads it: holes only, the template's and the bank's.
		const findings = parseSurface(q.source, envIn(m, "")).findings;
		expect(findings.filter((f) => f.severity !== "hole")).toEqual([]);
		expect(findings.map((f) => f.path)).toContain("concept");
		expect(created("").q.source).toBe("");
	});

	it("saves a new question and a new shared file at the workspace's root", () => {
		const commitOf = (cmds: readonly Cmd[]) =>
			cmds.find(
				(c): c is Extract<Cmd, { kind: "commit" }> => c.kind === "commit",
			);
		let [m] = update(loaded(WORKSPACE), {
			kind: "questionCreated",
			text: "name: brand_new\ntext: New?\nintent: To see.\nopen: {}\n",
			bank: "",
		});
		const draft = Math.max(...Object.keys(m.local.questions).map(Number));
		[m] = update(m, { kind: "saveRequested", id: draft });
		[m] = update(m, { kind: "saveFolderChanged", folder: "fresh" });
		const [, saved] = update(m, { kind: "saveConfirmed" });
		expect(commitOf(saved)?.changes.map((c) => c.path)).toEqual([
			"questions/fresh/brand_new.yaml",
		]);
		let [n] = update(loaded(WORKSPACE), {
			kind: "schemeCreateOpened",
			scheme: "universe",
			bank: "",
		});
		[n] = update(n, { kind: "schemeNameChanged", name: "renters" });
		[n] = update(n, { kind: "schemeTextChanged", text: "Renters" });
		[n] = update(n, { kind: "schemeNamingConfirmed" });
		const universe = Math.max(...Object.keys(n.local.schemes).map(Number));
		const [, made] = update(n, { kind: "saveRequested", id: universe });
		expect(commitOf(made)?.changes.map((c) => c.path)).toEqual([
			"universes/renters.yaml",
		]);
	});

	it("reads another author's file with the workspace's shared files", () => {
		const m = loaded(WORKSPACE);
		const path = "scales/yn.yaml";
		const [opened, cmds] = update(m, {
			kind: "hashChanged",
			hash: formatLink({ repo: "o/r", branch: "qretools-ann", file: path }),
		});
		expect(cmds).toContainEqual(
			expect.objectContaining({
				kind: "readAt",
				target: expect.objectContaining({
					path: "",
					branch: "qretools-ann",
				}),
				path,
				rel: "scales/yn.yaml",
			}),
		);
		const [shown] = update(opened, {
			kind: "foreignLoaded",
			branch: "qretools-ann",
			path,
			result: ok({
				file: { path: "scales/yn.yaml", sha: "theirs", text: "labels: {}\n" },
				schemes: [],
			}),
		});
		expect(shown.screen).toMatchObject({
			kind: "foreign",
			path,
			file: { path, sha: "theirs" },
		});
	});
});
