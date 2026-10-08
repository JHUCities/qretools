import { Heading, Label, Link, Stack } from "@primer/react";
import { ScrollableRegion } from "@primer/react/experimental";
import {
	exportRefusal,
	instrumentOf,
	plainText,
	status,
	type Target,
	workspaceFileOf,
} from "@qretools/core";
import { outlineOf } from "@qretools/core/editor";
import { toDiagnostics } from "@qretools/editor";
import {
	Ddi,
	Download,
	Findings,
	Outline,
	StatusBadge,
	useSettled,
	WorkspaceNotice,
} from "@qretools/shell/ui";
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
	const { dispatch, effects } = useApp();
	const text = openText(model) ?? "";
	// Only what reading the instrument depends on: a notice or the DDI schema arriving
	// leaves the instrument, and so its DDI, as it was.
	const { banks: loads, settings, working, workspace } = model;
	const input = useMemo(
		() => ({ banks: loads, settings, working, workspace, open: path }),
		[loads, settings, working, workspace, path],
	);
	const uses = useMemo(() => usesOf(input), [input]);
	const banks = useMemo(() => banksOf(input), [input]);
	const workspaceFile =
		workspace.kind === "loaded" ? workspace.file : undefined;
	const own = useMemo(
		() =>
			workspaceFile === undefined
				? undefined
				: workspaceFileOf(workspaceFile.text),
		[workspaceFile],
	);
	// The agency as the workspace file writes it, valid or not: the instrument's findings
	// then say what's wrong with it, as the CLI's do with `--agency`.
	const agency = own?.given;
	const instrument = useMemo(
		() =>
			instrumentOf(text, {
				banks,
				...(agency !== undefined && { agency }),
			}),
		[text, banks, agency],
	);
	const problems = useMemo(
		() =>
			model.ddiSchema.kind === "failed"
				? [model.ddiSchema.finding]
				: effects.validate(instrument.ddi),
		[instrument.ddi, model.ddiSchema, effects],
	);
	const refusal = exportRefusal(instrument, problems);
	const outline = useMemo(
		() => outlineOf(instrument.draft),
		[instrument.draft],
	);
	const notice = useMemo(() => <WorkspaceNotice own={own} />, [own]);
	const diagnostics = useMemo(
		() => toDiagnostics(instrument.findings, instrument.ranges),
		[instrument],
	);
	// The list settles: it catches up 400 ms after typing stops, at once on another file,
	// and when the author turns to it. The editor's own underlines stay live.
	const [listed, flushFindings] = useSettled(
		instrument.findings,
		SETTLE_MS,
		path,
	);
	const [outlined, flushOutline] = useSettled(outline, SETTLE_MS, path);
	const flush = () => {
		flushFindings();
		flushOutline();
	};
	const onTarget = (target: Target) =>
		dispatch({ kind: "locationClicked", target });
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
					<Download name={name} ddi={instrument.ddi} refusal={refusal} />
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
				<ScrollableRegion key={path} className="right" aria-label="Previews">
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
							<Findings findings={listed} onTarget={onTarget} />
						</div>
					</article>
					<article className="pane">
						<h3>Outline</h3>
						<div className="pane-body" onPointerEnter={flush}>
							{outlined.length === 0 ? (
								<p className="quiet">The flow has no steps yet.</p>
							) : (
								<Outline items={outlined} onTarget={onTarget} />
							)}
						</div>
					</article>
					<Ddi
						document={instrument.ddi}
						schema={model.ddiSchema}
						problems={problems ?? []}
						notice={notice}
					/>
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
