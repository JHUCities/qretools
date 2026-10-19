/**
 * The tutorial holds: its solutions are a clean workspace whose instruments all export,
 * and its exercises show exactly the gaps the lessons ask the learner to fill.
 */
import { workspaceOf } from "@qretools/core";
import { qsfOf } from "@qretools/qsf";
import { describe, expect, it } from "vitest";
import { pathOn, render, sideOf } from "./render.ts";
import { readSource } from "./source.ts";

const source = await readSource();
const yaml = (files: Record<string, string>) =>
	Object.fromEntries(
		Object.entries(files).filter(([p]) => p.endsWith(".yaml")),
	);
const ex = sideOf(source, "ex");
const sol = sideOf(source, "sol");

/** Every finding in a workspace, as `file severity code at`. */
const findingsOf = (files: Record<string, string>) => {
	const ws = workspaceOf(yaml(files));
	return {
		ws,
		lines: [
			...Object.entries(ws.bank.findings).flatMap(([file, fs]) =>
				fs.map((f) => `${file} ${f.severity} ${f.code} ${f.path}`),
			),
			...Object.entries(ws.instruments).flatMap(([file, { instrument }]) =>
				instrument.findings.map(
					(f) => `${file} ${f.severity} ${f.code} ${f.path}`,
				),
			),
		].sort(),
	};
};

describe("the tutorial", () => {
	it("renders each side with no marker left, and a one-sided file on its side only", () => {
		for (const side of [ex, sol])
			for (const text of Object.values(side))
				expect(text).not.toMatch(/ {2}#(SOL|EX)$/m);
		expect(render("a\nb  #SOL\nc  #EX\n", "ex")).toBe("a\nc\n");
		expect(pathOn("q/x.sol.yaml", "ex")).toBeUndefined();
		expect(pathOn("q/x.sol.yaml", "sol")).toBe("q/x.yaml");
	});

	it("numbers its lessons 1 to 33, with no gap", () => {
		const numbers = new Set(
			Object.values(ex).flatMap((t) =>
				[...t.matchAll(/Lesson (\d+) of 33:/g)].map((m) => Number(m[1])),
			),
		);
		expect([...numbers].sort((a, b) => a - b)).toEqual(
			Array.from({ length: 33 }, (_, i) => i + 1),
		);
	});

	it("has solutions with nothing to fill in, fix or reconsider, whose instruments all export", () => {
		const { ws, lines } = findingsOf(sol);
		expect(lines).toEqual([]);
		expect(ws.ignored).toEqual([]);
		for (const [file, { instrument }] of Object.entries(ws.instruments))
			expect([
				file,
				qsfOf(instrument.ddi, { name: "t", created: "2026-10-18 00:00:00" })
					.kind,
			]).toEqual([file, "made"]);
	});

	it("has exercises showing exactly each lesson's gap", () => {
		// Instruments that ask a question of an unfinished lesson show it too, until it's done;
		// lesson 28's clash is the lesson itself.
		expect(findingsOf(ex).lines).toMatchInlineSnapshot(`
			[
			  "instruments/lesson22_first_instrument.yaml hole hole flow.2.ask",
			  "instruments/lesson23_stop.yaml hole hole flow.1.stop",
			  "instruments/lesson24_branch.yaml hole hole flow.1.if",
			  "instruments/lesson24_branch.yaml info universe flow.1.then.0.ask",
			  "instruments/lesson25_else_if.yaml hole hole flow.1.else.if",
			  "instruments/lesson25_else_if.yaml hole unknown-name flow.1.if",
			  "instruments/lesson26_compute.yaml hole hole flow.2.value",
			  "instruments/lesson27_fill.yaml error unknown-name flow.1.fill.rating",
			  "instruments/lesson27_fill.yaml hole hole flow.1.fill.rating",
			  "instruments/lesson28_ask_twice.yaml error name-clash flow.2.ask",
			  "instruments/lesson29_roster.yaml hole hole flow.1.count",
			  "instruments/lesson30_more.yaml hole hole flow.1.then.0.more",
			  "instruments/lesson31_checks.yaml hole hole flow.0.checks.0.ensure",
			  "instruments/lesson32_order.yaml hole hole flow.0.order",
			  "instruments/lesson33_survey.yaml error unknown-name flow.7.fill.rating",
			  "instruments/lesson33_survey.yaml hole hole flow.2.stop",
			  "instruments/lesson33_survey.yaml hole hole flow.5.then.0.ask",
			  "missing.yaml hole hole labels.-9",
			  "questions/lesson01_intent/park_visited.yaml hole hole intent",
			  "questions/lesson02_text/park_safety.yaml hole hole text",
			  "questions/lesson03_options/park_cleanliness.yaml hole hole responses.2",
			  "questions/lesson04_number/household_size.yaml hole hole ",
			  "questions/lesson05_open/park_wishes.yaml hole hole ",
			  "questions/lesson06_craft/playgrounds_kept.yaml hole hole text",
			  "questions/lesson06_craft/toilets_kept.yaml info double-barreled text",
			  "questions/lesson07_shared_scale/park_together.yaml hole hole responses",
			  "questions/lesson08_use_the_name/park_pride.yaml warning matches-scale responses",
			  "questions/lesson09_new_scale/park_visit_frequency.yaml hole hole responses",
			  "questions/lesson10_concept/park_use_weekly.yaml warning concept-prose concept",
			  "questions/lesson11_universe/park_nearby.yaml hole hole universe",
			  "questions/lesson12_instruction/park_main_use.yaml hole hole instruction",
			  "questions/lesson13_unit/park_visit_days.yaml hole hole number.unit",
			  "questions/lesson14_select_all/travel_modes.yaml warning no-none-option select",
			  "questions/lesson15_fill/park_comments.yaml hole hole text",
			  "questions/lesson20_variants/park_spending.yaml warning duplicate-text text",
			  "questions/lesson20_variants/park_spending_reversed.yaml warning duplicate-text text",
			  "select_all.yaml hole hole not_chosen",
			]
		`);
	});
});
