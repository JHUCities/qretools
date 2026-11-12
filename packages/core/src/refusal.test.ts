import { describe, expect, it } from "vitest";
import { bankOf } from "./evaluate.ts";
import type { Finding } from "./findings.ts";
import { exportRefusal, refusalReason } from "./refusal.ts";

const invalid: Finding = {
	code: "invalid-agency",
	severity: "error",
	path: "uses.hh",
	message: "`hh` declares no DDI agency.",
};
const hole: Finding = {
	code: "hole",
	severity: "hole",
	path: "flow",
	message: "Fill this in.",
};
const problem: Finding = {
	code: "ddi-invalid",
	severity: "error",
	path: "",
	message: "No.",
};
const clash = { urn: "a:b:1", keys: ["x", "y"] };

describe("when an export is refused", () => {
	it("checks in order: agency, agencies, identities, then the schema", () => {
		const kinds = [
			exportRefusal({ findings: [invalid], collisions: [clash] }, [problem]),
			exportRefusal({ agency: "a", findings: [invalid], collisions: [clash] }, [
				problem,
			]),
			exportRefusal({ agency: "a", collisions: [clash] }, [problem]),
			exportRefusal({ agency: "a", collisions: [] }, undefined),
			exportRefusal({ agency: "a", collisions: [] }, [problem]),
		].map((r) => r?.kind);
		expect(kinds).toEqual([
			"noAgency",
			"invalidAgency",
			"collisions",
			"unchecked",
			"schema",
		]);
	});

	it("refuses while an access level can't be read, but not for a level held at the last", () => {
		const finding = (code: Finding["code"]): Finding => ({
			code,
			severity: "error",
			path: "access",
			message: "m",
		});
		const kind = (code: Finding["code"]) =>
			exportRefusal(
				{ agency: "a", findings: [finding(code)], collisions: [] },
				[],
			)?.kind;
		expect(kind("access-unreadable")).toBe("access");
		expect(kind("no-access-levels")).toBe("access");
		expect(kind("unknown-access")).toBeUndefined();
	});

	it("refuses a bank whose access list can't be read, saying why, and only while a question names a level", () => {
		const ZIP =
			"name: zip\ntext: ZIP?\nintent: i\nopen: {}\naccess: restricted\n";
		// As the CLI's export reads a bank: every file's findings.
		const refusal = (access: string, question = ZIP) => {
			const bank = bankOf({
				"workspace.yaml": `agency: org.example\n${access}`,
				...(question !== "" && { "questions/a/zip.yaml": question }),
			});
			return exportRefusal(
				{
					agency: "org.example",
					findings: Object.values(bank.findings).flat(),
					collisions: [],
				},
				[],
			);
		};
		const reasons: Record<string, string> = {
			"access:\n": "(`access` is empty)",
			"access: public\n": "(`access` must be a list of levels)",
			"access: [Public, restricted]\n": "(`Public` isn't a level's name)",
			"access: [public, restricted, public]\n": "(`public` is listed twice)",
			"": "workspace.yaml lists no access levels",
		};
		for (const [access, reason] of Object.entries(reasons)) {
			const r = refusal(access);
			expect([access, r?.kind]).toEqual([access, "access"]);
			expect(
				r?.kind === "access" &&
					r.findings.map((f) => f.message.includes(reason)),
			).toEqual([true]);
		}
		expect(refusal("access: [public, restricted]\n")).toBeUndefined();
		expect(refusal("access:\n", "")).toBeUndefined();
		// A level the list doesn't have is held at the last one, which is safe.
		expect(
			refusal(
				"access: [public, restricted]\n",
				ZIP.replace("restricted", "secret"),
			),
		).toBeUndefined();
	});

	it("doesn't refuse for holes: they leave elements out, and the findings say so", () => {
		expect(
			exportRefusal({ agency: "a", findings: [hole], collisions: [] }, []),
		).toBeUndefined();
	});

	it("carries what the refusal is about, and says it in a sentence", () => {
		const r = exportRefusal(
			{ agency: "a", findings: [hole, invalid], collisions: [] },
			[],
		);
		expect(r).toEqual({ kind: "invalidAgency", findings: [invalid] });
		expect(r && refusalReason(r)).toBe(
			"A DDI agency is missing or wrong. See Findings.",
		);
	});
});
