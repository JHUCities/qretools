/**
 * `@qretools/shell/ui`: the React pieces the QREtools apps share, on Primer. Kept apart
 * from the shell's main entry, which imports no React.
 */
export { Ddi, type DdiSchema } from "./Ddi.tsx";
export { ExternalLink } from "./ExternalLink.tsx";
export {
	Findings,
	failureDescription,
	findingKeys,
	inlineCode,
	type OnTarget,
	type Related,
	StatusBadge,
	StatusIcon,
} from "./findings.tsx";
export { AccountMenu, ThemeToggle, Wordmark } from "./header.tsx";
export { Download, Outline, WorkspaceNotice } from "./instrument.tsx";
export { useSettled } from "./useSettled.ts";
