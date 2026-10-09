// @vitest-environment jsdom

/**
 * The DDI pane in each state. Its header (the verdict, and the app's action) is always
 * shown; what the app says and the schema's problems are never folded; only the JSON is.
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

describe("the DDI pane, as drawn", () => {
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

describe("the DDI pane's header and fold", () => {
	it("keeps the action beside the verdict, outside the heading and the fold", () => {
		render(
			<Ddi
				document={DOCUMENT}
				schema={{ kind: "ready" }}
				problems={[PROBLEM]}
				action={<button type="button">Download DDI</button>}
			/>,
		);
		const heading = screen.getByRole("heading", { name: "DDI-Lifecycle 4.0" });
		const download = screen.getByRole("button", { name: "Download DDI" });
		expect(heading.contains(download)).toBe(false);
		expect(download.closest("details, summary")).toBeNull();
		// The problem is shown with the JSON folded; the JSON is inside the fold.
		const fold = screen.getByText("Document as JSON").closest("details");
		expect(fold?.open).toBe(false);
		expect(screen.getByText(/is missing/).closest("details")).toBeNull();
		expect(fold?.querySelector("pre")).not.toBeNull();
	});
});
