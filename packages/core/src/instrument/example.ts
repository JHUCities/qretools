/**
 * An example instrument, to copy or delete: written by hand for the template's bank
 * (consent, a follow-up, a check, a form experiment), or, in a bank without those
 * questions, built from the bank's own. Either way it reads with nothing to fill in, so
 * an example never opens as a page of holes in a bank it wasn't written for.
 */
import type { BankScope } from "../evaluate.ts";
import type { Draft } from "../surface/draft.ts";
import { parseInstrument } from "./parse.ts";

/** The alias the example reads its bank by. */
const ALIAS = "bank";

/**
 * Written for the template's bank. The template is a default, visibly so: in any other
 * bank the example is built from its own questions (`built`).
 */
const WRITTEN = `name:
title: Example instrument
description: A short instrument asking questions of this workspace's bank, to copy or delete.
universe: bank.all_respondents
uses:
  bank:
inputs:
  form:
    responses:
      "1": Form 1
      "2": Form 2
    description: Which half of the response-order experiment, assigned before the interview.
flow:
  - say: Thank you for taking part. This survey takes about five minutes.
  - ask: bank.consent
  - stop: bank.consent = "2"
    say: Thank you for your time.
  - section: The service
    flow:
      - ask: bank.service_satisfaction
      - if: bank.service_satisfaction in {"4", "5"}
        then:
          - ask: bank.service_comments
            universe: Respondents dissatisfied with the service
  - section: Libraries and parks
    flow:
      - ask: bank.library_visits
        checks:
          - ensure: bank.library_visits < 25
            severity: info
            message: "{{bank.library_visits}} days is most of the month. Is that right?"
      - if: form = "1"
        then:
          - ask: bank.parks_spending
            universe: Respondents on form 1
        else:
          - ask: bank.parks_spending_reversed
            universe: Respondents on form 2
  - ask: bank.news_sources
`;

/**
 * The example instrument named `name`, reading the bank at `address` (as `uses:` writes
 * it, relative to the instrument) whose questions are `bank`: the written one where it
 * reads with no hole or error in this bank, else one built from the bank's questions.
 */
export function exampleInstrument(
	name: string,
	address: string,
	bank: BankScope,
): string {
	const written = withNameAndBank(WRITTEN, name, address);
	return reads(written, bank) ? written : built(name, address, bank);
}

/** The text with its `name:` and its bank's address filled in. */
const withNameAndBank = (text: string, name: string, address: string) =>
	text
		.replace(/^name:[ \t]*$/m, `name: ${name}`)
		.replace(/^ {2}bank:[ \t]*$/m, `  ${ALIAS}: ${address}`);

/** Whether the instrument reads in `bank` with nothing to fill in and nothing wrong. */
const reads = (text: string, bank: BankScope): boolean =>
	parseInstrument(text, { [ALIAS]: bank }).findings.every(
		(f) => f.severity !== "hole" && f.severity !== "error",
	);

/**
 * An example built from the bank's own questions, in path order: a welcome; a section
 * with a single-choice question and, on its first code, the next question; a number
 * question checked against its own minimum. What the bank lacks is left out, never a
 * hole: an empty bank gets the welcome alone.
 */
function built(name: string, address: string, bank: BankScope): string {
	// Only a question an `ask` can name: named once in the bank, with an answer, and
	// leaving nothing for an instrument to fill.
	const askable = Object.keys(bank.questions)
		.sort()
		.flatMap((path) => {
			const draft = bank.questions[path]?.draft;
			const name = draft?.name;
			return draft !== undefined &&
				name !== undefined &&
				draft.domain !== undefined &&
				(draft.fills ?? []).length === 0 &&
				bank.index.names.get(name)?.length === 1
				? [{ name, draft }]
				: [];
		});
	const taken = new Set<string>();
	const take = (ok: (d: Draft) => boolean) => {
		const found = askable.find((q) => !taken.has(q.name) && ok(q.draft));
		if (found !== undefined) taken.add(found.name);
		return found;
	};
	const coded = take(
		(d) =>
			d.domain?.kind === "responses" &&
			d.domain.select === "one" &&
			d.domain.codes.length >= 2,
	);
	const next = coded === undefined ? undefined : take(() => true);
	const number = take((d) => d.domain?.kind === "number");
	const q = (n: string) => `${ALIAS}.${n}`;
	const steps: string[] = [];
	if (coded !== undefined) {
		steps.push(`      - ask: ${q(coded.name)}`);
		const first =
			coded.draft.domain?.kind === "responses"
				? coded.draft.domain.codes[0]?.code
				: undefined;
		// A code is any text, but one holding a quote or a backslash would need VTL's
		// escapes in its string: the demo goes without the condition rather than risk one.
		if (next !== undefined && first !== undefined && !/["\\]/.test(first))
			steps.push(
				`      - if: ${q(coded.name)} = "${first}"`,
				"        then:",
				`          - ask: ${q(next.name)}`,
			);
	}
	if (number !== undefined) {
		const min =
			number.draft.domain?.kind === "number" ? number.draft.domain.min : 0;
		steps.push(
			`      - ask: ${q(number.name)}`,
			"        checks:",
			`          - ensure: ${q(number.name)} >= ${min ?? 0}`,
			"            severity: info",
			`            message: "{{${q(number.name)}}} is below ${min ?? 0}. Is that right?"`,
		);
	}
	const [universe] = Object.keys(bank.env.universes).sort();
	return [
		`name: ${name}`,
		"title: Example instrument",
		"description: A short instrument asking questions of this workspace's bank, to copy or delete.",
		...(universe === undefined ? [] : [`universe: ${q(universe)}`]),
		"uses:",
		`  ${ALIAS}: ${address}`,
		"flow:",
		"  - say: Thank you for taking part.",
		...(steps.length === 0
			? []
			: ["  - section: Example", "    flow:", ...steps]),
		"",
	].join("\n");
}
