/** The page: a split layout with the bank tree in the pane and the open file in the content. */
import {
	GearIcon,
	GitBranchIcon,
	GitPullRequestIcon,
	LinkExternalIcon,
	PlusIcon,
} from "@primer/octicons-react";
import {
	ActionList,
	ActionMenu,
	BranchName,
	Button,
	ConfirmationDialog,
	LinkButton,
	Stack,
	VisuallyHidden,
} from "@primer/react";
import { AriaStatus } from "@primer/react/experimental";
import { useMemo } from "react";
import { SCHEME_KINDS } from "../../core/schemes.js";
import { indexOf, usedBy } from "../../core/symbols.js";
import { fileOf, type Id, type Model, TEMPLATES } from "../model.js";
import { alsoSaves } from "../sync.js";
import {
	bankFolders,
	SCHEME_SINGULAR,
	schemeSections,
	treeOf,
} from "../tree.js";
import { movedPath, moveProblem, schemeNameProblem } from "../update.js";
import { useApp, useEnv, useModel } from "./AppContext.js";
import { BankDialog } from "./BankDialog.js";
import { Browser } from "./Browser.js";
import { Editing, ForeignView } from "./Editing.js";
import { ExternalLink } from "./ExternalLink.js";
import { MoveDialog } from "./MoveDialog.js";
import { SaveDialog } from "./SaveDialog.js";
import { SchemeNameDialog } from "./SchemeNameDialog.js";

