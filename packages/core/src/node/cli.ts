/**
 * The `qretools` command: `check` a workspace directory's findings (its banks', its
 * instruments' and its own file's), as compilers report them, or `export` a bank's DDI. `main` takes its output as values (`Io`), so it runs in a
 * test as it runs in a shell; the bin only wires it to the process.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { addressOf } from "../address.ts";
import {
	collisions,
	type DdiDocument,
	documentOf,
	type Item,
} from "../ddi/document.ts";
import { makeValidator } from "../ddi/validate.ts";
import { type Bank, bankOf } from "../evaluate.ts";
import {
	type Finding,
	locate,
	type Range,
	type Severity,
	status,
} from "../findings.ts";
import { importsOf, instrumentOf } from "../instrument/instrument.ts";
import { exportRefusal, type Refusal } from "../refusal.ts";
import { type RemoteBank, remotesOf, workspaceOf } from "../workspace.ts";
import { WORKSPACE } from "../workspacefile.ts";
import { readBank, readWorkspace } from "./index.ts";

/** Where the command writes: findings or the DDI on `out`, everything said to people on `err`. */
export interface Io {
	readonly out: (text: string) => void;
	readonly err: (text: string) => void;
	readonly writeFile: (path: string, text: string) => Promise<void>;
}

const USAGE = `Usage:
  qretools check [dir] [--strict]   Report a bank's or workspace's findings; fail on anything to fill in or fix
  qretools export [dir] [-o file]   Write the bank's DDI-Lifecycle 4.0 JSON
  qretools instrument check <file> [--agency <agency>] [--bank alias=dir]... [--strict]
  qretools instrument export <file> --agency <agency> [--bank alias=dir]... [-o file]

dir is the bank's or workspace's folder (default: the current directory). A workspace
holds banks (each a folder with bank.yaml, or its root), instruments/ and workspace.yaml.
An instrument's banks are read from the folders its \`uses\` names by relative path
(\`./banks/x\`), or from --bank for an alias.
--strict  also fail on warnings.
--agency  the DDI agency the instrument is published under.`;

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
	if (args.positionals[0] === "instrument") return instrument(args, io);
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
		args.values.bank !== undefined
			? "--bank"
			: args.values.agency !== undefined
				? "--agency"
				: command === "check"
					? args.values.output !== undefined && "--output"
					: args.values.strict === true && "--strict";
	if (stray) {
		io.err(`\`${stray}\` isn't an option of \`${command}\`.\n${USAGE}\n`);
		return USAGE_ERROR;
	}
	if (command === "check")
		return checkWorkspace(dir, args.values.strict === true, io);
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
	return exportBank(bankOf(files), args.values.output, io);
}

