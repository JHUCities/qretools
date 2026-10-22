// @vitest-environment jsdom
/** `<ddi-codebook>` in a page: what it shows, and what a click on a reference does. */
import { afterEach, describe, expect, it } from "vitest";

const label = (en: string, fr: string) => [
	{
		Content: [
			{ MultilingualStringValue: { LanguageTag: "en", Value: en } },
			{ MultilingualStringValue: { LanguageTag: "fr", Value: fr } },
		],
	},
];
const DDI = {
	Universe: {
		u: {
			URN: "urn:ddi:org.x:adults:1",
			UniverseName: label("adults", "adultes"),
		},
	},
	Concept: {
		c: { URN: "urn:ddi:org.x:age:1", ConceptName: label("age", "âge") },
	},
	Variable: {
		v: {
			URN: "urn:ddi:org.x:age-var:1",
			VariableName: label("age", "age"),
			Label: label("Age", "Âge"),
			UniverseReference: ["urn:ddi:org.x:adults:1"],
			ConceptReference: ["urn:ddi:org.x:age:1"],
		},
	},
};

const element = () => {
	const el = document.createElement("ddi-codebook");
	document.body.append(el);
	return el;
};
const universe = (el: Element) =>
	el.querySelector<HTMLAnchorElement>('[data-kind="Universe"]');

/** A click as a pointer makes it, with any modifier keys. */
const click = (target: Element, init: MouseEventInit = {}) => {
	const e = new MouseEvent("click", {
		bubbles: true,
		cancelable: true,
		button: 0,
		...init,
	});
	target.dispatchEvent(e);
	return e;
};

afterEach(() => document.body.replaceChildren());

