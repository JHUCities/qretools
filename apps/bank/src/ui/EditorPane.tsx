/**
 * CodeMirror inside React. The component owns only the editor's lifecycle; the
 * editor object (editor.ts) owns the text while a keystroke is in flight, and
 * `sync` pushes the Model's text, diagnostics, marks and schema in. The handle is
 * registered with the effects so `revealRange` can reach it.
 */

import { domainSnippets, newLineAfter } from "@qretools/core/editor";
import {
	createEditor,
	type Editor,
	type EditorInputs,
	instrumentSource,
} from "@qretools/editor";
import { useLayoutEffect, useRef } from "react";
import { useApp } from "./AppContext.js";

/**
 * A question or shared file has its schema, which completion reads. An instrument has
 * none: completion offers the questions and names of the banks it uses instead
 * (`instrument`), read from the store when it asks, never as they were at mount.
 */
export function EditorPane(
	inputs: EditorInputs &
		(
			| {
					readonly schema: object;
					readonly instrument?: undefined;
					/** A question: its response domains are offered written out too. */
					readonly question?: true;
			  }
			| {
					readonly schema?: undefined;
					readonly instrument: true;
					readonly question?: undefined;
			  }
		),
) {
	const host = useRef<HTMLDivElement>(null);
	const editor = useRef<Editor | null>(null);
	const { dispatch, effects, evaluations, store } = useApp();
	const instrument = inputs.instrument === true;
	const question = inputs.question === true;
	// The open file's id when completion asks: the editor outlives a change of file.
	const open = useRef(inputs.id);
	open.current = inputs.id;
	useLayoutEffect(() => {
		if (!host.current) return;
		const scopes = () => {
			const { model } = store.getState();
			const e = model.local.workspace[open.current];
			return e?.kind === "instrument" ? evaluations.usedScopes(model, e) : {};
		};
		const e = createEditor(
			host.current,
			(text) => dispatch({ kind: "edited", text }),
			(offset) => dispatch({ kind: "cursorMoved", offset }),
			(id, offset) => dispatch({ kind: "definitionRequested", id, offset }),
			instrument
				? { completions: [instrumentSource(scopes)], newLine: newLineAfter }
				: question
					? { snippets: domainSnippets }
					: {},
		);
		editor.current = e;
		effects.registerEditor(e);
		return () => {
			effects.registerEditor(undefined);
			e.destroy();
			editor.current = null;
		};
	}, [dispatch, effects, evaluations, store, instrument, question]);
	const { id, text, diagnostics, marks, schema, readOnly, label } = inputs;
	// Before paint: the first frame of a file already shows its text, never an empty
	// editor that fills a frame later.
	useLayoutEffect(() => {
		editor.current?.sync({
			id,
			text,
			diagnostics,
			marks,
			...(schema !== undefined && { schema }),
			...(readOnly !== undefined && { readOnly }),
			...(label !== undefined && { label }),
		});
		if (editor.current) effects.editorSynced(id);
	}, [id, text, diagnostics, marks, schema, readOnly, label, effects]);
	return <div ref={host} className="editor" />;
}
