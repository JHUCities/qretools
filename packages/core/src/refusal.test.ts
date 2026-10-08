import { describe, expect, it } from "vitest";
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
		expect(r && refusalReason(r)).toBe("Every item needs a real DDI agency.");
	});
});