describe("<ddi-codebook>", async () => {
	// Defined on import, as a page's module script would.
	await import("../element/element.ts");

	it("shows the same codebook from its property or its attribute", () => {
		const a = element();
		a.ddi = DDI;
		const b = element();
		b.setAttribute("ddi", JSON.stringify(DDI));
		expect(a.innerHTML).toBe(b.innerHTML);
		expect(a.querySelector("#org\\.x\\:age-var h3")?.textContent).toBe(
			"age Age",
		);
		expect(a.querySelectorAll("main, header, h1")).toHaveLength(0);
		// jsdom doesn't apply @scope, so only the rule's text is checked, not what it styles.
		expect(a.querySelector("style")?.textContent).toMatch(/^@scope \{/);
	});

	it("reads the document in the language asked for, and says what that is", () => {
		const el = element();
		el.ddi = DDI;
		// Its own lang is what its content is in, as for any element: not a choice.
		el.lang = "de";
		const box = el.firstElementChild;
		expect(box?.getAttribute("lang")).toBe("en");
		el.language = "fr";
		expect(el.getAttribute("language")).toBe("fr");
		expect(el.firstElementChild?.getAttribute("lang")).toBe("fr");
		expect(el.querySelector("#org\\.x\\:age-var h3")?.textContent).toBe(
			"age Âge",
		);
		expect(el.querySelector("#ddi-contents")?.getAttribute("lang")).toBe("en");
	});

	it("writes itself once for each change, and not again for the same", async () => {
		const once = document.createElement("ddi-codebook-once");
		once.setAttribute("ddi", JSON.stringify(DDI));
		once.setAttribute("language", "fr");
		Object.assign(once, { href: () => undefined });
		document.body.append(once);
		const writes = new MutationObserver(() => {});
		writes.observe(once, { childList: true });
		const { DdiCodebook } = await import("../element/element.ts");
		customElements.define("ddi-codebook-once", class extends DdiCodebook {});
		// Upgraded: attributes, then the property set before, written once.
		expect(writes.takeRecords()).toHaveLength(1);
		const el = once as InstanceType<typeof DdiCodebook>;
		const { ddi, href } = el;
		el.ddi = ddi;
		el.setAttribute("language", "fr");
		el.href = href;
		expect(writes.takeRecords()).toHaveLength(0);
		// So a reader's place is kept: the link they're on keeps focus.
		const link = universe(el);
		link?.focus();
		el.setAttribute("ddi", el.getAttribute("ddi") ?? "");
		expect(document.activeElement).toBe(link);
		el.language = "en";
		expect(writes.takeRecords()).toHaveLength(1);
		writes.disconnect();
	});

	it("keeps what was set on it before it was defined", async () => {
		const early = document.createElement("ddi-codebook-early");
		Object.assign(early, { ddi: DDI });
		document.body.append(early);
		const { DdiCodebook } = await import("../element/element.ts");
		customElements.define("ddi-codebook-early", class extends DdiCodebook {});
		expect(early.querySelector("article")).not.toBeNull();
	});

	it("says why it can't show a document, without throwing", () => {
		const el = element();
		el.setAttribute("ddi", "{ not json");
		expect(el.textContent).toMatch(/^The document given isn't JSON/);
		expect(el.firstElementChild?.getAttribute("lang")).toBe("en");
		el.ddi = [1];
		expect(el.textContent).toMatch(/isn't a JSON object/);
		// Text that wasn't JSON had no document: taking it away still empties it.
		el.setAttribute("ddi", "{ not json");
		el.removeAttribute("ddi");
		expect(el.childNodes).toHaveLength(0);
	});

	it("empties when its document is taken away, by attribute or property", () => {
		const a = element();
		a.setAttribute("ddi", JSON.stringify(DDI));
		a.removeAttribute("ddi");
		expect(a.childNodes).toHaveLength(0);
		const b = element();
		b.ddi = DDI;
		b.ddi = null;
		expect(b.childNodes).toHaveLength(0);
	});

	it("sends a reference where the host says, else to its anchor", () => {
		const el = element();
		el.href = (ref) =>
			ref.type === "Concept" ? `#open=${ref.name}` : undefined;
		el.ddi = DDI;
		expect(universe(el)?.getAttribute("href")).toBe("#org.x:adults");
		// A concept the page has an anchor for: the host's address all the same.
		expect(
			el.querySelector('a[data-kind="Concept"]')?.getAttribute("href"),
		).toBe("#open=age");
	});

	it("fires ddi-follow on a plain click on a reference; cancelled, the link isn't followed", () => {
		const el = element();
		el.ddi = DDI;
		const link = universe(el);
		if (link === null) throw new Error("no link");
		const seen: CustomEvent[] = [];
		const listen = (e: CustomEvent) => seen.push(e);
		document.addEventListener("ddi-follow", listen);
		expect(click(link).defaultPrevented).toBe(false);
		el.addEventListener("ddi-follow", (e) => e.preventDefault(), {
			once: true,
		});
		expect(click(link).defaultPrevented).toBe(true);
		// Enter on a focused link activates it as a click: the same event.
		link.click();
		document.removeEventListener("ddi-follow", listen);
		// Composed, so a host in a shadow root hears it too.
		expect(seen.every((e) => e.composed)).toBe(true);
		expect(seen).toHaveLength(3);
		expect(seen.slice(0, 2).map((e) => [e.target, e.detail])).toEqual([
			[
				link,
				{
					kind: "ref",
					urn: "urn:ddi:org.x:adults:1",
					type: "Universe",
					name: "adults",
				},
			],
			[
				link,
				{
					kind: "ref",
					urn: "urn:ddi:org.x:adults:1",
					type: "Universe",
					name: "adults",
				},
			],
		]);
	});

	it("leaves every other click to the browser: a modified one, the contents, another page", () => {
		const el = element();
		el.ddi = DDI;
		const seen: Event[] = [];
		el.addEventListener("ddi-follow", (e) => {
			seen.push(e);
			e.preventDefault();
		});
		const link = universe(el);
		if (link === null) throw new Error("no link");
		for (const init of [
			{ metaKey: true },
			{ ctrlKey: true },
			{ shiftKey: true },
			{ altKey: true },
			// A middle click fires auxclick in today's browsers; a click with it, defensively.
			{ button: 1 },
		])
			expect(click(link, init).defaultPrevented).toBe(false);
		const contents = el.querySelector("nav a");
		if (contents === null) throw new Error("no contents");
		expect(click(contents).defaultPrevented).toBe(false);
		expect(seen).toEqual([]);
		// A link is a link: in the tab order, followed by Enter as by a click.
		expect(link.tabIndex).toBe(0);
	});
});
