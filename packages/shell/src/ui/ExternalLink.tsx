/** A link to another site, in a new tab: said to screen readers, never drawn as an icon (owner, 2026-10-09). */

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
			{children}
			<VisuallyHidden> (opens in a new tab)</VisuallyHidden>
		</Link>
	);
}
