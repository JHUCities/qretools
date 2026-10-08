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

// Primer's Spinner asks for the reduced-motion preference; jsdom has no matchMedia.
if (typeof window !== "undefined" && !window.matchMedia)
	window.matchMedia = (query: string) =>
		({
			matches: false,
			media: query,
			onchange: null,
			addEventListener: () => {},
			removeEventListener: () => {},
			addListener: () => {},
			removeListener: () => {},
			dispatchEvent: () => false,
		}) as MediaQueryList;

// Primer's AriaStatus announces through a `live-region` element, which its Node build
// (what Vitest resolves) never defines: a silent one stands in.
if (typeof customElements !== "undefined" && !customElements.get("live-region"))
	customElements.define(
		"live-region",
		class extends HTMLElement {
			announce() {
				return { cancel: () => {} };
			}
			announceFromElement() {
				return { cancel: () => {} };
			}
		},
	);

// CodeMirror measures text through ranges; jsdom's ranges have no layout.
if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
	Range.prototype.getClientRects = () =>
		({
			length: 0,
			item: () => null,
			[Symbol.iterator]: [][Symbol.iterator],
		}) as unknown as DOMRectList;
	Range.prototype.getBoundingClientRect = () => new DOMRect();
}
