import { describe, expect, it } from "vitest";
import {
	evaluateScheme,
	kindAt,
	SCHEME_KINDS,
	schemeEnv,
	schemePath,
} from "./schemes.js";
import { EMPTY_ENV } from "./surface/env.js";
import { parseSurface } from "./surface/parse.js";

const brief = (f: { severity: string; code: string; path: string }) =>
	`${f.severity}:${f.code}@${f.path}`;

describe("scheme paths", () => {
	it("round-trip between a kind and name and the path they live at", () => {
		for (const kind of SCHEME_KINDS) {
			const path = schemePath(kind, kind === "missing" ? "missing" : "x_1");
			expect(kindAt(path)).toEqual({
				kind,
				name: kind === "missing" ? "missing" : "x_1",
			});
		}
		expect(kindAt("questions/nhd/nhd_sat.yaml")).toEqual({ kind: "question" });
		for (const other of [
			"README.md",
			"migration/convert.ts",
			"questions/x.yaml",
			"scales/a/b.yaml",
			"archive/old.yaml",
		])
			expect(kindAt(other)).toBeUndefined();
	});
});

describe("evaluateScheme", () => {
	const missing = [{ code: "-8", label: "Item non-response" }];
	it("reads each kind, and says what is wrong in place", () => {
		expect(
			evaluateScheme("universe", "text: Renters\n", EMPTY_ENV),
		).toMatchObject({
			findings: [],
			value: { kind: "text", text: "Renters" },
		});
		expect(
			evaluateScheme("instruction", "text:\n", EMPTY_ENV).findings.map(brief),
		).toEqual(["hole:hole@text"]);
		const scale = evaluateScheme("scale", 'labels:\n  1: Yes\n  "-8": Oops\n', {
			...EMPTY_ENV,
			missing,
		});
		expect(scale.findings.map(brief)).toEqual([
			"warning:missing-code@labels.-8",
		]);
		expect(scale.ranges["labels.-8"]).toBeDefined();
		// The missing list is not checked against itself.
		expect(
			evaluateScheme("missing", 'labels:\n  "-8": x\n', {
				...EMPTY_ENV,
				missing,
			}).findings,
		).toEqual([]);
	});
});

describe("schemeEnv", () => {
	it("builds the environment; a broken file contributes nothing, and its users become holes", () => {
		const env = schemeEnv([
			{ kind: "scale", name: "yn", text: "labels:\n  1: Yes\n  2: No\n" },
			{ kind: "scale", name: "broken", text: "labels:\n" },
			{ kind: "universe", name: "renters", text: "text: Renters\n" },
			{ kind: "instruction", name: "one", text: "text: Select one\n" },
			{ kind: "missing", name: "missing", text: 'labels:\n  "-8": NR\n' },
		]);
		expect(Object.keys(env.scales)).toEqual(["yn"]);
		expect(env.universes.renters?.text).toBe("Renters");
		expect(env.instructions.one?.text).toBe("Select one");
		expect(env.missing).toEqual([{ code: "-8", label: "NR" }]);
		const { findings, mentions } = parseSurface(
			"name: q\ntext: Q?\nintent: Prevalence of x\nresponses: broken\nuniverse: renters\n",
			env,
		);
		expect(findings.map(brief)).toEqual(["hole:hole@responses"]);
		expect(mentions).toEqual([
			{ scheme: "scale", name: "broken", path: "responses" },
			{ scheme: "universe", name: "renters", path: "universe" },
		]);
	});
});
