/**
 * CodeMirror inside React. The component owns only the editor's lifecycle; the
 * editor object (editor.ts) owns the text while a keystroke is in flight, and
 * `sync` pushes the Model's text, diagnostics and schema in. The handle is
 * registered with the effects so `revealRange` can reach it.
 */
import { useEffect, useLayoutEffect, useRef } from "react";
import { createEditor, type Editor, type EditorInputs } from "../editor.js";
import { useApp } from "./AppContext.js";

export function EditorPane(inputs: EditorInputs) {
	const host = useRef<HTMLDivElement>(null);
	const editor = useRef<Editor | null>(null);
	const { dispatch, effects } = useApp();
	useLayoutEffect(() => {
		if (!host.current) return;
		const e = createEditor(
			host.current,
			(text) => dispatch({ kind: "edited", text }),
			(offset) => dispatch({ kind: "cursorMoved", offset }),
		);
		editor.current = e;
		effects.registerEditor(e);
		return () => {
			effects.registerEditor(undefined);
			e.destroy();
			editor.current = null;
		};
	}, [dispatch, effects]);
	const { id, text, diagnostics, schema, readOnly } = inputs;
	useEffect(() => {
		editor.current?.sync({
			id,
			text,
			diagnostics,
			schema,
			...(readOnly !== undefined && { readOnly }),
		});
	}, [id, text, diagnostics, schema, readOnly]);
	return <div ref={host} className="editor" />;
}
