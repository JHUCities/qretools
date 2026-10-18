import { describe, expect, it } from "vitest";
import { qsfOf, qsfRefusal, qsfTime, withCreated } from "./qsf.ts";
import { demoDdi } from "./testing.ts";

describe("an instrument's DDI as a Qualtrics survey", () => {
	it("reads, writes, and refuses on any error", () => {
		const { qsf, findings } = qsfOf(demoDdi(), {
			name: "demo",
			created: "2026-10-18 09:30:00",
		});
		expect(qsf?.SurveyEntry).toMatchObject({ SurveyName: "demo" });
		expect(qsfRefusal(findings)).toEqual(
			findings.some((f) => f.severity === "error")
				? { errors: findings.filter((f) => f.severity === "error").length }
				: undefined,
		);
		expect(qsfRefusal([])).toBeUndefined();
	});

	it("gives no survey for DDI it can't read", () => {
		const { qsf, findings } = qsfOf(
			{},
			{ name: "x", created: "2026-10-18 00:00:00" },
		);
		expect(qsf).toBeUndefined();
		expect(qsfRefusal(findings)).toEqual({ errors: 1 });
	});

	it("stamps the time it's made, as the survey header has it", () => {
		expect(qsfTime(new Date(Date.UTC(2026, 9, 18, 9, 5, 7)))).toBe(
			"2026-10-18 09:05:07",
		);
		const { qsf } = qsfOf(demoDdi(), {
			name: "demo",
			created: "2000-01-01 00:00:00",
		});
		if (qsf === undefined) throw new Error("no survey");
		expect(withCreated(qsf, "2026-10-18 09:05:07").SurveyEntry).toMatchObject({
			SurveyCreationDate: "2026-10-18 09:05:07",
			LastModified: "2026-10-18 09:05:07",
			SurveyName: "demo",
		});
	});
});
