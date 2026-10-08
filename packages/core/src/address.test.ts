import { describe, expect, it } from "vitest";
import { addressOf, joinFolder } from "./address.ts";

describe("a bank's address", () => {
	it("is a folder beside the instrument when it starts ./ or ../", () => {
		expect(addressOf("../banks/hh")).toEqual({
			kind: "local",
			path: "../banks/hh",
		});
		expect(addressOf(" ./hh ")).toEqual({ kind: "local", path: "./hh" });
	});

	it("is a repository, a folder in it, and a version, the version last", () => {
		expect(addressOf("JHUCities/qretools-bank-template@v1")).toEqual({
			kind: "remote",
			owner: "JHUCities",
			repo: "qretools-bank-template",
			path: "",
			ref: "v1",
			key: "jhucities/qretools-bank-template@v1",
		});
		expect(addressOf("o/r@v1.0.0+2026")).toMatchObject({ ref: "v1.0.0+2026" });
		expect(addressOf("o/r/banks/Hh/@release/2026.1")).toMatchObject({
			path: "banks/Hh",
			ref: "release/2026.1",
			key: "o/r/banks/Hh@release/2026.1",
		});
	});

	it("is one bank however its owner and repository are capitalised, never its folder or version", () => {
		const key = (t: string) => {
			const a = addressOf(t);
			return a.kind === "remote" ? a.key : undefined;
		};
		expect(key("O/R/b@V1")).toBe(key("o/r/b@V1"));
		expect(key("o/r/B@v1")).not.toBe(key("o/r/b@v1"));
		expect(key("o/r/b@V1")).not.toBe(key("o/r/b@v1"));
	});

	it("says what's wrong with anything else", () => {
		for (const text of [
			"hh",
			"o/r",
			"o@v1",
			"-o/r@v1",
			"o/r@",
			"o/r/../b@v1",
			"o/r//b@v1",
			"o/r@v 1",
			"o/../b@v1",
			"../banks/hh@v1",
			"o/r@v1..2",
			"o/r@.v1",
			"o/r@v1/.x",
			"o/r@v1.lock",
			"o/r@v:1",
		])
			expect(addressOf(text), text).toMatchObject({
				kind: "invalid",
				reason: expect.stringContaining(`\`${text}\``),
			});
		expect(
			addressOf("o/r").kind === "invalid" && addressOf("o/r"),
		).toMatchObject({ reason: expect.stringContaining("`o/r@v1`") });
	});
});

describe("a folder from a folder", () => {
	it("follows . and .. and ignores empty parts", () => {
		expect(joinFolder("instruments", "../banks/hh")).toBe("banks/hh");
		expect(joinFolder("", "./hh/")).toBe("hh");
		expect(joinFolder("p/instruments", "../../shared/./b")).toBe("shared/b");
		expect(joinFolder("a", "..")).toBe("");
	});

	it("leads nowhere above the root", () => {
		expect(joinFolder("instruments", "../../hh")).toBeUndefined();
	});
});
