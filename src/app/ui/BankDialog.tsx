/**
 * Bank settings and connection. The form fields are transient input until
 * Connect; the token goes to the effects and the token store, never into a
 * message. Failures and the session are shown here from the Model.
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
import type { Bank, Dispatch, Session } from "../model.js";
import type { BankSettings, Failure } from "../storage.js";
import { useApp } from "./AppContext.js";
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
	const { effects } = useApp();
	const [owner, setOwner] = useState(settings.owner);
	const [repo, setRepo] = useState(settings.repo);
	const [branch, setBranch] = useState(settings.branch);
	const [token, setToken] = useState("");
	const [remember, setRemember] = useState(settings.remember);
	const close = () => dispatch({ kind: "settingsToggled", open: false });
	const connect = () => {
		const next: BankSettings = {
			owner: owner.trim() || settings.owner,
			repo: repo.trim() || settings.repo,
			branch: branch.trim() || settings.branch,
			remember,
		};
		if (token.trim() !== "") effects.setToken(token.trim(), remember);
		setToken("");
		dispatch({ kind: "connectRequested", settings: next });
	};
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
				{ buttonType: "primary", content: "Connect", onClick: connect },
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
				<FormControl>
					<FormControl.Label>Token</FormControl.Label>
					<TextInput
						block
						type="password"
						autoComplete="off"
						placeholder={
							effects.hasToken()
								? "(a token is on hand; paste to replace)"
								: "fine-grained personal access token"
						}
						value={token}
						onChange={(e) => setToken(e.target.value)}
					/>
					<FormControl.Caption>
						Create a fine-grained token on GitHub limited to the bank repository
						with Contents and Pull requests read and write. It stays in this
						browser and is never sent anywhere but GitHub.
					</FormControl.Caption>
				</FormControl>
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