export function App() {
	const { dispatch, evaluations } = useApp();
	const model = useModel((m) => m);
	const env = useEnv();
	const { local, browser, screen, activity } = model;
	// The tree is drawn from these slices only, so a caret move does not redraw it.
	const treeInput = useMemo(
		() => ({ local, browser, screen, activity }),
		[local, browser, screen, activity],
	);
	const folders = useMemo(
		() => treeOf(treeInput, (q) => evaluations.get(q, model.agency, env)),
		[treeInput, model.agency, evaluations, env],
	);
	// The bank's symbol table: which variables each question defines and which
	// scheme names it writes. Rebuilt from cached evaluations, so cheap per keystroke.
	const index = useMemo(
		() =>
			indexOf(
				Object.values(model.local.questions).map((q) => ({
					key: q.id,
					symbols: evaluations.get(q, model.agency, env).symbols,
				})),
			),
		[model.local.questions, model.agency, evaluations, env],
	);
	const sections = useMemo(
		() => schemeSections(treeInput, (e) => evaluations.scheme(e, env), index),
		[treeInput, evaluations, env, index],
	);
	const creating = model.browser.creating;
	const moving = model.browser.moving;
	const movingQuestion =
		moving === undefined ? undefined : model.local.questions[moving.id];
	const open: Id | undefined =
		model.screen.kind === "editing" ? model.screen.id : undefined;
	const saving = model.browser.saving;
	const savingQuestion =
		saving === undefined ? undefined : model.local.questions[saving.id];
	const confirm =
		model.browser.confirmDelete === undefined
			? undefined
			: fileOf(model, model.browser.confirmDelete);
	const confirmName =
		confirm === undefined
			? undefined
			: confirm.kind === "question"
				? evaluations.get(confirm, model.agency, env).draft.name
				: confirm.name;
	// Deleting a scheme file others name turns each of those names into a hole: say how many.
	const confirmUsers =
		confirm === undefined ||
		confirm.kind === "question" ||
		confirm.kind === "missing"
			? 0
			: new Set(usedBy(index, confirm.kind, confirm.name).map((s) => s.key))
					.size;

	return (
		<>
			{/*
			 * An app shell: the window is a grid whose header sizes itself and whose
			 * workspace fills the rest; only the tree, the editor and the previews
			 * scroll. Primer's PageLayout is a page layout (the document scrolls), so
			 * the shell is the parent that constrains height, as Primer's docs advise,
			 * and Primer's components live inside it.
			 */}
			<div className="shell">
				<Stack
					as="header"
					className="topbar"
					direction="horizontal"
					align="center"
					wrap="wrap"
					gap="condensed"
					paddingBlock="condensed"
					paddingInline="normal"
				>
					<h1>qretools</h1>
					<span className="quiet">question bank</span>
					{/* A live region: connecting, loading and signing out are announced. */}
					<AriaStatus as="span" className="quiet session">
						{sessionLine(model)}
					</AriaStatus>
					<BranchLinks model={model} />
					<Stack.Item grow />
					<ActionMenu>
						<ActionMenu.Anchor>
							<Button leadingVisual={PlusIcon}>New</Button>
						</ActionMenu.Anchor>
						<ActionMenu.Overlay>
							<ActionList>
								<ActionList.Item
									onSelect={() =>
										dispatch({ kind: "questionCreated", text: "" })
									}
								>
									Blank question
								</ActionList.Item>
								<ActionList.Divider />
								<ActionList.GroupHeading>Templates</ActionList.GroupHeading>
								{TEMPLATES.map((t) => (
									<ActionList.Item
										key={t.label}
										onSelect={() =>
											dispatch({ kind: "questionCreated", text: t.text })
										}
									>
										{t.label}
									</ActionList.Item>
								))}
								<ActionList.Divider />
								<ActionList.GroupHeading>Shared</ActionList.GroupHeading>
								{SCHEME_KINDS.map((k) => (
									<ActionList.Item
										key={k}
										onSelect={() =>
											dispatch({ kind: "schemeCreateOpened", scheme: k })
										}
									>
										{capitalise(SCHEME_SINGULAR[k])}
									</ActionList.Item>
								))}
							</ActionList>
						</ActionMenu.Overlay>
					</ActionMenu>
					<Button
						leadingVisual={GearIcon}
						onClick={() => dispatch({ kind: "settingsToggled", open: true })}
					>
						Bank
					</Button>
				</Stack>
				{/* On narrow screens the tree and the open file are separate views. */}
				<div
					className="workspace"
					data-open={open !== undefined || model.screen.kind === "foreign"}
				>
					<nav className="sidebar" aria-label="Question bank">
						<Browser
							folders={folders}
							sections={sections}
							loading={
								model.loading.kind === "loading" ||
								model.session.kind === "connecting"
							}
							filter={model.browser.filter}
							open={open}
							dispatch={dispatch}
						/>
					</nav>
					<main className="content">
						{model.screen.kind === "foreign" ? (
							<ForeignView screen={model.screen} />
						) : open === undefined ? (
							<div className="blank">
								<p className="quiet">
									{model.pendingLink !== undefined &&
									model.session.kind !== "connected"
										? "Connect to the bank (Bank, above) to open this link."
										: model.pendingLink !== undefined
											? "Opening the link once the bank has loaded…"
											: "Pick a question or a shared element in the bank, or create a new one."}
								</p>
							</div>
						) : (
							<Editing id={open} index={index} />
						)}
					</main>
				</div>
			</div>
			{model.browser.settingsOpen && (
				<BankDialog
					settings={model.settings}
					session={model.session}
					bank={model.loading}
					failures={model.failures}
					dispatch={dispatch}
				/>
			)}
			{moving && movingQuestion?.base && (
				<MoveDialog
					from={movingQuestion.base.path}
					to={movedPath(movingQuestion.base.path, moving.folder)}
					folder={moving.folder}
					folders={bankFolders(model)}
					problem={moveProblem(model, movingQuestion, moving.folder)}
					dispatch={dispatch}
				/>
			)}
			{creating && (
				<SchemeNameDialog
					kind={creating.kind}
					name={creating.name}
					problem={schemeNameProblem(model, creating.kind, creating.name)}
					dispatch={dispatch}
				/>
			)}
			{saving && savingQuestion && (
				<SaveDialog
					draft={evaluations.get(savingQuestion, model.agency, env).draft}
					folder={saving.folder}
					folders={bankFolders(model)}
					taken={(path) => path in model.remote.questions}
					also={alsoSaves(
						model.local,
						model.remote,
						evaluations.get(savingQuestion, model.agency, env).symbols.mentions,
						(e) =>
							e.kind === "missing"
								? []
								: usedBy(index, e.kind, e.name).map((s) => s.key),
					)}
					dispatch={dispatch}
				/>
			)}
			{confirm && (
				<ConfirmationDialog
					title={
						confirm.base === undefined
							? "Delete this draft?"
							: "Delete from the bank?"
					}
					confirmButtonType="danger"
					confirmButtonContent="Delete"
					onClose={(gesture) =>
						dispatch(
							gesture === "confirm"
								? { kind: "deleteRequested", id: confirm.id }
								: { kind: "deleteCancelled" },
						)
					}
				>
					{confirm.base === undefined
						? `The draft ${confirmName ?? "(no name)"} is only in this browser and cannot be recovered.`
						: `${confirmName ?? confirm.base.path} will be deleted from the repository in a commit under your name. Git keeps the history.`}
					{confirmUsers > 0 &&
						` ${confirmUsers} question${confirmUsers === 1 ? " names" : "s name"} it; each will show a hole there until it is changed.`}
				</ConfirmationDialog>
			)}
		</>
	);
}

