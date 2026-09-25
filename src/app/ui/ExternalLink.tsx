/**
 * A link that leaves the app for GitHub, in a new tab. Primer's Link, with the
 * external-link icon as the visual cue and the same said to screen readers: a new tab
 * opening unannounced is disorienting.
 */
import { LinkExternalIcon } from "@primer/octicons-react";
import { Link, VisuallyHidden } from "@primer/react";
import type { ReactNode } from "react";

export function ExternalLink({
	href,
	muted = false,
	children,
}: {
	href: string;
	muted?: boolean;
	children: ReactNode;
}) {
	return (
		<Link href={href} target="_blank" rel="noreferrer" muted={muted}>
			{children} <LinkExternalIcon size={12} aria-hidden />
			<VisuallyHidden> (opens in a new tab)</VisuallyHidden>
		</Link>
	);
}
