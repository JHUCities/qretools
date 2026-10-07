/**
 * Signed out, the app is this page: which bank, and "Sign in with GitHub", in one
 * narrow column as github.com's own sign-in page is. There is nothing to edit without
 * a bank; the author's own unsaved work in this tab waits for the sign-in.
 *
 * A native form: Enter signs in. The repository is written as GitHub writes it,
 * `owner/name`, and parsed once on submit (`parseRepo`); a link to another bank offers
 * its repository here. The text, the checkbox and a pasted development token are
 * transient input, so component state; the token goes to the effects, never a Msg.
 */

import { LinkExternalIcon, MarkGithubIcon } from "@primer/octicons-react";
import {
	Banner,
	Button,
	Checkbox,
	FormControl,
	Link,
	LinkButton,
	Stack,
	TextInput,
	VisuallyHidden,
} from "@primer/react";
import { plainText } from "@qretools/core/codeSpans.js";
import { useId, useRef, useState } from "react";
import { installUrl, SOURCE_URL } from "../config.js";
import { TOKEN_PASTE } from "../flags.js";
import { hasOwnWork, type Model } from "../model.js";
import { parseRepo, repoText } from "../storage.js";
import { useApp } from "./AppContext.js";
import { ExternalLink } from "./ExternalLink.js";
import { failureDescription } from "./Previews.js";

export function SignIn({ model }: { model: Model }) {
	const { dispatch, effects, signIn: config, template } = useApp();
	const { settings, session } = model;
	const [text, setText] = useState(
		model.pendingLink?.repo ?? repoText(settings),
	);
	const [remember, setRemember] = useState(settings.remember);
	const [token, setToken] = useState("");
	// The format is pointed out after a first attempt, then as it is corrected.
	const [tried, setTried] = useState(false);
	const [tokenTried, setTokenTried] = useState(false);
	const input = useRef<HTMLInputElement>(null);
	const headingId = useId();
	const parsed = parseRepo(text);
	const problem = tried && !parsed.ok ? parsed.error : undefined;
	const connecting = session.kind === "connecting";
	const chosen = () => {
		setTried(true);
		if (parsed.ok) return { ...parsed.value, remember };
		input.current?.focus();
		return undefined;
	};
	const withToken = () => {
		setTokenTried(true);
		const next = chosen();
		if (next === undefined || token.trim() === "") return;
		effects.setToken(token.trim(), remember);
		setToken("");
		dispatch({ kind: "connectRequested", settings: next });
	};
	// This tab's unsaved work belongs to its bank: signing in to another sets it aside.
	const current = repoText(settings);
	const elsewhere =
		hasOwnWork(model) &&
		parsed.ok &&
		`${parsed.value.owner}/${parsed.value.repo}`.toLowerCase() !==
			current.toLowerCase();
	return (
		<main className="signin" aria-labelledby={headingId}>
			<Stack gap="normal" className="signin-column">
				<h2 id={headingId} className="signin-heading">
					Sign in to your question bank
				</h2>
				{session.kind === "failed" && (
					<Banner
						variant="critical"
						title={plainText(session.failure.message)}
						description={failureDescription(session.failure)}
						// An empty repository: GitHub's page for it offers the first file.
						primaryAction={
							session.failure.kind === "empty" ? (
								<LinkButton
									href={`https://github.com/${settings.owner}/${settings.repo}`}
									target="_blank"
									rel="noreferrer"
									trailingVisual={LinkExternalIcon}
								>
									Open on GitHub
									<VisuallyHidden> (opens in a new tab)</VisuallyHidden>
								</LinkButton>
							) : undefined
						}
					/>
				)}
				{model.failures.map((f, i) => (
					<Banner
						// biome-ignore lint/suspicious/noArrayIndexKey: the same failure may appear twice
						key={i}
						variant="critical"
						title={plainText(f.message)}
						description={failureDescription(f)}
						onDismiss={() => dispatch({ kind: "failureDismissed", index: i })}
					/>
				))}
				<form
					className="signin-box"
					onSubmit={(e) => {
						e.preventDefault();
						if (config === undefined) return withToken();
						const next = chosen();
						if (next !== undefined)
							dispatch({ kind: "signInRequested", settings: next });
					}}
				>
					<Stack gap="normal">
						<FormControl>
							<FormControl.Label>Repository</FormControl.Label>
							<TextInput
								ref={input}
								block
								autoComplete="off"
								autoCapitalize="off"
								spellCheck={false}
								value={text}
								{...(problem !== undefined && {
									validationStatus: "error" as const,
								})}
								onChange={(e) => setText(e.target.value)}
							/>
							<FormControl.Caption>
								The GitHub repository that holds the bank, as owner/name.
							</FormControl.Caption>
							{problem !== undefined && (
								<FormControl.Validation variant="error">
									{problem}
								</FormControl.Validation>
							)}
						</FormControl>
						<FormControl>
							<Checkbox
								checked={remember}
								onChange={(e) => setRemember(e.target.checked)}
							/>
							<FormControl.Label>Remember on this device</FormControl.Label>
						</FormControl>
						{config === undefined && (
							<p className="fg-attention">
								Sign-in with GitHub isn't set up for this build.
							</p>
						)}
						{config !== undefined && (
							<Button
								type="submit"
								variant="primary"
								block
								leadingVisual={MarkGithubIcon}
								loading={connecting}
								loadingAnnouncement="Signing in"
							>
								Sign in with GitHub
							</Button>
						)}
						{TOKEN_PASTE && (
							<FormControl>
								<FormControl.Label>Token (development)</FormControl.Label>
								<TextInput
									block
									type="password"
									autoComplete="off"
									value={token}
									onChange={(e) => setToken(e.target.value)}
								/>
								<FormControl.Caption>
									A fine-grained token limited to the bank repository, with
									Contents read and write.
								</FormControl.Caption>
								{tokenTried && token.trim() === "" && (
									<FormControl.Validation variant="error">
										Paste a token to sign in with it.
									</FormControl.Validation>
								)}
							</FormControl>
						)}
						{TOKEN_PASTE && (
							<Button
								type={config === undefined ? "submit" : "button"}
								block
								onClick={config === undefined ? undefined : withToken}
							>
								Sign in with token
							</Button>
						)}
					</Stack>
				</form>
				{/* As github.com offers "New to GitHub?" under its form. */}
				{template !== undefined && (
					<p className="quiet signin-note">
						New bank?{" "}
						<Link href={template} target="_blank" rel="noreferrer">
							Start one from the template
							<VisuallyHidden> (opens in a new tab)</VisuallyHidden>
						</Link>
						{config?.appSlug !== undefined && (
							<>
								, then{" "}
								<Link
									href={installUrl(config.appSlug)}
									target="_blank"
									rel="noreferrer"
								>
									install the app on it
									<VisuallyHidden> (opens in a new tab)</VisuallyHidden>
								</Link>
							</>
						)}
						.
					</p>
				)}
				{elsewhere && (
					<p className="quiet signin-note">
						Your unsaved work in this tab is for {current}. Signing in to
						another bank sets it aside.
					</p>
				)}
				{/* A failed sign-in still holds the GitHub sign-in: a way to let it go. */}
				{session.kind === "failed" && effects.hasToken() && (
					<Button
						variant="invisible"
						onClick={() => dispatch({ kind: "disconnected" })}
					>
						Sign out of GitHub
					</Button>
				)}
				{/* Last, as github.com's sign-in page ends with its own links. */}
				<p className="quiet signin-note">
					<ExternalLink href={SOURCE_URL} muted icon={false}>
						About QREtools
					</ExternalLink>
				</p>
			</Stack>
		</main>
	);
}
