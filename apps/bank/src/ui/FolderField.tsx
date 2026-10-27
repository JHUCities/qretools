/**
 * The folder a question goes in. Choosing and creating are separate: a native select
 * (Primer's `Select`) of the bank's folders, whose last option, "New folder…", shows a
 * field for the new name. Every author sees a new folder, so making one is a second,
 * deliberate step, never a typo one arrow key from a real folder. (A creatable combobox
 * suits cheap things like labels, not structure.)
 *
 * The value is the Model's (the dialog dispatches it); `problem` says whether it can be
 * used. Which control shows is passing input, so it is component state.
 */
import { FormControl, Select, Stack, TextInput } from "@primer/react";
import { inlineCode } from "@qretools/shell/ui";
import { useState } from "react";

const NEW = "\u0000new";

export function FolderField({
	folder,
	folders,
	current,
	problem,
	caption,
	onChange,
}: {
	readonly folder: string;
	readonly folders: readonly string[];
	/** The folder it is in now (moving), shown but not choosable. */
	readonly current?: string;
	/** Why this folder cannot be used, or undefined. */
	readonly problem: string | undefined;
	readonly caption: React.ReactNode;
	readonly onChange: (folder: string) => void;
}) {
	const [creating, setCreating] = useState(
		folders.length === 0 || (folder !== "" && !folders.includes(folder)),
	);
	// A usable folder the bank doesn't have yet: saving creates it.
	const isNew =
		problem === undefined && folder !== "" && !folders.includes(folder);
	// Nothing chosen yet (empty, or where it is now) isn't a mistake to point at; the
	// dialog's button stays inactive anyway.
	const shown = folder === "" || folder === current ? undefined : problem;
	const message = (
		<>
			<FormControl.Caption>
				{folders.length === 0 && "The bank has no folders yet. "}
				{caption}
				{isNew && " This creates a new folder."}
			</FormControl.Caption>
			{shown !== undefined && (
				<FormControl.Validation variant="error">
					{inlineCode(shown)}
				</FormControl.Validation>
			)}
		</>
	);
	return (
		<Stack gap="normal">
			{/* With no folders there is nothing to choose: only the name. */}
			{folders.length > 0 && (
				<FormControl>
					<FormControl.Label>Folder</FormControl.Label>
					<Select
						block
						autoFocus={!creating}
						value={creating ? NEW : folder}
						onChange={(e) => {
							const v = e.target.value;
							setCreating(v === NEW);
							onChange(v === NEW ? "" : v);
						}}
					>
						{!creating && !folders.includes(folder) && (
							<Select.Option value={folder} disabled>
								Choose a folder
							</Select.Option>
						)}
						{folders.map((f) => (
							<Select.Option key={f} value={f} disabled={f === current}>
								{f === current ? `${f} (where it is now)` : f}
							</Select.Option>
						))}
						<Select.Option value={NEW}>New folder…</Select.Option>
					</Select>
					{!creating && message}
				</FormControl>
			)}
			{creating && (
				<FormControl>
					<FormControl.Label>New folder name</FormControl.Label>
					<TextInput
						block
						autoFocus
						value={folder}
						{...(shown !== undefined && {
							validationStatus: "error" as const,
						})}
						onChange={(e) => onChange(e.target.value)}
					/>
					{message}
				</FormControl>
			)}
		</Stack>
	);
}
