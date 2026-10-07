/**
 * The `qretools` command: `check` a bank directory's findings, as compilers report
 * them, or `export` its DDI. `main` takes its output as values (`Io`), so it runs in a
 * test as it runs in a shell; the bin only wires it to the process.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { collisions, documentOf, type Item } from "../ddi/document.ts";
import { makeValidator } from "../ddi/validate.ts";
import { type Bank, bankOf } from "../evaluate.ts";
import {
	type Finding,
	locate,
	type Range,
	type Severity,
	status,
} from "../findings.ts";
import { readBank } from "./index.ts";

/** Where the command writes: findings or the DDI on `out`, everything said to people on `err`. */
export interface Io {
	readonly out: (text: string) => void;
	readonly err: (text: string) => void;
	readonly writeFile: (path: string, text: string) => Promise<void>;
}

const USAGE = `Usage:
  qretools check [dir] [--strict]   Report a bank's findings; fail on anything to fill in or fix
  qretools export [dir] [-o file]   Write the bank's DDI-Lifecycle 4.0 JSON

dir is the bank's folder (default: the current directory).
--strict  also fail on warnings.`;

/** Exit codes: 0 fine, 1 the bank has problems (or can't be exported), 2 the command couldn't run. */
const OK = 0;
const PROBLEMS = 1;
const USAGE_ERROR = 2;

export async function main(argv: readonly string[], io: Io): Promise<number> {
	let args: ReturnType<typeof parse>;
	try {
		args = parse(argv);
	} catch (e) {
		io.err(`${e instanceof Error ? e.message : String(e)}\n${USAGE}\n`);
		return USAGE_ERROR;
	}
	const [command, dir = ".", ...extra] = args.positionals;
	if (args.values.help || command === undefined || extra.length > 0) {
		(args.values.help ? io.out : io.err)(`${USAGE}\n`);
		return args.values.help ? OK : USAGE_ERROR;
	}
	if (command !== "check" && command !== "export") {
		io.err(`Unknown command \`${command}\`.\n${USAGE}\n`);
		return USAGE_ERROR;
	}
	// Each option belongs to one command; given to the other, it's a mistake, not ignored.
	const stray =
		command === "check"
			? args.values.output !== undefined && "--output"
			: args.values.strict === true && "--strict";
	if (stray) {
		io.err(`\`${stray}\` isn't an option of \`${command}\`.\n${USAGE}\n`);
		return USAGE_ERROR;
	}
	let files: Readonly<Record<string, string>>;
	try {
		files = await readBank(dir);
	} catch (e) {
		io.err(
			`Can't read the bank at ${dir}: ${e instanceof Error ? e.message : String(e)}\n`,
		);
		return USAGE_ERROR;
	}
	if (Object.keys(files).length === 0) {
		io.err(
			`No bank files in ${dir}: a bank has questions/, scales/, bank.yaml and so on.\n`,
		);
		return USAGE_ERROR;
	}
	const bank = bankOf(files);
	return command === "check"
		? check(bank, files, dir, args.values.strict === true, io)
		: exportBank(bank, args.values.output, io);
}

function parse(argv: readonly string[]) {
	return parseArgs({
		args: [...argv],
		allowPositionals: true,
		strict: true,
		options: {
			strict: { type: "boolean" },
			output: { type: "string", short: "o" },
			help: { type: "boolean", short: "h" },
		},
	});
}

/** As compilers write it, so editors and CI annotate it: `error`, `warning`, `note`. */
const LEVEL: Readonly<Record<Severity, string>> = {
	hole: "error",
	error: "error",
	warning: "warning",
	info: "note",
};

/** A 1-based line and column (UTF-16 units, as editors count) of an offset. */
export function lineCol(
	source: string,
	offset: number,
): { readonly line: number; readonly col: number } {
	const before = source.slice(0, offset);
	const lines = before.split("\n");
	return { line: lines.length, col: (lines.at(-1)?.length ?? 0) + 1 };
}

