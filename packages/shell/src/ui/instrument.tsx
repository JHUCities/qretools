/**
 * What the apps show of an instrument beside its source: the flow as an outline, the
 * DDI download, and what its workspace's details say about the export.
 */
import { DownloadIcon } from "@primer/octicons-react";
import { Button, Link, LinkButton, Truncate } from "@primer/react";
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
import { Fragment, useEffect, useId, useState } from "react";
import { inlineCode } from "./findings.tsx";

/**
 * The DDI download: a link to the document as a file while it may be exported, and an
 * inactive button saying why not otherwise (the rule is the core's, the CLI's too).
 */
export function Download({
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
