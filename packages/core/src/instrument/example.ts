/**
 * An example instrument, to copy or delete: written by hand for the example bank
 * (consent, a computed value, a follow-up filled from an answer's label, a check, a form
 * experiment, a roster). It is offered only where it reads with nothing to fill in, so
 * an example never opens as a page of holes in a bank it wasn't written for.
 */
import type { BankScope } from "../evaluate.ts";
import { parseInstrument } from "./parse.ts";

/** The alias the example reads its bank by. */
const ALIAS = "bank";

/**
 * Written for the example bank as the template ships it (`fixtures/bank` is its copy,
 * and the test that this reads there is what keeps the two together).
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
      - compute: dissatisfied
        value: bank.service_satisfaction in {"4", "5"}
      - if: dissatisfied
        then:
          - ask: bank.service_comments
            universe: Respondents dissatisfied with the service
            fill:
              rating: label(bank.service_satisfaction)
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
  - ask: bank.household_size
  - roster: members
    count: bank.household_size
    flow:
      - say: The next question is about person {{index}} in your household.
      - ask: bank.member_age
`;

/**
 * The example instrument named `name`, reading the bank at `address` (as `uses:` writes
 * it, relative to the instrument) whose questions are `bank`; undefined where it would
 * not read there with nothing to fill in and nothing wrong (the bank's questions have
 * changed, or are older than this text): no example is better than a page of holes.
 */
export function exampleInstrument(
	name: string,
	address: string,
	bank: BankScope,
): string | undefined {
	const written = WRITTEN.replace(/^name:[ \t]*$/m, `name: ${name}`).replace(
		/^ {2}bank:[ \t]*$/m,
		`  ${ALIAS}: ${address}`,
	);
	return parseInstrument(written, { [ALIAS]: bank }).findings.every(
		(f) => f.severity !== "hole" && f.severity !== "error",
	)
		? written
		: undefined;
}
