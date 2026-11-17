// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Naming } from "../model.js";
import { SchemeNameDialog } from "./SchemeNameDialog.js";

const naming = (over: Partial<Naming>): Naming => ({
	kind: "instruction",
	name: "se",
	text: "",
	purpose: { kind: "create", use: { id: 1, path: "instruction" } },
	...over,
});

describe("the name dialog", () => {
	it("asks a new instruction for its name and text, the name editable and prefilled", () => {
		const dispatch = vi.fn();
		render(
			<SchemeNameDialog
				naming={naming({})}
				problem={undefined}
				dispatch={dispatch}
			/>,
		);
		const name = screen.getByRole("textbox", {
			name: "Name",
		}) as HTMLInputElement;
		expect(name.value).toBe("se");
		fireEvent.change(name, { target: { value: "select_all" } });
		expect(dispatch).toHaveBeenCalledWith({
			kind: "schemeNameChanged",
			name: "select_all",
		});
		fireEvent.change(screen.getByRole("textbox", { name: "Text" }), {
			target: { value: "Select all that apply" },
		});
		expect(dispatch).toHaveBeenCalledWith({
			kind: "schemeTextChanged",
			text: "Select all that apply",
		});
		expect(
			screen.getByText(/The question you came from will use it/),
		).toBeTruthy();
	});

	it("asks a scale, or a rename, for its name only", () => {
		render(
			<SchemeNameDialog
				naming={naming({ kind: "scale", purpose: { kind: "rename", id: 2 } })}
				problem={undefined}
				dispatch={vi.fn()}
			/>,
		);
		expect(screen.queryByRole("textbox", { name: "Text" })).toBeNull();
		expect(screen.getByRole("button", { name: "Rename" })).toBeTruthy();
	});
});

describe("renaming a shared file", () => {
	const renaming = (kind: Naming["kind"], name: string) =>
		naming({ kind, name, purpose: { kind: "rename", id: 1 } });
	const saved = {
		from: "agree4",
		saved: true,
		questions: [
			{ id: 2, name: "one" },
			{ id: 3, name: "two" },
		],
		instruments: [{ id: 4, name: "survey" }],
	};

	it("says what it updates and what keeps the old name, before a new name is typed, with no error for its own name", () => {
		render(
			<SchemeNameDialog
				naming={renaming("scale", "agree4")}
				problem="That's its name already."
				rename={saved}
				dispatch={vi.fn()}
			/>,
		);
		expect(
			screen.getByText(
				"Renaming this shared scale updates 2 questions and 1 instrument.",
			),
		).toBeTruthy();
		expect(screen.getByText("In the DDI it gets a new ID.")).toBeTruthy();
		// What reads the bank at a tag keeps the old name by itself: not explained.
		expect(screen.queryByText(/keep/)).toBeNull();
		expect(screen.queryByText("That's its name already.")).toBeNull();
		expect(
			screen
				.getByRole("button", { name: "Rename" })
				.getAttribute("aria-disabled"),
		).toBe("true");
	});

	it("names the DDI identity once the name can be used", () => {
		render(
			<SchemeNameDialog
				naming={renaming("scale", "agree_4")}
				problem={undefined}
				rename={{ ...saved, identity: "scale-agree_4" }}
				dispatch={vi.fn()}
			/>,
		);
		expect(screen.getByText("scale-agree_4")).toBeTruthy();
	});

	it("gives a unit no DDI paragraph at all", () => {
		render(
			<SchemeNameDialog
				naming={renaming("unit", "day")}
				problem={undefined}
				rename={{ ...saved, from: "days" }}
				dispatch={vi.fn()}
			/>,
		);
		expect(screen.queryByText(/In the DDI/)).toBeNull();
		// The opening line only: no empty paragraph taking the stack's gap.
		expect(document.querySelectorAll(".rename-scope > p").length).toBe(1);
	});

	it("says a draft's rename is local", () => {
		render(
			<SchemeNameDialog
				naming={renaming("scale", "agree_4")}
				problem={undefined}
				rename={{ ...saved, saved: false, instruments: [] }}
				dispatch={vi.fn()}
			/>,
		);
		expect(
			screen.getByText("Renaming this shared scale updates 2 questions."),
		).toBeTruthy();
		expect(screen.queryByText(/In the DDI|keep/)).toBeNull();
	});
});
