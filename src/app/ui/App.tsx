/** The page: a split layout with the bank tree in the pane and the open file in the content. */
import { GearIcon, PlusIcon } from "@primer/octicons-react";
import {
	ActionList,
	ActionMenu,
	Button,
	ConfirmationDialog,
	SplitPageLayout,
} from "@primer/react";
import { useMemo } from "react";
import { SCHEME_KINDS } from "../../core/schemes.js";
import { indexOf, usedBy } from "../../core/symbols.js";
import { fileOf, type Id, type Model, TEMPLATES } from "../model.js";
import { bankFolders, SCHEME_LABELS, schemeSections, treeOf } from "../tree.js";
import { schemeNameProblem } from "../update.js";
import { useApp, useEnv, useModel } from "./AppContext.js";
import { BankDialog } from "./BankDialog.js";
import { Browser } from "./Browser.js";
import { Editing } from "./Editing.js";
import { SaveDialog } from "./SaveDialog.js";
import { SchemeNameDialog } from "./SchemeNameDialog.js";

export function App() {
	const { dispatch, evaluations } = useApp();
	const model = useModel((m) => m);
	const env = useEnv();
	const folders = useMemo(
		() => treeOf(model, (q) => evaluations.get(q, model.agency, env)),
		[model, evaluations, env],
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
		() => schemeSections(model, (e) => evaluations.scheme(e, env), index),
		[model, evaluations, env, index],
	);
	const creating = model.browser.creating;
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
			<SplitPageLayout>
				<SplitPageLayout.Header>
					<div className="topbar">
						<h1>qretools</h1>
						<span className="quiet">question bank</span>
						<span className="quiet session">
							{model.session.kind === "connected" &&
								`${model.session.login} · ${model.settings.owner}/${model.settings.repo} · ${model.session.branch}${model.session.canWrite ? "" : " (read only)"}`}
						</span>
						<BranchLinks model={model} />
						<span className="spacer" />
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
											{k === "missing"
												? "Missing values"
												: SCHEME_LABELS[k].replace(/s$/, "")}
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
					</div>
				</SplitPageLayout.Header>
				<SplitPageLayout.Pane
					position="start"
					width="medium"
					resizable
					widthStorageKey="qretools.pane"
					aria-label="Question bank"
					sticky
				>
					<Browser
						folders={folders}
						sections={sections}
						filter={model.browser.filter}
						open={open}
						dispatch={dispatch}
					/>
				</SplitPageLayout.Pane>
				<SplitPageLayout.Content width="full" padding="none">
					{open === undefined ? (
						<div className="blank">
							<p className="quiet">
								Pick a question or a shared element in the bank, or create a new
								one.
							</p>
						</div>
					) : (
						<Editing id={open} index={index} />
					)}
				</SplitPageLayout.Content>
			</SplitPageLayout>
			{model.browser.settingsOpen && (
				<BankDialog
					settings={model.settings}
					session={model.session}
					bank={model.loading}
					failures={model.failures}
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
	const pulls = `${repo}/pulls?q=${encodeURIComponent(`is:pr head:${session.branch}`)}`;
	return (
		<>
			{loading.aheadBy > 0 && (
				<a
					className="topbar-link"
					href={compare}
					target="_blank"
					rel="noreferrer"
				>
					Propose {loading.aheadBy} change{loading.aheadBy === 1 ? "" : "s"} on
					GitHub
				</a>
			)}
			{loading.behindBy > 0 && (
				<a
					className="topbar-link quiet"
					href={pulls}
					target="_blank"
					rel="noreferrer"
				>
					{loading.behindBy} behind {session.defaultBranch}: update on GitHub
				</a>
			)}
		</>
	);
}
