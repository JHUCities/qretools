/**
 * How the Qualtrics export handles what Qualtrics does differently, decided by the owner
 * (2026-10-18). Single-valued for now: declared so the decision is visible where it acts,
 * and so that a choice can replace a constant when a team needs another.
 */
export const SETTINGS = {
	/** A warning check: a statement on the question's page, shown while the check fails. */
	soft_checks: "in_page",
	/** Missing-value codes aren't offered to respondents. */
	missing: "hide",
	/** Respondents may go back (Qualtrics drops the answers of questions they then skip). */
	back: "allow",
} as const;
