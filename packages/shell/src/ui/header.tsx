/**
 * The header's own pieces, as every QREtools app draws them: the wordmark, the light or
 * dark toggle, and the account menu. Prop-driven: what a click means is the app's.
 */
import { MoonIcon, SignOutIcon, SunIcon } from "@primer/octicons-react";
import {
	ActionList,
	ActionMenu,
	Avatar,
	Button,
	IconButton,
} from "@primer/react";
import { useTheme } from "@primer/react/next";

/** The wordmark: real text in two typefaces (app.css), read as one word. */
export function Wordmark() {
	return (
		<h1 className="brand">
			<span className="wordmark-qre">QRE</span>tools
		</h1>
	);
}

/**
 * Light or dark, as primer.style offers it: one button naming the theme it switches to.
 * It starts from the system's; the app remembers a choice.
 */
export function ThemeToggle({
	onChoose,
}: {
	onChoose: (theme: "light" | "dark") => void;
}) {
	const { resolvedColorMode } = useTheme();
	// Following the system, Primer resolves to "night" or "day", not "dark" or "light".
	const dark = resolvedColorMode === "dark" || resolvedColorMode === "night";
	const next = dark ? "light" : "dark";
	return (
		<IconButton
			icon={next === "dark" ? MoonIcon : SunIcon}
			aria-label={`Switch to ${next} theme`}
			onClick={() => onChoose(next)}
		/>
	);
}

/**
 * The account, as github.com shows it: the avatar opens a menu with who is signed in
 * and signing out.
 */
export function AccountMenu({
	login,
	avatarUrl,
	onSignOut,
}: {
	login: string;
	avatarUrl: string;
	onSignOut: () => void;
}) {
	return (
		<ActionMenu>
			<ActionMenu.Anchor>
				<Button
					variant="invisible"
					className="account"
					aria-label={`Account: ${login}`}
				>
					<Avatar src={avatarUrl} size={32} alt="" />
				</Button>
			</ActionMenu.Anchor>
			<ActionMenu.Overlay align="end">
				<ActionList>
					<ActionList.Group>
						<ActionList.GroupHeading>
							Signed in as {login}
						</ActionList.GroupHeading>
					</ActionList.Group>
					<ActionList.Divider />
					<ActionList.Item onSelect={onSignOut}>
						<ActionList.LeadingVisual>
							<SignOutIcon />
						</ActionList.LeadingVisual>
						Sign out
					</ActionList.Item>
				</ActionList>
			</ActionMenu.Overlay>
		</ActionMenu>
	);
}
