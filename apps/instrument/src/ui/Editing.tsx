/**
 * The open instrument: its name, state and download, the banks it uses, the source in
 * the editor, and beside it its findings, its outline and its DDI. Read against its
 * banks and its workspace's agency on every keystroke (`instrumentOf` is a few
 * milliseconds); the banks themselves are evaluated once each, and the DDI is checked
 * against the official schema only when it changes.
 */
import { DownloadIcon } from "@primer/octicons-react";
import {
	Button,
	Heading,
	Label,
	Link,
	LinkButton,
	Stack,
	Truncate,
} from "@primer/react";
import { InlineMessage, ScrollableRegion } from "@primer/react/experimental";
import {
	type DdiDocument,
	exportRefusal,
	instrumentOf,
	plainText,
	type Refusal,
	refusalReason,
	status,
	type Target,
	WORKSPACE,
	type WorkspaceFile,
	workspaceFileOf,
} from "@qretools/core";
import {
	type OutlineItem,
	type OutlinePart,
	outlineOf,
} from "@qretools/core/editor";
import { toDiagnostics } from "@qretools/editor";
import {
	Ddi,
	Findings,
	inlineCode,
	StatusBadge,
	useSettled,
} from "@qretools/shell/ui";
import { Fragment, useEffect, useId, useMemo, useState } from "react";
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

/**
 * The DDI download: a link to the document as a file while it may be exported, and an
 * inactive button saying why not otherwise (the rule is the core's, the CLI's too).
 */
function Download({
	name,
	ddi,
	refusal,
}: {
	name: string;
	ddi: DdiDocument;
	refusal: Refusal | undefined;
}) {
	const reason = useId();
	const allowed = refusal === undefined;
	// The file, made while it may be downloaded and let go when it changes: made in the
	// effect whose cleanup lets it go, so each URL pairs with its own revoke (StrictMode
	// runs an effect twice in development; a memo's URL would be revoked under the link).
	const [href, setHref] = useState<string>();
	useEffect(() => {
		if (!allowed) {
			setHref(undefined);
			return;
		}
		const url = URL.createObjectURL(
			new Blob([`${JSON.stringify(ddi, null, 2)}\n`], {
				type: "application/json",
			}),
		);
		setHref(url);
		return () => URL.revokeObjectURL(url);
	}, [ddi, allowed]);
	if (allowed && href !== undefined)
		return (
			<LinkButton
				size="small"
				href={href}
				download={`${name}.ddi.json`}
				leadingVisual={DownloadIcon}
			>
				Download DDI
			</LinkButton>
		);
	return (
		<>
			<Button
				size="small"
				inactive
				leadingVisual={DownloadIcon}
				aria-describedby={reason}
			>
				Download DDI
			</Button>
			<span id={reason} className="quiet">
				{refusal === undefined ? "" : refusalReason(refusal)}
			</span>
		</>
	);
}

/** What the workspace file says, or that there's none: beside the DDI, which it publishes. */
function WorkspaceNotice({ own }: { own: WorkspaceFile | undefined }) {
	if (own === undefined)
		return (
			<InlineMessage variant="warning">
				<span>
					This workspace has no <code className="code">{WORKSPACE.file}</code>,
					so there's no DDI agency to publish its instruments under.
				</span>
			</InlineMessage>
		);
	return own.findings.map((f, i) => (
		<InlineMessage
			// biome-ignore lint/suspicious/noArrayIndexKey: findings are positional and can repeat
			key={i}
			variant={f.severity === "error" ? "critical" : "warning"}
		>
			<span>
				<code className="code">{WORKSPACE.file}</code>: {inlineCode(f.message)}
			</span>
		</InlineMessage>
	));
}

/**
 * The flow as nested lists, each step a way to its place in the source; what is still
 * to be written shows as a hole, as in the previews of a question.
 */
function Outline({
	items,
	onTarget,
}: {
	items: readonly OutlineItem[];
	onTarget: (target: Target) => void;
}) {
	return (
		<ol className="outline">
			{items.map((item) => (
				<li key={item.path}>
					<Link
						as="button"
						type="button"
						onClick={() => onTarget({ path: item.path, severity: "info" })}
					>
						{item.label.map((part, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: a label's parts are positional
							<Fragment key={i}>
								{/* Heard as words; the flex gap draws the space. */}
								{i > 0 && " "}
								<Part part={part} />
							</Fragment>
						))}
					</Link>
					{item.detail !== undefined && (
						<Truncate
							as="span"
							title={item.detail}
							className="quiet outline-detail"
						>
							{item.detail}
						</Truncate>
					)}
					{item.children.length > 0 && (
						<Outline items={item.children} onTarget={onTarget} />
					)}
				</li>
			))}
		</ol>
	);
}

function Part({ part }: { part: OutlinePart }) {
	switch (part.kind) {
		case "code":
			return <code className="code">{part.text}</code>;
		case "hole":
			return <span className="hole">{part.text}</span>;
		case "keyword":
			return <span className="outline-keyword">{part.text}</span>;
		case "text":
			return <span>{part.text}</span>;
		default:
			return part.kind satisfies never;
	}
}
