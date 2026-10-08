/**
 * The DDI pane: the document as JSON, with its verdict against the official schema
 * beside the heading, and the schema's problems above it.
 */

import { ChevronRightIcon } from "@primer/octicons-react";
import { Details, Label } from "@primer/react";
import { InlineMessage } from "@primer/react/experimental";
import type { DdiDocument, Finding } from "@qretools/core";
import { memo, type ReactNode } from "react";
import { inlineCode } from "./findings.tsx";

/** The official DDI schema is 900KB and loads lazily. The compiled validator lives in each app's effects. */
export type DdiSchema =
	| { readonly kind: "loading" }
	| { readonly kind: "ready" }
	| { readonly kind: "failed"; readonly finding: Finding };

/** Memoised: stringifying the whole DDI document must not ride every caret move. */
export const Ddi = memo(function Ddi({
	document,
	schema,
	problems,
	notice,
}: {
	document: DdiDocument;
	schema: DdiSchema;
	problems: readonly Finding[];
	/**
	 * What the app has to say about this export, above any schema problems (the bank:
	 * that it declares no agency yet). Pass a stable element: the pane is memoised.
	 */
	notice?: ReactNode;
}) {
	const badge =
		schema.kind === "loading" ? (
			<Label>loading schema…</Label>
		) : problems.length === 0 ? (
			<Label variant="success">valid against the official schema</Label>
		) : (
			<Label variant="danger">
				{problems.length === 1
					? "1 schema problem"
					: `${problems.length} schema problems`}
			</Label>
		);
	return (
		// Primer's Details hides the browser's marker; the chevron stands in for it,
		// on the heading's line.
		<Details className="pane">
			<Details.Summary>
				<h3>
					<span className="disclosure">
						<ChevronRightIcon aria-hidden />
						DDI-Lifecycle 4.0
					</span>
					{badge}
				</h3>
			</Details.Summary>
			<div className="pane-body">
				{notice}
				{problems.map((f, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: schema problems are positional and can repeat
					<InlineMessage variant="critical" key={i}>
						<span>
							{inlineCode(f.message)}
							{f.detail !== undefined && (
								<span className="detail">{f.detail}</span>
							)}
						</span>
					</InlineMessage>
				))}
				<pre className="json">{JSON.stringify(document, null, 2)}</pre>
			</div>
		</Details>
	);
});
