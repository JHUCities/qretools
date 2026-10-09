/** The page: a split layout with the bank tree in the pane and the open file in the content. */

import {
	GearIcon,
	GitBranchIcon,
	GitPullRequestIcon,
	PlusIcon,
} from "@primer/octicons-react";
import {
	ActionList,
	ActionMenu,
	Banner,
	Button,
	ConfirmationDialog,
	Heading,
	IconButton,
	Link,
	LinkButton,
	Spinner,
	Stack,
	Truncate,
	VisuallyHidden,
} from "@primer/react";
import { AriaStatus, SkeletonAvatar } from "@primer/react/experimental";
import {
	fileAt,
	type Index,
	indexOf,
	isRoot,
	plainText,
	SCHEME_KINDS,
	SCHEME_NAME,
	SCHEME_SINGULAR,
	type Symbols,
	status as statusOf,
	UNNAMED,
	usedBy,
	WORKSPACE_DETAILS,
} from "@qretools/core";
import { installUrl } from "@qretools/shell";
import {
	AccountMenu,
	ExternalLink,
	failureDescription,
	ThemeToggle,
	Wordmark,
} from "@qretools/shell/ui";
import { useCallback, useMemo } from "react";
import { SOURCE_URL } from "../config.js";
import {
	bankFileOf,
	type Dispatch,
	fileOf,
	type Id,
	isScheme,
	type Model,
	newBank,
	TEMPLATES,
} from "../model.js";
import { alsoSaves, claimOf, isUnsaved, usersIn } from "../sync.js";
import {
	bankFolders,
	banksShown,
	detailsButton,
	schemeSections,
	treeOf,
	workspaceLeaves,
} from "../tree.js";
import {
	bankLoading,
	compareUrl,
	folderOfPath,
	instrumentNameProblem,
	movedPath,
	moveProblem,
	namingProblem,
	ownBranch,
	sessionStatus,
	signOutPlan,
	writeBlocked,
} from "../update.js";
import { instrumentsUsing } from "../usedBy.js";
import {
	SESSION_STATUS,
	useApp,
	useInstrumentUses,
	useModel,
} from "./AppContext.js";
import { BankFilter, type BankTree, Browser, bankLabel } from "./Browser.js";
import { Editing, ForeignView } from "./Editing.js";
import { type FileKind, FileSkeleton } from "./FileSkeleton.js";
import { InstrumentNameDialog } from "./InstrumentNameDialog.js";
import { MoveDialog } from "./MoveDialog.js";
import { SaveDialog } from "./SaveDialog.js";
import { SchemeNameDialog } from "./SchemeNameDialog.js";
import { SignIn } from "./SignIn.js";
import { SignOutDialog } from "./SignOutDialog.js";

/**
 * New: a question, from a template or blank, or a shared file. In a workspace of several
 * banks, first which bank (the open file's first), as a submenu each.
 */
function NewMenu({
	banks,
	first,
	workspaceOnly,
	dispatch,
}: {
	banks: readonly string[];
	first: string;
	/** A workspace with no bank of its own: nothing here makes one (`workspaceOnly`). */
	workspaceOnly: boolean;
	dispatch: Dispatch;
}) {
	const ordered = [first, ...banks.filter((b) => b !== first)];
	return (
		<ActionMenu>
			<ActionMenu.Anchor>
				<Button leadingVisual={PlusIcon}>New</Button>
			</ActionMenu.Anchor>
			<ActionMenu.Overlay>
				<ActionList>
					{/* The workspace's own files first, as the tree shows them. */}
					<ActionList.GroupHeading>Workspace</ActionList.GroupHeading>
					<ActionList.Item
						onSelect={() => dispatch({ kind: "instrumentCreateOpened" })}
					>
						Instrument…
					</ActionList.Item>
					<ActionList.Item
						onSelect={() =>
							dispatch({ kind: "instrumentCreateOpened", example: true })
						}
					>
						Example instrument…
					</ActionList.Item>
					<ActionList.Item
						onSelect={() => dispatch({ kind: "workspaceDetailsOpened" })}
					>
						Workspace details
					</ActionList.Item>
					{workspaceOnly ? null : banks.length <= 1 ? (
						<>
							<ActionList.Divider />
							<NewItems dispatch={dispatch} />
						</>
					) : (
						<>
							<ActionList.Divider />
							<ActionList.GroupHeading>In bank</ActionList.GroupHeading>
							{ordered.map((bank) => (
								<ActionMenu key={bank}>
									<ActionMenu.Anchor>
										<ActionList.Item>{bankLabel(bank)}</ActionList.Item>
									</ActionMenu.Anchor>
									<ActionMenu.Overlay>
										<ActionList>
											<NewItems bank={bank} dispatch={dispatch} />
										</ActionList>
									</ActionMenu.Overlay>
								</ActionMenu>
							))}
						</>
					)}
				</ActionList>
			</ActionMenu.Overlay>
		</ActionMenu>
	);
}

