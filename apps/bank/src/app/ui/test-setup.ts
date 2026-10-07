import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Without Vitest globals, Testing Library does not unmount between tests on its own.
afterEach(cleanup);

// Primer's TreeView scrolls the current item into view; jsdom has no such method.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
	Element.prototype.scrollIntoView = () => {};
}

// Primer's tooltips install a popover polyfill that adopts a stylesheet; jsdom has
// neither `adoptedStyleSheets` nor constructable sheets' `replaceSync`.
if (
	typeof Document !== "undefined" &&
	!("adoptedStyleSheets" in Document.prototype)
) {
	Object.defineProperty(Document.prototype, "adoptedStyleSheets", {
		value: [],
		writable: true,
		configurable: true,
	});
	if (
		typeof CSSStyleSheet !== "undefined" &&
		!CSSStyleSheet.prototype.replaceSync
	)
		CSSStyleSheet.prototype.replaceSync = () => {};
}

// Primer's Dialog observes its size; jsdom has no ResizeObserver.
if (typeof globalThis.ResizeObserver === "undefined") {
	globalThis.ResizeObserver = class {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
}
