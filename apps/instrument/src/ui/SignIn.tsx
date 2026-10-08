/**
 * Signed out, the app is this page: which project, and "Sign in with GitHub", in one
 * narrow column as the bank app's is. A native form: Enter signs in. The project is
 * written as GitHub writes a repository, `owner/name[/folder]`, and parsed once on
 * submit. The text, the checkbox and a pasted development token are transient input,
 * so component state; the token goes to the effects, never a Msg.
 */
import { MarkGithubIcon } from "@primer/octicons-react";
import {
	Banner,
	Button,
	Checkbox,
	FormControl,
	Stack,
	TextInput,
} from "@primer/react";
import { plainText } from "@qretools/core";
import { bankText, installUrl, parseBank } from "@qretools/shell";
import { ExternalLink, failureDescription } from "@qretools/shell/ui";
import { useId, useRef, useState } from "react";
import { TOKEN_PASTE } from "../flags.ts";
import type { Model } from "../model.ts";
import { useApp } from "./AppContext.ts";

export function SignIn({ model }: { model: Model }) {
	const { dispatch, effects, signIn: config, template } = useApp();
	const { settings, session } = model;
	const [text, setText] = useState(
		model.pendingLink?.repo ?? (settings.repo === "" ? "" : bankText(settings)),
	);
	const [remember, setRemember] = useState(settings.remember);
	const [token, setToken] = useState("");
	// The format is pointed out after a first attempt, then as it is corrected.
	const [tried, setTried] = useState(false);
	const [tokenTried, setTokenTried] = useState(false);
	const input = useRef<HTMLInputElement>(null);
	const headingId = useId();
	const parsed = parseBank(text);
	// The shell's sentence speaks of a bank; this page asks for a project.
	const problem =
		tried && !parsed.ok
			? "Write the project as owner/name, or owner/name/folder for a project in a folder."
			: undefined;
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
	return (
		<main className="signin" aria-labelledby={headingId}>
			<Stack gap="normal" className="signin-column">
				<h2 id={headingId} className="signin-heading">
					Sign in to your project
				</h2>
				{session.kind === "failed" && (
					<Banner
						variant="critical"
						title={plainText(session.failure.message)}
						description={failureDescription(session.failure)}
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
							<FormControl.Label>Project</FormControl.Label>
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
								The GitHub repository that holds the project's instruments, as
								owner/name, or owner/name/folder for a project in a folder.
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
									A fine-grained token that can read the project's repository.
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
						New project?{" "}
						<ExternalLink href={template} icon={false}>
							Start one from the template
						</ExternalLink>
						: an example instrument and the bank it uses
						{config?.appSlug !== undefined && (
							<>
								. If it's private,{" "}
								<ExternalLink href={installUrl(config.appSlug)} icon={false}>
									install the app on it
								</ExternalLink>
							</>
						)}
						.
					</p>
				)}
			</Stack>
		</main>
	);
}