/** What New makes, in `bank` when one was chosen. */
function NewItems({ bank, dispatch }: { bank?: string; dispatch: Dispatch }) {
	const inBank = bank === undefined ? {} : { bank };
	return (
		<>
			<ActionList.Item
				onSelect={() =>
					dispatch({ kind: "questionCreated", text: "", ...inBank })
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
						dispatch({ kind: "questionCreated", text: t.text, ...inBank })
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
						dispatch({ kind: "schemeCreateOpened", scheme: k, ...inBank })
					}
				>
					{capitalise(SCHEME_SINGULAR[k])}
				</ActionList.Item>
			))}
		</>
	);
}

/** The shape a file at a workspace path will have, while it is on its way. */
function skeletonKind(path: string, banks: readonly string[]): FileKind {
	const at = fileAt(path, banks);
	return at === undefined
		? "question"
		: at.kind === "bank"
			? at.at.kind
			: at.kind;
}

/** A bank with no files yet indexes nothing. */
const NO_INDEX: Index<Id> = indexOf([]);

export function App() {
	const { dispatch, evaluations, signIn: signInConfig } = useApp();
	const model = useModel((m) => m);
	// Each bank's environment, memoised per bank in the evaluations (see evaluations.ts).
	const envFor = useCallback(
		(bank: string) =>
			evaluations.env(
				{ local: model.local, remote: model.remote, banks: model.banks },
				bank,
			),
		[evaluations, model.local, model.remote, model.banks],
	);
	const { local, browser, screen, activity } = model;
	// There is no editor without a bank: signed out is a sign-in page.
	const signedIn =
		model.session.kind === "connecting" || model.session.kind === "connected";
	const loading = bankLoading(model);
	const status = sessionStatus(model);
	// The tree is drawn from these slices only, so a caret move does not redraw it.
	// Which instruments use each bank file: the tree's counts and the delete dialog's.
	const instrumentUses = useInstrumentUses();
	const treeInput = useMemo(
		() => ({ local, browser, screen, activity }),
		[local, browser, screen, activity],
	);
	// Each bank's symbol table: what each file defines, names and writes, questions and
	// shared files alike, within its bank (one bank's names are not another's). Rebuilt
	// from cached evaluations, so cheap per keystroke.
	const indexes = useMemo(() => {
		const byBank = new Map<string, { key: Id; symbols: Symbols }[]>();
		const put = (bank: string, key: Id, symbols: Symbols) =>
			byBank.set(bank, [...(byBank.get(bank) ?? []), { key, symbols }]);
		for (const q of Object.values(model.local.questions))
			put(q.bank, q.id, evaluations.get(q, envFor(q.bank)).symbols);
		for (const e of Object.values(model.local.schemes))
			put(e.bank, e.id, evaluations.scheme(e, envFor(e.bank)).symbols);
		return new Map(
			[...byBank].map(([bank, entries]) => [bank, indexOf(entries)]),
		);
	}, [model.local, evaluations, envFor]);
	const indexFor = useCallback(
		(bank: string): Index<Id> => indexes.get(bank) ?? NO_INDEX,
		[indexes],
	);
	// The banks the tree shows, each with its questions and its shared files.
	const shownBanks = useMemo(
		() => banksShown({ banks: model.banks, local }),
		[model.banks, local],
	);
	const trees = useMemo(
		() =>
			shownBanks.map(
				(bank): BankTree => ({
					bank,
					folders: treeOf(
						treeInput,
						(q) => evaluations.get(q, envFor(q.bank)),
						bank,
					),
					sections: schemeSections(
						treeInput,
						(e) => evaluations.scheme(e, envFor(e.bank)),
						indexFor(bank),
						bank,
						instrumentUses,
					),
				}),
			),
		[shownBanks, treeInput, evaluations, envFor, indexFor, instrumentUses],
	);
	// The workspace's own files, read as their author sees them.
	const workspace = useMemo(() => {
		const slices = {
			local,
			remote: model.remote,
			banks: model.banks,
			remoteBanks: model.remoteBanks,
		};
		return workspaceLeaves(treeInput, (e) =>
			statusOf(
				e.kind === "instrument"
					? evaluations.instrument(slices, e).instrument.findings
					: (evaluations.workspaceFile(slices)?.findings ?? []),
			),
		);
	}, [
		treeInput,
		evaluations,
		local,
		model.remote,
		model.banks,
		model.remoteBanks,
	]);
	// A workspace whose files are all its own (instruments, details) has no bank to show
	// or to make questions in: an empty repository still starts as one bank at its root.
	// What the details' button says (unsaved, to fill in or fix, advice), as their tree
	// item's marks did.
	const details = useMemo(() => {
		const file = evaluations.workspaceFile({
			local,
			remote: model.remote,
			banks: model.banks,
		});
		return detailsButton(
			treeInput,
			file === undefined ? undefined : statusOf(file.findings),
		);
	}, [treeInput, evaluations, local, model.remote, model.banks]);
	// The workspace's details are open: said on the button beside its name.
	const detailsOpen =
		screen.kind === "editing" &&
		local.workspace[screen.id]?.kind === "workspaceFile";
	const workspaceOnly =
		shownBanks.length === 0 && Object.keys(local.workspace).length > 0;
	const naming = model.browser.naming;
	const namingInstrument = model.browser.namingInstrument;
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
			: // The workspace's own files say what they are: nothing else is named so.
				confirm.kind === "instrument"
				? `instrument ${confirm.name}`
				: confirm.kind === "workspaceFile"
					? WORKSPACE_DETAILS
					: confirm.base !== undefined
						? (confirm.base.path.split("/").at(-1) ?? "").replace(/\.yaml$/, "")
						: confirm.kind === "question"
							? evaluations.get(confirm, envFor(confirm.bank)).draft.name
							: confirm.name;
	// Deleting a scheme file others name turns each of those names into a hole: say how many.
	// Nothing names an instrument or the workspace details: no count for them.
	// …and each instrument here that names it, which would show one too.
	const confirmInstruments =
		confirm === undefined || !isScheme(confirm) || isRoot(confirm.kind)
			? 0
			: instrumentsUsing(instrumentUses, claimOf(confirm)).length;
	const confirmUsers =
		confirm === undefined || !isScheme(confirm) || isRoot(confirm.kind)
			? 0
			: new Set(
					usedBy(indexFor(confirm.bank), confirm.kind, confirm.name).map(
						(s) => s.key,
					),
				).size;

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
					// As primer.style's header: 16px above and below 32px controls, 24px aside.
					paddingBlock="normal"
					paddingInline={{ narrow: "normal", regular: "spacious" }}
				>
					{/*
					 * The wordmark: real text in two typefaces (the shell's app.css), read as one word.
					 * Which bank is open is the sidebar's title, not the header's.
					 */}
					<Wordmark />
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
					 * While signing in, "New" disabled: its own size, so the header neither grows
					 * nor narrows when the real one arrives (the avatar's place is its
					 * SkeletonAvatar, below). No spinner: the status beside it has the one, and
					 * says why. Natively disabled, not `inactive` as the file header's buttons
					 * are: a placeholder for seconds is no tab stop, and focus on it would drop
					 * to the page when it goes.
					 */}
					{model.session.kind === "connecting" && (
						<Button leadingVisual={PlusIcon} disabled>
							New
						</Button>
					)}
					{model.session.kind === "connected" && (
						<NewMenu
							banks={shownBanks}
							first={newBank(model)}
							workspaceOnly={workspaceOnly}
							dispatch={dispatch}
						/>
					)}
					<ThemeToggle
						onChoose={(theme) => dispatch({ kind: "themeChosen", theme })}
					/>
					{model.session.kind === "connecting" ? (
						<SkeletonAvatar size={32} />
					) : (
						<Account model={model} />
					)}
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
								description={
									f.link === undefined ? (
										failureDescription(f)
									) : (
										<>
											{failureDescription(f)}{" "}
											<ExternalLink href={f.link.href}>
												{f.link.label}
											</ExternalLink>
										</>
									)
								}
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
							{/*
							 * The pane's title is the bank itself, `owner / repo`, level with the open
							 * file's header; then its branch and the filter together, then the tree.
							 * The landmark keeps a name of its own: the title holds a link.
							 */}
							<div className="band">
								{/*
								 * The workspace's details sit by its name, as a repository's settings
								 * by its name on github.com: they are about the whole workspace.
								 */}
								<div className="band-row">
									<Heading as="h2" variant="small" className="pane-title">
										<VisuallyHidden>Question bank: </VisuallyHidden>
										<Bank model={model} />
									</Heading>
									<IconButton
										icon={GearIcon}
										// Medium, as the pull-request button: at small the dot covers the icon.
										variant="invisible"
										aria-label={details.label}
										{...(details.attention && {
											notificationIndicator: "icon" as const,
										})}
										// No selected look on a button: the open file's header says it,
										// and assistive technology hears it here.
										aria-current={detailsOpen ? "page" : undefined}
										onClick={() => dispatch({ kind: "workspaceDetailsOpened" })}
									/>
								</div>
							</div>
							{/* The branch, the filter and the foot stay put; the tree between scrolls. */}
							<div className="sidebar-body">
								<div className="sidebar-tools">
									<BranchLine model={model} />
									<BankFilter
										filter={model.browser.filter}
										loading={loading}
										dispatch={dispatch}
									/>
								</div>
								<div className="trees">
									<Browser
										banks={trees}
										workspace={workspace}
										workspaceOnly={workspaceOnly}
										noInstruments={
											!Object.values(local.workspace).some(
												(e) => e.kind === "instrument",
											)
										}
										loading={loading}
										filter={model.browser.filter}
										open={open}
										dispatch={dispatch}
									/>
								</div>
								<div className="sidebar-foot">
									<ExternalLink href={SOURCE_URL} muted>
										{/* Named in full for a list of links heard out of context. */}
										<VisuallyHidden>QREtools on </VisuallyHidden>GitHub
									</ExternalLink>
								</div>
							</div>
						</nav>
						<main className="content">
							{model.screen.kind === "foreign" ? (
								<ForeignView screen={model.screen} />
							) : open === undefined && waiting && model.pendingLink ? (
								<FileSkeleton
									kind={skeletonKind(model.pendingLink.file ?? "", model.banks)}
									onBack={() => dispatch({ kind: "listOpened" })}
								/>
							) : open === undefined ? (
								<div className="blank">
									<p className="quiet">
										{model.pendingLink !== undefined &&
										model.loading.kind === "failed"
											? "The workspace didn't load, so this link can't open yet."
											: "Pick an instrument, a question or a shared file, or create one with New."}
									</p>
								</div>
							) : (
								<Editing
									id={open}
									index={indexFor(bankFileOf(model, open)?.bank ?? "")}
								/>
							)}
						</main>
					</div>
				)}
			</div>
			{moving && movingQuestion?.base && (
				<MoveDialog
					from={movingQuestion.base.path}
					current={folderOfPath(movingQuestion.base.path, movingQuestion.bank)}
					to={movedPath(
						movingQuestion.base.path,
						moving.folder,
						movingQuestion.bank,
					)}
					folder={moving.folder}
					folders={bankFolders(model, movingQuestion.bank)}
					problem={moveProblem(model, movingQuestion, moving.folder)}
					blocked={writeBlocked(model)}
					also={alsoSaves(
						model.local,
						model.remote,
						evaluations.get(movingQuestion, envFor(movingQuestion.bank)).symbols
							.mentions,
						usersIn(indexFor(movingQuestion.bank)),
						movingQuestion.bank,
					)}
					dispatch={dispatch}
				/>
			)}
			{namingInstrument && (
				<InstrumentNameDialog
					name={namingInstrument.name}
					example={namingInstrument.example === true}
					problem={instrumentNameProblem(model, namingInstrument.name)}
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
					draft={
						evaluations.get(savingQuestion, envFor(savingQuestion.bank)).draft
					}
					folder={saving.folder}
					folders={bankFolders(model, savingQuestion.bank)}
					bank={savingQuestion.bank}
					taken={(path) => path in model.remote.questions}
					also={alsoSaves(
						model.local,
						model.remote,
						evaluations.get(savingQuestion, envFor(savingQuestion.bank)).symbols
							.mentions,
						usersIn(indexFor(savingQuestion.bank)),
						savingQuestion.bank,
					)}
					dispatch={dispatch}
				/>
			)}
			{signingOut && signOut && (
				<SignOutDialog
					questions={signOut.save.filter((f) => f.kind === "question").length}
					shared={signOut.save.filter(isScheme).length}
					instruments={
						signOut.save.filter((f) => f.kind === "instrument").length
					}
					workspaceDetails={signOut.save.some(
						(f) => f.kind === "workspaceFile",
					)}
					discard={signOut.discard.map(
						(q) => evaluations.get(q, envFor(q.bank)).draft.name ?? UNNAMED,
					)}
					blocked={signOut.blocked.map((f) =>
						f.kind === "question"
							? (evaluations.get(f, envFor(f.bank)).draft.name ?? UNNAMED)
							: f.kind === "instrument"
								? `instrument ${f.name}`
								: f.kind === "workspaceFile"
									? WORKSPACE_DETAILS
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
						: model.session.kind === "connected"
							? `It's removed from your branch, ${ownBranch(model.session.login)}. ${model.session.defaultBranch} is unchanged until your pull request is merged.`
							: "It's removed from your branch. The default branch is unchanged until your pull request is merged."}
					{confirm.base !== undefined &&
						isUnsaved(confirm) &&
						" Your unsaved changes to it are discarded."}
					{confirmUsers + confirmInstruments > 0 &&
						` ${namedBy(confirmUsers, confirmInstruments)} it; each will show a field to fill in there until it's changed.`}
				</ConfirmationDialog>
			)}
		</>
	);
}

