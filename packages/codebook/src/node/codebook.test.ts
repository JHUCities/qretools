import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
	bankOf,
	documentOf,
	instrumentOf,
	type Json,
	questionItems,
} from "@qretools/core";
import { readWorkspace } from "@qretools/core/node";
import { describe, expect, it } from "vitest";
import { pageOf } from "../html.ts";
import { type Codebook, codebookOf, parse } from "../model.ts";
import { asking, outline } from "../testing.ts";

const fixture = (name: string) =>
	fileURLToPath(new URL(`../../../core/fixtures/${name}`, import.meta.url));

const codebook = (ddi: Json): Codebook => {
	const parsed = parse(ddi);
	if (!parsed.ok) throw new Error("unparsed");
	return codebookOf(parsed.value);
};

/** The example bank's questions as one document, as `qretools export` writes them. */
const bank = async () => {
	const b = bankOf(await readWorkspace(fixture("bank")));
	return documentOf(
		Object.keys(b.questions)
			.sort()
			.flatMap((p) => {
				const ev = b.questions[p];
				return ev === undefined ? [] : questionItems(ev.draft, b, p);
			}),
	);
};

/** An instrument's DDI, its source using the households workspace as `hh`. */
const instrument = async (source: string) =>
	instrumentOf(source, {
		banks: { hh: bankOf(await readWorkspace(fixture("households"))) },
		agency: "org.example",
	}).ddi;

