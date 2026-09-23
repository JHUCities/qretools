/**
 * A scheme file is named before it exists: the name is its filename and the word
 * questions write to use it, so it is chosen deliberately, once. The reason a name
 * cannot be used is policy from `update`, shown as the author types.
 */
import { AlertIcon } from "@primer/octicons-react";
import { Dialog, FormControl, TextInput } from "@primer/react";
import { schemePath } from "../../core/schemes.js";
import type { NamedScheme } from "../../core/surface/env.js";
import type { Dispatch } from "../model.js";
import { inlineCode } from "./Previews.js";

const EXAMPLES: Readonly<Record<NamedScheme, string>> = {
	scale: "agree5",
	universe: "renters",
	instruction: "select_all",
};

export function SchemeNameDialog({
	kind,
	name,
	problem,
	dispatch,
}: {
	readonly kind: NamedScheme;
	readonly name: string;
	readonly problem: string | undefined;
	readonly dispatch: Dispatch;
}) {
	const close = () => dispatch({ kind: "schemeCreateCancelled" });
	return (
		<Dialog
			title={`New ${kind}`}
			onClose={close}
			footerButtons={[
				{ buttonType: "default", content: "Cancel", onClick: close },
				{
					buttonType: "primary",
					content: "Create",
					disabled: problem !== undefined,
					onClick: () => dispatch({ kind: "schemeCreateConfirmed" }),
				},
			]}
		>
			<FormControl>
				<FormControl.Label>Name</FormControl.Label>
				<TextInput
					block
					autoFocus
					value={name}
					placeholder={EXAMPLES[kind]}
					aria-label="Name"
					onChange={(e) =>
						dispatch({ kind: "schemeNameChanged", name: e.target.value })
					}
					onKeyDown={(e) => {
						if (e.key === "Enter" && problem === undefined)
							dispatch({ kind: "schemeCreateConfirmed" });
					}}
				/>
				<FormControl.Caption>
					Questions use it by writing this name, e.g.{" "}
					<code>
						{kind === "scale" ? "responses" : kind}: {name || EXAMPLES[kind]}
					</code>
					.
				</FormControl.Caption>
			</FormControl>
			<p className="save-path">
				{problem === undefined ? (
					<code>{schemePath(kind, name)}</code>
				) : (
					name !== "" && (
						<span className="fg-danger">
							<AlertIcon size={14} /> {inlineCode(problem)}
						</span>
					)
				)}
			</p>
		</Dialog>
	);
}
