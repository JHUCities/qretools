import { describe, expect, it } from "vitest";
import { qsfOf, qsfRefusalReason, qsfTime } from "./qsf.ts";
import { demoDdi } from "./testing.ts";

describe("an instrument's DDI as a Qualtrics survey", () => {
	it("reads, writes, and refuses on any error", () => {
		const r = qsfOf(demoDdi(), {
			name: "demo",
			created: "2026-10-18 09:30:00",
		});
		const errors = r.findings.filter((f) => f.severity === "error").length;
		if (r.kind === "made") {
			expect(errors).toBe(0);
			expect(r.qsf.SurveyEntry).toMatchObject({
				SurveyName: "demo",
				SurveyCreationDate: "2026-10-18 09:30:00",
			});
		} else expect(r.errors).toBe(errors);
	});

	it("gives no survey for DDI it can't read", () => {
		const r = qsfOf({}, { name: "x", created: "2026-10-18 00:00:00" });
		expect(r).toMatchObject({ kind: "refused", errors: 1 });
		expect(qsfRefusalReason(1)).toBe(
			"1 thing in this instrument can't be run in Qualtrics.",
		);
	});

	it("stamps the time as the survey header has it", () => {
		expect(qsfTime(new Date(Date.UTC(2026, 9, 18, 9, 5, 7)))).toBe(
			"2026-10-18 09:05:07",
		);
	});
});
