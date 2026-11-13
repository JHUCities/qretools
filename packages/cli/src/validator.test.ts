import { fileURLToPath } from "node:url";
import { makeValidator } from "@qretools/core";
import { expect, it, vi } from "vitest";
import { type Io, main } from "./cli.ts";
import { ownRepository, readHistory } from "./history.ts";

// A file of its own: the mock and the module's compiled validator are this file's alone.
vi.mock("@qretools/core", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@qretools/core")>();
	return { ...actual, makeValidator: vi.fn(actual.makeValidator) };
});

const SAMPLE = fileURLToPath(
	new URL("../../core/fixtures/bank", import.meta.url),
);

const io: Io = {
	out: () => {},
	err: () => {},
	writeFile: async () => {},
	removeFile: async () => {},
	readRemote: async () => {
		throw new Error("no remote in this test");
	},
	readHistory,
	ownRepository,
	readStdin: async () => "",
	fetch: async () => {
		throw new Error("no network in this test");
	},
};

it("compiles the DDI schema once for two exports", async () => {
	expect(await main(["export", SAMPLE, "-o", "a.json"], io)).toBe(0);
	expect(await main(["export", SAMPLE, "-o", "b.json"], io)).toBe(0);
	expect(makeValidator).toHaveBeenCalledTimes(1);
});
