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
