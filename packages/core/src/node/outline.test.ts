import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { bankOf } from "../evaluate.ts";
import { instrumentOf } from "../instrument/instrument.ts";
import { type OutlineItem, outlineOf } from "../instrument/outline.ts";
import { readBank } from "./index.ts";

const here = (path: string): string =>
	fileURLToPath(new URL(path, import.meta.url));

/** An outline as indented lines: keywords bare, names in backticks, holes in brackets. */
const lines = (items: readonly OutlineItem[], depth = 0): string[] =>
	items.flatMap((i) => [
		`${"  ".repeat(depth)}${i.label
			.map((p) =>
				p.kind === "code"
					? `\`${p.text}\``
					: p.kind === "hole"
						? `[${p.text}]`
						: p.text,
			)
			.join(" ")}${i.detail === undefined ? "" : ` — ${i.detail}`}  @${i.path}`,
		...lines(i.children, depth + 1),
	]);

describe("an instrument's outline", async () => {
	const banks = {
		hh: bankOf(await readBank(here("../../fixtures/households"))),
	};

	it("follows the flow, nested as it nests, each item at its path", async () => {
		const { draft } = instrumentOf(
			await readFile(
				here("../../fixtures/instruments/households.yaml"),
				"utf8",
			),
			{ banks },
		);
		expect(lines(outlineOf(draft))).toMatchSnapshot();
	});

	it("shows branches, a question asked again, and what is still to be written", () => {
		const { draft } = instrumentOf(
			[
				"uses:",
				"  hh: ../households",
				"flow:",
				"  - ask: hh.size",
				"  - ask: hh.size",
				"    as: size_again",
				"  - if: hh.size > 2",
				"    then:",
				"      - say: Big.",
				"    else:",
				"      if:",
				"      then:",
				"        - say: Unknown.",
				"      else:",
				"        - ask:",
				"  - stop:",
				"  - compute:",
				"  - roster:",
				"    count: hh.size",
				"    flow: []",
				"  - nothing: here",
				"",
			].join("\n"),
			{ banks },
		);
		expect(lines(outlineOf(draft))).toMatchSnapshot();
		// Each item at a place of its own, so a view can key and link items by path.
		const paths = lines(outlineOf(draft)).map((l) => l.split("@")[1]);
		expect(new Set(paths).size).toBe(paths.length);
	});
});
