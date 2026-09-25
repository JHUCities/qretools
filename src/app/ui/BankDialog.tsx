/**
 * Bank settings and connection. "Sign in with GitHub" is the way in; pasting a token
 * is a development fallback behind a build-time flag. The form fields are transient
 * input until then; a pasted token goes to the effects, never into a message. Failures and the session are shown here from the Model.
 */
import { UploadIcon } from "@primer/octicons-react";
import {
	Banner,
	Button,
	Checkbox,
	Dialog,
	FormControl,
	TextInput,
} from "@primer/react";
import { useState } from "react";
import { TOKEN_PASTE } from "../flags.js";
import type { Bank, Dispatch, Session } from "../model.js";
import type { BankSettings, Failure } from "../storage.js";
import { useApp } from "./AppContext.js";
import { ExternalLink } from "./ExternalLink.js";
import { inlineCode } from "./Previews.js";

export function BankDialog({
	settings,
	session,
	bank,
	failures,
	dispatch,
}: {
	settings: BankSettings;
	session: Session;
	bank: Bank;
	failures: readonly Failure[];
	dispatch: Dispatch;
}) {
	const { effects, signIn: signInSetUp } = useApp();
	const [owner, setOwner] = useState(settings.owner);
	const [repo, setRepo] = useState(settings.repo);
	const [branch, setBranch] = useState(settings.branch);
	const [token, setToken] = useState("");
	const [remember, setRemember] = useState(settings.remember);
	const close = () => dispatch({ kind: "settingsToggled", open: false });
	// An empty branch means the author's own branch: it must stay empty, not fall back.
	const next = (): BankSettings => ({
		owner: owner.trim() || settings.owner,
		repo: repo.trim() || settings.repo,
		branch: branch.trim(),
		remember,
	});
	const signIn = () => dispatch({ kind: "signInRequested", settings: next() });
	const connect = () => {
		if (TOKEN_PASTE && token.trim() !== "")
			effects.setToken(token.trim(), remember);
		setToken("");
		dispatch({ kind: "connectRequested", settings: next() });
	};
	const config = signInSetUp;
	const upload = async (files: FileList | null) => {
		const read = await Promise.all(
			[...(files ?? [])].map(async (f) => ({
				name: f.name,
				text: (await f.text()).replace(/\r\n?/g, "\n"),
			})),
		);
		if (read.length > 0) dispatch({ kind: "filesUploaded", files: read });
	};
	return (
		<Dialog
			title="Bank"
			onClose={close}
			footerButtons={[
				{ buttonType: "default", content: "Close", onClick: close },
				...(TOKEN_PASTE
					? [
							{
								buttonType: config
									? ("default" as const)
									: ("primary" as const),
								content: "Connect with token",
								onClick: connect,
							},
						]
					: []),
				...(config
					? [
							{
								buttonType: "primary" as const,
								content: "Sign in with GitHub",
								onClick: signIn,
							},
						]
					: []),
			]}
		>
			<div className="bank-form">
				<FormControl>
					<FormControl.Label>Owner</FormControl.Label>
					<TextInput
						block
						value={owner}
						onChange={(e) => setOwner(e.target.value)}
					/>
				</FormControl>
				<FormControl>
					<FormControl.Label>Repository</FormControl.Label>
					<TextInput
						block
						value={repo}
						onChange={(e) => setRepo(e.target.value)}
					/>
				</FormControl>
				<FormControl>
					<FormControl.Label>Your branch</FormControl.Label>
					<TextInput
						block
						value={branch}
						placeholder="qretools/<your login>"
						onChange={(e) => setBranch(e.target.value)}
					/>
					<FormControl.Caption>
						Saves go here, never to the bank's default branch; the bank changes
						when you propose and the pull request is merged on GitHub. Leave it
						empty for your own branch, created on your first save.
					</FormControl.Caption>
				</FormControl>
				{config?.appSlug !== undefined && (
					<p className="quiet">
						Signing in works for repositories where the{" "}
						<ExternalLink
							href={`https://github.com/apps/${config.appSlug}/installations/new`}
						>
							{config.appSlug} app is installed
						</ExternalLink>{" "}
						and you have access.
					</p>
				)}
				{config === undefined && (
					<p className="fg-attention">
						Sign-in with GitHub is not set up for this build.
					</p>
				)}
				{TOKEN_PASTE && (
					<FormControl>
						<FormControl.Label>Token (development)</FormControl.Label>
						<TextInput
							block
							type="password"
							autoComplete="off"
							placeholder={
								effects.hasToken()
									? "(signed in; paste to use a token instead)"
									: "fine-grained personal access token"
							}
							value={token}
							onChange={(e) => setToken(e.target.value)}
						/>
						<FormControl.Caption>
							A fine-grained token limited to the bank repository, with Contents
							read and write. For development and as a fallback; it stays in
							this browser.
						</FormControl.Caption>
					</FormControl>
				)}
				<FormControl>
					<Checkbox
						checked={remember}
						onChange={(e) => setRemember(e.target.checked)}
					/>
					<FormControl.Label>Remember on this device</FormControl.Label>
				</FormControl>
			</div>
			<div className="bank-status">
				<SessionLine
					session={session}
					onDisconnect={() => dispatch({ kind: "disconnected" })}
				/>
				{bank.kind === "loading" && <p>Loading the bank…</p>}
				{bank.kind === "loaded" && (
					<p>
						Bank loaded. Shared scales, universes, instructions and missing
						values are in the tree, each with its own findings.
					</p>
				)}
				{failures.map((f, i) => (
					<Banner
						key={`${f.kind}:${f.message}`}
						variant="critical"
						title={f.message}
						description={f.hint}
						onDismiss={() => dispatch({ kind: "failureDismissed", index: i })}
					/>
				))}
				<label className="upload">
					<UploadIcon /> Upload YAML{" "}
					<input
						type="file"
						accept=".yaml,.yml"
						multiple
						onChange={(e) => void upload(e.target.files)}
					/>
				</label>
			</div>
		</Dialog>
	);
}

function SessionLine({
	session,
	onDisconnect,
}: {
	session: Session;
	onDisconnect: () => void;
}) {
	switch (session.kind) {
		case "anonymous":
			return (
				<p className="quiet">
					Not connected. Working with local drafts and the bundled scales.
				</p>
			);
		case "connecting":
			return <p>Connecting…</p>;
		case "failed":
			return (
				<Banner
					variant="critical"
					title={session.failure.message}
					description={
						session.failure.hint === undefined
							? undefined
							: inlineCode(session.failure.hint)
					}
				/>
			);
		case "connected":
			return (
				<p>
					Connected as {session.login},{" "}
					{session.canWrite
						? "with write access."
						: "read access only: you can browse, draft and download."}{" "}
					<Button size="small" onClick={onDisconnect}>
						Disconnect
					</Button>
				</p>
			);
		default:
			return session satisfies never;
	}
}
