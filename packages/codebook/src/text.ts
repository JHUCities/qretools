/**
 * Text as a codebook shows it: paragraphs of typed spans, never a string the HTML layer
 * must parse again. Plain words split into paragraphs at blank lines, and a web address
 * in them becomes a link; a value piped into a text (a fill) is a reference to its
 * parameter.
 */

import {
	asList,
	asObj,
	type Indexed,
	refUrn,
	str,
	words,
} from "@qretools/core";

export type Span =
	| { readonly kind: "text"; readonly text: string }
	| { readonly kind: "link"; readonly text: string; readonly url: string }
	/** Words to show as code: a variable's or a code's literal value. */
	| { readonly kind: "code"; readonly text: string }
	/** Another item, by URN: the anchor of its entry or shared entry. */
	| {
			readonly kind: "ref";
			/** The DDI type name (`Universe`, `Concept`, `InParameter`). */
			readonly type: string;
			readonly urn: string;
			readonly name?: string;
			/** A value piped into a text, drawn as one: `[name]`. */
			readonly fill?: true;
	  };
export type Ref = Extract<Span, { kind: "ref" }>;
export type Para = readonly Span[];
export type Text = readonly Para[];

/** A web address, without the punctuation that ends a sentence around it. */
const URL = /https?:\/\/[^\s<>"]*[^\s<>".,;:!?)\]'}]/g;
const BLANK_LINE = /\n[ \t]*\n\s*/;

/** Words with each web address in them a link. */
export function linked(text: string): Span[] {
	const spans: Span[] = [];
	let at = 0;
	for (const m of text.matchAll(URL)) {
		if (m.index > at)
			spans.push({ kind: "text", text: text.slice(at, m.index) });
		spans.push({ kind: "link", text: m[0], url: m[0] });
		at = m.index + m[0].length;
	}
	if (at < text.length) spans.push({ kind: "text", text: text.slice(at) });
	return spans;
}

/** Spans in reading order as paragraphs: a blank line in a text span starts a new one. */
export function paragraphs(spans: readonly Span[]): Text {
	const paras: Span[][] = [[]];
	for (const s of spans) {
		if (s.kind !== "text") {
			paras.at(-1)?.push(s);
			continue;
		}
		s.text.split(BLANK_LINE).forEach((part, i) => {
			if (i > 0) paras.push([]);
			if (part !== "") paras.at(-1)?.push(...linked(part));
		});
	}
	return paras.filter((p) => p.length > 0);
}

/** Plain words as text; nothing for no words. */
export function textOf(s: string | undefined): Text | undefined {
	const text = s === undefined ? [] : paragraphs([{ kind: "text", text: s }]);
	return text.length === 0 ? undefined : text;
}

/**
 * An item's name, from its own name field (`VariableName`, `UniverseName`; a control
 * construct's `ConstructName`; a parameter's `ParameterName`, whatever field holds it, as a
 * loop's `LoopVariableReference` does; else its `Alias`), if it has one. Never from its ID.
 */
export const nameOf = (it: Indexed, lang?: string): string | undefined =>
	words(
		it.item[
			it.type.endsWith("Parameter") ? "ParameterName" : `${it.type}Name`
		] ??
			it.item.ConstructName ??
			it.item.ParameterName,
		lang,
	) ?? str(it.item.Alias);

export const refOf = (it: Indexed, lang?: string): Ref => {
	const name = nameOf(it, lang);
	return {
		kind: "ref",
		type: it.type,
		urn: it.urn,
		...(name !== undefined && { name }),
	};
};

/** What a fill's parameter can belong to that the page has a place for. */
const FILLED: ReadonlySet<string> = new Set([
	"Variable",
	"Loop",
	"ComputationItem",
]);

/**
 * A DynamicText (QuestionText, InstructionText): the one written for `lang`, else the
 * first. Literal text as words; a fill as a reference to the parameter it shows, named
 * as the text's own parameter names it, else as the parameter it points at does.
 */
export function dynamicTextOf(
	j: unknown,
	follow: (r: unknown) => Indexed | undefined,
	lang?: string,
): Text | undefined {
	const all = asList(j);
	const chosen =
		all.find((d) => lang !== undefined && d.AudienceLanguage === lang) ??
		all[0];
	const spans = asList(chosen?.TextContent).flatMap((t): Span[] => {
		const literal = words(asObj(t.Text), lang);
		if (literal !== undefined) return [{ kind: "text", text: literal }];
		const p = asObj(t.SourceParameterReference);
		const urn = refUrn(p);
		if (p === undefined || urn === undefined) return [];
		const found = follow(p);
		// An OutParameter stands for what owns it (a variable, a loop's counter, a computed value).
		const target =
			found?.owner !== undefined && FILLED.has(found.owner.type)
				? found.owner
				: found;
		const name =
			nameOf({ type: "Parameter", urn, item: p }, lang) ??
			(found === undefined ? undefined : nameOf(found, lang));
		return [
			{
				kind: "ref",
				type: target?.type ?? "Parameter",
				urn: target?.urn ?? urn,
				...(name !== undefined && { name }),
				fill: true,
			},
		];
	});
	const text = paragraphs(spans);
	return text.length === 0 ? undefined : text;
}