describe("the example bank's codebook", () => {
	it("has an entry per variable, an option of a select-all grouped under its question", async () => {
		const cb = codebook(await bank());
		expect(cb.findings).toEqual([]);
		expect(cb.entries.map((e) => e.name)).toEqual([
			"consent",
			"household_size",
			"library_visits",
			"member_age",
			"news_sources_1",
			"news_sources_2",
			"news_sources_3",
			"news_sources_4",
			"news_sources_5",
			"parks_spending",
			"parks_spending_reversed",
			"service_comments",
			"service_satisfaction",
		]);
		const news = cb.entries.filter((e) => e.group !== undefined);
		expect(news.map((e) => e.group?.option.code)).toEqual([
			"1",
			"2",
			"3",
			"4",
			"5",
		]);
		expect(new Set(news.map((e) => e.group?.question)).size).toBe(1);
		expect(outline(cb)).toMatchInlineSnapshot(`
			[
			  "Variable consent "Consent to the interview": Do you agree to take part in this survey?",
			  "  instruction Select one",
			  "  codes 1=Yes, 2=No, -8!=Item non-response, -7!=Question not presented due to skip pattern",
			  "Variable household_size "People in the household": How many people live in your household, including you?",
			  "  codes -8!=Item non-response, -7!=Question not presented due to skip pattern",
			  "  format {"kind":"number","min":1,"max":20}",
			  "  universe all_respondents",
			  "Variable library_visits "Days visiting a library": In the past 30 days, on how many days did you visit a public library?",
			  "  codes -8!=Item non-response, -7!=Question not presented due to skip pattern",
			  "  format {"kind":"number","min":0,"max":30,"unit":"days"}",
			  "  universe all_respondents",
			  "  concept library_use",
			  "Variable member_age "Age of a household member": How old is this person?",
			  "  codes -8!=Item non-response, -7!=Question not presented due to skip pattern",
			  "  format {"kind":"number","min":0,"max":120,"unit":"years"}",
			  "  universe household_members",
			  "Variable news_sources_1 "Newspaper": Where do you get news about your community?",
			  "  option 1 A local newspaper or its website",
			  "  instruction Select all that apply",
			  "  codes 0=No, 1=Yes, -8!=Item non-response, -7!=Question not presented due to skip pattern",
			  "  universe all_respondents",
			  "  concept news_consumption",
			  "Variable news_sources_2 "Broadcast": Where do you get news about your community?",
			  "  option 2 Television or radio",
			  "  instruction Select all that apply",
			  "  codes 0=No, 1=Yes, -8!=Item non-response, -7!=Question not presented due to skip pattern",
			  "  universe all_respondents",
			  "  concept news_consumption",
			  "Variable news_sources_3 "Social media": Where do you get news about your community?",
			  "  option 3 Social media",
			  "  instruction Select all that apply",
			  "  codes 0=No, 1=Yes, -8!=Item non-response, -7!=Question not presented due to skip pattern",
			  "  universe all_respondents",
			  "  concept news_consumption",
			  "Variable news_sources_4 "Word of mouth": Where do you get news about your community?",
			  "  option 4 Friends, family or neighbors",
			  "  instruction Select all that apply",
			  "  codes 0=No, 1=Yes, -8!=Item non-response, -7!=Question not presented due to skip pattern",
			  "  universe all_respondents",
			  "  concept news_consumption",
			  "Variable news_sources_5 "None": Where do you get news about your community?",
			  "  option 5 None of these",
			  "  instruction Select all that apply",
			  "  codes 0=No, 1=Yes, -8!=Item non-response, -7!=Question not presented due to skip pattern",
			  "  universe all_respondents",
			  "  concept news_consumption",
			  "Variable parks_spending "Support for more parks spending": Would you support the city spending more on parks, even if it meant higher taxes?",
			  "  instruction Select one",
			  "  codes 1=Strongly support, 2=Somewhat support, 3=Somewhat oppose, 4=Strongly oppose, -8!=Item non-response, -7!=Question not presented due to skip pattern",
			  "  universe all_respondents",
			  "  concept parks_spending_support",
			  "Variable parks_spending_reversed "Support for more parks spending (reversed order)": Would you support the city spending more on parks, even if it meant higher taxes?",
			  "  instruction Select one",
			  "  codes 1=Strongly oppose, 2=Somewhat oppose, 3=Somewhat support, 4=Strongly support, -8!=Item non-response, -7!=Question not presented due to skip pattern",
			  "  universe all_respondents",
			  "  concept parks_spending_support",
			  "Variable service_comments "Comments on the service": You answered "<rating>". What would have made the service better?",
			  "  codes -8!=Item non-response, -7!=Question not presented due to skip pattern",
			  "  format {"kind":"text","maxLength":500}",
			  "  universe all_respondents",
			  "  concept service_satisfaction",
			  "Variable service_satisfaction "Overall satisfaction": Overall, how satisfied are you with the service you received?",
			  "  instruction Select one",
			  "  codes 1=Very satisfied, 2=Somewhat satisfied, 3=Neither satisfied nor dissatisfied, 4=Somewhat dissatisfied, 5=Very dissatisfied, -8!=Item non-response, -7!=Question not presented due to skip pattern",
			  "  universe all_respondents",
			  "  concept service_satisfaction",
			]
		`);
	});

	it("lists each shared item once, the missing values among them", async () => {
		const cb = codebook(await bank());
		expect({
			concepts: cb.shared.concepts.map((c) => c.name),
			universes: cb.shared.universes.map((u) => u.name),
			codeLists: cb.shared.codeLists.length,
			missing: cb.shared.missing.map((m) => m.rows.map((r) => r.code)),
		}).toMatchInlineSnapshot(`
			{
			  "codeLists": 5,
			  "concepts": [
			    "library_use",
			    "news_consumption",
			    "parks_spending_support",
			    "service_satisfaction",
			  ],
			  "missing": [
			    [
			      "-8",
			      "-7",
			    ],
			  ],
			  "universes": [
			    "all_respondents",
			    "household_members",
			  ],
			}
		`);
	});

	it("writes its page", async () => {
		await expect(pageOf(codebook(await bank()))).toMatchFileSnapshot(
			"__snapshots__/bank.html",
		);
	});

	it("keeps provenance as written: the blob a version was made from", async () => {
		const path = "questions/example/consent.yaml";
		const b = bankOf(await readWorkspace(fixture("bank")), {
			[path]: { number: "3", blob: "abc" },
		});
		const draft = b.questions[path]?.draft;
		if (draft === undefined) throw new Error("no consent");
		const [consent] = codebook(
			documentOf(questionItems(draft, b, path)),
		).entries;
		expect(consent?.version).toBe("3");
		expect(consent?.provenance?.ids).toEqual([
			{ value: "abc", type: expect.stringMatching(/blob/) },
		]);
	});
});

