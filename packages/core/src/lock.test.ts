import { describe, expect, it } from "vitest";
import { locksFor } from "./lock.ts";
import type { RemoteBank } from "./workspace.ts";

const A = "a".repeat(40);
const B = "b".repeat(40);
const at = (commit: string): RemoteBank => ({
	kind: "files",
	files: {},
	at: { commit, blobs: {} },
});

describe("what saving or exporting an instrument locks", () => {
	it("is each tag it reads at the commit read, where that isn't its lock already", () => {
		expect(
			locksFor(
				["o/same@v1", "o/moved@v1", "o/new@v1"],
				{ "o/same@v1": at(A), "o/moved@v1": at(B), "o/new@v1": at(B) },
				{ "o/same@v1": A, "o/moved@v1": A, "o/other@v1": A },
			),
		).toEqual({ "o/moved@v1": B, "o/new@v1": B });
	});

	it("is nothing for a bank not read at a tag: read from a folder, unread, or unavailable", () => {
		expect(
			locksFor(
				["o/folder@v1", "o/unread@v1", "o/gone@v1"],
				{
					"o/folder@v1": { kind: "files", files: {} },
					"o/gone@v1": { kind: "unavailable", reason: "no" },
				},
				{},
			),
		).toEqual({});
	});
});
