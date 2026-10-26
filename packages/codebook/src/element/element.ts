/**
 * `<ddi-codebook>`: a codebook in any page, from a DDI-Lifecycle 4.0 document given as
 * its `ddi` property (the parsed JSON) or attribute (the JSON text). The shell around the
 * pure layers: it parses, keeps the index, and writes the codebook's HTML into itself,
 * with the style scoped to it (`@scope`). In the page's own DOM, not a shadow root, so a
 * reference is a link the browser follows to its anchor (`:target`, history, find in
 * page), as on the standalone page. Defined on import.
 *
 * - `language` (attribute and property): the language the codebook is read in, where
 *   the document has it; else its first. The codebook is written in a `<div>` that says
 *   that language, and its own words are marked English; with none, the host's applies.
 *   The element's own `lang` keeps HTML's meaning (what its content is in).
 * - `href`: `(ref) => string | undefined`, where a reference goes when the host knows
 *   better than the page (an app opening the item's file). Compared by identity: a host
 *   that makes a new function each time it draws rewrites the codebook, and loses focus.
 * - A plain click on a reference fires `ddi-follow` on the link, bubbling, composed and
 *   cancelable, its `detail` the reference as `href` receives it (`{ kind: "ref", urn,
 *   type, name }`); cancelled, the browser doesn't follow the link. A click with a
 *   modifier key opens it as the browser does.
 *
 * It writes itself only when what it shows changes. Its sections' ids and its classes
 * start `ddi-` (`ddi-contents`, `ddi-group`, …), so they don't collide with a host
 * page's; the ids are fixed: one codebook per page.
 */

import type { DdiIndex } from "@qretools/core";
import { codebookHtml, escapeHtml, type Options, STYLE } from "../html.ts";
import { codebookOf, parse } from "../model.ts";
import type { Ref } from "../text.ts";

/** What the element holds: nothing yet, a document's index, or why it can't show one. */
type Held =
	| { readonly kind: "none" }
	| { readonly kind: "index"; readonly index: DdiIndex }
	| { readonly kind: "unreadable"; readonly reason: string };

/** Everything the element shows is made from: one value, replaced, never changed. */
interface Inputs {
	/** As given; `held` is made from it. */
	readonly ddi: unknown;
	readonly held: Held;
	readonly href: Options["href"];
	readonly language: string | undefined;
}

const NOTHING: Inputs = {
	ddi: undefined,
	held: { kind: "none" },
	href: undefined,
	language: undefined,
};

/** A document, read once. `undefined` or `null` is none. */
function heldOf(json: unknown): Held {
	if (json == null) return { kind: "none" };
	const read = parse(json);
	return read.ok
		? { kind: "index", index: read.value }
		: {
				kind: "unreadable",
				reason: read.error.map((f) => f.message).join(" "),
			};
}

/**
 * The inputs after a change. A document is read again only when it is another one, or
 * when what is held didn't come from it (text that wasn't JSON, which has no document).
 */
function next(inputs: Inputs, change: Partial<Inputs>): Inputs {
	if (!("ddi" in change)) return { ...inputs, ...change };
	const same = change.ddi === inputs.ddi && inputs.held.kind !== "unreadable";
	return {
		...inputs,
		...change,
		held: change.held ?? (same ? inputs.held : heldOf(change.ddi)),
	};
}

const sameInputs = (a: Inputs, b: Inputs): boolean =>
	a.held === b.held && a.href === b.href && a.language === b.language;

export class DdiCodebook extends HTMLElement {
	static observedAttributes = ["ddi", "language"];

	#inputs: Inputs = NOTHING;
	/** What is written in it now; undefined before the first write. */
	#shown: Inputs | undefined;
	/**
	 * Whether it has been connected: an upgrade gives it its attributes, one call each,
	 * before it is, so it writes once, with all of them, when it is.
	 */
	#connected = false;

	constructor() {
		super();
		this.addEventListener("click", (e) => this.#clicked(e));
	}

	get ddi(): unknown {
		return this.#inputs.ddi;
	}
	/** `undefined` or `null` empties it. */
	set ddi(json: unknown) {
		this.#set({ ddi: json });
	}

	get href(): Options["href"] {
		return this.#inputs.href;
	}
	set href(f: Options["href"]) {
		this.#set({ href: f });
	}

	get language(): string | undefined {
		return this.#inputs.language;
	}
	set language(lang: string | undefined) {
		if (lang === undefined || lang === "") this.removeAttribute("language");
		else this.setAttribute("language", lang);
	}

	connectedCallback(): void {
		// A property set before the element was defined hides its setter: take it, once.
		const early: Partial<Inputs> = {};
		for (const key of ["ddi", "href"] as const)
			if (Object.hasOwn(this, key)) {
				const value: unknown = this[key];
				delete this[key];
				Object.assign(early, { [key]: value });
			}
		this.#connected = true;
		this.#set(early);
	}

	attributeChangedCallback(
		name: string,
		before: string | null,
		text: string | null,
	) {
		// The same text again is the same document: reading it would make another.
		if (before === text) return;
		if (name === "language") return this.#set({ language: text || undefined });
		// Removing the attribute empties it, as the last write.
		if (text === null) return this.#set({ ddi: undefined });
		let json: unknown;
		try {
			json = JSON.parse(text);
		} catch (e) {
			return this.#set({
				ddi: undefined,
				held: {
					kind: "unreadable",
					reason: `The document given isn't JSON: ${e instanceof Error ? e.message : String(e)}`,
				},
			});
		}
		this.#set({ ddi: json });
	}

	#set(change: Partial<Inputs>): void {
		this.#inputs = next(this.#inputs, change);
		this.#render();
	}

	#render(): void {
		const inputs = this.#inputs;
		if (
			!this.isConnected ||
			!this.#connected ||
			(this.#shown !== undefined && sameInputs(this.#shown, inputs))
		)
			return;
		this.#shown = inputs;
		const { held, href, language } = inputs;
		if (held.kind === "none") {
			this.replaceChildren();
			return;
		}
		if (held.kind === "unreadable") {
			const p = document.createElement("p");
			p.lang = "en";
			p.textContent = held.reason;
			this.replaceChildren(p);
			return;
		}
		const codebook = codebookOf(
			held.index,
			language === undefined ? {} : { lang: language },
		);
		this.innerHTML = `<div${codebook.lang === undefined ? "" : ` lang="${escapeHtml(codebook.lang)}"`}><style>@scope {${STYLE}}</style>${codebookHtml(
			codebook,
			href === undefined ? {} : { href },
		)}</div>`;
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
				composed: true,
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
