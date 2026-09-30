/** The page: a split layout with the bank tree in the pane and the open file in the content. */
import {
	GitBranchIcon,
	GitPullRequestIcon,
	LinkExternalIcon,
	PlusIcon,
	SignOutIcon,
} from "@primer/octicons-react";
import {
	ActionList,
	ActionMenu,
	Avatar,
	Banner,
	Button,
	ConfirmationDialog,
	IconButton,
	Link,
	LinkButton,
	Spinner,
	Stack,
	Truncate,
	VisuallyHidden,
} from "@primer/react";
import {
	AriaStatus,
	SkeletonAvatar,
	SkeletonBox,
} from "@primer/react/experimental";
import { useMemo } from "react";
import { plainText } from "../../core/codeSpans.js";
import { SCHEME_NAME, SCHEME_SINGULAR, UNNAMED } from "../../core/copy.js";
import { kindAt, SCHEME_KINDS } from "../../core/schemes.js";
import { indexOf, usedBy } from "../../core/symbols.js";
import { installUrl, SOURCE_URL } from "../config.js";
import { fileOf, type Id, type Model, TEMPLATES } from "../model.js";
import { alsoSaves, isUnsaved, usersIn } from "../sync.js";
import { bankFolders, schemeSections, treeOf } from "../tree.js";
import {
	bankLoading,
	folderOfPath,
	movedPath,
	moveProblem,
	namingProblem,
	ownBranch,
	sessionStatus,
	signOutPlan,
	writeBlocked,
} from "../update.js";
import { SESSION_STATUS, useApp, useEnv, useModel } from "./AppContext.js";
import { BankFilter, Browser } from "./Browser.js";
import { Editing, ForeignView } from "./Editing.js";
import { ExternalLink } from "./ExternalLink.js";
import { FileSkeleton } from "./FileSkeleton.js";
import { MoveDialog } from "./MoveDialog.js";
import { failureDescription } from "./Previews.js";
import { SaveDialog } from "./SaveDialog.js";
import { SchemeNameDialog } from "./SchemeNameDialog.js";
import { SignIn } from "./SignIn.js";
import { SignOutDialog } from "./SignOutDialog.js";

