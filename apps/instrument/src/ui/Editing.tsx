/**
 * The open instrument: its name and state, the banks it uses, the source in the editor,
 * and its findings beside it. Read against its banks on every keystroke (`instrumentOf`
 * is a few milliseconds); the banks themselves are evaluated once each.
 */
import { Heading, Label, Link, Stack } from "@primer/react";
import { ScrollableRegion } from "@primer/react/experimental";
import { instrumentOf, plainText, status } from "@qretools/core";
import { toDiagnostics } from "@qretools/editor";
import { Findings, StatusBadge, useSettled } from "@qretools/shell/ui";
import { useMemo } from "react";
import { banksOf } from "../evaluations.ts";
import type { Model } from "../model.ts";
import { instrumentName } from "../update.ts";
import { openText, type Use, usesOf } from "../uses.ts";
import { useApp } from "./AppContext.ts";
import { EditorPane } from "./EditorPane.tsx";

/** How long typing must pause before the findings list catches up with the text. */
const SETTLE_MS = 400;

export function Editing({ model, path }: { model: Model; path: string }) {
	const { dispatch } = useApp();
	const text = openText(model) ?? "";
	const uses = useMemo(() => usesOf(model), [model]);
	const banks = useMemo(() => banksOf(model), [model]);
	const instrument = useMemo(
		() => instrumentOf(text, { banks }),
		[text, banks],
	);
	const diagnostics = useMemo(
		() => toDiagnostics(instrument.findings, instrument.ranges),
		[instrument],
	);
	// The list settles: it catches up 400 ms after typing stops, at once on another file,
	// and when the author turns to it. The editor's own underlines stay live.
	const [listed, flush] = useSettled(instrument.findings, SETTLE_MS, path);
	const name = instrumentName(path);
	return (
		<>
			<div className="qhead">
				<Stack
					direction="horizontal"
					align="center"
					gap="condensed"
					wrap="wrap"
				>
					<Heading as="h2" variant="small">
						{name}
					</Heading>
					{model.working[path] !== undefined && <Label>unsaved changes</Label>}
				</Stack>
				{uses.length > 0 && (
					<Banks
						uses={uses}
						onRetry={(key) => dispatch({ kind: "bankRetried", key })}
					/>
				)}
			</div>
			<div className="split">
				{/* Leaving the editor (by blur, which bubbles in React) is a pause. */}
				<section className="left" aria-label="Instrument source" onBlur={flush}>
					<EditorPane
						key={path}
						text={text}
						diagnostics={diagnostics}
						label={`Instrument ${name}: source (YAML)`}
					/>
				</section>
				<ScrollableRegion key={path} className="right" aria-label="Findings">
					<article className="pane">
						<h3>
							Findings <StatusBadge status={status(instrument.findings)} />
						</h3>
						<div
							className="pane-body"
							onPointerEnter={flush}
							onFocusCapture={(e) => {
								// Keyboard focus only: a pointer press also focuses, mid-click.
								if (
									e.target instanceof Element &&
									e.target.matches(":focus-visible")
								)
									flush();
							}}
						>
							<Findings
								findings={listed}
								onTarget={(target) =>
									dispatch({ kind: "locationClicked", target })
								}
							/>
						</div>
					</article>
				</ScrollableRegion>
			</div>
		</>
	);
}

/** Each bank the instrument uses, and how far reading it has got; a failed one can be read again. */
function Banks({
	uses,
	onRetry,
}: {
	uses: readonly Use[];
	onRetry: (key: string) => void;
}) {
	return (
		<ul className="uses quiet">
			{uses.map((u) => (
				<li key={u.alias}>
					<code className="code">{u.alias}</code> {stateText(u)}
					{u.state.kind === "loaded" &&
						(u.state.load.kind === "failed" || !u.state.load.found) && (
							<>
								{" "}
								<Link
									as="button"
									type="button"
									onClick={() =>
										u.state.kind === "loaded" && onRetry(u.state.key)
									}
								>
									Try again
								</Link>
							</>
						)}
				</li>
			))}
		</ul>
	);
}

function stateText(u: Use): string {
	const { state } = u;
	switch (state.kind) {
		case "unreadable":
			return plainText(state.reason);
		case "loading":
			return `reading ${state.key}…`;
		case "loaded":
			return state.load.kind === "failed"
				? `couldn't be read: ${plainText(state.load.failure.message)}`
				: state.load.found
					? state.key
					: `isn't there: no folder ${state.key}`;
		default:
			return state satisfies never;
	}
}
