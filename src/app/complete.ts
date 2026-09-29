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

interface SchemaNode {
	readonly description?: string;
	readonly enum?: readonly unknown[];
	readonly anyOf?: readonly SchemaNode[];
	readonly oneOf?: readonly {
		readonly const?: unknown;
		readonly description?: string;
	}[];
	readonly properties?: Readonly<Record<string, SchemaNode>>;
}

const KEY_LINE = /^(\s*)([A-Za-z_][\w-]*):(.*)$/;

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
	const line = context.state.doc.lineAt(context.pos);
	const before = line.text.slice(0, context.pos - line.from);

	const value = /^\s*([A-Za-z_][\w-]*):\s+(\w*)$/.exec(before);
	if (value) {
		const [, key = "", typed = ""] = value;
		const options = valuesOf(schema.properties?.[key]);
		if (typed !== "" || options.length === 0) return null;
		return { from: context.pos, options: [...options] };
	}

	const key = /^(\s*)(\w*)$/.exec(before);
	if (!key) return null;
	const [, indent = "", typed = ""] = key;
	const lines = context.state.doc.toString().split("\n");
	const here = line.number - 1;
	const { node, siblings } = scope(schema, lines, here, indent.length);
	if (!node?.properties || packageHandles(typed, indent.length, siblings))
		return null;
	const options: Completion[] = Object.entries(node.properties)
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
	indent: number,
	siblings: readonly string[],
): boolean => typed !== "" && (indent === 0 || siblings.length > 0);

/** The schema node whose keys belong at this indent, and the keys already written there. */
function scope(
	schema: SchemaNode,
	lines: readonly string[],
	here: number,
	indent: number,
): { node: SchemaNode | undefined; siblings: readonly string[] } {
	const keysAt = (from: number, to: number, at: number) =>
		lines.slice(from, to).flatMap((l, i) => {
			const m = KEY_LINE.exec(l);
			return m && (m[1] ?? "").length === at && from + i !== here
				? [m[2] ?? ""]
				: [];
		});
	if (indent === 0)
		return { node: schema, siblings: keysAt(0, lines.length, 0) };
	for (let i = here - 1; i >= 0; i--) {
		const m = KEY_LINE.exec(lines[i] ?? "");
		if (!m || (m[1] ?? "").length >= indent) continue;
		if ((m[1] ?? "").length !== 0) return { node: undefined, siblings: [] };
		const end = lines.findIndex((l, j) => j > i && /^\S/.test(l));
		return {
			node: schema.properties?.[m[2] ?? ""],
			siblings: keysAt(i + 1, end === -1 ? lines.length : end, indent),
		};
	}
	return { node: undefined, siblings: [] };
}

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
