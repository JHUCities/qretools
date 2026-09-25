/** The page: a split layout with the bank tree in the pane and the open file in the content. */
import {
	GitBranchIcon,
	GitPullRequestIcon,
	LinkExternalIcon,
	PlusIcon,
	RepoIcon,
	SignOutIcon,
} from "@primer/octicons-react";
import {
	ActionList,
	ActionMenu,
	Avatar,
	BranchName,
	Button,
	ConfirmationDialog,
	IconButton,
	Link,
	Spinner,
	Stack,
	VisuallyHidden,
} from "@primer/react";
import { AriaStatus } from "@primer/react/experimental";
import { useMemo } from "react";
import { kindAt, SCHEME_KINDS } from "../../core/schemes.js";
import { indexOf, usedBy } from "../../core/symbols.js";
import { fileOf, type Id, type Model, TEMPLATES } from "../model.js";
import { alsoSaves } from "../sync.js";
import {
	bankFolders,
	SCHEME_SINGULAR,
	schemeSections,
	treeOf,
} from "../tree.js";
import {
	movedPath,
	moveProblem,
	ownBranch,
	schemeNameProblem,
	sessionStatus,
} from "../update.js";
import { SESSION_STATUS, useApp, useEnv, useModel } from "./AppContext.js";
import { BankDialog } from "./BankDialog.js";
import { BankFilter, Browser } from "./Browser.js";
import { Editing, ForeignView } from "./Editing.js";
import { ExternalLink } from "./ExternalLink.js";
import { FileSkeleton } from "./FileSkeleton.js";
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
	// A link waiting for the bank shows the file's shape where the file will be.
	const waiting =
		model.pendingLink !== undefined &&
		(model.session.kind === "connecting" ||
			(model.session.kind === "connected" && model.loading.kind === "loading"));
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
					{/* Name and context share a baseline; the branch chip and the icon are centred. */}
					<Stack
						direction="horizontal"
						align="baseline"
						gap="condensed"
						className="brand"
					>
						<h1>qretools</h1>
						<Context model={model} />
						<Branch model={model} />
					</Stack>
					{/*
					 * A live region, always mounted so that what it says is announced: what
					 * the session is doing, or why nothing can be written. A file's inactive
					 * write buttons point here, since those reasons are the session's.
					 */}
					<Stack
						direction="horizontal"
						align="center"
						gap="condensed"
						className="status"
					>
						{busy(model) && <Spinner size="small" srText={null} />}
						<AriaStatus as="span" id={SESSION_STATUS} className="quiet session">
							{sessionStatus(model) ?? ""}
						</AriaStatus>
						{model.loading.kind === "failed" && (
							<Button
								size="small"
								onClick={() => dispatch({ kind: "bankReloadRequested" })}
							>
								Try again
							</Button>
						)}
					</Stack>
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
					<Account model={model} />
				</Stack>
				{/* On narrow screens the tree and the open file are separate views. */}
				<div
					className="workspace"
					data-open={
						open !== undefined || model.screen.kind === "foreign" || waiting
					}
				>
					<nav className="sidebar" aria-label="Question bank">
						<BankFilter filter={model.browser.filter} dispatch={dispatch} />
						<div className="trees">
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
						</div>
					</nav>
					<main className="content">
						{model.screen.kind === "foreign" ? (
							<ForeignView screen={model.screen} />
						) : open === undefined && waiting && model.pendingLink ? (
							<FileSkeleton
								kind={kindAt(model.pendingLink.file ?? "")?.kind ?? "question"}
								onBack={() => dispatch({ kind: "listOpened" })}
							/>
						) : open === undefined ? (
							<div className="blank">
								{model.pendingLink !== undefined &&
								(model.session.kind === "anonymous" ||
									model.session.kind === "failed") ? (
									<Stack align="start" gap="condensed">
										<p className="quiet">Sign in to open this link.</p>
										<Button
											variant="primary"
											onClick={() =>
												dispatch({ kind: "settingsToggled", open: true })
											}
										>
											Sign in
										</Button>
									</Stack>
								) : (
									<p className="quiet">
										{model.pendingLink !== undefined &&
										model.loading.kind === "failed"
											? "The bank did not load, so this link cannot open yet."
											: "Pick a question or a shared element in the bank, or create a new one."}
									</p>
								)}
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

const repoUrl = (model: Model): string =>
	`https://github.com/${model.settings.owner}/${model.settings.repo}`;

/**
 * Where the author is, as github.com's header says it: `owner / repo`, the repository
 * a link to GitHub. On narrow screens only the repository name.
 */
function Context({ model }: { model: Model }) {
	if (model.session.kind !== "connected") return null;
	return (
		<span className="context">
			<span className="quiet owner">
				{model.settings.owner} <span aria-hidden>/</span>{" "}
			</span>
			{/* No external-link icon here, as in github.com's header; still said to screen readers. */}
			<Link href={repoUrl(model)} target="_blank" rel="noreferrer">
				<strong>{model.settings.repo}</strong>
				<VisuallyHidden> (opens in a new tab)</VisuallyHidden>
			</Link>
		</span>
	);
}

/**
 * The account, as github.com shows it: the avatar opens a menu with who is signed in,
 * the bank, and signing out. Before sign-in, a button; while connecting, nothing, so
 * the startup connection does not flicker a "Sign in".
 */
function Account({ model }: { model: Model }) {
	const { dispatch } = useApp();
	const { session, loading } = model;
	const settings = () => dispatch({ kind: "settingsToggled", open: true });
	if (session.kind === "connecting") return null;
	if (session.kind !== "connected")
		return <Button onClick={settings}>Sign in</Button>;
	return (
		<ActionMenu>
			<ActionMenu.Anchor>
				<Button
					variant="invisible"
					className="account"
					aria-label={`Account: ${session.login}`}
				>
					<Avatar src={session.avatarUrl} size={32} alt="" />
				</Button>
			</ActionMenu.Anchor>
			<ActionMenu.Overlay align="end">
				<ActionList>
					<ActionList.Group>
						<ActionList.GroupHeading>
							Signed in as {session.login}
						</ActionList.GroupHeading>
						{loading.kind === "loaded" && loading.from === "branch" && (
							<ActionList.LinkItem
								href={`${repoUrl(model)}/tree/${encodeURI(ownBranch(session.login))}`}
								target="_blank"
								rel="noreferrer"
							>
								<ActionList.LeadingVisual>
									<GitBranchIcon />
								</ActionList.LeadingVisual>
								Your branch on GitHub
								<VisuallyHidden> (opens in a new tab)</VisuallyHidden>
								<ActionList.TrailingVisual>
									<LinkExternalIcon />
								</ActionList.TrailingVisual>
							</ActionList.LinkItem>
						)}
						<ActionList.Item onSelect={settings}>
							<ActionList.LeadingVisual>
								<RepoIcon />
							</ActionList.LeadingVisual>
							Change bank…
						</ActionList.Item>
					</ActionList.Group>
					<ActionList.Divider />
					<ActionList.Item onSelect={() => dispatch({ kind: "disconnected" })}>
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

/**
 * Where saves go, after the repository: the author's own branch (never a choice, so it
 * is context, as VS Code's status bar and GitHub Desktop's "Current branch" show it),
 * and what it holds that the bank does not, as links to GitHub, which does the rest:
 * the pull request, review, updating the branch, merging. Known the moment the session
 * is connected; a link to it once it exists on GitHub. Items of the header's row, so
 * the repository gives way first, then the branch; the pull-request icon never does.
 */
function Branch({ model }: { model: Model }) {
	const { session, loading } = model;
	if (session.kind !== "connected") return null;
	const branch = ownBranch(session.login);
	const repo = repoUrl(model);
	const compare = `${repo}/compare/${session.defaultBranch}...${encodeURI(branch)}?expand=1`;
	const loaded = loading.kind === "loaded" ? loading : undefined;
	const name = (
		<>
			<GitBranchIcon size={12} aria-hidden />{" "}
			<span className="branch-text">{branch}</span>
		</>
	);
	return (
		<>
			<span className="quiet sep branch-part" aria-hidden>
				/
			</span>
			{/* Before the first save the branch does not exist yet: named, not linked. */}
			{loaded?.from === "branch" ? (
				<BranchName
					className="branch-name branch-part"
					title={branch}
					href={`${repo}/tree/${encodeURI(branch)}`}
					target="_blank"
					rel="noreferrer"
				>
					{name}
					<VisuallyHidden> (opens in a new tab)</VisuallyHidden>
				</BranchName>
			) : (
				<BranchName
					as="span"
					className="branch-name branch-part"
					title={branch}
				>
					{name}
				</BranchName>
			)}
			{loaded !== undefined && loaded.behindBy > 0 && (
				<span className="behind">
					<ExternalLink href={compare} muted>
						{loaded.behindBy} behind {session.defaultBranch}
					</ExternalLink>
				</span>
			)}
			{/*
			 * Something to propose: the pull-request icon with a dot, as VS Code badges
			 * pending changes; the tooltip (Primer's, from `description`) says what the
			 * dot means and what the link does. Absent when there is nothing.
			 */}
			{loaded?.proposable && (
				<IconButton
					as="a"
					href={compare}
					target="_blank"
					rel="noreferrer"
					className="propose"
					icon={GitPullRequestIcon}
					variant="invisible"
					aria-label="Propose changes (opens in a new tab)"
					description="Your saved work is not in the bank yet. Open pull request."
					notificationIndicator="icon"
				/>
			)}
		</>
	);
}

const saving = (model: Model): boolean =>
	Object.values(model.activity).some(
		(a) => a.kind === "saving" || a.kind === "deleting",
	);

const busy = (model: Model): boolean =>
	model.session.kind === "connecting" ||
	(model.session.kind === "connected" &&
		(model.loading.kind === "loading" ||
			saving(model) ||
			(model.screen.kind === "foreign" && model.screen.file === undefined)));

const capitalise = (s: string): string =>
	s.charAt(0).toUpperCase() + s.slice(1);
