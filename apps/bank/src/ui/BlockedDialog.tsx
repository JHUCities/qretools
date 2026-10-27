/**
 * Says why a save was refused. Pressing an inactive Save, Move, Delete or Update opens
 * it when the reason lasts until someone acts. It repeats the top bar's sentence, then
 * says what to do, as Primer asks of an inactive button. `update` decides both
 * (`blockage`); this only shows them.
 */

import { Dialog, LinkButton, Stack, VisuallyHidden } from "@primer/react";
import { inlineCode } from "@qretools/shell/ui";
import type { Dispatch } from "../model.js";
import type { Blockage } from "../update.js";

export function BlockedDialog({
	blockage,
	installHref,
	checking,
	dispatch,
}: {
	readonly blockage: Extract<Blockage, { kind: "standing" }>;
	/** Where the GitHub App is installed, when this build knows its App. */
	readonly installHref: string | undefined;
	/** GitHub is being asked again, because "Try again" was pressed. */
	readonly checking: boolean;
	readonly dispatch: Dispatch;
}) {
	const close = () => dispatch({ kind: "blockedNoticeClosed" });
	// Ask GitHub again: what the app may do now (after an install or a grant of access),
	// or for the workspace that didn't load. The notice stays until GitHub answers.

	const again = () =>
		dispatch({
			kind:
				blockage.fix === "retryLoad"
					? "bankReloadRequested"
					: "accessCheckRequested",
		});
	return (
		<Dialog
			title="This workspace can't be changed"
			onClose={close}
			footerButtons={[
				// "OK", not "Close": the dialog's own ✕ is already named Close.
				{ buttonType: "default", content: "OK", onClick: close },
				{
					buttonType: "primary",
					content: "Try again",
					loading: checking,
					onClick: again,
				},
			]}
		>
			<Stack gap="normal">
				<p className="blocked-reason">
					{inlineCode(`${blockage.reason}.`)}
					{blockage.hint !== undefined && <> {inlineCode(blockage.hint)}</>}
				</p>
				{blockage.fix === "install" && installHref !== undefined && (
					<div>
						<LinkButton href={installHref} target="_blank" rel="noreferrer">
							Install the app
							<VisuallyHidden> (opens in a new tab)</VisuallyHidden>
						</LinkButton>
					</div>
				)}
			</Stack>
		</Dialog>
	);
}
