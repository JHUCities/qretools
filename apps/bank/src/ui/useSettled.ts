/**
 * A value as it stood after a pause: while it keeps changing (typing), the settled
 * value stays put, so a list drawn from it does not jump under the author's eyes;
 * once it has held still for `ms`, the settled value catches up. A new `key` (another
 * file) is shown at once, never the previous file's value. `flush` catches up now:
 * for the moments the author turns to what is drawn (leaving the editor, saving,
 * reaching for the list). A view concern only: the Model is never delayed.
 */
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

export function useSettled<T>(
	value: T,
	ms: number,
	key: unknown,
): readonly [T, () => void] {
	const [settled, setSettled] = useState({ value, key });
	const latest = useRef({ value, key });
	useLayoutEffect(() => {
		latest.current = { value, key };
	});
	useEffect(() => {
		if (settled.value === value && settled.key === key) return;
		if (settled.key !== key) {
			setSettled({ value, key });
			return;
		}
		const timer = setTimeout(() => setSettled({ value, key }), ms);
		return () => clearTimeout(timer);
	}, [value, key, ms, settled]);
	const flush = useCallback(() => setSettled(latest.current), []);
	// Another file: its own value from the first render, never the last file's.
	return [settled.key === key ? settled.value : value, flush];
}