/**
 * What the author's branch holds that the bank does not, as links to GitHub, which
 * does the rest: the pull request, review, updating the branch, merging. The app
 * states facts and links; it never recreates GitHub's interface.
 */
function BranchLinks({ model }: { model: Model }) {
	const { session, loading, settings } = model;
	if (session.kind !== "connected" || loading.kind !== "loaded") return null;
	const repo = `https://github.com/${settings.owner}/${settings.repo}`;
	const compare = `${repo}/compare/${session.defaultBranch}...${encodeURI(session.branch)}?expand=1`;
	return (
		<Stack direction="horizontal" align="center" gap="condensed" wrap="wrap">
			{/* Before the first save the branch does not exist yet: named, not linked. */}
			{loading.from === "branch" ? (
				<BranchName
					href={`${repo}/tree/${encodeURI(session.branch)}`}
					target="_blank"
					rel="noreferrer"
				>
					<GitBranchIcon size={12} aria-hidden /> {session.branch}
					<VisuallyHidden> (opens in a new tab)</VisuallyHidden>
				</BranchName>
			) : (
				<BranchName as="span">
					<GitBranchIcon size={12} aria-hidden /> {session.branch}
				</BranchName>
			)}
			{loading.behindBy > 0 && (
				<ExternalLink href={compare} muted>
					{loading.behindBy} behind {session.defaultBranch}
				</ExternalLink>
			)}
			{loading.proposable && (
				<LinkButton
					size="small"
					href={compare}
					target="_blank"
					rel="noreferrer"
					leadingVisual={GitPullRequestIcon}
					trailingVisual={LinkExternalIcon}
				>
					Propose changes
					<VisuallyHidden> on GitHub (opens in a new tab)</VisuallyHidden>
				</LinkButton>
			)}
		</Stack>
	);
}

/** Who is connected to which bank, or what the connection is doing: said, and announced. */
function sessionLine(model: Model): string {
	const { session, settings, loading } = model;
	switch (session.kind) {
		case "anonymous":
			return "";
		case "connecting":
			return "Connecting to GitHub…";
		case "failed":
			return session.failure.message;
		case "connected":
			return loading.kind === "loading"
				? "Loading the bank from GitHub…"
				: `${session.login} · ${settings.owner}/${settings.repo}${session.canWrite ? "" : " (read only)"}`;
	}
}

const capitalise = (s: string): string =>
	s.charAt(0).toUpperCase() + s.slice(1);
