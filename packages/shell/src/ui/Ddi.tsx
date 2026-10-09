/**
 * The DDI pane: its verdict against the official schema and the app's action (an
 * instrument's download) beside the heading, always shown; then what the app has to say
 * and the schema's problems, never folded away; then the document as JSON, folded
 * (owner, 2026-10-09: the download had sat below the fold, under a fold of the whole pane).
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
	action,
}: {
	document: DdiDocument;
	schema: DdiSchema;
	problems: readonly Finding[];
	/**
	 * What the app has to say about this export, above any schema problems (the bank:
	 * that it declares no agency yet). Pass a stable element: the pane is memoised.
	 */
	notice?: ReactNode;
	/** Beside the verdict: what can be done with the document (download it). Stable, as `notice`. */
	action?: ReactNode;
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
		<article className="pane">
			{/* A row, not the heading: the action is no part of the heading's name. */}
			<div className="pane-head">
				<h3>DDI-Lifecycle 4.0</h3>
				<span className="pane-tools">
					{badge}
					{action}
				</span>
			</div>
			<div className="pane-body ddi-body">
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
				{/*
				 * Primer's Details (native: find in page opens it) hides the browser's marker;
				 * the chevron stands in for it.
				 */}
				<Details className="ddi-json">
					<Details.Summary>
						<span className="disclosure">
							<ChevronRightIcon aria-hidden />
							Document as JSON
						</span>
					</Details.Summary>
					<pre className="json">{JSON.stringify(document, null, 2)}</pre>
				</Details>
			</div>
		</article>
	);
});
