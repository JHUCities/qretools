/**
 * The author is back: this tab is shown again, or its window has focus again. Both, since
 * returning from a second window gives only focus, and switching tabs in one window only
 * a visibility change. What that is worth is `update`'s to say (`tabShown`); this only
 * reports it, with the browser's own events.
 */
export function whenShown(back: () => void): void {
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "visible") back();
	});
	window.addEventListener("focus", back);
}
