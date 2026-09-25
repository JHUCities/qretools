/**
 * The bank as a file tree, with a filter that prunes it: questions by topic, then
 * the shared elements by kind. Everything shown is derived by tree.ts.
 */
import { SearchIcon } from "@primer/octicons-react";
import { Label, TextInput, TreeView } from "@primer/react";
import type { Dispatch, Id } from "../model.js";
import type { Folder, Leaf, SchemeLeaf, SchemeSection } from "../tree.js";
import { StatusIcon } from "./Previews.js";

export function Browser({
	folders,
	sections,
	filter,
	open,
	dispatch,
	loading = false,
}: {
	folders: readonly Folder[];
	sections: readonly SchemeSection[];
	filter: string;
	open: Id | undefined;
	dispatch: Dispatch;
	/** The bank is being read from GitHub: an empty tree means "not yet", not "none". */
	loading?: boolean;
}) {
	return (
		<div className="browser">
			<TextInput
				block
				type="search"
				leadingVisual={SearchIcon}
				placeholder="Filter by name or title"
				aria-label="Filter"
				value={filter}
				onChange={(e) =>
					dispatch({ kind: "filterChanged", text: e.target.value })
				}
			/>
			<h2 className="browser-heading">Questions</h2>
			{folders.length === 0 ? (
				<p className="quiet" aria-live="polite">
					{loading
						? "Loading the bank from GitHub…"
						: filter === ""
							? "No questions yet. Create one, or connect to the bank."
							: "No questions match."}
				</p>
			) : (
				<TreeView aria-label="Questions">
					{folders.map((f) => (
						<FolderItem
							key={f.name}
							folder={f}
							open={open}
							dispatch={dispatch}
						/>
					))}
				</TreeView>
			)}
			{sections.length > 0 && (
				<>
					<h2 className="browser-heading">Shared</h2>
					<TreeView aria-label="Shared elements">
						{sections.map((s) => (
							<SectionItem
								key={s.key}
								section={s}
								open={open}
								dispatch={dispatch}
							/>
						))}
					</TreeView>
				</>
			)}
		</div>
	);
}

function FolderItem({
	folder,
	open,
	dispatch,
}: {
	folder: Folder;
	open: Id | undefined;
	dispatch: Dispatch;
}) {
	return (
		<TreeView.Item
			id={`folder:${folder.name}`}
			expanded={folder.expanded}
			onExpandedChange={() =>
				dispatch({ kind: "folderToggled", folder: folder.name })
			}
			containIntrinsicSize="2rem"
		>
			<TreeView.LeadingVisual>
				<TreeView.DirectoryIcon />
			</TreeView.LeadingVisual>
			{folder.name}
			<TreeView.TrailingVisual>
				<span className="quiet">{folder.leaves.length}</span>
			</TreeView.TrailingVisual>
			<TreeView.SubTree>
				{folder.leaves.map((leaf) => (
					<LeafItem
						key={leaf.id}
						leaf={leaf}
						current={leaf.id === open}
						dispatch={dispatch}
					/>
				))}
			</TreeView.SubTree>
		</TreeView.Item>
	);
}

function LeafItem({
	leaf,
	current,
	dispatch,
}: {
	leaf: Leaf;
	current: boolean;
	dispatch: Dispatch;
}) {
	return (
		<TreeView.Item
			id={`q:${leaf.id}`}
			current={current}
			onSelect={() => dispatch({ kind: "fileOpened", id: leaf.id })}
		>
			{leaf.name ?? <span className="quiet">(no name)</span>}
			<TreeView.TrailingVisual>
				<Marks leaf={leaf} />
			</TreeView.TrailingVisual>
		</TreeView.Item>
	);
}

function SectionItem({
	section,
	open,
	dispatch,
}: {
	section: SchemeSection;
	open: Id | undefined;
	dispatch: Dispatch;
}) {
	return (
		<TreeView.Item
			id={section.key}
			expanded={section.expanded}
			onExpandedChange={() =>
				dispatch({ kind: "folderToggled", folder: section.key })
			}
			containIntrinsicSize="2rem"
		>
			<TreeView.LeadingVisual>
				<TreeView.DirectoryIcon />
			</TreeView.LeadingVisual>
			{section.label}
			<TreeView.TrailingVisual>
				<span className="quiet">{section.leaves.length}</span>
			</TreeView.TrailingVisual>
			<TreeView.SubTree>
				{/* A tree node navigates; creating is the New menu's, never a node's. */}
				{section.leaves.map((leaf) => (
					<TreeView.Item
						key={leaf.id}
						id={`s:${leaf.id}`}
						current={leaf.id === open}
						onSelect={() => dispatch({ kind: "fileOpened", id: leaf.id })}
					>
						{leaf.name}
						<TreeView.TrailingVisual>
							<Marks leaf={leaf} />
						</TreeView.TrailingVisual>
					</TreeView.Item>
				))}
			</TreeView.SubTree>
		</TreeView.Item>
	);
}

function Marks({ leaf }: { leaf: Leaf | SchemeLeaf }) {
	return (
		<span className="leaf-marks">
			{leaf.draft && (
				<Label size="small" variant="attention">
					draft
				</Label>
			)}
			{!leaf.draft && leaf.unsaved && (
				<Label size="small" variant="attention">
					unsaved
				</Label>
			)}
			{leaf.failed && (
				<Label size="small" variant="danger">
					failed
				</Label>
			)}
			{leaf.busy && <Label size="small">…</Label>}
			{"usedBy" in leaf && leaf.usedBy !== undefined && (
				<span className="quiet" title="Questions naming it">
					used by {leaf.usedBy}
				</span>
			)}
			<StatusIcon status={leaf.status} />
		</span>
	);
}
