import { describe, expect, it } from "vitest";
import { manifestVersions, tagMessage } from "./manifest.ts";

const VERSIONS = {
	"questions/t/q.yaml": {
		number: "3",
		date: "2026-10-01T12:00:00Z",
		blob: "bq",
	},
	"scales/agree.yaml": { number: "2", blob: "bs" },
	"missing.yaml": { number: "1", blob: "bm" },
};
// What a read at the tag sees: the versioned files, and others no version is counted for.
const READ = {
	"questions/t/q.yaml": "bq",
	"scales/agree.yaml": "bs",
	"missing.yaml": "bm",
	"workspace.yaml": "bw",
	"instruments/x.yaml": "bx",
};
const MESSAGE = tagMessage(VERSIONS, "2.0.0");

describe("a release's manifest in its tag's message", () => {
	it("reads back the versions it was written with", () => {
		expect(MESSAGE.split("\n")[0]).toBe(
			"Each file's DDI version, by QREtools 2.0.0",
		);
		expect(manifestVersions(MESSAGE, READ)).toEqual({
			kind: "used",
			versions: VERSIONS,
		});
	});

	it("reads it whatever signature git keeps after it, and with CRLF", () => {
		const signed = `${MESSAGE}-----BEGIN PGP SIGNATURE-----\n\nabc\n-----END PGP SIGNATURE-----\n`;
		expect(manifestVersions(signed, READ).kind).toBe("used");
		expect(manifestVersions(MESSAGE.replaceAll("\n", "\r\n"), READ).kind).toBe(
			"used",
		);
	});

	it("is no manifest in a tag whose message is prose, or that has none", () => {
		expect(manifestVersions("v1: the first release\n", READ)).toEqual({
			kind: "none",
		});
		expect(manifestVersions("v1\n\nWhat changed: wording.\n", READ)).toEqual({
			kind: "none",
		});
		expect(manifestVersions("", READ)).toEqual({ kind: "none" });
	});

	it("is used all or not at all: one file read differently, or not in it, makes it stale", () => {
		expect(
			manifestVersions(MESSAGE, { ...READ, "scales/agree.yaml": "other" }),
		).toMatchObject({
			kind: "stale",
			reason: expect.stringContaining("scales/agree.yaml"),
		});
		expect(
			manifestVersions(MESSAGE, { ...READ, "scales/new.yaml": "bn" }),
		).toMatchObject({ kind: "stale" });
		const { "missing.yaml": _, ...without } = READ;
		expect(manifestVersions(MESSAGE, without)).toMatchObject({
			kind: "stale",
		});
	});

	it("says it can't read one that isn't its shape, and ignores fields it doesn't know", () => {
		expect(manifestVersions("v1\n\n{ not json\n}\n", READ)).toMatchObject({
			kind: "unreadable",
		});
		expect(manifestVersions('v1\n\n{\n  "files": 3\n}\n', READ)).toMatchObject({
			kind: "unreadable",
		});
		const badDate = MESSAGE.replace("2026-10-01T12:00:00Z", "yesterday");
		expect(manifestVersions(badDate, READ).kind).toBe("unreadable");
		const later = MESSAGE.replace('"qretools"', '"later": true,\n  "qretools"');
		expect(manifestVersions(later, READ).kind).toBe("used");
	});
});