describe("an instrument's codebook", () => {
	it("says where each question is asked, in the instrument's order", async () => {
		const root = fixture("households");
		const cb = codebook(
			await instrument(
				await readFile(`${root}/instruments/households.yaml`, "utf8"),
			),
		);
		expect(cb.findings).toEqual([]);
		expect(outline(cb)).toMatchInlineSnapshot(`
			[
			  "title Households and housing",
			  "Variable consent: Do you agree to take part in this survey?",
			  "  codes 1=Yes, 2=No, -8!=Refused, -9!=Don't know",
			  "  asked always",
			  "Variable size: How many people live in your household, including you?",
			  "  codes -8!=Refused, -9!=Don't know",
			  "  format {"kind":"number","min":1,"max":20}",
			  "  asked not (consent = "2")",
			  "Variable age: How old is this person?",
			  "  codes -8!=Refused, -9!=Don't know",
			  "  format {"kind":"number","min":0,"max":120}",
			  "  asked not (consent = "2") in 1 loop",
			  "  universe members",
			  "Variable works: Does this person work for pay?",
			  "  codes 1=Yes, 2=No, -8!=Refused, -9!=Don't know",
			  "  asked not (consent = "2") in 1 loop",
			  "  universe members",
			  "Variable tenure: Do you own or rent your home?",
			  "  codes 1=Own, 2=Rent, 3=Neither, -8!=Refused, -9!=Don't know",
			  "  asked not (consent = "2")",
			  "Variable rent: How much is your rent each month, in dollars?",
			  "  codes -8!=Refused, -9!=Don't know",
			  "  format {"kind":"number","min":0}",
			  "  asked not (consent = "2") and (renter)",
			  "  universe renters",
			  "Variable utilities: You said you pay <rent> a month. Does that include utilities?",
			  "  codes 1=Yes, 2=No, -8!=Refused, -9!=Don't know",
			  "  asked not (consent = "2") and (renter)",
			  "  universe renters",
			  "Variable vehicle: What kind of vehicle is it?",
			  "  codes 1=Car, 2=Truck, 3=Motorcycle, -8!=Refused, -9!=Don't know",
			  "  asked not (consent = "2") in 1 loop",
			  "Variable more_vehicles: Does your household have another vehicle?",
			  "  codes 1=Yes, 2=No, -8!=Refused, -9!=Don't know",
			  "  asked not (consent = "2") in 1 loop",
			  "Variable comments: Is there anything else you'd like to tell us?",
			  "  codes -8!=Refused, -9!=Don't know",
			  "  format {"kind":"text","maxLength":500}",
			  "  asked not (consent = "2")",
			  "Variable county",
			  "  codes 1=North County, 2=South County",
			  "  notes From the sample file.",
			]
		`);
	});

	it("gives each ask its own place: conditions, a section's order and the options'", async () => {
		const cb = codebook(
			await instrument(`name: orders
uses:
  hh: ../
flow:
  - section: Housing
    order: random
    flow:
      - ask: hh.tenure
        options: rotate
  - if: hh.tenure = "1"
    then:
      - ask: hh.comments
    else:
      - ask: hh.comments
        as: comments_again
`),
		);
		expect(cb.findings).toEqual([]);
		expect(
			cb.entries.map((e) => `${e.name}: ${e.asked.map(asking).join(" | ")}`),
		).toMatchInlineSnapshot(`
			[
			  "tenure: always order Random options Rotate",
			  "comments: (tenure = "1")",
			  "comments_again: not (tenure = "1")",
			]
		`);
	});

	it("writes the instrument as its specification: numbered, worded, its conditions in words", async () => {
		const root = fixture("households");
		const page = pageOf(
			codebook(
				await instrument(
					await readFile(`${root}/instruments/households.yaml`, "utf8"),
				),
			),
		);
		expect(specOf(page)).toMatchInlineSnapshot(`
			[
			  "Instrument",
			  "households Households and housing#Link to households Households and housing",
			  "A small instrument with every construct of the language, for the library's tests.",
			  "Comes with each case: county (North County, South County). From the sample file.",
			  "Thank you for taking part in this survey of [county].",
			  "1. consent",
			  "Do you agree to take part in this survey?",
			  "1Yes",
			  "2No",
			  "Show if consent is “No” (stop)",
			  "Thank you for your time.",
			  "Ask if consent is “Yes”, or not answered",
			  "2. size",
			  "How many people live in your household, including you?",
			  "Number from 1 to 20",
			  "Repeated members for members_index = 1, 2, 3 … while members_index is at most size, and members_index is at most 20",
			  "The next questions are about person [members_index].",
			  "3. age",
			  "How old is this person?",
			  "Number from 0 to 120",
			  "4. works",
			  "Does this person work for pay?",
			  "1Yes",
			  "2No",
			  "Housing",
			  "5. tenure",
			  "Do you own or rent your home?",
			  "1Own",
			  "2Rent",
			  "3Neither",
			  "Computed renter is true when tenure is “Rent”",
			  "Ask if renter is true",
			  "6. rent",
			  "How much is your rent each month, in dollars?",
			  "Number, at least 0",
			  "Show if rent is at least 10000 (warning)",
			  "That's a lot for a month's rent.",
			  "7. utilities",
			  "You said you pay [rent] a month. Does that include utilities?",
			  "1Yes",
			  "2No",
			  "Repeated vehicles until (nvl(vehicles_index, 0) >= 1, and (more_vehicles is “No”, or not answered)), or nvl(vehicles_index, 0) >= 4",
			  "Computed vehicles_index is set to nvl(vehicles_index, 0) + 1 (VTL)",
			  "8. vehicle",
			  "What kind of vehicle is it?",
			  "1Car",
			  "2Truck",
			  "3Motorcycle",
			  "9. more_vehicles",
			  "Does your household have another vehicle?",
			  "1Yes",
			  "2No",
			  "Repeated members for members_index = 1, 2, 3 … while members_index is at most size, and members_index is at most 20",
			  "Show if works is “Yes”",
			  "Person [members_index] works.",
			  "10. comments",
			  "Is there anything else you'd like to tell us?",
			  "Text, up to 500 characters",
			]
		`);
		// Every id once, and every link to one finds it.
		const ids = [...page.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
		expect(new Set(ids).size).toBe(ids.length);
		for (const [, to] of page.matchAll(/href="#([^"]+)"/g))
			expect(ids).toContain(decodeURIComponent(to ?? ""));
	});

	it("links each fill to what it shows, and says an input isn't asked", async () => {
		const root = fixture("households");
		const page = pageOf(
			codebook(
				await instrument(
					await readFile(`${root}/instruments/households.yaml`, "utf8"),
				),
			),
		);
		const fills = [
			...page.matchAll(/class="ddi-fill">\[<a href="#([^"]+)"[^>]*>([^<]+)</g),
		].map((m) => `${m[2]} → ${m[1]}`);
		expect(fills).toEqual([
			"county → org.example:instrument-households.var-county",
			"members_index → org.example:instrument-households.roster-members",
			"rent → org.example:instrument-households.var-rent",
			"members_index → org.example:instrument-households.each-members",
		]);
		const county = page.slice(
			page.indexOf('id="org.example:instrument-households.var-county"'),
		);
		expect(county).toContain(
			"<dt>Asked</dt><dd>Not asked: comes with each case</dd>",
		);
	});

	it("lists a select-all question's options under it", async () => {
		const ddi = instrumentOf(
			`name: news
uses:
  ex: ../
flow:
  - ask: ex.news_sources
`,
			{
				banks: { ex: bankOf(await readWorkspace(fixture("bank"))) },
				agency: "org.example",
			},
		).ddi;
		const spec = specOf(pageOf(codebook(ddi)));
		expect(spec.slice(spec.indexOf("1. news_sources"))).toMatchInlineSnapshot(`
			[
			  "1. news_sources",
			  "Where do you get news about your community?",
			  "Select all that apply",
			  "Select all that apply",
			  "1A local newspaper or its website",
			  "2Television or radio",
			  "3Social media",
			  "4Friends, family or neighbors",
			  "5None of these",
			]
		`);
	});
});

/** The instrument's section of a page as lines of text: each block a line, tags gone. */
function specOf(page: string): string[] {
	const section = page.slice(
		page.indexOf('<section aria-labelledby="ddi-instrument">'),
		page.indexOf('<section aria-labelledby="ddi-variables">'),
	);
	return section
		.split(/<(?:li|p|h\d|blockquote|div)\b[^>]*>/)
		.map((l) =>
			l
				.replace(/<[^>]*>/g, "")
				.replaceAll("&#39;", "'")
				.replaceAll("&quot;", '"')
				.replaceAll("&lt;", "<")
				.replaceAll("&gt;", ">")
				.replaceAll("&amp;", "&")
				.trim(),
		)
		.filter((l) => l !== "");
}