function parse(argv: readonly string[]) {
	return parseArgs({
		args: [...argv],
		allowPositionals: true,
		strict: true,
		options: {
			strict: { type: "boolean" },
			output: { type: "string", short: "o" },
			bank: { type: "string", multiple: true },
			agency: { type: "string" },
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

/** The workspace in `dir`, checked: every file's findings in path order, then a count. */
async function checkWorkspace(
	dir: string,
	strict: boolean,
	io: Io,
): Promise<number> {
	let files: Readonly<Record<string, string>>;
	try {
		files = await readWorkspace(dir);
	} catch (e) {
		io.err(
			`Can't read the bank at ${dir}: ${e instanceof Error ? e.message : String(e)}\n`,
		);
		return USAGE_ERROR;
	}
	// Banks in other repositories aren't fetched here yet: each says so on its use.
	const remote = Object.fromEntries(
		remotesOf(files).map((a): [string, RemoteBank] => [
			a.key,
			{
				kind: "unavailable",
				reason: `\`${a.owner}/${a.repo}${a.path === "" ? "" : `/${a.path}`}@${a.ref}\` is in another repository, which \`qretools check\` doesn't read yet.`,
			},
		]),
	);
	const ws = workspaceOf(files, { remote });
	// Each file as the workspace has it: its findings, its text, and its ranges.
	const checked: {
		readonly path: string;
		readonly findings: readonly Finding[];
		readonly ranges: Readonly<Record<string, Range>>;
	}[] = [];
	for (const [folder, bank] of Object.entries(ws.banks))
		for (const [path, findings] of Object.entries(bank.findings))
			checked.push({
				path: folder === "" ? path : `${folder}/${path}`,
				findings,
				ranges:
					bank.questions[path]?.ranges ?? bank.schemes[path]?.ranges ?? {},
			});
	for (const [path, { instrument }] of Object.entries(ws.instruments))
		checked.push({
			path,
			findings: instrument.findings,
			ranges: instrument.ranges,
		});
	if (ws.file !== undefined)
		checked.push({
			path: WORKSPACE.file,
			findings: ws.file.findings,
			ranges: ws.file.ranges,
		});
	if (checked.length === 0) {
		io.err(
			`No bank files in ${dir}: a bank has questions/, scales/, bank.yaml and so on.\n`,
		);
		return USAGE_ERROR;
	}
	const counts = { incomplete: 0, warnings: 0, findings: 0 };
	for (const { path, findings, ranges } of checked.sort((a, b) =>
		a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
	)) {
		// As the user named the folder, so a problem matcher finds the file from here.
		for (const f of findings)
			io.out(`${findingLine(join(dir, path), files[path] ?? "", ranges, f)}\n`);
		const s = status(findings);
		counts.findings += findings.length;
		if (s.kind === "incomplete") counts.incomplete += 1;
		else if (s.kind === "advice" && s.worst === "warning") counts.warnings += 1;
	}
	// A YAML file read as nothing, said as compilers note it, at its start.
	for (const path of ws.ignored) {
		io.out(
			`${join(dir, path)}:1:1: note: This file is read as nothing: it isn't in a bank's folders or instruments/. [ignored]\n`,
		);
		counts.findings += 1;
	}
	const read =
		Object.values(ws.banks).reduce(
			(n, b) =>
				n + Object.keys(b.questions).length + Object.keys(b.schemes).length,
			0,
		) +
		Object.keys(ws.instruments).length +
		(ws.file === undefined ? 0 : 1);
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
	// Each question's items as `bankOf` elaborated them (its versions included).
	const sources = Object.keys(bank.questions)
		.sort()
		.map((path): readonly [string, readonly Item[]] => [
			path,
			bank.questions[path]?.items ?? [],
		]);
	const document = documentOf(sources.flatMap(([, items]) => items));
	const refusal = exportRefusal(
		{
			...(bank.agency !== undefined && { agency: bank.agency }),
			collisions: collisions(sources),
		},
		await validate(document),
	);
	if (refusal?.kind === "noAgency") {
		io.err(
			"Not exported: the bank declares no DDI agency (bank.yaml, agency:).\n",
		);
		return PROBLEMS;
	}
	const incomplete = Object.entries(bank.findings).filter(
		([, findings]) => status(findings).kind === "incomplete",
	).length;
	if (incomplete > 0)
		io.err(
			`${incomplete} files have something to fill in or fix; what they lack is left out of the DDI (\`qretools check\` lists it).\n`,
		);
	if (refusal !== undefined) return refused(refusal, io);
	const text = `${JSON.stringify(document, null, 2)}\n`;
	if (output === undefined) io.out(text);
	else await io.writeFile(output, text);
	return OK;
}

/**
 * Why an export was refused, on stderr: the details, then one line. The core decides
 * (`exportRefusal`); these are the CLI's words for it.
 */
function refused(r: Refusal, io: Io): number {
	switch (r.kind) {
		case "noAgency":
			// The instrument's words: the bank export says its own before it gets here.
			io.err(
				"Not exported: give the DDI agency the instrument is published under, with --agency.\n",
			);
			break;
		case "invalidAgency":
			for (const f of r.findings) io.err(`${f.message}\n`);
			io.err("Not exported: every item needs a real DDI agency.\n");
			break;
		case "collisions":
			for (const c of r.collisions)
				io.err(`${c.urn} names different items in ${c.keys.join(", ")}\n`);
			io.err("Not exported: items would share an identity.\n");
			break;
		// The CLI always runs the schema first, so `unchecked` can't arrive; were it to,
		// it isn't exported for the schema's sake.
		case "unchecked":
		case "schema":
			for (const p of r.kind === "schema" ? r.problems : [])
				io.err(`${p.message}${p.detail ? ` (${p.detail})` : ""}\n`);
			io.err("Not exported: the DDI doesn't match the official schema.\n");
			break;
		default:
			return r satisfies never;
	}
	return PROBLEMS;
}

/** The official DDI schema's problems with a document, the schema read beside this module. */
async function validate(document: DdiDocument): Promise<readonly Finding[]> {
	const schema = JSON.parse(
		await readFile(
			new URL("../../ddi/ddi-lifecycle-4.0-beta4.schema.json", import.meta.url),
			"utf8",
		),
	);
	const validator = makeValidator(schema);
	return validator.ok ? validator.value(document) : [validator.error];
}

/**
 * `qretools instrument check|export <file>`: the instrument read against its banks,
 * each read from the folder `uses` names by relative path or `--bank` gives.
 */
async function instrument(
	args: ReturnType<typeof parse>,
	io: Io,
): Promise<number> {
	const [, command, file, ...extra] = args.positionals;
	if (
		(command !== "check" && command !== "export") ||
		file === undefined ||
		extra.length > 0
	) {
		io.err(`${USAGE}\n`);
		return USAGE_ERROR;
	}
	const stray =
		command === "check"
			? args.values.output !== undefined && "--output"
			: args.values.strict === true && "--strict";
	if (stray) {
		io.err(
			`\`${stray}\` isn't an option of \`instrument ${command}\`.\n${USAGE}\n`,
		);
		return USAGE_ERROR;
	}
	let source: string;
	try {
		source = (await readFile(file, "utf8")).replaceAll("\r\n", "\n");
	} catch (e) {
		io.err(
			`Can't read ${file}: ${e instanceof Error ? e.message : String(e)}\n`,
		);
		return USAGE_ERROR;
	}
	const given = new Map<string, string>();
	for (const b of args.values.bank ?? []) {
		const eq = b.indexOf("=");
		if (eq <= 0 || eq === b.length - 1) {
			io.err(
				`\`--bank ${b}\` names a bank as alias=<dir>, such as --bank bas=../banks/bas.\n`,
			);
			return USAGE_ERROR;
		}
		given.set(b.slice(0, eq), b.slice(eq + 1));
	}
	const uses = importsOf(source);
	for (const alias of given.keys())
		if (!uses.some((u) => u.alias === alias)) {
			io.err(
				`\`--bank ${alias}=…\` names no bank this instrument uses (${uses.map((u) => u.alias).join(", ") || "none"}).\n`,
			);
			return USAGE_ERROR;
		}
	const banks: Record<string, Bank> = {};
	for (const use of uses) {
		const address =
			use.address === undefined ? undefined : addressOf(use.address);
		const dir =
			given.get(use.alias) ??
			(address?.kind === "local"
				? join(dirname(file), address.path)
				: undefined);
		if (dir === undefined) {
			io.err(
				`Can't read \`${use.alias}\` (${use.address ?? "no address"}) yet: give its folder with --bank ${use.alias}=<dir>.\n`,
			);
			return USAGE_ERROR;
		}
		try {
			banks[use.alias] = bankOf(await readBank(dir));
		} catch (e) {
			io.err(
				`Can't read the bank \`${use.alias}\` at ${dir}: ${e instanceof Error ? e.message : String(e)}\n`,
			);
			return USAGE_ERROR;
		}
	}
	const result = instrumentOf(source, {
		banks,
		...(args.values.agency !== undefined && { agency: args.values.agency }),
	});
	if (command === "check") {
		for (const f of result.findings)
			io.out(`${findingLine(file, source, result.ranges, f)}\n`);
		const s = status(result.findings);
		io.err(`${result.findings.length} findings.\n`);
		return s.kind === "incomplete" ||
			(args.values.strict === true &&
				s.kind === "advice" &&
				s.worst === "warning")
			? PROBLEMS
			: OK;
	}
	const refusal = exportRefusal(result, await validate(result.ddi));
	if (refusal !== undefined) return refused(refusal, io);
	if (status(result.findings).kind === "incomplete")
		io.err(
			"The instrument has something to fill in or fix; what it lacks is left out of the DDI (`qretools instrument check` lists it).\n",
		);
	const text = `${JSON.stringify(result.ddi, null, 2)}\n`;
	if (args.values.output === undefined) io.out(text);
	else await io.writeFile(args.values.output, text);
	return OK;
}