/** One finding as a line: `path:line:col: level: message [code]`; a hole says "to fill in". */
export function findingLine(
	path: string,
	source: string,
	ranges: Readonly<Record<string, Range>>,
	f: Finding,
): string {
	const { line, col } = lineCol(source, locate(f, ranges)[0]);
	const what = f.severity === "hole" ? "to fill in" : f.code;
	return `${path}:${line}:${col}: ${LEVEL[f.severity]}: ${f.message} [${what}]`;
}

function check(
	bank: Bank,
	files: Readonly<Record<string, string>>,
	dir: string,
	strict: boolean,
	io: Io,
): number {
	const counts = { incomplete: 0, warnings: 0, findings: 0 };
	for (const path of Object.keys(bank.findings).sort()) {
		const findings = bank.findings[path] ?? [];
		const ranges =
			bank.questions[path]?.ranges ?? bank.schemes[path]?.ranges ?? {};
		// As the user named the bank, so a problem matcher finds the file from here.
		for (const f of findings)
			io.out(`${findingLine(join(dir, path), files[path] ?? "", ranges, f)}\n`);
		const s = status(findings);
		counts.findings += findings.length;
		if (s.kind === "incomplete") counts.incomplete += 1;
		else if (s.kind === "advice" && s.worst === "warning") counts.warnings += 1;
	}
	const read =
		Object.keys(bank.questions).length + Object.keys(bank.schemes).length;
	io.err(
		`${read} files, ${counts.findings} findings: ${counts.incomplete} with something to fill in or fix, ${counts.warnings} with warnings.\n`,
	);
	return counts.incomplete > 0 || (strict && counts.warnings > 0)
		? PROBLEMS
		: OK;
}

/**
 * The bank's DDI: every question's items, keyed once. Refused, with reasons and nothing
 * written, when it would be wrong: no declared agency, two items under one identity, or
 * a document the official schema rejects. Holes don't refuse it: they leave elements out.
 * Shared items no question uses aren't in it.
 */
async function exportBank(
	bank: Bank,
	output: string | undefined,
	io: Io,
): Promise<number> {
	if (bank.agency === undefined) {
		io.err(
			"Not exported: the bank declares no DDI agency (bank.yaml, agency:).\n",
		);
		return PROBLEMS;
	}
	// Each question's items as `bankOf` elaborated them (its versions included).
	const sources = Object.keys(bank.questions)
		.sort()
		.map((path): readonly [string, readonly Item[]] => [
			path,
			bank.questions[path]?.items ?? [],
		]);
	const incomplete = Object.entries(bank.findings).filter(
		([, findings]) => status(findings).kind === "incomplete",
	).length;
	if (incomplete > 0)
		io.err(
			`${incomplete} files have something to fill in or fix; what they lack is left out of the DDI (\`qretools check\` lists it).\n`,
		);
	const clashes = collisions(sources);
	if (clashes.length > 0) {
		for (const c of clashes)
			io.err(`${c.urn} names different items in ${c.keys.join(", ")}\n`);
		io.err("Not exported: items would share an identity.\n");
		return PROBLEMS;
	}
	const document = documentOf(sources.flatMap(([, items]) => items));
	const schema = JSON.parse(
		await readFile(
			new URL("../../ddi/ddi-lifecycle-4.0-beta4.schema.json", import.meta.url),
			"utf8",
		),
	);
	const validator = makeValidator(schema);
	const problems = validator.ok ? validator.value(document) : [validator.error];
	if (problems.length > 0) {
		for (const p of problems)
			io.err(`${p.message}${p.detail ? ` (${p.detail})` : ""}\n`);
		io.err("Not exported: the DDI doesn't match the official schema.\n");
		return PROBLEMS;
	}
	const text = `${JSON.stringify(document, null, 2)}\n`;
	if (output === undefined) io.out(text);
	else await io.writeFile(output, text);
	return OK;
}
