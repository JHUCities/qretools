/**
 * The page, in the bank app's shell (the shared stylesheet's grid): a header, then the
 * workspace's instruments in the sidebar and the open one in the content. Signed out,
 * the sign-in page.
 */
import {
	Banner,
	Button,
	Heading,
	Link,
	Spinner,
	Stack,
	Truncate,
	VisuallyHidden,
} from "@primer/react";
import { AriaStatus, SkeletonAvatar } from "@primer/react/experimental";
import { plainText, WORKSPACE } from "@qretools/core";
import { bankText } from "@qretools/shell";
import {
	AccountMenu,
	ExternalLink,
	failureDescription,
	ThemeToggle,
	Wordmark,
} from "@qretools/shell/ui";
import type { Model } from "../model.ts";
import { instrumentHref, instrumentName } from "../update.ts";
import { SESSION_STATUS, useApp, useModel } from "./AppContext.ts";
import { Editing } from "./Editing.tsx";
import { SignIn } from "./SignIn.tsx";

/** What the session is doing, said once in the header; undefined at rest. */
export function sessionStatus(model: Model): string | undefined {
	if (model.session.kind === "connecting") return "Signing in…";
	if (model.session.kind !== "connected") return undefined;
	switch (model.workspace.kind) {
		case "loading":
			return "Loading the workspace…";
		case "failed":
			return "The workspace didn't load";
		default:
			return undefined;
	}
}

export function App() {
	const { dispatch } = useApp();
	const model = useModel((m) => m);
	const { session } = model;
	const status = sessionStatus(model);
	const busy =
		session.kind === "connecting" ||
		(session.kind === "connected" && model.workspace.kind === "loading");
	return (
		<div className="shell">
			<Stack
				as="header"
				className="topbar"
				direction="horizontal"
				align="center"
				wrap="wrap"
				gap="condensed"
				paddingBlock="normal"
				paddingInline={{ narrow: "normal", regular: "spacious" }}
			>
				<Wordmark />
				<Stack
					direction="horizontal"
					align="center"
					gap="condensed"
					className="status"
				>
					{busy && <Spinner size="small" srText={null} />}
					<AriaStatus as="span" id={SESSION_STATUS} className="quiet session">
						{status !== undefined && (
							<Truncate as="span" title={status} maxWidth="100%">
								{status}
							</Truncate>
						)}
					</AriaStatus>
					{model.workspace.kind === "failed" && (
						<Button
							size="small"
							onClick={() => dispatch({ kind: "workspaceReloadRequested" })}
						>
							Try again
						</Button>
					)}
				</Stack>
				<ThemeToggle
					onChoose={(theme) => dispatch({ kind: "themeChosen", theme })}
				/>
				{session.kind === "connecting" ? (
					<SkeletonAvatar size={32} />
				) : session.kind === "connected" ? (
					<AccountMenu
						login={session.login}
						avatarUrl={session.avatarUrl}
						onSignOut={() => dispatch({ kind: "signOutRequested" })}
					/>
				) : null}
			</Stack>
			<Stack gap="condensed" className="notices">
				{session.kind === "connected" &&
					model.failures.map((f, i) => (
						<Banner
							// biome-ignore lint/suspicious/noArrayIndexKey: the same failure may appear twice
							key={i}
							variant="critical"
							title={plainText(f.message)}
							description={failureDescription(f)}
							onDismiss={() => dispatch({ kind: "failureDismissed", index: i })}
						/>
					))}
			</Stack>
			{session.kind === "connecting" ? (
				<main className="connecting" aria-busy="true" />
			) : session.kind !== "connected" ? (
				<SignIn model={model} />
			) : (
				<div className="workspace" data-open={model.open !== undefined}>
					<nav className="sidebar" aria-label="Workspace">
						<div className="band">
							<Heading as="h2" variant="small" className="pane-title">
								<VisuallyHidden>Workspace: </VisuallyHidden>
								<span className="bank">
									<Link
										href={`https://github.com/${model.settings.owner}/${model.settings.repo}`}
										target="_blank"
										rel="noreferrer"
									>
										<strong>{bankText(model.settings)}</strong>
										<VisuallyHidden> (opens in a new tab)</VisuallyHidden>
									</Link>
								</span>
							</Heading>
						</div>
						<div className="instruments-pane">
							<Instruments model={model} branch={session.defaultBranch} />
						</div>
					</nav>
					<main className="content">
						{model.open === undefined ? (
							<div className="blank">
								<p className="quiet">Pick an instrument.</p>
							</div>
						) : (
							<Editing model={model} path={model.open} />
						)}
					</main>
				</div>
			)}
		</div>
	);
}

/** The workspace's instruments as links: opening one is following its address. */
function Instruments({ model, branch }: { model: Model; branch: string }) {
	const { template } = useApp();
	const { workspace } = model;
	if (workspace.kind === "loading")
		return <p className="quiet">Loading the workspace…</p>;
	if (workspace.kind !== "loaded") return null;
	const paths = Object.keys(workspace.instruments);
	if (paths.length === 0)
		return (
			<p className="quiet">
				{workspace.hasFolder ? (
					`No instruments in ${WORKSPACE.instruments}/ yet.`
				) : (
					<>
						{bankText(model.settings)} has no {WORKSPACE.instruments}/ folder
						yet.
						{template !== undefined && (
							<>
								{" "}
								<ExternalLink href={template} icon={false}>
									Start a workspace from the template, with an example
									instrument
								</ExternalLink>
								.
							</>
						)}
					</>
				)}
			</p>
		);
	return (
		<>
			<h3 className="browser-heading">Instruments</h3>
			{/* `role="list"`: Safari's VoiceOver drops list semantics from a list without bullets. */}
			{/* biome-ignore lint/a11y/noRedundantRoles: VoiceOver, above */}
			<ul className="instruments" role="list">
				{paths.map((path) => (
					<li key={path}>
						<Link
							href={instrumentHref(model, branch, path)}
							{...(model.open === path && { "aria-current": "page" as const })}
						>
							{instrumentName(path)}
						</Link>
					</li>
				))}
			</ul>
		</>
	);
}
