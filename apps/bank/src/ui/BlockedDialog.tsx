/**
 * Why a write was refused, said where the author asked: a press on an inactive write
 * button (Save, Move, Delete, Update) opens this when the reason is one that stands
 * until someone acts. The same sentence as the top bar's, then what to do about it and
 * the way to do it, as Primer asks of an inactive button: explain why, and give a path
 * forward. What blocks and what fixes it are `update`'s (`blockage`); this only says them.
 */

import { Dialog, LinkButton, Stack, VisuallyHidden } from "@primer/react";
import { inlineCode } from "@qretools/shell/ui";
import type { Dispatch, Model } from "../model.js";
import type { Blockage } from "../update.js";

export function BlockedDialog({
	blockage,
	installHref,
	settings,
	dispatch,
}: {
	readonly blockage: Extract<Blockage, { kind: "standing" }>;
	/** Where the GitHub App is installed, when this build knows its App. */
	readonly installHref: string | undefined;
	readonly settings: Model["settings"];
	readonly dispatch: Dispatch;
}) {
	const close = () => dispatch({ kind: "blockedNoticeClosed" });
	// Asking again: GitHub for what the app may do (after installing it in the other
	// tab), or for the workspace that didn't load.
	const again =
		blockage.fix === "install"
			? () => dispatch({ kind: "connectRequested", settings })
			: blockage.fix === "retryLoad"
				? () => dispatch({ kind: "bankReloadRequested" })
				: undefined;
	return (
		<Dialog
			title="This workspace can't be changed"
			onClose={close}
			footerButtons={[
				// "OK", not "Close": the dialog's own ✕ is already named Close.
				{ buttonType: "default", content: "OK", onClick: close },
				...(again === undefined
					? []
					: [
							{
								buttonType: "primary" as const,
								content: "Try again",
								onClick: again,
							},
						]),
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
