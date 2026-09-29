// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Finding } from "../../core/findings.js";
import { Findings } from "./Previews.js";

const dup: Finding = {
	code: "duplicate-text",
	severity: "warning",
	path: "text",
	message: "The same question text is in `b`.",
	hint: "Keep one question.",
};
const own: Finding = {
	code: "thin-intent",
	severity: "info",
	path: "intent",
	message: "Say more.",
};

describe("findings that name another file", () => {
	it("link to it beside the item, an ordinary link; the item still goes to this file's place", () => {
		const onTarget = vi.fn();
		render(
			<Findings
				findings={[dup, own]}
				onTarget={onTarget}
				related={(f) =>
					f === dup
						? { href: "#repo=o/r&branch=b&file=q.yaml", label: "Open b" }
						: undefined
				}
			/>,
		);
		const link = screen.getByRole("link", { name: "Open b" });
		expect(link.getAttribute("href")).toBe("#repo=o/r&branch=b&file=q.yaml");
		expect(screen.getAllByRole("link")).toHaveLength(1);
		fireEvent.click(screen.getByText(/The same question text/));
		expect(onTarget).toHaveBeenCalledWith(dup);
	});
});

describe("a finding with a fix", () => {
	const fix = {
		kind: "edit" as const,
		label: "Use `days`",
		edits: [{ path: "number.unit", value: "days" }],
	};
	const spelled: Finding = {
		code: "unit-spelling",
		severity: "warning",
		path: "number.unit",
		message: "`Days` is written `days` in `b`.",
		fix,
	};

	it("offers it beside the item, winning over the link, and applies it on a click", () => {
		const onFix = vi.fn();
		render(
			<Findings
				findings={[spelled]}
				onTarget={vi.fn()}
				onFix={onFix}
				related={() => ({ href: "#x", label: "Open b" })}
			/>,
		);
		expect(screen.queryByRole("link")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Use days" }));
		expect(onFix).toHaveBeenCalledWith(fix);
	});

	it("offers nothing where nothing can be edited", () => {
		render(<Findings findings={[spelled]} onTarget={vi.fn()} />);
		expect(screen.queryByRole("button", { name: "Use days" })).toBeNull();
	});
});
