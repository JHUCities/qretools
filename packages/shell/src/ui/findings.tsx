/**
 * The findings, and the small pieces that draw core values the same way in every
 * QREtools app: field names in messages as code, a failure's description, a file's
 * verdict as a badge or an icon. They decide nothing.
 */

import {
	AlertIcon,
	CheckCircleIcon,
	InfoIcon,
	IssueDraftIcon,
	XCircleIcon,
} from "@primer/octicons-react";
import { Label, Link } from "@primer/react";
import {
	codeSpans,
	type Finding,
	type Fix,
	SEVERITY_LABEL,
	type Status,
	type Target,
	toFillIn,
} from "@qretools/core";
import type { ReactNode } from "react";

/** Where a click on a hole or finding goes; absent in a read-only view, where nothing is clickable. */
export type OnTarget = ((target: Target) => void) | undefined;

/** Messages mark field names with backticks (`codeSpans`); show those as code. */
export const inlineCode = (text: string): ReactNode[] =>
	codeSpans(text).map((s, i) =>
		s.code ? (
			// biome-ignore lint/suspicious/noArrayIndexKey: the pieces of a split string have no identity but their position
			<code key={i} className="code">
				{s.text}
			</code>
		) : (
			s.text
		),
	);

/** A banner's description: the hint, then any library detail, quieter. */
export const failureDescription = (f: {
	readonly hint?: string;
	readonly detail?: string;
}): ReactNode =>
	f.hint === undefined && f.detail === undefined ? undefined : (
		<>
			{f.hint !== undefined && inlineCode(f.hint)}
			{f.detail !== undefined && <span className="detail">{f.detail}</span>}
		</>
	);

export function StatusBadge({ status }: { status: Status }) {
	switch (status.kind) {
		case "complete":
			return <Label variant="success">complete</Label>;
		case "advice":
			return (
				<Label variant={status.worst === "warning" ? "attention" : "accent"}>
					{status.count === 1
						? "1 piece of advice"
						: `${status.count} pieces of advice`}
				</Label>
			);
		case "incomplete":
			return (
				<Label variant={status.errors > 0 ? "danger" : "attention"}>
					{[
						status.holes > 0 && toFillIn(status.holes),
						status.errors > 0 && `${status.errors} to fix`,
					]
						.filter(Boolean)
						.join(", ")}
				</Label>
			);
		default:
			return status satisfies never;
	}
}

/** A file's verdict as one icon: its most severe finding's, as the Findings list draws it. */
export function StatusIcon({ status }: { status: Status }) {
	if (status.kind === "complete")
		return (
			<CheckCircleIcon size={14} className="fg-success" aria-label="complete" />
		);
	const worst =
		status.kind === "advice"
			? status.worst
			: status.errors > 0
				? "error"
				: "hole";
	const { Icon, className } = SEVERITY[worst];
	return (
		<Icon size={14} className={className} aria-label={SEVERITY_LABEL[worst]} />
	);
}

/** Each severity's icon and colour: a hole is a dashed circle, an invitation, never red. */
const SEVERITY = {
	hole: { Icon: IssueDraftIcon, className: "fg-attention" },
	error: { Icon: XCircleIcon, className: "fg-danger" },
	warning: { Icon: AlertIcon, className: "fg-attention" },
	info: { Icon: InfoIcon, className: "fg-accent" },
} as const;

/**
 * The findings: one list, editable or not; severity is an icon with its name, never
 * colour alone. Editable, the message takes the author to its place in the source, and
 * a fix or another file's link follows it as a text link. Not Primer's ActionList: an
 * item is one button, so nothing interactive can sit inside it, and read only it would
 * render buttons that do nothing (Primer 38's Item.js).
 */
/**
 * A key per finding that survives edits elsewhere in the text: what it says and where,
 * plus which occurrence it is when the same finding is reported twice. A finding that
 * stays keeps its element (and its focus); only a new one enters.
 */
export const findingKeys = (
	findings: readonly Finding[],
): readonly string[] => {
	const seen = new Map<string, number>();
	return findings.map((f) => {
		const id = `${f.code}\u0000${f.path}\u0000${f.message}`;
		const n = seen.get(id) ?? 0;
		seen.set(id, n + 1);
		return `${id}\u0000${n}`;
	});
};

/** Another file a finding is about, as a link beside it (a draft has no address, so none). */
export interface Related {
	readonly href: string;
	readonly label: string;
}

export function Findings({
	findings,
	onTarget,
	related,
	onFix,
}: {
	findings: readonly Finding[];
	onTarget?: OnTarget;
	/** The other file a bank-level finding names, opened by an ordinary link. */
	related?: (f: Finding) => Related | undefined;
	/** Apply a finding's quick fix; absent where nothing can be edited. */
	onFix?: (fix: Fix) => void;
}) {
	if (findings.length === 0)
		return <p className="quiet">Nothing to fill in, fix, or reconsider.</p>;
	const keys = findingKeys(findings);
	return (
		// A plain list, editable or not: a fix and a link sit under the message, as
		// GitHub offers "Create a new release" under "No releases published", which an
		// ActionList item (one button) cannot hold. `role="list"`: Safari's VoiceOver
		// drops list semantics from a list without bullets.
		// biome-ignore lint/a11y/noRedundantRoles: VoiceOver, above
		<ul className="findings" role="list" aria-label="Findings">
			{findings.map((f, i) => {
				const { Icon, className } = SEVERITY[f.severity];
				const other = related?.(f);
				const fix = onFix === undefined ? undefined : f.fix;
				const message = inlineCode(f.message);
				return (
					<li key={keys[i]} className="finding">
						<Icon
							className={`${className} finding-icon`}
							aria-label={SEVERITY_LABEL[f.severity]}
						/>
						<div className="finding-body">
							{onTarget === undefined ? (
								<span className="finding-message">{message}</span>
							) : (
								// The message goes to its place in the source.
								<Link
									as="button"
									type="button"
									className="finding-message"
									onClick={() => onTarget(f)}
								>
									{message}
								</Link>
							)}
							{f.hint !== undefined && (
								<span className="finding-hint">{inlineCode(f.hint)}</span>
							)}
							{f.detail !== undefined && (
								<span className="detail">{f.detail}</span>
							)}
							{fix !== undefined && (
								<Link
									as="button"
									type="button"
									className="finding-action"
									// Where focus goes next is `update`'s: into the source for an edit,
									// the name dialog for a new shared entry.
									onClick={() => onFix?.(fix)}
								>
									{inlineCode(fix.label)}
								</Link>
							)}
							{other !== undefined && (
								<Link className="finding-action" href={other.href}>
									{other.label}
								</Link>
							)}
						</div>
					</li>
				);
			})}
		</ul>
	);
}
