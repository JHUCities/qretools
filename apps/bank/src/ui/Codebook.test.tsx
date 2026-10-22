// @vitest-environment jsdom

/**
 * The codebook pane, drawn from a question's DDI: what the export holds and nothing
 * else (no hole slots), shared names green and, where the view follows them, links.
 */
import { codebookOf, parse } from "@qretools/codebook";
import {
	documentOf,
	evaluate,
	questionItems,
	schemeEnv,
	UNNAMED,
} from "@qretools/core";
import { render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Codebook, type Follow } from "./Previews.js";

const ENV = schemeEnv([
	{ kind: "concept", name: "trust", text: "label: Trust in neighbors\n" },
	{ kind: "universe", name: "adults", text: "text: People 18 or over\n" },
	{
		kind: "scale",
		name: "agree4",
		text: "labels:\n  1: Agree\n  2: Somewhat agree\n  3: Somewhat disagree\n  4: Disagree\n",
	},
	{
		kind: "missing",
		name: "missing",
		text: "labels:\n  -8: Refused\n  -9: Don't know\n",
	},
]);

/** A question's pane, as the app makes it: its DDI, then the codebook of that. */
function pane(source: string, follow?: Follow) {
	const { draft } = evaluate(source, ENV);
	const read = parse(
		documentOf(questionItems(draft, { env: ENV, agency: "org.example" })),
	);
	if (!read.ok) throw new Error("unread");
	return render(
		<Codebook
			codebook={codebookOf(read.value)}
			{...(follow !== undefined && { follow })}
		/>,
	).container;
}

const QUESTION = `name: trust_nbrs
title: Trust in neighbors
text: How much do you agree that people around here can be trusted?
intent: Social trust at the neighborhood level
concept: trust
universe: adults
responses: agree4
`;

/** Follows a shared name to a made-up address for its file: every file but select all's, which the bank lacks. */
const follow: Follow = (shared, chip) =>
	shared.kind === "select_all" ? undefined : (
		<a href={`#file=${shared.kind}/${shared.name}`}>{chip}</a>
	);

describe("the codebook pane", () => {
	it("lists the variable: its name and label, the question, its terms, its codes", () => {
		const c = pane(QUESTION, follow);
		expect(c.querySelector("h4")?.textContent).toBe(
			"trust_nbrs Trust in neighbors",
		);
		expect(c.querySelector("blockquote")?.textContent).toMatch(/^How much/);
		const terms = Object.fromEntries(
			[...c.querySelectorAll("dt")].map((dt) => [
				dt.textContent,
				dt.nextElementSibling?.textContent,
			]),
		);
		expect(terms).toEqual({
			Concept: "Trust in neighbors trust",
			Universe: "People 18 or over adults",
			Intent: "Social trust at the neighborhood level",
			"Missing values": "-8, -9",
		});
		const table = c.querySelector("table");
		expect(table?.caption?.textContent).toBe("Values from agree4");
		expect(
			[...(table?.tBodies ?? [])].map((b) =>
				[...b.rows].map((r) => r.textContent),
			),
		).toEqual([
			["1Agree", "2Somewhat agree", "3Somewhat disagree", "4Disagree"],
			["Missing values from missing", "-8Refused", "-9Don't know"],
		]);
	});

	it("draws a shared name green, a link to its file where the view follows it", () => {
		const followed = pane(QUESTION, follow);
		const concept = within(followed).getByText("trust", { selector: "code" });
		expect(concept.className).toBe("code code-ref");
		expect(concept.closest("a")?.getAttribute("href")).toBe(
			"#file=concept/trust",
		);
		const read = pane(QUESTION);
		const plain = within(read).getByText("trust", { selector: "code" });
		expect(plain.className).toBe("code code-ref");
		expect(plain.closest("a")).toBeNull();
		// Words the question wrote itself are plain.
		const prose = pane(
			QUESTION.replace("universe: adults", "universe: Everyone asked"),
		);
		expect(prose.querySelectorAll(".code-ref")).toHaveLength(3);
	});

	it("shows nothing for what isn't written yet: no hole, no placeholder name", () => {
		const c = pane("name:\ntext: Anything else?\nintent:\nopen: {}\n");
		// No name, no variable: no codes recorded yet.
		expect(c.querySelector("table")).toBeNull();
		expect(c.querySelector("h4")?.textContent).toBe(UNNAMED);
		expect(c.textContent).not.toMatch(/untitled|urn:|fill in/i);
	});

	it("shows a fill in the question's words as the gap it is", () => {
		const c = pane(
			"name: utilities\ntext: You pay {{rent}} a month. Does that include utilities?\nintent: i\nopen: {}\nfills:\n  rent: number\n",
		);
		expect(c.querySelector("blockquote .fill-slot")?.textContent).toBe(
			"[rent]",
		);
	});

	it("captions a table of missing values alone with the list they come from", () => {
		const c = pane(
			"name: rooms\ntext: How many rooms?\nintent: Size\nnumber:\n  min: 1\n",
			follow,
		);
		expect(c.querySelector("table")?.caption?.textContent).toBe(
			"Missing values from missing",
		);
		expect(c.querySelectorAll("tbody")).toHaveLength(1);
	});

	it("gives a select-all question's words once, its options in one table, their values once", () => {
		const c = pane(
			`name: pets
text: Which pets live with you?
intent: Pet ownership
select: many
responses:
  1:
    label: Dog
    title: Pets -- Dog
    variable: pets_dog
  2:
    label: Cat
    variable: pets_cat
`,
			follow,
		);
		expect(c.querySelectorAll("blockquote")).toHaveLength(1);
		const [options, values] = [...c.querySelectorAll("table")];
		expect(options?.caption?.textContent).toBe("Options");
		expect(
			[...(options?.tBodies[0]?.rows ?? [])].map((r) => r.textContent),
		).toEqual(["1 Dogpets_dog Pets -- Dog", "2 Catpets_cat Cat"]);
		// Select all's list has no file here: named nowhere, not a green name for nothing.
		expect(values?.caption?.textContent).toBe("Each option's values");
		expect(c.querySelectorAll("table")).toHaveLength(2);
	});
});
