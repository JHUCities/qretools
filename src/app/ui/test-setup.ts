import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Without Vitest globals, Testing Library does not unmount between tests on its own.
afterEach(cleanup);

// Primer's TreeView scrolls the current item into view; jsdom has no such method.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
	Element.prototype.scrollIntoView = () => {};
}
