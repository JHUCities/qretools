import { describe, expect, it } from "vitest";
import { evaluate } from "./evaluate.js";
import { type Finding, inDocumentOrder, locate, status } from "./findings.js";
import { EMPTY_ENV } from "./surface/env.js";

const statusOf = (source: string) =>
	status(evaluate(source, "org.example", EMPTY_ENV).findings);

describe("status", () => {
	it("is the core's verdict on a draft", () => {
		expect(statusOf("")).toEqual({ kind: "incomplete", holes: 4, errors: 0 });
		expect(
			statusOf(
				"name: q\ntext: Do you rent?\nintent: Prevalence of renting among adults\nopen: {}\n",
			),
		).toEqual({
			kind: "complete",
		});
		expect(
			statusOf("name: q\ntext: Do you rent?\nintent: Housing\nopen: {}\n"),
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

describe("inDocumentOrder", () => {
	const f = (path: string, code: Finding["code"] = "hole"): Finding => ({
		code,
		severity: code === "hole" ? "hole" : "warning",
		path,
		message: path,
	});
	it("orders by place in the source, holes for unwritten fields last, ties as reported", () => {
		const ranges = { "": [0, 30], text: [10, 20], name: [0, 5] } as const;
		const ordered = inDocumentOrder(
			[f("intent"), f("text", "double-barreled"), f("name"), f("text")],
			ranges,
		);
		expect(ordered.map((x) => `${x.path}:${x.code}`)).toEqual([
			"name:hole",
			"text:double-barreled",
			"text:hole",
			"intent:hole",
		]);
	});
	it("is how evaluate reports them", () => {
		const ev = evaluate(
			"responses:\n  1: Yes\n  1: Yes\ntext: Do you rent and own?\n",
			"org.example",
			EMPTY_ENV,
		);
		const starts = ev.findings.map((x) => locate(x, ev.ranges)[0]);
		expect(starts).toEqual([...starts].sort((a, b) => a - b));
	});
});