export function App() {
	const { dispatch, evaluations, signIn: signInConfig } = useApp();
	const model = useModel((m) => m);
	const env = useEnv();
	const { local, browser, screen, activity } = model;
	// There is no editor without a bank: signed out is a sign-in page.
	const signedIn =
		model.session.kind === "connecting" || model.session.kind === "connected";
	const loading = bankLoading(model);
	const status = sessionStatus(model);
	// The tree is drawn from these slices only, so a caret move does not redraw it.
	const treeInput = useMemo(
		() => ({ local, browser, screen, activity }),
		[local, browser, screen, activity],
	);
	const folders = useMemo(
		() => treeOf(treeInput, (q) => evaluations.get(q, model.agency, env)),
		[treeInput, model.agency, evaluations, env],
	);
	// The bank's symbol table: what each file defines, names and writes, questions and
	// shared files alike. Rebuilt from cached evaluations, so cheap per keystroke.
	const index = useMemo(
		() =>
			indexOf([
				...Object.values(model.local.questions).map((q) => ({
					key: q.id,
					symbols: evaluations.get(q, model.agency, env).symbols,
				})),
				...Object.values(model.local.schemes).map((e) => ({
					key: e.id,
					symbols: evaluations.scheme(e, env).symbols,
				})),
			]),
		[model.local, model.agency, evaluations, env],
	);
	const sections = useMemo(
		() => schemeSections(treeInput, (e) => evaluations.scheme(e, env), index),
		[treeInput, evaluations, env, index],
	);
	const naming = model.browser.naming;
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
	const signingOut = model.browser.signingOut;
	const signOut = signingOut && signOutPlan(model);
	const saving = model.browser.saving;
	const savingQuestion =
		saving === undefined ? undefined : model.local.questions[saving.id];
	const confirm =
		model.browser.confirmDelete === undefined
			? undefined
			: fileOf(model, model.browser.confirmDelete);
	// A saved file is named by the path the commit deletes (the filename follows the
	// name), never by unsaved edits that may have renamed it; a draft by its text.
	const confirmName =
		confirm === undefined
			? undefined
			: confirm.base !== undefined
				? (confirm.base.path.split("/").at(-1) ?? "").replace(/\.yaml$/, "")
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
					{/* The name and path, then what the branch holds, centred on one line. */}
					<Stack
						direction="horizontal"
						align="center"
						gap="condensed"
						className="brand"
					>
						{/* Text lines up with text: the name and the path share a baseline. */}
						<Stack
							direction="horizontal"
							align="baseline"
							gap="condensed"
							className="path"
						>
							<h1>qretools</h1>
							<Context model={model} />
						</Stack>
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
						{/*
						 * One line, cut short rather than wrap the header; the live region and
						 * the tooltip keep the whole text.
						 */}
						<AriaStatus as="span" id={SESSION_STATUS} className="quiet session">
							{status !== undefined && (
								<Truncate as="span" title={status} maxWidth="100%">
									{status}
								</Truncate>
							)}
						</AriaStatus>
						{model.loading.kind === "failed" && (
							<Button
								size="small"
								onClick={() => dispatch({ kind: "bankReloadRequested" })}
							>
								Try again
							</Button>
						)}
						{/* The status says the app cannot write here; this is where to fix it. */}
						{model.session.kind === "connected" &&
							model.session.access.kind === "notInstalled" &&
							signInConfig?.appSlug !== undefined && (
								<LinkButton
									size="small"
									href={installUrl(signInConfig.appSlug)}
									target="_blank"
									rel="noreferrer"
									trailingVisual={LinkExternalIcon}
								>
									Install the app
									<VisuallyHidden> (opens in a new tab)</VisuallyHidden>
								</LinkButton>
							)}
						{/* After installing in the other tab: ask GitHub again, no sign-in round trip. */}
						{model.session.kind === "connected" &&
							model.session.access.kind === "notInstalled" && (
								<Button
									size="small"
									onClick={() =>
										dispatch({
											kind: "connectRequested",
											settings: model.settings,
										})
									}
								>
									Try again
								</Button>
							)}
					</Stack>
					{/*
					 * While signing in, the places "New" and the avatar will take, at their
					 * sizes, so the header neither grows nor narrows when they arrive.
					 */}
					{model.session.kind === "connecting" && (
						<>
							<span className="new-placeholder" aria-hidden>
								<Button leadingVisual={PlusIcon} tabIndex={-1} inert>
									New
								</Button>
								<SkeletonBox />
							</span>
							<SkeletonAvatar size={32} />
						</>
					)}
					{model.session.kind === "connected" && (
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
					)}
					<Account model={model} />
				</Stack>
				{/*
				 * What the app has to say once, while signed in (signed out, the sign-in page
				 * says it). Always mounted, so the shell's rows stay in place; empty, it has
				 * no height.
				 */}
				<Stack gap="condensed" className="notices">
					{model.session.kind === "connected" &&
						model.failures.map((f, i) => (
							<Banner
								// biome-ignore lint/suspicious/noArrayIndexKey: the same failure may appear twice
								key={i}
								variant="critical"
								title={plainText(f.message)}
								description={failureDescription(f)}
								onDismiss={() =>
									dispatch({ kind: "failureDismissed", index: i })
								}
							/>
						))}
				</Stack>
				{/* On narrow screens the tree and the open file are separate views. */}
				{model.session.kind === "connecting" ? (
					// Whether there will be a bank is not known yet: neither the sign-in
					// form nor the workspace's shape; the top bar says what is happening.
					// Not `.content`: that spans every row of the workspace's grid, and
					// here, in the shell's own grid, it pushed the header to the bottom.
					<main className="connecting" aria-busy="true" />
				) : !signedIn ? (
					<SignIn model={model} />
				) : (
					<div
						className="workspace"
						data-open={
							open !== undefined || model.screen.kind === "foreign" || waiting
						}
					>
						<nav className="sidebar" aria-label="Question bank">
							<BankFilter
								filter={model.browser.filter}
								loading={loading}
								dispatch={dispatch}
							/>
							{/* The tree scrolls; the foot stays put below it, whatever the tree holds. */}
							<div className="sidebar-body">
								<div className="trees">
									<Browser
										folders={folders}
										sections={sections}
										loading={loading}
										filter={model.browser.filter}
										open={open}
										dispatch={dispatch}
									/>
								</div>
								<div className="sidebar-foot">
									<ExternalLink href={SOURCE_URL} muted>
										qretools on GitHub
									</ExternalLink>
								</div>
							</div>
						</nav>
						<main className="content">
							{model.screen.kind === "foreign" ? (
								<ForeignView screen={model.screen} />
							) : open === undefined && waiting && model.pendingLink ? (
								<FileSkeleton
									kind={
										kindAt(model.pendingLink.file ?? "")?.kind ?? "question"
									}
									onBack={() => dispatch({ kind: "listOpened" })}
								/>
							) : open === undefined ? (
								<div className="blank">
									<p className="quiet">
										{model.pendingLink !== undefined &&
										model.loading.kind === "failed"
											? "The bank didn't load, so this link can't open yet."
											: "Pick a question or a shared scale, universe or instruction in the bank, or create a new one."}
									</p>
								</div>
							) : (
								<Editing id={open} index={index} />
							)}
						</main>
					</div>
				)}
			</div>
			{moving && movingQuestion?.base && (
				<MoveDialog
					from={movingQuestion.base.path}
					current={folderOfPath(movingQuestion.base.path)}
					to={movedPath(movingQuestion.base.path, moving.folder)}
					folder={moving.folder}
					folders={bankFolders(model)}
					problem={moveProblem(model, movingQuestion, moving.folder)}
					blocked={writeBlocked(model)}
					also={alsoSaves(
						model.local,
						model.remote,
						evaluations.get(movingQuestion, model.agency, env).symbols.mentions,
						usersIn(index),
					)}
					dispatch={dispatch}
				/>
			)}
			{naming && (
				<SchemeNameDialog
					naming={naming}
					problem={namingProblem(model, naming)}
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
						usersIn(index),
					)}
					dispatch={dispatch}
				/>
			)}
			{signingOut && signOut && (
				<SignOutDialog
					questions={signOut.save.filter((f) => f.kind === "question").length}
					shared={signOut.save.filter((f) => f.kind !== "question").length}
					discard={signOut.discard.map(
						(q) => evaluations.get(q, model.agency, env).draft.name ?? UNNAMED,
					)}
					blocked={signOut.blocked.map((f) =>
						f.kind === "question"
							? (evaluations.get(f, model.agency, env).draft.name ?? UNNAMED)
							: `${SCHEME_NAME[f.kind]} ${f.name}`,
					)}
					saving={signingOut.phase === "saving"}
					failure={signingOut.failure}
					reason={writeBlocked(model)}
					dispatch={dispatch}
				/>
			)}
			{confirm && (
				<ConfirmationDialog
					title={
						confirm.base === undefined
							? "Delete this draft?"
							: `Delete ${confirmName}?`
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
					{/* Where the deletion goes: the author's branch, never the bank directly. */}
					{confirm.base === undefined
						? `${confirmName ?? "This draft"} exists only in this browser and can't be recovered.`
						: `It's removed from your branch${model.session.kind === "connected" ? `, ${ownBranch(model.session.login)}` : ""}. The bank is unchanged until your pull request is merged.`}
					{confirm.base !== undefined &&
						isUnsaved(confirm) &&
						" Your unsaved changes to it are discarded."}
					{confirmUsers > 0 &&
						` ${confirmUsers} question${confirmUsers === 1 ? " names" : "s name"} it; each will show a field to fill in there until it's changed.`}
				</ConfirmationDialog>
			)}
		</>
	);
}

