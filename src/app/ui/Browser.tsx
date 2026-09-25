/**
 * The bank as a file tree, with a filter that prunes it: questions by topic, then
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
import { Blankslate, SkeletonText } from "@primer/react/experimental";
import { useId } from "react";
import type { Status } from "../../core/findings.js";
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
	return (
		<Stack gap="condensed">
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
			<h2 id={questionsId} className="browser-heading">
				Questions
			</h2>
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
			) : loading ? (
				// Placeholder rows while the bank loads; the top bar announces it.
				<SkeletonText lines={6} size="bodyMedium" />
			) : (
				<Blankslate narrow>
					<Blankslate.Heading as="h3">
						{filter === "" ? "No questions yet" : "No questions match"}
					</Blankslate.Heading>
					<Blankslate.Description>
						{filter === ""
							? "Start one from New, or connect to a bank in Bank."
							: "Try another name or title."}
					</Blankslate.Description>
				</Blankslate>
			)}
			{sections.length > 0 && (
				<>
					<h2 id={sharedId} className="browser-heading">
						Shared
					</h2>
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
						{leaf.name ?? <span className="quiet">(no name)</span>}
						<TreeView.TrailingVisual label={marksLabel(leaf)}>
							<Marks leaf={leaf} />
						</TreeView.TrailingVisual>
					</TreeView.Item>
				))}
			</TreeView.SubTree>
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
			<TreeView.TrailingVisual
				label={countLabel(section.leaves.length, "file")}
			>
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
			? "has advice"
			: s.errors > 0
				? "has errors"
				: "has holes";

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
