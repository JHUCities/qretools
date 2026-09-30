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
import type {
	Completion,
	CompletionContext,
	CompletionResult,
} from "@codemirror/autocomplete";
import { getJSONSchema } from "codemirror-json-schema";
import { placeAt } from "../core/surface/place.js";

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

/** Values a field may take: a plain enum, or the constants of a branch (shared scale names). */
function valuesOf(node: SchemaNode | undefined): readonly Completion[] {
	if (!node) return [];
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
		// Once a value is typed, the package completes it.
		const options = place.typed === "" ? valuesOf(node) : [];
		return options.length === 0
			? null
			: { from: context.pos, options: [...options] };
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
