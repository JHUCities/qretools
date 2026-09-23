/** The page: a split layout with the bank tree in the pane and the open question in the content. */
import { GearIcon, PlusIcon } from "@primer/octicons-react";
import {
	ActionList,
	ActionMenu,
	Button,
	ConfirmationDialog,
	SplitPageLayout,
} from "@primer/react";
import { useMemo } from "react";
import { status } from "../../core/findings.js";
import { toDiagnostics } from "../diagnostics.js";
import { isUnsaved } from "./../merge.js";
import { type Id, TEMPLATES } from "../model.js";
import { treeOf } from "../tree.js";
import { useApp, useModel } from "./AppContext.js";
import { BankDialog } from "./BankDialog.js";
import { Browser } from "./Browser.js";
import { EditorPane } from "./EditorPane.js";
import {
	Codebook,
	Ddi,
	Findings,
	Respondent,
	StatusBadge,
} from "./Previews.js";
import { QuestionHeader } from "./QuestionHeader.js";

export function App() {
	const { dispatch, evaluations } = useApp();
	const model = useModel((m) => m);
	const folders = useMemo(
		() => treeOf(model, (q) => evaluations.get(q, model.agency, model.scales)),
		[model, evaluations],
	);
	const open: Id | undefined =
		model.screen.kind === "editing" ? model.screen.id : undefined;
	const confirm =
		model.browser.confirmDelete === undefined
			? undefined
			: model.questions[model.browser.confirmDelete];
	const confirmName = confirm
		? evaluations.get(confirm, model.agency, model.scales).draft.name
		: undefined;

	return (
		<>
			<SplitPageLayout>
				<SplitPageLayout.Header>
					<div className="topbar">
						<h1>qretools</h1>
						<span className="quiet">question bank</span>
						<span className="quiet session">
							{model.session.kind === "connected" &&
								`${model.session.login} · ${model.settings.owner}/${model.settings.repo}@${model.settings.branch}${model.session.canWrite ? "" : " (read only)"}`}
						</span>
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
						filter={model.browser.filter}
						open={open}
						dispatch={dispatch}
					/>
				</SplitPageLayout.Pane>
				<SplitPageLayout.Content width="full" padding="none">
					{open === undefined ? (
						<div className="blank">
							<p className="quiet">
								Pick a question in the bank, or create a new one.
							</p>
						</div>
					) : (
						<Editing id={open} />
					)}
				</SplitPageLayout.Content>
			</SplitPageLayout>
			{model.browser.settingsOpen && (
				<BankDialog
					settings={model.settings}
					session={model.session}
					bank={model.bank}
					failures={model.failures}
					dispatch={dispatch}
				/>
			)}
			{confirm && (
				<ConfirmationDialog
					title={
						confirm.origin.kind === "draft"
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
					{confirm.origin.kind === "draft"
						? `The draft ${confirmName ?? "(no name)"} is only in this browser and cannot be recovered.`
						: `${confirmName ?? confirm.origin.path} will be deleted from the repository in a commit under your name. Git keeps the history.`}
				</ConfirmationDialog>
			)}
		</>
	);
}

function Editing({ id }: { id: Id }) {
	const { dispatch, evaluations, effects } = useApp();
	const q = useModel((m) => m.questions[id]);
	const agency = useModel((m) => m.agency);
	const scales = useModel((m) => m.scales);
	const session = useModel((m) => m.session);
	const ddiSchema = useModel((m) => m.ddiSchema);
	// Hooks run unconditionally; the early return comes after them.
	const ev = q ? evaluations.get(q, agency, scales) : undefined;
	const diagnostics = useMemo(
		() => (ev ? toDiagnostics(ev.findings, ev.ranges) : []),
		[ev],
	);
	if (!q || !ev) return null;
	const schema = evaluations.schema(scales);
	const onTarget = (
		target: Parameters<typeof Findings>[0]["onTarget"] extends (
			t: infer T,
		) => void
			? T
			: never,
	) => dispatch({ kind: "locationClicked", target });
	const problems =
		ddiSchema.kind === "failed"
			? [ddiSchema.finding]
			: (effects.validate(ev.ddi) ?? []);
	return (
		<div className="editing">
			<QuestionHeader
				q={q}
				name={ev.draft.name}
				unsaved={isUnsaved(q)}
				session={session}
				on={{
					save: () => dispatch({ kind: "saveRequested", id }),
					reload: () => dispatch({ kind: "reloadRequested", id }),
					remove: () => dispatch({ kind: "deleteRequested", id }),
					downloadYaml: () =>
						dispatch({ kind: "downloadRequested", id, format: "yaml" }),
					downloadDdi: () =>
						dispatch({ kind: "downloadRequested", id, format: "ddi" }),
				}}
			/>
			<div className="split">
				<section className="left" aria-label="Question source">
					<EditorPane
						id={id}
						text={q.source}
						diagnostics={diagnostics}
						schema={schema}
					/>
				</section>
				<section className="right">
					<article className="pane">
						<h2>
							Findings <StatusBadge status={status(ev.findings)} />
						</h2>
						<div className="pane-body">
							<Findings findings={ev.findings} onTarget={onTarget} />
						</div>
					</article>
					<article className="pane">
						<h2>As the respondent sees it</h2>
						<div className="pane-body">
							<Respondent view={ev.respondent} onTarget={onTarget} />
						</div>
					</article>
					<article className="pane">
						<h2>Codebook entry</h2>
						<div className="pane-body">
							<Codebook view={ev.codebook} onTarget={onTarget} />
						</div>
					</article>
					<Ddi document={ev.ddi} schema={ddiSchema} problems={problems} />
				</section>
			</div>
		</div>
	);
}
