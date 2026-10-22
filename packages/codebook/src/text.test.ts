import { describe, expect, it } from "vitest";
import { linked, textOf } from "./text.ts";

describe("text", () => {
	it("makes a web address a link, without the punctuation around it", () => {
		const urls = (s: string) =>
			linked(s).flatMap((x) => (x.kind === "link" ? [x.url] : []));
		expect(urls("See https://example.org/a.")).toEqual([
			"https://example.org/a",
		]);
		expect(urls("(at http://example.org/b?c=1)")).toEqual([
			"http://example.org/b?c=1",
		]);
		expect(urls("https://example.org/x, https://example.org/y;")).toEqual([
			"https://example.org/x",
			"https://example.org/y",
		]);
		expect(urls("no address: example.org")).toEqual([]);
	});

	it("splits paragraphs at blank lines and keeps single line breaks", () => {
		expect(textOf("One\nline.\n \n\nTwo.")).toEqual([
			[{ kind: "text", text: "One\nline." }],
			[{ kind: "text", text: "Two." }],
		]);
		expect(textOf("")).toBeUndefined();
		expect(textOf(undefined)).toBeUndefined();
	});
});
