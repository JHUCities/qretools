// @vitest-environment jsdom

import type { Finding } from "@qretools/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Findings } from "./findings.tsx";

const dup: Finding = {
	code: "duplicate-text",
	severity: "warning",
	path: "text",
	message: "The same question text is in `b`.",
	hint: "Keep one question.",
};
const own: Finding = {
	code: "intent-repeats-text",
	severity: "info",
	path: "intent",
	message: "Say more.",
};

describe("findings that name another file", () => {
	it("link to it under the message, an ordinary link; the message still goes to this file's place", () => {
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
		fireEvent.click(
			screen.getByRole("button", { name: /The same question text/ }),
		);
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
		code: "matches-unit",
		severity: "warning",
		path: "number.unit",
		message: "`Days` is written `days` in `b`.",
		fix,
	};

	it("offers it under the message beside another file's link, and applies it", () => {
		const onFix = vi.fn();
		const onTarget = vi.fn();
		render(
			<Findings
				findings={[spelled]}
				onTarget={onTarget}
				onFix={onFix}
				related={() => ({ href: "#x", label: "Open b" })}
			/>,
		);
		expect(screen.getByRole("link", { name: "Open b" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Use days" }));
		expect(onFix).toHaveBeenCalledWith(fix);
		expect(onTarget).not.toHaveBeenCalled();
	});

	it("offers nothing where nothing can be edited", () => {
		render(<Findings findings={[spelled]} onTarget={vi.fn()} />);
		expect(screen.queryByRole("button", { name: "Use days" })).toBeNull();
	});
});

describe("a read-only list", () => {
	it("is the same list, its words and severity, with nothing to press", () => {
		render(<Findings findings={[dup, own]} />);
		const list = screen.getByRole("list", { name: "Findings" });
		expect(list.querySelectorAll("li")).toHaveLength(2);
		expect(screen.getByRole("img", { name: "warning" })).toBeTruthy();
		expect(screen.getByText(/The same question text/)).toBeTruthy();
		expect(screen.queryByRole("button")).toBeNull();
	});
});

describe("advice a question may dismiss", () => {
	it("offers Dismiss under the message, beside its fix, and not on a bank finding", () => {
		const onFix = vi.fn();
		render(<Findings findings={[dup, own]} onTarget={vi.fn()} onFix={onFix} />);
		const dismiss = screen.getAllByRole("button", { name: "Dismiss" });
		expect(dismiss).toHaveLength(1);
		fireEvent.click(dismiss[0] as HTMLElement);
		expect(onFix).toHaveBeenCalledWith({
			kind: "dismiss",
			label: "Dismiss",
			code: "intent-repeats-text",
		});
	});

	it("lists what was dismissed after the findings, with its reason, going to the dismissal", () => {
		const onTarget = vi.fn();
		render(
			<Findings
				findings={[]}
				dismissed={[
					{ finding: own, reason: "Short on purpose.", path: "dismiss.x" },
				]}
				onTarget={onTarget}
			/>,
		);
		expect(
			screen.getByText("Nothing to fill in, fix, or reconsider."),
		).toBeTruthy();
		expect(screen.getByText("1 dismissed")).toBeTruthy();
		expect(screen.getByText("Short on purpose.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Say more." }));
		expect(onTarget).toHaveBeenCalledWith({
			path: "dismiss.x",
			severity: "info",
		});
	});
});
