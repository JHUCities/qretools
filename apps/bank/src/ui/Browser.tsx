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
import {
	absentRoot,
	type Finding,
	isRoot,
	SCHEME_SINGULAR,
	type Status,
	status,
	UNNAMED,
} from "@qretools/core";
import { StatusIcon } from "@qretools/shell/ui";
import { useId } from "react";
import type { Dispatch, Id } from "../model.js";
import type { Folder, Leaf, SchemeLeaf, SchemeSection } from "../tree.js";

/** One bank's part of the tree: its questions by folder, and its shared files by kind. */
export interface BankTree {
	/** The bank's folder in the workspace, "" for its root. */
	readonly bank: string;
	readonly folders: readonly Folder[];
	readonly sections: readonly SchemeSection[];
}

/** How a bank is named where several are shown: by its folder; the root by its place. */
export const bankLabel = (bank: string): string =>
	bank === "" ? "Workspace root" : bank;

export function Browser({
	banks,
	workspace = [],
	workspaceOnly = false,
	filter,
	open,
	dispatch,
	loading = false,
}: {
	banks: readonly BankTree[];
	/** The workspace's own files (`workspaceLeaves`): its instruments and its details. */
	workspace?: readonly SchemeLeaf[];
	/** The workspace has no bank of its own: only its instruments and details are shown. */
	workspaceOnly?: boolean;
	filter: string;
	open: Id | undefined;
	dispatch: Dispatch;
	/** The workspace is being read from GitHub: an empty tree means "not yet", not "none". */
	loading?: boolean;
}) {
	// Placeholder rows under the real headings while the workspace loads, never the
	// stale files this browser last knew; the top bar announces the load.
	if (loading)
		return (
			<Stack gap="condensed">
				<h3 className="browser-heading">Questions</h3>
				<SkeletonText lines={6} size="bodyMedium" />
				<h3 className="browser-heading">Shared</h3>
				<SkeletonText lines={3} size="bodyMedium" />
			</Stack>
		);
	const [only] = banks;
	// What is asked comes first, then what it is asked from.
	const instruments = workspace.length > 0 && (
		<Instruments leaves={workspace} open={open} dispatch={dispatch} />
	);
	if (workspaceOnly)
		return <Instruments leaves={workspace} open={open} dispatch={dispatch} />;
	// One bank, as a bank has always been shown: its questions, then its shared files.
	if (banks.length <= 1) {
		const trees = (
			<BankTrees
				tree={only ?? { bank: "", folders: [], sections: [] }}
				level={3}
				filter={filter}
				open={open}
				dispatch={dispatch}
			/>
		);
		return instruments ? (
			<Stack gap="normal">
				{instruments}
				{trees}
			</Stack>
		) : (
			trees
		);
	}
	// Several: each bank under its own heading, one level down.
	return (
		<Stack gap="normal">
			{instruments}
			{banks.map((tree) => (
				<BankSection
					key={tree.bank}
					tree={tree}
					filter={filter}
					open={open}
					dispatch={dispatch}
				/>
			))}
		</Stack>
	);
}

/** The workspace's instruments and its details: one flat tree, named by its heading. */
function Instruments({
	leaves,
	open,
	dispatch,
}: {
	leaves: readonly SchemeLeaf[];
	open: Id | undefined;
	dispatch: Dispatch;
}) {
	const id = useId();
	return (
		<Stack gap="condensed">
			<h3 id={id} className="browser-heading">
				Instruments
			</h3>
			<TreeView aria-labelledby={id}>
				{leaves.map((leaf) => (
					<TreeView.Item
						key={leaf.id}
						id={`w:${leaf.id}`}
						current={leaf.id === open}
						onSelect={() => dispatch({ kind: "fileOpened", id: leaf.id })}
					>
						{leaf.name}
						<TreeView.TrailingVisual label={marksLabel(leaf)}>
							<Marks leaf={leaf} />
						</TreeView.TrailingVisual>
					</TreeView.Item>
				))}
			</TreeView>
		</Stack>
	);
}

function BankSection({
	tree,
	filter,
	open,
	dispatch,
}: {
	tree: BankTree;
	filter: string;
	open: Id | undefined;
	dispatch: Dispatch;
}) {
	const id = useId();
	return (
		<section aria-labelledby={id}>
			<h3 id={id} className="browser-bank">
				{bankLabel(tree.bank)}
			</h3>
			<BankTrees
				tree={tree}
				level={4}
				filter={filter}
				open={open}
				dispatch={dispatch}
			/>
		</section>
	);
}

/** A bank's two trees, each named by its visible heading. */
function BankTrees({
	tree,
	level,
	filter,
	open,
	dispatch,
}: {
	tree: BankTree;
	level: 3 | 4;
	filter: string;
	open: Id | undefined;
	dispatch: Dispatch;
}) {
	const questionsId = useId();
	const sharedId = useId();
	const H = level === 3 ? "h3" : "h4";
	const { folders, sections } = tree;
	return (
		<Stack gap="condensed">
			<H id={questionsId} className="browser-heading">
				Questions
			</H>
			{folders.length > 0 ? (
				<TreeView aria-labelledby={questionsId}>
					{folders.map((f) => (
						<FolderItem
							key={f.key}
							folder={f}
							open={open}
							dispatch={dispatch}
						/>
					))}
				</TreeView>
			) : (
				<Blankslate narrow>
					<Blankslate.Heading as={level === 3 ? "h4" : "h5"}>
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
					<H id={sharedId} className="browser-heading">
						Shared
					</H>
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
			id={`folder:${folder.key}`}
			expanded={folder.expanded}
			onExpandedChange={() =>
				dispatch({ kind: "folderToggled", folder: folder.key })
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

/**
 * What an absent root file means for the bank, by the core's rule (`absentRoot`):
 * findings for a required one, none for an optional one.
 */
const absent = (s: SchemeSection): readonly Finding[] =>
	isRoot(s.kind) && s.leaves.length === 0 ? absentRoot(s.kind) : [];

/** A section's count, heard: "3 scales"; a bank's one root file is there or not. */
const sectionCount = (s: SchemeSection): string =>
	isRoot(s.kind)
		? s.leaves.length > 0
			? "defined"
			: absent(s).length > 0
				? `none yet, ${STATUS_TEXT(status(absent(s)))}`
				: "none yet"
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
				{absent(section).length > 0 ? (
					<StatusIcon status={status(absent(section))} />
				) : (
					<CounterLabel>{section.leaves.length}</CounterLabel>
				)}
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
