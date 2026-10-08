// @vitest-environment jsdom

/**
 * The DDI pane as drawn before it moved into the shell, in each state: written first,
 * so the move (and its `notice` in place of `declare`) can show it changed nothing.
 * The snapshots are the ones taken before the move.
 */
import type { DdiDocument, Finding } from "@qretools/core";
import { Ddi } from "@qretools/shell/ui";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgencyNotice } from "./Previews.js";

const DOCUMENT = { Instrument: {} } as unknown as DdiDocument;
const PROBLEM: Finding = {
	code: "ddi-invalid",
	severity: "error",
	path: "",
	message: "`QuestionItem` is missing `ID`.",
	detail: "must have required property 'ID'",
};

const html = (container: HTMLElement): string =>
	container.innerHTML.replace(/_r_[0-9a-z]+_|«r[0-9a-z]+»|:r[0-9a-z]+:/g, "ID");

describe("the DDI pane, as drawn before it moved", () => {
	it("while the schema loads", () => {
		const { container } = render(
			<Ddi document={DOCUMENT} schema={{ kind: "loading" }} problems={[]} />,
		);
		expect(html(container)).toMatchSnapshot();
	});

	it("valid", () => {
		const { container } = render(
			<Ddi document={DOCUMENT} schema={{ kind: "ready" }} problems={[]} />,
		);
		expect(html(container)).toMatchSnapshot();
	});

	it("with schema problems", () => {
		const { container } = render(
			<Ddi
				document={DOCUMENT}
				schema={{ kind: "ready" }}
				problems={[PROBLEM, PROBLEM]}
			/>,
		);
		expect(html(container)).toMatchSnapshot();
	});

	it("while the bank declares no agency, offering to add one", () => {
		const declare = vi.fn();
		const { container } = render(
			<Ddi
				document={DOCUMENT}
				schema={{ kind: "ready" }}
				problems={[]}
				notice={<AgencyNotice declare={declare} />}
			/>,
		);
		expect(html(container)).toMatchSnapshot();
		fireEvent.click(
			screen.getByRole("button", { name: "Add the bank's agency" }),
		);
		expect(declare).toHaveBeenCalledOnce();
	});
});
