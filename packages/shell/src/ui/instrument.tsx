/**
 * What the apps show of an instrument beside its source: the flow as an outline, the
 * DDI download, and what its workspace's details say about the export.
 */
import { DownloadIcon } from "@primer/octicons-react";
import { Button, Link, LinkButton, VisuallyHidden } from "@primer/react";
import { InlineMessage } from "@primer/react/experimental";
import {
	type DdiDocument,
	type Refusal,
	refusalReason,
	type Target,
	WORKSPACE,
	type WorkspaceFile,
} from "@qretools/core";
import type { OutlineItem, OutlinePart } from "@qretools/core/editor";
import { Fragment, type ReactNode, useEffect, useState } from "react";
import { inlineCode } from "./findings.tsx";

/**
 * The DDI download: a link to the document as a file while it may be exported, and an
 * inactive button otherwise, described by `DownloadReason` (the rule is the core's, the
 * CLI's too). Apart, so the button can sit in the pane's header, one height whatever the
 * reason, and the reason, which changes as the author types, in the body.
 */
export function Download({
	name,
	ddi,
	refusal,
	reason,
}: {
	name: string;
	ddi: DdiDocument;
	refusal: Refusal | undefined;
	/** The id of the `DownloadReason` that says why not. */
	reason: string;
}) {
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
		<Button
			size="small"
			inactive
			leadingVisual={DownloadIcon}
			aria-describedby={reason}
		>
			Download DDI
		</Button>
	);
}

/** Why the download is held back; nothing while it isn't. */
export function DownloadReason({
	id,
	refusal,
}: {
	id: string;
	refusal: Refusal | undefined;
}) {
	return refusal === undefined ? null : (
		<p id={id} className="quiet download-reason">
			{refusalReason(refusal)}
		</p>
	);
}

/** What the workspace file says, or that there's none: beside the DDI, which it publishes. */
export function WorkspaceNotice({ own }: { own: WorkspaceFile | undefined }) {
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
export function Outline({
	items,
	onTarget,
	question,
}: {
	items: readonly OutlineItem[];
	onTarget: (target: Target) => void;
	/**
	 * An ask's question's words as a way to the question itself (the app knows where it
	 * lives); absent, or undefined for an item, they're plain text.
	 */
	question?: (item: OutlineItem, words: string) => ReactNode | undefined;
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
						<OutlineLabel label={item.label} />
						{/* Told apart from the question's own link in a links list. */}
						<VisuallyHidden> in the source</VisuallyHidden>
					</Link>
					{/* The label goes to the source; the question's words, to the question. */}
					{item.detail !== undefined && (
						<span className="quiet outline-detail">
							{question?.(item, item.detail) ?? item.detail}
						</span>
					)}
					{item.children.length > 0 && (
						<Outline
							items={item.children}
							onTarget={onTarget}
							{...(question !== undefined && { question })}
						/>
					)}
				</li>
			))}
		</ol>
	);
}

/**
 * A step's label as the outline says it ("Stop if `hh.consent = "2"`"): also how a
 * question's "Used by" names the places an instrument reads it.
 */
export function OutlineLabel({ label }: { label: readonly OutlinePart[] }) {
	return label.map((part, i) => (
		// biome-ignore lint/suspicious/noArrayIndexKey: a label's parts are positional
		<Fragment key={i}>
			{/* Heard as words; the flex gap draws the space. */}
			{i > 0 && " "}
			<Part part={part} />
		</Fragment>
	));
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
