import { describe, expect, it } from "vitest";
import { evaluate } from "./evaluate.ts";
import { addEntry } from "./surface/edit.ts";
import { EMPTY_ENV } from "./surface/env.ts";

const base =
	'name: q\ntext: Which do you use?\nintent: Prevalence of each mode among adults\nselect: many\nresponses:\n  "1": Bus\n  "2": Train\n';
const said = (source: string) => {
	const ev = evaluate(source, EMPTY_ENV);
	return {
		shown: ev.findings.map((f) => `${f.severity}:${f.code}@${f.path}`),
		dismissed: ev.dismissed.map((d) => `${d.finding.code}: ${d.reason}`),
	};
};

describe("dismiss", () => {
	it("hides the advice it names and keeps the reason", () => {
		expect(said(base).shown).toContain("warning:no-none-option@select");
		expect(
			said(`${base}dismiss:\n  no-none-option: Everyone uses one.\n`),
		).toEqual({ shown: [], dismissed: ["no-none-option: Everyone uses one."] });
	});

	it("is a hole without a reason, and hides nothing until it has one", () => {
		expect(said(`${base}dismiss:\n  no-none-option:\n`).shown).toEqual([
			"warning:no-none-option@select",
			"hole:hole@dismiss.no-none-option",
		]);
		expect(said(`${base}dismiss:\n`).shown).toContain("hole:hole@dismiss");
	});

	it("refuses what isn't advice a question can dismiss", () => {
		expect(
			said(`${base}dismiss:\n  duplicate-option-variable: x\n  nope: y\n`)
				.shown,
		).toEqual([
			"warning:no-none-option@select",
			"warning:unknown-key@dismiss.duplicate-option-variable",
			"warning:unknown-key@dismiss.nope",
		]);
	});

	it("says when there is nothing to dismiss", () => {
		expect(
			said(`${base}dismiss:\n  no-none-option: x\n  double-barreled: y\n`),
		).toEqual({
			shown: ["info:nothing-dismissed@dismiss.double-barreled"],
			dismissed: ["no-none-option: x"],
		});
	});

	it("is written by the advice's Dismiss, the caret at the empty reason", () => {
		const r = addEntry(base, "dismiss", "no-none-option");
		expect(r).toMatchObject({
			kind: "written",
			text: `${base}dismiss:\n  no-none-option:\n`,
		});
	});
});
