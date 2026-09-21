/**
 * Hyperscript. Strings become text nodes, so user-written question text can never
 * be interpreted as markup; nothing in the app assigns innerHTML.
 */
type Child = Node | string | null | undefined | false;
type Props = Readonly<
	Record<
		string,
		string | number | boolean | undefined | ((event: Event) => void)
	>
>;

export function h(
	tag: string,
	props: Props = {},
	...children: readonly Child[]
): HTMLElement {
	const el = document.createElement(tag);
	for (const [key, value] of Object.entries(props)) {
		if (value === undefined || value === false) continue;
		if (typeof value === "function")
			el.addEventListener(key.replace(/^on/, "").toLowerCase(), value);
		else if (key === "class") el.className = String(value);
		else el.setAttribute(key, value === true ? "" : String(value));
	}
	el.append(
		...children.filter(
			(c): c is Node | string => c !== null && c !== undefined && c !== false,
		),
	);
	return el;
}
