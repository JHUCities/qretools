// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import {
	bankOf,
	ddiIndexOf,
	evaluateCondition,
	instrumentOf,
	readInstruments,
} from "@qretools/core";
import { readWorkspace } from "@qretools/core/node";
import { describe, expect, it } from "vitest";
import { pageOf } from "../page.ts";
import { type Answer, walk } from "../walk.ts";

const root = join(import.meta.dirname, "../../../core/fixtures/households");
const made = instrumentOf(
	await readFile(`${root}/instruments/households.yaml`, "utf8"),
	{ banks: { hh: bankOf(await readWorkspace(root)) }, agency: "org.example" },
);
const read = readInstruments(ddiIndexOf(made.ddi));
const households = read.value.instruments[0];
if (households === undefined) throw new Error("no instrument read");

/** The run that gives each question met the answer `answer` names for it, in turn. */
const route = (
	answer: (question: string, row: string) => Answer,
	inputs: Record<string, Answer> = { county: "1" },
) => {
	const answers: Answer[] = [];
	for (let guard = 0; guard < 200; guard++) {
		const w = walk(
			households,
			{ inputs, answers, orders: {} },
			evaluateCondition,
		);
		const at = w.current;
		if (at === undefined) return w;
		const rows = Object.keys(w.held).length; // anything that changes per row will do for a key
		answers.push(
			at.step.kind === "ask"
				? answer(at.step.question.name, String(rows))
				: null,
		);
	}
	throw new Error("the walk didn't end");
};
const askedIn = (w: ReturnType<typeof route>) =>
	w.trail.flatMap((e) => (e.kind === "ask" ? [e.key] : []));

/** An answer for each question, as a person might give it. */
const typical: Record<string, Answer> = {
	consent: "1",
	size: 2,
	age: 40,
	works: "1",
	tenure: "2",
	rent: 900,
	utilities: "1",
	vehicle: "1",
	more_vehicles: "2",
	comments: "None",
};

