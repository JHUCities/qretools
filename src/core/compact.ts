/** `T` with every key that admits `undefined` made optional and `undefined`-free. */
export type Compacted<T> = {
	[K in keyof T as undefined extends T[K] ? never : K]: T[K];
} & {
	[K in keyof T as undefined extends T[K] ? K : never]?: Exclude<
		T[K],
		undefined
	>;
};

/** Drop `undefined` values so optional fields are absent, not present-and-undefined. */
export function compact<const T extends object>(obj: T): Compacted<T> {
	return Object.fromEntries(
		Object.entries(obj).filter(([, v]) => v !== undefined),
	) as Compacted<T>;
}
