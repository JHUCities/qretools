/** The template a new instrument starts from: its own workspace named, every other field to fill in, nothing wrong. */
import { describe, expect, it } from "vitest";
import template from "../../templates/instrument/instrument.yaml?raw";
import { bankOf } from "../evaluate.ts";
import { instrumentOf } from "../instrument/instrument.ts";

describe("the instrument template", () => {
	it("reads as exactly its fields to fill in, and nothing else", () => {
		// The agency is the workspace's, given here so only the template's own holes show.
		const { findings } = instrumentOf(template, {
			banks: { bank: bankOf({ "workspace.yaml": "agency: org.example\n" }) },
			agency: "org.example",
		});
		expect(findings.map((f) => [f.severity, f.path])).toEqual([
			["hole", "name"],
			["hole", "title"],
			["hole", "flow.0.ask"],
		]);
	});
});
