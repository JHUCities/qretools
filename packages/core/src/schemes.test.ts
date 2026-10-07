import { describe, expect, it } from "vitest";
import {
	evaluateScheme,
	isRoot,
	kindAt,
	labelledSource,
	SCHEME_KINDS,
	schemeEnv,
	schemePath,
} from "./schemes.js";
import { EMPTY_ENV } from "./surface/env.js";
import { parseSurface } from "./surface/parse.js";
import { nameFrom } from "./surface/schema.js";

const brief = (f: { severity: string; code: string; path: string }) =>
	`${f.severity}:${f.code}@${f.path}`;

describe("scheme paths", () => {
	it("round-trip between a kind and name and the path they live at", () => {
		// A root file's name is its kind; any other kind's is the file's name.
		for (const kind of SCHEME_KINDS) {
			const name = isRoot(kind) ? kind : "x_1";
			expect(kindAt(schemePath(kind, name))).toEqual({ kind, name });
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

describe("a concept file", () => {
	it("reads a label and a definition; a missing label is a hole", () => {
		expect(
			evaluateScheme(
				"concept",
				"label: Neighborhood satisfaction\ndefinition: How content residents are.\n",
				EMPTY_ENV,
			).value,
		).toEqual({
			kind: "labelled",
			entry: {
				label: "Neighborhood satisfaction",
				definition: "How content residents are.",
			},
		});
		expect(
			evaluateScheme("concept", "definition: x\n", EMPTY_ENV).findings.map(
				(f) => `${f.severity}@${f.path}`,
			),
		).toEqual(["hole@label"]);
		expect(
			evaluateScheme(
				"concept",
				"label: x\nlabels: y\n",
				EMPTY_ENV,
			).findings.map((f) => f.code),
		).toEqual(["unknown-key"]);
	});

	it("lives in concepts/, is in the environment by its name, and starts from its label", () => {
		expect(schemePath("concept", "trust")).toBe("concepts/trust.yaml");
		expect(kindAt("concepts/trust.yaml")).toEqual({
			kind: "concept",
			name: "trust",
		});
		expect(
			schemeEnv([{ kind: "concept", name: "trust", text: "label: Trust\n" }])
				.concepts,
		).toEqual({ trust: { label: "Trust" } });
		expect(labelledSource(" Trust: in government ")).toBe(
			'label: "Trust: in government"\n',
		);
	});
});

describe("names made from words", () => {
	it("are always valid names", () => {
		expect(nameFrom("Racial identification", "concept")).toBe(
			"racial_identification",
		);
		expect(nameFrom("  Trust (in) gov't!  ", "concept")).toBe("trust_in_gov_t");
		expect(nameFrom("2nd language", "concept")).toBe("concept_2nd_language");
		expect(nameFrom("Café", "concept")).toBe("cafe");
		expect(nameFrom("!!!", "concept")).toBe("concept");
	});
});
