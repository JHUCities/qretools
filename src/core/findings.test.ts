import { describe, expect, it } from "vitest";
import { evaluate } from "./evaluate.js";
import { status } from "./findings.js";
import { EMPTY_ENV } from "./surface/env.js";

const statusOf = (source: string) =>
	status(evaluate(source, "org.example", EMPTY_ENV).findings);

describe("status", () => {
	it("is the core's verdict on a draft", () => {
		expect(statusOf("")).toEqual({ kind: "incomplete", holes: 4, errors: 0 });
		expect(
			statusOf(
				"name: q\ntext: Do you rent?\nintent: Prevalence of renting among adults\nopen:\n",
			),
		).toEqual({
			kind: "complete",
		});
		expect(
			statusOf("name: q\ntext: Do you rent?\nintent: Housing\nopen:\n"),
		).toEqual({ kind: "advice", count: 1 });
		expect(
			statusOf("name: q\ntext: Do you rent?\nintent: Housing\nwording: x\n"),
		).toEqual({
			kind: "incomplete",
			holes: 1,
			errors: 1,
		});
	});
});
