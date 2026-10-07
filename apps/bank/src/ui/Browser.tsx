/**
 * The bank as a file tree, with a filter that prunes it: questions by folder, then
 * the shared elements by kind. Everything shown is derived by tree.ts. Two trees, each
 * named by its visible heading: Tab moves between them, arrows within, as Primer's
 * TreeView guidelines describe.
 */

import { SearchIcon } from "@primer/octicons-react";
import {
	CounterLabel,
	FormControl,
	Label,
	Spinner,
	Stack,
	TextInput,
	TreeView,
} from "@primer/react";
import {
	Blankslate,
	SkeletonBox,
	SkeletonText,
} from "@primer/react/experimental";
import { SCHEME_SINGULAR, UNNAMED } from "@qretools/core/copy.js";
import type { Status } from "@qretools/core/findings.js";
import { useId } from "react";
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
	const questionsId = useId();
	const sharedId = useId();
	// Placeholder rows under the real headings while the bank loads, never the stale
	// files this browser last knew; the top bar announces the load.
	if (loading)
		return (
			<Stack gap="condensed">
				<h3 className="browser-heading">Questions</h3>
				<SkeletonText lines={6} size="bodyMedium" />
				<h3 className="browser-heading">Shared</h3>
				<SkeletonText lines={3} size="bodyMedium" />
			</Stack>
		);
	return (
		<Stack gap="condensed">
			<h3 id={questionsId} className="browser-heading">
				Questions
			</h3>
			{folders.length > 0 ? (
				<TreeView aria-labelledby={questionsId}>
					{folders.map((f) => (
						<FolderItem
							key={f.name}
							folder={f}
							open={open}
							dispatch={dispatch}
						/>
					))}
				</TreeView>
			) : (
				<Blankslate narrow>
					<Blankslate.Heading as="h4">
						{filter === "" ? "No questions yet" : "No questions match"}
					</Blankslate.Heading>
					<Blankslate.Description>
						{filter === ""
							? "Start one from New."
							: "Try another name or title."}
					</Blankslate.Description>
				</Blankslate>
			)}
			{sections.length > 0 && (
				<>
					<h3 id={sharedId} className="browser-heading">
						Shared
					</h3>
					<TreeView aria-labelledby={sharedId}>
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
		</Stack>
	);
}

/**
 * TreeView finds its slots (`TrailingVisual`) among an item's direct children, so each
 * item writes `TreeView.TrailingVisual` itself; these give only its label and content.
 */
const countLabel = (n: number, noun: string): string =>
	`${n} ${noun}${n === 1 ? "" : "s"}`;

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
			<TreeView.TrailingVisual
				label={countLabel(folder.leaves.length, "question")}
			>
				<CounterLabel>{folder.leaves.length}</CounterLabel>
			</TreeView.TrailingVisual>
			<TreeView.SubTree>
				{folder.leaves.map((leaf) => (
					<TreeView.Item
						key={leaf.id}
						id={`q:${leaf.id}`}
						current={leaf.id === open}
						onSelect={() => dispatch({ kind: "fileOpened", id: leaf.id })}
					>
						{leaf.name ?? <span className="quiet">{UNNAMED}</span>}
						<TreeView.TrailingVisual label={marksLabel(leaf)}>
							<Marks leaf={leaf} />
						</TreeView.TrailingVisual>
					</TreeView.Item>
				))}
			</TreeView.SubTree>
		</TreeView.Item>
	);
}

/** A section's count, heard: "3 scales"; the one missing-values list is there or not. */
const sectionCount = (s: SchemeSection): string =>
	s.kind === "missing"
		? s.leaves.length === 0
			? "none yet"
			: "defined"
		: countLabel(s.leaves.length, SCHEME_SINGULAR[s.kind]);

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
			<TreeView.TrailingVisual label={sectionCount(section)}>
				<CounterLabel>{section.leaves.length}</CounterLabel>
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
						<TreeView.TrailingVisual label={marksLabel(leaf)}>
							<Marks leaf={leaf} />
						</TreeView.TrailingVisual>
					</TreeView.Item>
				))}
			</TreeView.SubTree>
		</TreeView.Item>
	);
}

const STATUS_TEXT = (s: Status): string =>
	s.kind === "complete"
		? "complete"
		: s.kind === "advice"
			? s.worst === "warning"
				? "has warnings"
				: "has advice"
			: s.errors > 0
				? "has errors"
				: "has fields to fill in";

/** A file's state, heard as one phrase (the trailing visual's `label`, as Primer's guidelines ask). */
function marksLabel(leaf: Leaf | SchemeLeaf): string {
	const used = "usedBy" in leaf ? leaf.usedBy : undefined;
	return [
		leaf.draft ? "draft" : leaf.unsaved ? "unsaved" : undefined,
		leaf.failed ? "failed" : undefined,
		leaf.busy ? "saving" : undefined,
		used === undefined ? undefined : `used by ${used}`,
		STATUS_TEXT(leaf.status),
	]
		.filter((x) => x !== undefined)
		.join(", ");
}

/** A file's state beside its name, seen as labels and an icon. */
function Marks({ leaf }: { leaf: Leaf | SchemeLeaf }) {
	const used = "usedBy" in leaf ? leaf.usedBy : undefined;
	return (
		<Stack as="span" direction="horizontal" align="center" gap="condensed">
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
			{leaf.busy && <Spinner size="small" srText={null} />}
			{used !== undefined && <span className="quiet">used by {used}</span>}
			<StatusIcon status={leaf.status} />
		</Stack>
	);
}

/**
 * The filter over both trees, in the sidebar's band (which shares a row with the open
 * file's header), fixed while the trees scroll, as github.com keeps "Go to file".
 * Always there: local drafts are filterable without a bank.
 */
export function BankFilter({
	filter,
	loading,
	dispatch,
}: {
	filter: string;
	/** While the bank loads there is nothing to filter: the input's shape, not the input. */
	loading: boolean;
	dispatch: Dispatch;
}) {
	return (
		<div className="filter">
			{loading ? (
				<SkeletonBox height="var(--control-medium-size)" />
			) : (
				<FormControl>
					<FormControl.Label visuallyHidden>
						Filter the bank by name or title
					</FormControl.Label>
					<TextInput
						block
						type="search"
						leadingVisual={SearchIcon}
						placeholder="Filter by name or title"
						value={filter}
						onChange={(e) =>
							dispatch({ kind: "filterChanged", text: e.target.value })
						}
					/>
				</FormControl>
			)}
		</div>
	);
}
