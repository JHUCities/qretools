/**
 * CodeMirror inside React, for an instrument: the shared editor with the instrument's
 * own completion (bank questions after `ask:`, names in conditions) and no schema. The
 * component owns only the editor's lifecycle; mounted per file (its parent keys it).
 */

import {
	createEditor,
	type Editor,
	type EditorInputs,
	instrumentSource,
} from "@qretools/editor";
import { useLayoutEffect, useRef } from "react";
import { banksOf } from "../evaluations.ts";
import { useApp } from "./AppContext.ts";

export function EditorPane({
	text,
	diagnostics,
	label,
}: {
	text: string;
	diagnostics: EditorInputs["diagnostics"];
	label: string;
}) {
	const host = useRef<HTMLDivElement>(null);
	const editor = useRef<Editor | null>(null);
	const { dispatch, effects, store } = useApp();
	useLayoutEffect(() => {
		if (!host.current) return;
		const e = createEditor(
			host.current,
			(text) => dispatch({ kind: "edited", text }),
			() => {},
			() => {},
			// The banks as loaded when completion asks, read from the store then: never
			// those of the moment the editor was made.
			{
				completions: [instrumentSource(() => banksOf(store.getState().model))],
			},
		);
		editor.current = e;
		effects.registerEditor(e);
		return () => {
			effects.registerEditor(undefined);
			e.destroy();
			editor.current = null;
		};
	}, [dispatch, effects, store]);
	// Before paint: the first frame of a file already shows its text.
	useLayoutEffect(() => {
		// One id: a fresh editor per file comes from the parent's `key={path}` remount.
		editor.current?.sync({ id: 1, text, diagnostics, marks: [], label });
	}, [text, diagnostics, label]);
	return <div ref={host} className="editor" />;
}
