// @vitest-environment jsdom

import { EMPTY_ENV, evaluate } from "@qretools/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Respondent } from "./Previews.tsx";

describe("the respondent's view of an option with a box", () => {
	it("draws a box beside the option, which typing in leaves unticked", () => {
		const { respondent } = evaluate(
			'name: q\ntext: How?\nintent: i\nresponses:\n  "1": Bus\n  "4":\n    label: Other (please specify)\n    specify: true\n',
			EMPTY_ENV,
		);
		render(<Respondent view={respondent} />);
		const box = screen.getByRole("textbox", {
			name: "Text for Other (please specify)",
		});
		const option = screen.getByRole("radio", {
			name: "Other (please specify)",
		}) as HTMLInputElement;
		fireEvent.click(box);
		expect(option.checked).toBe(false);
		expect(screen.getAllByRole("textbox")).toHaveLength(1);
	});
});
