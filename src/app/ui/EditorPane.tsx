/**
 * CodeMirror inside React. The component owns only the editor's lifecycle; the
 * editor object (editor.ts) owns the text while a keystroke is in flight, and
 * `sync` pushes the Model's text, diagnostics, marks and schema in. The handle is
 * registered with the effects so `revealRange` can reach it.
 */
import { useLayoutEffect, useRef } from "react";
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
	const { id, text, diagnostics, marks, schema, readOnly, label } = inputs;
	// Before paint: the first frame of a file already shows its text, never an empty
	// editor that fills a frame later.
	useLayoutEffect(() => {
		editor.current?.sync({
			id,
			text,
			diagnostics,
			marks,
			schema,
			...(readOnly !== undefined && { readOnly }),
			...(label !== undefined && { label }),
		});
	}, [id, text, diagnostics, marks, schema, readOnly, label]);
	return <div ref={host} className="editor" />;
}
