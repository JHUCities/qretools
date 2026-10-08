/**
 * `@qretools/editor`: the surface language's editor, on CodeMirror 6, shared by the
 * QREtools apps: highlighting by role and meaning, findings as diagnostics, schema and
 * name completion, quick fixes and go to definition, over the core's editor API.
 * Internal to this repository for now. Its look comes from the host page's stylesheet.
 */

export { toDiagnostics } from "./diagnostics.ts";
export {
	createEditor,
	type Editor,
	type EditorInputs,
	type EditorOptions,
} from "./editor.ts";
export { instrumentSource } from "./instrument.ts";