describe("walking the households form", () => {
	it("reads the instrument with nothing it can't read", () => {
		expect(read.findings).toEqual([]);
	});

	it("goes everywhere the conditions say, each roster row by row", () => {
		const w = route((q) => typical[q] ?? null);
		expect(w.ended).toBe("end");
		expect(askedIn(w)).toEqual([
			"consent",
			"size",
			"age[1]",
			"works[1]",
			"age[2]",
			"works[2]",
			"tenure",
			"rent",
			"utilities",
			"vehicle[1]",
			"more_vehicles[1]",
			"comments",
		]);
		// `each: members` reads each row's own answer.
		expect(
			w.trail
				.filter((e) => e.kind === "say")
				.map((e) => e.kind === "say" && e.text),
		).toEqual([
			"Thank you for taking part in this survey of 1.",
			"The next questions are about person 1.",
			"The next questions are about person 2.",
			"Person 1 works.",
			"Person 2 works.",
		]);
	});

	it("screens out when consent is refused", () => {
		const w = route((q) => (q === "consent" ? "2" : (typical[q] ?? null)));
		expect(w.ended).toBe("stopped");
		expect(askedIn(w)).toEqual(["consent"]);
		expect(w.trail.at(-1)).toEqual({
			kind: "say",
			text: "Thank you for your time.",
		});
	});

	it("asks rent only of renters, and pipes it into the next question", () => {
		const owner = route((q) => (q === "tenure" ? "1" : (typical[q] ?? null)));
		expect(askedIn(owner)).not.toContain("rent");
		expect(askedIn(owner)).not.toContain("utilities");
		const renter = walk(
			households,
			{
				inputs: { county: "2" },
				answers: [null, "1", 0, "2", 900],
				orders: {},
			},
			evaluateCondition,
		);
		expect(renter.current?.text).toBe(
			"You said you pay 900 a month. Does that include utilities?",
		);
	});

	it("says only of the members who work that they do", () => {
		let row = 0;
		const w = route((q) =>
			q === "works" ? (++row === 2 ? "1" : "2") : (typical[q] ?? null),
		);
		expect(
			w.trail.flatMap((e) =>
				e.kind === "say" && e.text.startsWith("Person") ? [e.text] : [],
			),
		).toEqual(["Person 2 works."]);
	});

	it("asks for another vehicle until there isn't one, at most four", () => {
		let n = 0;
		const three = route((q) =>
			q === "more_vehicles" ? (++n < 3 ? "1" : "2") : (typical[q] ?? null),
		);
		expect(askedIn(three).filter((k) => k.startsWith("vehicle"))).toEqual([
			"vehicle[1]",
			"vehicle[2]",
			"vehicle[3]",
		]);
		const always = route((q) =>
			q === "more_vehicles" ? "1" : (typical[q] ?? null),
		);
		expect(askedIn(always).filter((k) => k.startsWith("vehicle"))).toHaveLength(
			4,
		);
	});

	it("runs no rows for a household size not given", () => {
		const w = route((q) => (q === "size" ? null : (typical[q] ?? null)));
		expect(askedIn(w).filter((k) => k.startsWith("age"))).toEqual([]);
	});

	it("moves on from an ask that records no variable", () => {
		const consent = households.flow.find((s) => s.kind === "ask");
		if (consent?.kind !== "ask") throw new Error("no ask");
		const unrecorded = { ...households, flow: [{ ...consent, records: [] }] };
		const w = walk(
			unrecorded,
			{ inputs: {}, answers: ["1"], orders: {} },
			evaluateCondition,
		);
		expect(w.ended).toBe("end");
		expect(w.held).toEqual({});
	});

	it("runs as the page runs it: from its source text alone", () => {
		const fresh = <T>(f: T): T => runInNewContext(`(${f})`) as T;
		const w = fresh(walk)(
			households,
			{ inputs: { county: "1" }, answers: [null, "2", null], orders: {} },
			fresh(evaluateCondition),
		);
		expect(w.ended).toBe("stopped");
	});
});

describe("the households page", () => {
	it("starts, answers, goes back and ends", () => {
		// The page as written, its script run as the browser would run it.
		const doc = document;
		doc.documentElement.innerHTML = pageOf(read.value);
		new Function(doc.querySelector("script:not([type])")?.textContent ?? "")();
		const $ = (s: string) => doc.querySelector(s) as HTMLElement;
		const submit = () => ($("main form") as HTMLFormElement).requestSubmit();
		expect($("main h2").textContent).toBe("Before the survey");
		($('input[name=county][value="2"]') as HTMLInputElement).click();
		submit();
		expect($("main h2").textContent).toBe("Statement");
		// `{{county}}` pipes the value, not its words (`label(county)` would).
		expect($("main .qtext").textContent).toContain("survey of 2.");
		expect(doc.activeElement).toBe($("main h2"));
		submit();
		expect($("main h2").textContent).toBe("Question 1consent");
		($('main input[value="2"]') as HTMLInputElement).click();
		submit();
		expect($("main h2").textContent).toBe("Statement");
		submit();
		expect($("main h2").textContent).toBe("Screened out");
		($("[data-back]") as HTMLButtonElement).click();
		($("[data-back]") as HTMLButtonElement).click();
		expect($("main h2").textContent).toBe("Question 1consent");
		for (let k = 0; k < 20; k++) {
			$("#restart").click();
			$("#random").click();
			expect(["The end", "Screened out"]).toContain($("main h2").textContent);
		}
	});

	it("says what random answers does, from a button beside it", () => {
		document.documentElement.innerHTML = pageOf(read.value);
		const info = document.querySelector(".info") as HTMLElement;
		const help = document.getElementById(
			info.getAttribute("popovertarget") ?? "",
		);
		expect(info.getAttribute("aria-label")).toBe("About random answers");
		expect(help?.hasAttribute("popover")).toBe(true);
		expect(help?.textContent).toContain("one question in 20");
	});
});