const repoUrl = (model: Model): string =>
	`https://github.com/${model.settings.owner}/${model.settings.repo}`;

/**
 * Where the author is and where saves go, as one line of text, as github.com's header
 * says `owner / repo`: `owner / repo / ⑂ qretools-<login>`. The branch is never a
 * choice (always the author's own), so it is context, not a picker. The repository
 * and the branch are links to GitHub (the branch once it exists). One inline element,
 * so it all shares a baseline and truncates as one, from the end; on narrow screens
 * only the repository shows.
 */
function Context({ model }: { model: Model }) {
	const { session, loading } = model;
	if (session.kind !== "connected") return null;
	const branch = ownBranch(session.login);
	const exists = loading.kind === "loaded" && loading.from === "branch";
	const icon = <GitBranchIcon size={12} aria-hidden className="inline-icon" />;
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
			<span className="branch-path" title={branch}>
				{" "}
				<span className="quiet" aria-hidden>
					/
				</span>{" "}
				{/* Before the first save the branch does not exist yet: named, not linked. */}
				{exists ? (
					<Link
						href={`${repoUrl(model)}/tree/${encodeURI(branch)}`}
						target="_blank"
						rel="noreferrer"
						muted
					>
						{icon} <VisuallyHidden>branch </VisuallyHidden>
						{branch}
						<VisuallyHidden> (opens in a new tab)</VisuallyHidden>
					</Link>
				) : (
					<span className="quiet">
						{icon} <VisuallyHidden>branch </VisuallyHidden>
						{branch}
					</span>
				)}
			</span>
		</span>
	);
}

/**
 * The account, as github.com shows it: the avatar opens a menu with who is signed in,
 * the bank, and signing out.
 */
function Account({ model }: { model: Model }) {
	const { dispatch } = useApp();
	const { session, loading } = model;
	// Signed out, the page itself is the way in; while connecting, nothing yet.
	if (session.kind !== "connected") return null;
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
					</ActionList.Group>
					<ActionList.Divider />
					<ActionList.Item
						onSelect={() => dispatch({ kind: "signOutRequested" })}
					>
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
 * What the author's branch holds that the bank does not, after the path, as links to
 * GitHub, which does the rest: the pull request, review, updating the branch, merging.
 * The app states facts and links; it never recreates GitHub's interface.
 */
function Branch({ model }: { model: Model }) {
	const { session, loading } = model;
	if (session.kind !== "connected") return null;
	const branch = ownBranch(session.login);
	const compare = `${repoUrl(model)}/compare/${session.defaultBranch}...${encodeURI(branch)}?expand=1`;
	const loaded = loading.kind === "loaded" ? loading : undefined;
	return (
		<>
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
					icon={GitPullRequestIcon}
					variant="invisible"
					aria-label="Open pull request (opens in a new tab)"
					description="Your saved work isn't in the bank yet. Open a pull request to propose it."
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
