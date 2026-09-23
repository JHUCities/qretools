// Primer's TreeView scrolls the current item into view; jsdom has no such method.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
	Element.prototype.scrollIntoView = () => {};
}
