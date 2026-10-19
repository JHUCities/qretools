/**
 * The tutorial's two sides from one source: the exercises (each lesson with its gap)
 * and the solutions (each gap filled). A line ending in `  #SOL` is on the solutions
 * side only, one ending in `  #EX` on the exercises side only (the marker removed);
 * a file named `x.sol.yaml` or `x.ex.yaml` is `x.yaml` on that side only.
 */
export type Side = "ex" | "sol";

const MARKS: Readonly<Record<Side, string>> = { ex: "  #EX", sol: "  #SOL" };
const other = (side: Side): Side => (side === "ex" ? "sol" : "ex");

/** One file's text on one side. */
export const render = (text: string, side: Side): string =>
	text
		.split("\n")
		.flatMap((line) =>
			line.endsWith(MARKS[other(side)])
				? []
				: [
						line.endsWith(MARKS[side])
							? line.slice(0, -MARKS[side].length).trimEnd()
							: line,
					],
		)
		.join("\n");

/** A source path on one side: its published path, or undefined if it isn't there. */
export const pathOn = (path: string, side: Side): string | undefined => {
	const one = /^(.*)\.(ex|sol)(\.[^./]+)$/.exec(path);
	if (one === null) return path;
	return one[2] === side ? `${one[1]}${one[3]}` : undefined;
};

/** Every source file on one side, by its published path. */
export const sideOf = (
	source: Readonly<Record<string, string>>,
	side: Side,
): Record<string, string> => {
	const out: Record<string, string> = {};
	for (const [path, text] of Object.entries(source)) {
		const at = pathOn(path, side);
		if (at !== undefined) out[at] = render(text, side);
	}
	return out;
};
