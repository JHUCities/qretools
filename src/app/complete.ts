/**
 * Completion where codemirror-json-schema offers none: on a blank line, for the
 * first key under a parent, and for an empty value that has known choices (an
 * enum, or the shared scale names). Generic over the JSON Schema in the editor's
 * state; it knows nothing about surveys.
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
							...(o.description !== undefined && { info: o.description }),
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
		.map(([name, sub], i) => ({
			label: name,
			type: "property",
			// Keep the schema's order (name, text, intent first), not the alphabet's.
			boost: 50 - i,
			apply: `${name}: `,
			...(sub.description !== undefined && { info: sub.description }),
		}));
	return options.length === 0
		? null
		: { from: context.pos - typed.length, options, validFor: /^\w*$/ };
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
