/**
 * `<ddi-codebook>`: a codebook in any page, from a DDI-Lifecycle 4.0 document given as
 * its `ddi` property (the parsed JSON) or attribute (the JSON text). The shell around the
 * pure layers: it parses, keeps the index, and writes the codebook's HTML into itself,
 * with the style scoped to it (`@scope`). In the page's own DOM, not a shadow root, so a
 * reference is a link the browser follows to its anchor (`:target`, history, find in
 * page), as on the standalone page. Defined on import.
 *
 * - `lang` (the element's own attribute, not an ancestor's): the language the codebook
 *   is read in, where the document has it.
 * - `href`: `(ref) => string | undefined`, where a reference goes when the host knows
 *   better than the page (an app opening the item's file).
 * - A plain click on a reference fires `ddi-follow` on the link, bubbling and cancelable,
 *   its `detail` the reference as `href` receives it (`{ kind: "ref", urn, type, name }`);
 *   cancelled, the browser doesn't
 *   follow the link. A click with a modifier key opens it as the browser does.
 *
 * One codebook per page: its sections' ids (`contents`, `variables`, …) are fixed.
 */

import type { DdiIndex } from "@qretools/core";
import { codebookHtml, type Options, STYLE } from "../html.ts";
import { codebookOf, parse } from "../model.ts";
import type { Ref } from "../text.ts";

/** What the element holds: nothing yet, a document's index, or why it can't show one. */
type Held =
	| { readonly kind: "none" }
	| { readonly kind: "index"; readonly index: DdiIndex }
	| { readonly kind: "unreadable"; readonly reason: string };

/** The JSON a `ddi` attribute holds, read once. */
function heldOf(json: unknown): Held {
	const read = parse(json);
	return read.ok
		? { kind: "index", index: read.value }
		: {
				kind: "unreadable",
				reason: read.error.map((f) => f.message).join(" "),
			};
}

export class DdiCodebook extends HTMLElement {
	static observedAttributes = ["ddi", "lang"];

	#held: Held = { kind: "none" };
	#ddi: unknown;
	#href: Options["href"];

	constructor() {
		super();
		this.addEventListener("click", (e) => this.#clicked(e));
	}

	get ddi(): unknown {
		return this.#ddi;
	}
	/** `undefined` or `null` empties it. */
	set ddi(json: unknown) {
		this.#ddi = json;
		this.#held = json == null ? { kind: "none" } : heldOf(json);
		this.#render();
	}

	get href(): Options["href"] {
		return this.#href;
	}
	set href(f: Options["href"]) {
		this.#href = f;
		this.#render();
	}

	connectedCallback(): void {
		// A property set before the element was defined hides its setter: set it again.
		for (const key of ["ddi", "href"] as const)
			if (Object.hasOwn(this, key)) {
				const value: unknown = this[key];
				delete this[key];
				(this as Record<typeof key, unknown>)[key] = value;
			}
		this.#render();
	}

	attributeChangedCallback(
		name: string,
		_: string | null,
		text: string | null,
	) {
		if (name === "lang") return this.#render();
		// Removing the attribute empties it, as the last write.
		if (text === null) {
			this.ddi = undefined;
			return;
		}
		let json: unknown;
		try {
			json = JSON.parse(text);
		} catch (e) {
			this.#ddi = undefined;
			this.#held = {
				kind: "unreadable",
				reason: `The document given isn't JSON: ${e instanceof Error ? e.message : String(e)}`,
			};
			return this.#render();
		}
		this.ddi = json;
	}

	#render(): void {
		if (!this.isConnected) return;
		const held = this.#held;
		if (held.kind === "none") {
			this.replaceChildren();
			return;
		}
		if (held.kind === "unreadable") {
			const p = document.createElement("p");
			p.textContent = held.reason;
			this.replaceChildren(p);
			return;
		}
		const lang = this.getAttribute("lang") || undefined;
		const codebook = codebookOf(held.index, lang === undefined ? {} : { lang });
		this.innerHTML = `<style>@scope {${STYLE}}</style>${codebookHtml(
			codebook,
			this.#href === undefined ? {} : { href: this.#href },
		)}`;
	}

	/** A plain click on a reference: the host may take it (`ddi-follow`), else the browser follows it. */
	#clicked(e: MouseEvent): void {
		if (
			e.defaultPrevented ||
			e.button !== 0 ||
			e.metaKey ||
			e.ctrlKey ||
			e.shiftKey ||
			e.altKey
		)
			return;
		const link =
			e.target instanceof Element ? e.target.closest("a[data-urn]") : null;
		if (!(link instanceof HTMLAnchorElement) || !this.contains(link)) return;
		const { urn, kind, name } = link.dataset;
		if (urn === undefined || kind === undefined) return;
		const ref: Ref = {
			kind: "ref",
			urn,
			type: kind,
			...(name !== undefined && { name }),
		};
		const followed = link.dispatchEvent(
			new CustomEvent("ddi-follow", {
				bubbles: true,
				cancelable: true,
				detail: ref,
			}),
		);
		if (!followed) e.preventDefault();
	}
}

if (customElements.get("ddi-codebook") === undefined)
	customElements.define("ddi-codebook", DdiCodebook);

declare global {
	interface HTMLElementTagNameMap {
		"ddi-codebook": DdiCodebook;
	}
	// It bubbles, so a document or any ancestor can listen for it too.
	interface GlobalEventHandlersEventMap {
		"ddi-follow": CustomEvent<Ref>;
	}
}