const repoUrl = (model: Model): string =>
	`https://github.com/${model.settings.owner}/${model.settings.repo}`;

/**
 * A branch and the bank's folder in a github.com URL: each folder segment encoded (git
 * allows nearly any name); the branch keeps its slashes, as github.com writes it.
 */
const treeUrl = (model: Model, branch: string): string =>
	[
		repoUrl(model),
		"tree",
		encodeURI(branch),
		...model.settings.path
			.split("/")
			.filter((s) => s !== "")
			.map(encodeURIComponent),
	].join("/");

/** The bank on GitHub: the repository, or its folder on the default branch once that's known. */
const bankUrl = (model: Model): string =>
	model.settings.path === "" || model.session.kind !== "connected"
		? repoUrl(model)
		: treeUrl(model, model.session.defaultBranch);

/**
 * The bank, as github.com names a repository: `owner / repo`, then `/ folder` for a
 * bank in a folder, the last part a link, on one line that truncates from the end. Its
 * branch is the next line (BranchLine).
 */
function Bank({ model }: { model: Model }) {
	const { owner, repo, path } = model.settings;
	return (
		<span className="bank">
			<span className="owner">
				{owner} <span aria-hidden>/</span>{" "}
			</span>
			{path !== "" && (
				<span className="owner">
					{repo} <span aria-hidden>/</span>{" "}
				</span>
			)}
			{/* No external-link icon, as in github.com's header; still said to screen readers. */}
			<Link href={bankUrl(model)} target="_blank" rel="noreferrer">
				<strong>{path === "" ? repo : path}</strong>
				<VisuallyHidden> (opens in a new tab)</VisuallyHidden>
			</Link>
		</span>
	);
}

