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
		questions: [
			{ id: 2, name: "one" },
			{ id: 3, name: "two" },
		],
		instruments: [{ id: 4, name: "survey" }],
	};

	it("says what it updates, and nothing else, with no error for its own name", () => {
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
		// One line and the list: no DDI identity, no warning, nothing that keeps the old name.
		expect(document.querySelectorAll(".rename-scope > p").length).toBe(1);
		expect(screen.queryByText("That's its name already.")).toBeNull();
		expect(
			screen
				.getByRole("button", { name: "Rename" })
				.getAttribute("aria-disabled"),
		).toBe("true");
	});

	it("counts only what it updates", () => {
		render(
			<SchemeNameDialog
				naming={renaming("scale", "agree_4")}
				problem={undefined}
				rename={{ ...saved, instruments: [] }}
				dispatch={vi.fn()}
			/>,
		);
		expect(
			screen.getByText("Renaming this shared scale updates 2 questions."),
		).toBeTruthy();
	});
});
