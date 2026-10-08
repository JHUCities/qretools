import { describe, expect, it } from "vitest";
import { resolveAddress } from "./address.ts";

const at = (path: string) => ({ owner: "o", repo: "r", path });

describe("where a bank an instrument uses is", () => {
	it("is a folder relative to the instrument's own, in the same repository", () => {
		expect(
			resolveAddress(at("p"), "instruments/x.yaml", "../banks/hh"),
		).toEqual({ kind: "folder", bank: at("p/banks/hh") });
		expect(resolveAddress(at(""), "instruments/x.yaml", "./hh")).toEqual({
			kind: "folder",
			bank: at("instruments/hh"),
		});
		expect(
			resolveAddress(at("p"), "instruments/x.yaml", "../../shared/./b/"),
		).toEqual({ kind: "folder", bank: at("shared/b") });
	});

	it("never leaves the repository, and reads no other kind of address yet", () => {
		expect(
			resolveAddress(at(""), "instruments/x.yaml", "../../banks/hh").kind,
		).toBe("unreadable");
		expect(
			resolveAddress(at("p"), "instruments/x.yaml", "o/bank@v1"),
		).toMatchObject({
			kind: "unreadable",
			reason: expect.stringMatching(/\.\//),
		});
		expect(resolveAddress(at("p"), "instruments/x.yaml", "hh").kind).toBe(
			"unreadable",
		);
	});
});
