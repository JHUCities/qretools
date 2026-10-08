/**
 * The page, in the bank app's shell (the shared stylesheet's grid): a header, then the
 * project's instruments in the sidebar and the open one in the content. Signed out,
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
import { PROJECT, plainText } from "@qretools/core";
import { bankText } from "@qretools/shell";
import {
	AccountMenu,
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
	switch (model.project.kind) {
		case "loading":
			return "Loading the project…";
		case "failed":
			return "The project didn't load";
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
		(session.kind === "connected" && model.project.kind === "loading");
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
					{model.project.kind === "failed" && (
						<Button
							size="small"
							onClick={() => dispatch({ kind: "projectReloadRequested" })}
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
					<nav className="sidebar" aria-label="Project">
						<div className="band">
							<Heading as="h2" variant="small" className="pane-title">
								<VisuallyHidden>Project: </VisuallyHidden>
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

/** The project's instruments as links: opening one is following its address. */
function Instruments({ model, branch }: { model: Model; branch: string }) {
	const { project } = model;
	if (project.kind === "loading")
		return <p className="quiet">Loading the project…</p>;
	if (project.kind !== "loaded") return null;
	const paths = Object.keys(project.instruments);
	if (paths.length === 0)
		return (
			<p className="quiet">
				{project.hasFolder
					? `No instruments in ${PROJECT.instruments}/ yet.`
					: `This project has no ${PROJECT.instruments}/ folder.`}
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
