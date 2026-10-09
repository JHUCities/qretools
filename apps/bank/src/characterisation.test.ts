/**
 * What the app does with one bank, end to end, recorded before it learned to hold a
 * workspace of several: the load, the tree, the paths every save, move and delete
 * commits to, and the links it writes. A bank at the repository's root and the same
 * bank in a folder of it must go on giving exactly this.
 */
import { fileURLToPath } from "node:url";
import { evaluate, evaluateScheme, indexOf, ok } from "@qretools/core";
import { readBank } from "@qretools/core/node";
import type { File } from "@qretools/shell";
import { beforeAll, describe, expect, it } from "vitest";
import { envIn, init, type Model, type Msg } from "./model.js";
import { schemeSections, treeOf } from "./tree.js";
import { update } from "./update.js";

type Step = ReturnType<typeof update>;

let files: readonly File[];
beforeAll(async () => {
	const read = await readBank(
		fileURLToPath(
			new URL("../../../packages/core/fixtures/bank", import.meta.url),
		),
	);
	files = Object.entries(read)
		.sort(([a], [b]) => (a < b ? -1 : 1))
		.map(([path, text]) => ({ path, sha: `sha-${path}`, text }));
});

/**
 * The app's internals the transcript reaches, in two helpers: the load message, and the
 * view of a loaded model. Later changes to the app touch only these, never what follows.
 */
const loadedMsg = (loaded: readonly File[]): Msg => ({
	kind: "workspaceLoaded",
	result: ok({
		files: loaded,
		found: true,
		from: "branch" as const,
		aheadBy: 0,
		behindBy: 0,
		unread: [],
	}),
});

/** What the tree shows of a loaded model, and which paths it holds as GitHub's copy. */
function view(m: Model) {
	const envFor = (bank: string) => envIn(m, bank);
	const indexFor = (bank: string) =>
		indexOf(
			Object.values(m.local.questions)
				.filter((q) => q.bank === bank)
				.map((q) => ({
					key: q.id,
					symbols: evaluate(q.source, envFor(bank)).symbols,
				})),
		);
	return {
		remote: {
			questions: Object.keys(m.remote.questions).sort(),
			schemes: Object.keys(m.remote.schemes).sort(),
		},
		// One bank, at the workspace's root.
		tree: treeOf(m, (q) => evaluate(q.source, envFor(q.bank)), "").map((f) => ({
			folder: f.name,
			leaves: f.leaves.map((l) => `${l.name} ${l.status.kind}`),
		})),
		shared: schemeSections(
			m,
			(e) => evaluateScheme(e.kind, e.source, envFor(e.bank), e.name),
			indexFor(""),
			"",
		).map((s) => ({
			kind: s.kind,
			leaves: s.leaves.map(
				(l) => `${l.name} ${l.status.kind} used by ${l.usedBy ?? "-"}`,
			),
		})),
	};
}

/** Connected to a bank at `path` in the repository, with its load done. */
function loaded(path: string): Model {
	const settings = { owner: "octo-org", repo: "survey", path, remember: false };
	const [start] = init({ work: ok(undefined), hasToken: true, settings });
	const steps: Msg[] = [
		{
			kind: "connected",
			result: ok({
				login: "iain",
				avatarUrl: "https://a/iain",
				access: { kind: "write" },
				defaultBranch: "main",
			}),
		},
		loadedMsg(files),
	];
	return steps.reduce((m, msg) => update(m, msg)[0], start);
}

/** What a step asked GitHub to do, and what it put in the address bar. */
const effects = ([, cmds]: Step): Record<string, unknown>[] =>
	cmds.flatMap((c): Record<string, unknown>[] =>
		c.kind === "commit"
			? [
					{
						commit: c.message,
						branch: c.target.branch,
						bank: c.target.path,
						changes: c.changes.map((ch) => ({
							path: ch.path,
							expected: ch.expected,
							deletes: ch.text === null,
						})),
					},
				]
			: c.kind === "setLink"
				? [{ link: c.hash, push: c.push }]
				: [],
	);

/** A committed change set, as GitHub would answer it: each path at a new sha. */
function committed(step: Step): Model {
	const commit = step[1].find((c) => c.kind === "commit");
	if (commit?.kind !== "commit") return step[0];
	return update(step[0], {
		kind: "committed",
		changes: commit.changes,
		result: ok({
			shas: Object.fromEntries(
				commit.changes.flatMap((c) =>
					c.text === null ? [] : [[c.path, `new-${c.path}`]],
				),
			),
		}),
	})[0];
}

/** The whole transcript for a bank at `path`: what the load shows, and what each act commits. */
function transcript(path: string) {
	let m = loaded(path);
	const shown = view(m);
	const acts: unknown[] = [];
	const act = (...msgs: Msg[]): Step => {
		let step: Step = [m, []];
		for (const msg of msgs) {
			step = update(step[0], msg);
			acts.push({ msg: msg.kind, effects: effects(step) });
		}
		m = committed(step);
		return step;
	};
	const idOf = (p: string): number => {
		const f = [
			...Object.values(m.local.questions),
			...Object.values(m.local.schemes),
		].find((e) => e.base?.path === p);
		if (f === undefined) throw new Error(`no file at ${p}`);
		return f.id;
	};
	const first = shown.remote.questions[0] ?? "";
	act({ kind: "fileOpened", id: idOf(first) });
	act({
		kind: "edited",
		text: `${m.local.questions[idOf(first)]?.source}# edited\n`,
	});
	act({ kind: "saveRequested", id: idOf(first) });
	act(
		{ kind: "moveRequested", id: idOf(first), folder: "moved" },
		{ kind: "moveConfirmed" },
	);
	act({
		kind: "questionCreated",
		text: "name: brand_new\ntext: New?\nintent: To see.\nopen: {}\n",
	});
	const draft = Math.max(...Object.keys(m.local.questions).map(Number));
	act(
		{ kind: "saveRequested", id: draft },
		{ kind: "saveFolderChanged", folder: "fresh" },
		{ kind: "saveConfirmed" },
	);
	act(
		{ kind: "schemeCreateOpened", scheme: "universe" },
		{ kind: "schemeNameChanged", name: "renters" },
		{ kind: "schemeTextChanged", text: "Renters" },
		{ kind: "schemeNamingConfirmed" },
	);
	const universe = Math.max(...Object.keys(m.local.schemes).map(Number));
	act({ kind: "saveRequested", id: universe });
	const second = shown.remote.questions[1] ?? "";
	act(
		{ kind: "deleteRequested", id: idOf(second) },
		{ kind: "deleteRequested", id: idOf(second) },
	);
	return { shown, acts };
}

describe("one bank, as the app has always held it", () => {
	it("at the repository's root", () => {
		expect(transcript("")).toMatchSnapshot();
	});

	it("in a folder of the repository: the same, with the store adding the folder", () => {
		const atRoot = transcript("");
		const inFolder = transcript("banks/hh");
		// The repository in links names the folder; nothing else differs.
		expect(
			JSON.parse(
				JSON.stringify(inFolder).replaceAll(
					"octo-org%2Fsurvey%2Fbanks%2Fhh",
					"octo-org%2Fsurvey",
				),
			),
		).toEqual({
			...atRoot,
			acts: (atRoot.acts as { effects: { bank?: string }[] }[]).map((a) => ({
				...a,
				effects: a.effects.map((e) =>
					e.bank === undefined ? e : { ...e, bank: "banks/hh" },
				),
			})),
		});
	});
});
