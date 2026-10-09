/**
 * Completion where codemirror-json-schema offers none: on a blank line, for the
 * first key under a parent, and for an empty value that has known choices (an
 * enum, or the shared scale names). Generic over the JSON Schema in the editor's
 * state; it knows nothing about surveys.
 *
 * One rule for what an option shows beside it: a name's content, on its own row
 * (`detail`: a shared instruction's text, a scale's labels), never what a field
 * means, and never a floating info panel. A field's meaning is the cursor
 * inspector's, once the field is written.
 */

import {
	type Completion,
	type CompletionContext,
	type CompletionResult,
	snippetCompletion,
} from "@codemirror/autocomplete";
import { placeAt } from "@qretools/core/editor";
import { getJSONSchema } from "codemirror-json-schema";

interface SchemaNode {
	readonly description?: string;
	readonly enum?: readonly unknown[];
	readonly anyOf?: readonly SchemaNode[];
	readonly oneOf?: readonly {
		readonly const?: unknown;
		readonly description?: string;
	}[];
	readonly properties?: Readonly<Record<string, SchemaNode>>;
	/** A record's values (Zod's `z.record`): what any key under it holds. */
	readonly additionalProperties?: SchemaNode | boolean;
}

/**
 * The schema of what is written under `segments`, through a union's object branch (the
 * first branch that has the segment, should two ever share one).
 */
function nodeAt(
	schema: SchemaNode,
	segments: readonly string[],
): SchemaNode | undefined {
	let node: SchemaNode | undefined = schema;
	for (const segment of segments) {
		node = (node.anyOf ?? [node])
			.map((branch) => {
				const record = branch.additionalProperties;
				return (
					branch.properties?.[segment] ??
					(typeof record === "object" ? record : undefined)
				);
			})
			.find((child) => child !== undefined);
		if (node === undefined) return undefined;
	}
	return node;
}

/**
 * Values a field may take: a plain enum, the constants of a branch (shared scale
 * names), or, for a field that holds keys of its own (`open`, `number`), `{}`: none of
 * them written.
 */
function valuesOf(node: SchemaNode | undefined): readonly Completion[] {
	if (!node) return [];
	if (node.properties)
		return [
			{ label: "{}", type: "constant", detail: "No settings of its own" },
		];
	if (node.enum)
		return node.enum.map((v) => ({ label: String(v), type: "enum" }));
	return (node.anyOf ?? [node]).flatMap((branch) =>
		(branch.oneOf ?? []).flatMap((o) =>
			o.const === undefined
				? []
				: [
						{
							label: String(o.const),
							type: "enum",
							...(o.description !== undefined && { detail: o.description }),
						},
					],
		),
	);
}

export function schemaCompletion(
	context: CompletionContext,
): CompletionResult | null {
	const schema = getJSONSchema(context.state) as SchemaNode | undefined;
	if (!schema) return null;
	const place = placeAt(context.state.doc.toString(), context.pos);
	if (place === undefined) return null;
	const node = nodeAt(schema, place.segments);

	if (place.kind === "value") {
		// Once a value is typed, the package completes it. Straight after the colon only
		// when asked (a click on the hole, or Cmd-I): typing `number:` then Enter starts a
		// block, and must never take an option instead.
		const options =
			place.typed === "" && (place.spaced || context.explicit)
				? valuesOf(node)
				: [];
		// Straight after the colon, an option writes its own space, as completion in
		// VS Code's and IntelliJ's YAML does: `open:` becomes `open: {}`, never `open:{}`.
		return options.length === 0
			? null
			: {
					from: context.pos,
					options: place.spaced
						? [...options]
						: options.map((o) => ({ ...o, apply: ` ${o.label}` })),
				};
	}

	const { typed, siblings } = place;
	// A union's object branch holds the keys (an option: a label, or a map with a label).
	const properties = (node?.anyOf ?? [node]).find(
		(b) => b?.properties,
	)?.properties;
	if (
		!properties ||
		packageHandles(typed, place.segments.length === 0, siblings)
	)
		return null;
	const options: Completion[] = Object.entries(properties)
		.filter(([name]) => !siblings.includes(name))
		.map(([name], i) => ({
			label: name,
			type: "property",
			// Keep the schema's order (name, text, intent first), not the alphabet's.
			boost: 50 - i,
			apply: `${name}: `,
		}));
	return options.length === 0
		? null
		: // No `validFor`: once a prefix is typed, the package completes it, so this list
			// must be asked again (and step aside) rather than kept, or keys appear twice.
			{ from: context.pos - typed.length, options };
}

/**
 * A snippet from the core, written exactly as it should appear, in CodeMirror's form:
 * CodeMirror indents each later line by the indent of the line it's inserted on, so
 * that indent comes off each later line here (it starts every one).
 */
export function relativeSnippet(template: string, base: string): string {
	return template
		.split("\n")
		.map((line, i) =>
			i > 0 && line.startsWith(base) ? line.slice(base.length) : line,
		)
		.join("\n");
}

/** A field written out with its own fields, as the core offers it (a question's response domains). */
export interface Snippet {
	readonly label: string;
	readonly detail: string;
	/** As it lands, `${}` its places; made relative to its line here. */
	readonly snippet: string;
	/** Where it replaces from: the start of the word being typed. */
	readonly from: number;
}

/**
 * The given snippets, beside the schema's keys (same label, the detail says what comes
 * with it). Unasked, only once a word is typed, as keys are.
 */
export const snippetSource =
	(snippets: (source: string, offset: number) => readonly Snippet[]) =>
	(context: CompletionContext): CompletionResult | null => {
		const found = snippets(context.state.doc.toString(), context.pos);
		const [first] = found;
		if (
			first === undefined ||
			(first.from === context.pos && !context.explicit)
		)
			return null;
		const base =
			/^ */.exec(context.state.doc.lineAt(first.from).text)?.[0] ?? "";
		return {
			from: first.from,
			options: found.map((s) =>
				snippetCompletion(relativeSnippet(s.snippet, base), {
					label: s.label,
					detail: s.detail,
					type: "text",
				}),
			),
			validFor: /^\w*$/,
		};
	};

/**
 * codemirror-json-schema completes a typed prefix, except for the first key under
 * a parent. Everywhere it works we stay out of its way, or options appear twice.
 */
const packageHandles = (
	typed: string,
	topLevel: boolean,
	siblings: readonly string[],
): boolean => typed !== "" && (topLevel || siblings.length > 0);

/**
 * The package's options under the same rule: a value's description (a string `info`)
 * moves to its row as `detail`; a key's rendered panel, and whatever the package itself
 * puts in `detail` (a type name, "Default value"), go. Everything else is kept.
 */
export const withoutInfo =
	(
		source: (
			context: CompletionContext,
		) => CompletionResult | null | readonly never[],
	): ((context: CompletionContext) => CompletionResult | null) =>
	(context) => {
		const result = source(context);
		// The package answers "nothing here" with an empty array.
		if (result === null || !("options" in result)) return null;
		return {
			...result,
			options: result.options.map(({ info, detail: _own, ...option }) =>
				typeof info === "string" ? { ...option, detail: info } : option,
			),
		};
	};