/**
 * The account menu once signed in. Signed out, the page itself is the way in; while
 * connecting, nothing yet.
 */
function Account({ model }: { model: Model }) {
	const { dispatch } = useApp();
	const { session } = model;
	if (session.kind !== "connected") return null;
	return (
		<AccountMenu
			login={session.login}
			avatarUrl={session.avatarUrl}
			onSignOut={() => dispatch({ kind: "signOutRequested" })}
		/>
	);
}

/**
 * The author's branch above the tree, then how it stands against the default branch:
 * behind it, with "Update" to bring its changes in (a merge on GitHub; a conflict is
 * left to a pull request), and anything to propose, as a link to the pull request
 * form. Review and merging stay on GitHub.
 */
function BranchLine({ model }: { model: Model }) {
	const { dispatch } = useApp();
	const { session, loading } = model;
	if (session.kind !== "connected") return null;
	const blocked = writeBlocked(model);
	const branch = ownBranch(session.login);
	const exists = loading.kind === "loaded" && loading.from === "branch";
	const compare = compareUrl(model.settings, session);
	const loaded = loading.kind === "loaded" ? loading : undefined;
	// The same icon, gap and text either way, so the first save changes nothing but the link.
	const name = (
		<>
			<GitBranchIcon aria-hidden />
			<VisuallyHidden>branch </VisuallyHidden>
			{/* Inline: its flex parent would otherwise make it a flex box, which has no ellipsis. */}
			<Truncate as="span" inline title={branch} maxWidth="100%">
				{branch}
			</Truncate>
		</>
	);
	const behind = loaded === undefined ? 0 : loaded.behindBy;
	return (
		<>
			<div className="branch-line">
				{/* Before the first save the branch does not exist yet: named, not linked. */}
				{exists ? (
					<Link
						className="branch"
						href={treeUrl(model, branch)}
						target="_blank"
						rel="noreferrer"
						muted
						title={branch}
					>
						{name}
						<VisuallyHidden> (opens in a new tab)</VisuallyHidden>
					</Link>
				) : (
					<span className="branch quiet" title={branch}>
						{name}
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
						className="branch-propose"
						icon={GitPullRequestIcon}
						variant="invisible"
						aria-label="Open pull request (opens in a new tab)"
						description={`Your saved work isn't on ${session.defaultBranch} yet. Open a pull request to propose it.`}
						notificationIndicator="icon"
					/>
				)}
			</div>
			{/*
			 * Behind the default branch: its own row, once the workspace has loaded, so the
			 * branch's name is never cut short to make room (as github.com's branch bar says
			 * "This branch is N commits behind main").
			 */}
			{behind > 0 && (
				<div className="branch-behind">
					{/* What changed, before updating: the compare page. */}
					<ExternalLink href={compare}>
						{behind} {behind === 1 ? "commit" : "commits"} behind{" "}
						{session.defaultBranch}
					</ExternalLink>
					{/* Only once the branch exists: the first save makes it up to date. */}
					{exists && (
						<Button
							size="small"
							inactive={blocked !== undefined}
							aria-describedby={
								blocked === undefined ? undefined : SESSION_STATUS
							}
							onClick={() =>
								blocked === undefined &&
								dispatch({ kind: "updateFromDefaultRequested" })
							}
						>
							Update
							<VisuallyHidden> from {session.defaultBranch}</VisuallyHidden>
						</Button>
					)}
				</div>
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

/** "3 questions and 1 instrument name", "1 question names": who names a shared file. */
function namedBy(questions: number, instruments: number): string {
	const count = (n: number, what: string) =>
		`${n} ${what}${n === 1 ? "" : "s"}`;
	const who = [
		...(questions > 0 ? [count(questions, "question")] : []),
		...(instruments > 0 ? [count(instruments, "instrument")] : []),
	].join(" and ");
	return `${who} ${questions + instruments === 1 ? "names" : "name"}`;
}

const capitalise = (s: string): string =>
	s.charAt(0).toUpperCase() + s.slice(1);
