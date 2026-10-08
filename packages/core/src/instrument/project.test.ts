import { describe, expect, it } from "vitest";
import { projectOf } from "./project.ts";

const codes = (source: string) =>
	projectOf(source).findings.map((f) => [f.severity, f.code, f.path]);

describe("the project file", () => {
	it("gives the agency the project's instruments are published under", () => {
		expect(projectOf("agency: org.example\n")).toMatchObject({
			agency: "org.example",
			findings: [],
		});
	});

	it("is read by the bank file's rule: a missing, empty or invalid agency is a finding with its place", () => {
		expect(codes("")).toEqual([["hole", "hole", "agency"]]);
		expect(projectOf("").findings[0]?.message).toMatch(
			/this project's instruments are published under/,
		);
		expect(codes("agency:\n")).toEqual([["hole", "hole", "agency"]]);
		const bad = projectOf("agency: my org\n");
		expect(bad.agency).toBeUndefined();
		// As written, for the instrument to say what's wrong with it.
		expect(bad.given).toBe("my org");
		expect(projectOf("agency: org.example\n").given).toBe("org.example");
		expect(projectOf("agency:\n").given).toBeUndefined();
		expect(bad.findings.map((f) => f.code)).toEqual(["invalid-agency"]);
		expect(bad.ranges.agency).toBeDefined();
		expect(codes("agency: a\nname: x\n")).toEqual([
			["error", "unknown-key", "name"],
		]);
	});
});
