/** The bank as a file tree, with a filter that prunes it. Everything shown is derived by tree.ts. */
import { SearchIcon } from "@primer/octicons-react";
import { Label, TextInput, TreeView } from "@primer/react";
import { memo } from "react";
import type { Dispatch, Id } from "../model.js";
import type { Folder, Leaf } from "../tree.js";
import { StatusIcon } from "./Previews.js";

export function Browser({
	folders,
	filter,
	open,
	dispatch,
}: {
	folders: readonly Folder[];
	filter: string;
	open: Id | undefined;
	dispatch: Dispatch;
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
			{folders.length === 0 ? (
				<p className="quiet">
					{filter === ""
						? "No questions yet. Create one, or connect to the bank."
						: "No questions match."}
				</p>
			) : (
				<TreeView aria-label="Question bank">
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
		</div>
	);
}

const FolderItem = memo(function FolderItem({
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
});

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
			onSelect={() => dispatch({ kind: "questionOpened", id: leaf.id })}
		>
			{leaf.name ?? <span className="quiet">(no name)</span>}
			<TreeView.TrailingVisual>
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
					<StatusIcon status={leaf.status} />
				</span>
			</TreeView.TrailingVisual>
		</TreeView.Item>
	);
}
