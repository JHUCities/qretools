/**
 * The `qretools` command: `check` a workspace directory's findings (its questions',
 * shared files' and instruments'), as compilers report them, `export` its questions' DDI,
 * write their `codebook` (an HTML page of that DDI, or of any DDI document),
 * or `build` it: the DDI of its last commit, each item at the version its history gives. `main` takes its
 * output as values (`Io`), so it runs in a
 * test as it runs in a shell; the bin only wires it to the process.
 */
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { codebookOf, pageOf, parse as readDdi } from "@qretools/codebook";
import {
	type Address,
	addressOf,
	agencyWritten,
	type Bank,
	type BankScope,
	bankOf,
	collisions,
	type DdiDocument,
	documentOf,
	exportRefusal,
	type Finding,
	HERE,
	type Item,
	importsOf,
	inDocumentOrder,
	instrumentAt,
	instrumentOf,
	locate,
	locksFor,
	locksWritten,
	makeValidator,
	movedTags,
	notHere,
	placeFindings,
	questionItems,
	type Range,
	type Refusal,
	type RemoteBank,
	ROOT,
	remoteScope,
	remotesOf,
	type Severity,
	scopeOf,
	shortCommit,
	status,
	tagMessage,
	unlockedTags,
	versionsOf,
	WORKSPACE,
	withLocks,
	workspaceOf,
} from "@qretools/core";
import { readWorkspace } from "@qretools/core/node";
import { qsfOf, qsfRefusalReason, qsfTime } from "@qretools/qsf";
import pkg from "../package.json" with { type: "json" };
import type { HistoryRead } from "./history.ts";

/** Where the command writes: findings or the DDI on `out`, everything said to people on `err`. */
export interface Io {
	readonly out: (text: string) => void;
	readonly err: (text: string) => void;
	readonly writeFile: (path: string, text: string) => Promise<void>;
	/** A workspace in another repository, read at its tag (the command uses git: `readTagged`). */
	readonly readRemote: (address: RemoteAddress) => Promise<RemoteBank>;
	/** The workspace in a directory at its last commit, with its history (the command uses git: `readHistory`). */
	readonly readHistory: (dir: string) => Promise<HistoryRead>;
}

type RemoteAddress = Extract<Address, { kind: "remote" }>;

const USAGE = `Usage:
  qretools check [dir] [--strict]   Report a workspace's findings; fail on anything to fill in or fix
  qretools export [dir] [-o file]   Write its questions' DDI-Lifecycle 4.0 JSON
  qretools codebook [dir | file.json] [-o file] [--strict]
                                    Write a codebook, one HTML page: of its questions' DDI, or of
                                    any DDI-Lifecycle 4.0 JSON file
  qretools build [dir] [-o outdir] [--tag-message file]
                                    Write its last commit's DDI, versioned from its git history, to outdir/ddi.json (default dir/dist)
  qretools instrument check <file> [--agency <agency>] [--bank alias=dir]... [--strict]
  qretools instrument export <file> [--agency <agency>] [--bank alias=dir]... [--qsf] [-o file]

dir is the workspace's folder (default: the current directory): workspace.yaml,
questions/<folder>/, the shared folders (scales/ and so on), missing.yaml,
select_all.yaml and instruments/.
An instrument reads its own workspace (\`../\` in its \`uses\`) and other workspaces at
a tag (\`owner/repo@v1\`, with git). A tag can be moved: \`instrument export\` locks
each tag it reads at the commit read, under \`locked:\` in its workspace.yaml, and a
tag that names another commit than its lock is a warning until the next export locks it.
--bank    read an alias written as \`owner/repo@v1\` from a directory instead, to work offline.
--strict  also fail on warnings; for codebook, fail on a reference to an item the
          document doesn't have (the page is written either way).
--tag-message  also write the message a release's annotated tag carries: each file's
          version, so a workspace that uses this one at the tag reads them.
--agency  the DDI agency the instrument is published under, when it isn't its
          workspace's (workspace.yaml), as for a file outside a workspace's instruments/.
--qsf     write the instrument as a Qualtrics survey (QSF, made from its DDI) instead of
          its DDI; refused when anything in it can't be run in Qualtrics as the DDI says.`;

/** What to say when a directory holds nothing the tool reads: the wrong folder, most likely. */
const nothingIn = (dir: string): string =>
	`Nothing to read in ${dir}: a workspace has workspace.yaml, questions/<folder>/, scales/, instruments/ and so on.\n`;

/** How many files a bank read as something: its questions and shared files. */
const readIn = (bank: Bank): number =>
	Object.keys(bank.questions).length + Object.keys(bank.schemes).length;

/** Exit codes: 0 fine, 1 the workspace has problems (or can't be exported), 2 the command couldn't run. */
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
	if (
		command !== "check" &&
		command !== "export" &&
		command !== "build" &&
		command !== "codebook"
	) {
		io.err(`Unknown command \`${command}\`.\n${USAGE}\n`);
		return USAGE_ERROR;
	}
	// Each option belongs to one command; given to the other, it's a mistake, not ignored.
	const stray =
		args.values.bank !== undefined
			? "--bank"
			: args.values.agency !== undefined
				? "--agency"
				: args.values.qsf === true
					? "--qsf"
					: command !== "build" && args.values["tag-message"] !== undefined
						? "--tag-message"
						: command === "check"
							? args.values.output !== undefined && "--output"
							: command !== "codebook" &&
								args.values.strict === true &&
								"--strict";
	if (stray) {
		io.err(`\`${stray}\` isn't an option of \`${command}\`.\n${USAGE}\n`);
		return USAGE_ERROR;
	}
	if (command === "check")
		return checkWorkspace(dir, args.values.strict === true, io);
	if (command === "build")
		return build(
			dir,
			args.values.output ?? join(dir, "dist"),
			args.values["tag-message"],
			io,
		);
	const strict = args.values.strict === true;
	// A file is a DDI document, any producer's; a directory is a workspace.
	if (
		command === "codebook" &&
		(await stat(dir).then(
			(s) => s.isFile(),
			() => false,
		))
	) {
		let text: string;
		try {
			text = await readFile(dir, "utf8");
		} catch (e) {
			io.err(
				`Can't read ${dir}: ${e instanceof Error ? e.message : String(e)}\n`,
			);
			return USAGE_ERROR;
		}
		return emit(
			renderCodebook(jsonOf(text), dir, strict),
			args.values.output,
			io,
		);
	}
	let files: Readonly<Record<string, string>>;
	try {
		files = await readWorkspace(dir);
	} catch (e) {
		io.err(
			`Can't read the workspace at ${dir}: ${e instanceof Error ? e.message : String(e)}\n`,
		);
		return USAGE_ERROR;
	}
	// The export is the questions': its instruments aren't the bank's files.
	const bank = bankOf(
		Object.fromEntries(
			Object.entries(files).filter(([p]) => instrumentAt(p) === undefined),
		),
	);
	if (readIn(bank) === 0) {
		io.err(nothingIn(dir));
		return USAGE_ERROR;
	}
	return exportBank(
		bank,
		args.values.output,
		io,
		command === "codebook"
			? (document) => renderCodebook({ ok: true, value: document }, dir, strict)
			: asJson,
	);
}

/** What a command writes: the text, if any, and lines to say on stderr; `problems` fails it. */
interface Rendered {
	readonly text?: string;
	readonly lines: readonly string[];
	readonly problems: boolean;
}

/** Writes what was rendered: its lines on stderr, its text to the file or stdout. */
async function emit(
	r: Rendered,
	output: string | undefined,
	io: Io,
): Promise<number> {
	for (const line of r.lines) io.err(`${line}\n`);
	if (r.text !== undefined)
		if (output === undefined) io.out(r.text);
		else await io.writeFile(output, r.text);
	return r.problems ? PROBLEMS : OK;
}

/** The DDI as `export` writes it. */
const asJson = (document: DdiDocument): Rendered => ({
	text: `${JSON.stringify(document, null, 2)}\n`,
	lines: [],
	problems: false,
});

type Json =
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly detail: string };

/** A file's text as JSON, or why it isn't. */
const jsonOf = (text: string): Json => {
	try {
		return { ok: true, value: JSON.parse(text) };
	} catch (e) {
		return { ok: false, detail: e instanceof Error ? e.message : String(e) };
	}
};

/**
 * A DDI document as its codebook: one HTML page, and a line in `check`'s form for each
 * reference to an item the document doesn't have, since CI never reads the page. Not
 * written when it isn't a DDI document. `strict` fails on a broken reference; the page
 * is written either way. `input` names what was read: the file, or the workspace.
 */
function renderCodebook(json: Json, input: string, strict: boolean): Rendered {
	if (!json.ok)
		return {
			lines: [
				`${input}: error: Not written: this isn't JSON (${json.detail}). [codebook-unreadable]`,
			],
			problems: true,
		};
	const read = readDdi(json.value);
	if (!read.ok)
		return {
			lines: read.error.map(
				(f) => `${input}: error: Not written: ${f.message} [${f.code}]`,
			),
			problems: true,
		};
	const codebook = codebookOf(read.value);
	return {
		text: pageOf(codebook),
		lines: codebook.findings.map(
			(f) =>
				`${input}: ${LEVEL[f.severity]}: ${f.path === "" ? "" : `${f.path}: `}${f.message} [${f.code}]`,
		),
		problems: strict && codebook.findings.length > 0,
	};
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
			qsf: { type: "boolean" },
			"tag-message": { type: "string" },
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
	f: Finding<string>,
): string {
	const { line, col } = lineCol(source, locate(f, ranges)[0]);
	const what = f.severity === "hole" ? "to fill in" : f.code;
	return `${path}:${line}:${col}: ${LEVEL[f.severity]}: ${f.message} [${what}]`;
}

/** Each workspace in another repository its instruments use, read once at its tag, by key. */
const readRemotes = async (
	files: Readonly<Record<string, string>>,
	io: Io,
): Promise<Record<string, RemoteBank>> =>
	Object.fromEntries(
		await Promise.all(
			remotesOf(files).map(
				async (a): Promise<[string, RemoteBank]> => [
					a.key,
					await io.readRemote(a),
				],
			),
		),
	);

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
			`Can't read the workspace at ${dir}: ${e instanceof Error ? e.message : String(e)}\n`,
		);
		return USAGE_ERROR;
	}
	// Workspaces in other repositories, each read once at its tag; one that can't be says why on its use.
	const remote = await readRemotes(files, io);
	const ws = workspaceOf(files, { remote });
	// Each file as the workspace has it: its findings, its text, and its ranges.
	const checked: {
		readonly path: string;
		readonly findings: readonly Finding[];
		readonly ranges: Readonly<Record<string, Range>>;
		/** A YAML file read as nothing: noted, in its place among the others. */
		readonly ignored?: true;
	}[] = [];
	for (const [path, findings] of Object.entries(ws.bank.findings))
		checked.push({
			path,
			findings,
			ranges:
				ws.bank.questions[path]?.ranges ?? ws.bank.schemes[path]?.ranges ?? {},
		});
	for (const [path, { instrument }] of Object.entries(ws.instruments))
		checked.push({
			path,
			findings: instrument.findings,
			ranges: instrument.ranges,
		});
	// The root is always there, so "nothing here" is nothing read, whatever else there is.
	const read = readIn(ws.bank) + Object.keys(ws.instruments).length;
	if (read === 0) {
		io.err(nothingIn(dir));
		return USAGE_ERROR;
	}
	for (const path of ws.ignored)
		checked.push({ path, findings: [], ranges: {}, ignored: true });
	const counts = { incomplete: 0, warnings: 0, findings: 0 };
	for (const { path, findings, ranges, ignored } of checked.sort((a, b) =>
		a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
	)) {
		// Said as compilers note it, at the file's start; a note about the layout, not a
		// finding in a file, so it isn't counted among them.
		if (ignored) {
			io.out(
				`${join(dir, path)}:1:1: note: This file is read as nothing: it isn't in questions/<folder>/, a shared folder or instruments/. [ignored]\n`,
			);
			continue;
		}
		// As the user named the folder, so a problem matcher finds the file from here.
		for (const f of findings)
			io.out(`${findingLine(join(dir, path), files[path] ?? "", ranges, f)}\n`);
		const s = status(findings);
		counts.findings += findings.length;
		if (s.kind === "incomplete") counts.incomplete += 1;
		else if (s.kind === "advice" && s.worst === "warning") counts.warnings += 1;
	}
	io.err(
		`${read} files, ${counts.findings} findings: ${counts.incomplete} with something to fill in or fix, ${counts.warnings} with warnings.\n`,
	);
	return counts.incomplete > 0 || (strict && counts.warnings > 0)
		? PROBLEMS
		: OK;
}

/**
 * The workspace's questions' DDI: every question's items, keyed once. Refused, with reasons and nothing
 * written, when it would be wrong: no declared agency, two items under one identity, or
 * a document the official schema rejects. Holes don't refuse it: they leave elements out.
 * Shared items no question uses aren't in it. Written as `write` makes it: JSON, or its
 * codebook.
 */
async function exportBank(
	bank: Bank,
	output: string | undefined,
	io: Io,
	/** How the document is written: as JSON, or as a codebook. */
	write: (document: DdiDocument) => Rendered,
): Promise<number> {
	// Each question's items, made as an instrument brings them.
	const sources = Object.keys(bank.questions)
		.sort()
		.map((path): readonly [string, readonly Item[]] => {
			const ev = bank.questions[path];
			return [
				path,
				ev === undefined ? [] : questionItems(ev.draft, bank, path),
			];
		});
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
			"Not exported: the workspace declares no DDI agency (workspace.yaml, agency:).\n",
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
	return emit(write(document), output, io);
}

/**
 * `qretools build [dir]`: the workspace as committed at HEAD, each file at the version its
 * first-parent history gives (`versionsOf`), exported as `export` does to `out/ddi.json`.
 * Uncommitted changes are left out, and said to be.
 */
async function build(
	dir: string,
	out: string,
	message: string | undefined,
	io: Io,
): Promise<number> {
	const read = await io.readHistory(dir);
	if (read.kind === "unavailable") {
		io.err(`Can't build ${dir}: ${read.reason}\n`);
		return USAGE_ERROR;
	}
	if (read.uncommitted)
		io.err(
			`${dir} has uncommitted changes: they aren't built, as they have no version yet.\n`,
		);
	const versions = versionsOf(read.history);
	const bank = bankOf(
		Object.fromEntries(
			Object.entries(read.files).filter(([p]) => instrumentAt(p) === undefined),
		),
		versions,
	);
	if (readIn(bank) === 0) {
		io.err(nothingIn(dir));
		return USAGE_ERROR;
	}
	const code = await exportBank(bank, join(out, "ddi.json"), io, asJson);
	// Only for a build that exported: a refused one is no release.
	if (code === OK && message !== undefined)
		await io.writeFile(message, tagMessage(versions, pkg.version));
	return code;
}

/**
 * Why an export was refused, on stderr: the details, then one line. The core decides
 * (`exportRefusal`); these are the CLI's words for it.
 */
function refused(r: Refusal, io: Io): number {
	switch (r.kind) {
		case "noAgency":
			// The instrument's words: the workspace's export says its own before it gets here.
			io.err(
				"Not exported: the instrument has no DDI agency. It isn't in a workspace that declares one (workspace.yaml, agency:), and none is given with --agency.\n",
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
	// Imported, not read from disk, so a bundle of the command carries it.
	const { default: schema } = await import("@qretools/core/schema.json", {
		with: { type: "json" },
	});
	const validator = makeValidator(schema);
	return validator.ok ? validator.value(document) : [validator.error];
}

/**
 * `qretools instrument check|export <file>`: the instrument read against what it uses,
 * its own workspace (`../`) from the folder above it and another at its tag, or from
 * the directory `--bank` gives for it. Any other local address is refused, as the
 * workspace's own check refuses it (`resolveUses`).
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
			? (args.values.output !== undefined && "--output") ||
				(args.values.qsf === true && "--qsf")
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
				`\`--bank ${b}\` gives an alias its directory as alias=<dir>, such as --bank bas=../bas.\n`,
			);
			return USAGE_ERROR;
		}
		given.set(b.slice(0, eq), b.slice(eq + 1));
	}
	const uses = importsOf(source);
	for (const alias of given.keys())
		if (!uses.some((u) => u.alias === alias)) {
			io.err(
				`\`--bank ${alias}=…\` names nothing this instrument uses (${uses.map((u) => u.alias).join(", ") || "none"}).\n`,
			);
			return USAGE_ERROR;
		}
	// Its workspace's settings, when it's in one: the locks a moved tag is warned against,
	// and where an export locks the tags it read.
	const settingsPath =
		basename(dirname(resolve(file))) === WORKSPACE.instruments
			? join(dirname(file), HERE, ROOT.workspace)
			: undefined;
	const settings =
		settingsPath === undefined
			? undefined
			: await readFile(settingsPath, "utf8").catch(() => undefined);
	const locks = settings === undefined ? {} : locksWritten(settings);
	/** Each bank read at its tag, and the key each alias reads it by. */
	const reads: Record<string, RemoteBank> = {};
	const tagged: Record<string, string> = {};
	const banks: Record<string, BankScope> = {};
	for (const use of uses) {
		const address: Address =
			use.address === undefined
				? { kind: "invalid", reason: "it has no address." }
				: addressOf(use.address);
		const offline = given.get(use.alias);
		if (address.kind === "invalid" || address.kind === "local") {
			const why =
				address.kind === "invalid"
					? address.reason
					: address.path !== HERE
						? notHere(address.path)
						: offline !== undefined
							? `it's this instrument's own workspace (\`${HERE}\`), read from the folder above it; \`--bank\` is for one written as \`owner/repo@v1\`.`
							: // The folder above is read whole, so it must be a workspace's: the app's rule too.
								basename(dirname(resolve(file))) !== WORKSPACE.instruments
								? `\`${HERE}\` is this instrument's own workspace, and ${file} isn't in a workspace's \`${WORKSPACE.instruments}/\` folder.`
								: undefined;
			if (why !== undefined) {
				io.err(`Can't read \`${use.alias}\`: ${why}\n`);
				return USAGE_ERROR;
			}
		}
		// In another repository, with no directory given for it: read at its tag.
		if (address.kind === "remote" && offline === undefined) {
			const read = await io.readRemote(address);
			if (read.kind === "unavailable") {
				io.err(`Can't read \`${use.alias}\`: ${read.reason}\n`);
				return USAGE_ERROR;
			}
			reads[address.key] = read;
			tagged[use.alias] = address.key;
			banks[use.alias] = remoteScope(address.key, read);
			continue;
		}
		const dir = offline ?? join(dirname(file), HERE);
		try {
			const files = await readWorkspace(dir);
			banks[use.alias] = scopeOf(files);
		} catch (e) {
			io.err(
				`Can't read \`${use.alias}\` at ${dir}: ${e instanceof Error ? e.message : String(e)}\n`,
			);
			return USAGE_ERROR;
		}
	}
	// Its workspace's agency is the instrument's, as in the app and `check`: one per
	// workspace, whichever banks the instrument reads.
	const agency =
		args.values.agency ??
		(settings === undefined ? undefined : agencyWritten(settings));
	const result = instrumentOf(source, {
		banks,
		...(agency !== undefined && { agency }),
	});
	// In a workspace, `check` says a tag no lock holds, as the workspace's check does; an
	// export locks it instead, and says so.
	const moved = [
		...movedTags(tagged, reads, locks),
		...(settingsPath === undefined || command !== "check"
			? []
			: unlockedTags(tagged, reads, locks)),
	];
	if (command === "check") {
		const findings = inDocumentOrder(
			[...result.findings, ...moved],
			result.ranges,
		);
		for (const f of findings)
			io.out(`${findingLine(file, source, result.ranges, f)}\n`);
		const s = status(findings);
		io.err(`${findings.length} findings.\n`);
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
	for (const f of moved)
		io.err(`${findingLine(file, source, result.ranges, f)}\n`);
	let code = OK;
	if (args.values.qsf === true)
		code = await exportQsf(file, source, result, args, io);
	else {
		const text = `${JSON.stringify(result.ddi, null, 2)}\n`;
		if (args.values.output === undefined) io.out(text);
		else await io.writeFile(args.values.output, text);
	}
	if (code !== OK) return code;
	// Exported: the tags it read are locked at the commits read, as a build writes its lockfile.
	const next = locksFor(Object.values(tagged), reads, locks);
	if (Object.keys(next).length === 0) return OK;
	if (settingsPath === undefined) {
		io.err(
			`Not locked: ${file} isn't in a workspace's \`${WORKSPACE.instruments}/\` folder, so there's no workspace.yaml to lock its tags in.\n`,
		);
		return OK;
	}
	if (settings === undefined) {
		io.err(
			`Not locked: ${dirname(settingsPath)} has no readable workspace.yaml (a workspace needs one for its agency).\n`,
		);
		return OK;
	}
	const locked = withLocks(settings, next);
	if (locked === undefined) {
		io.err(
			`Not locked: ${settingsPath} can't be read as fields (\`qretools check\` says why).\n`,
		);
		return OK;
	}
	// Written whether the DDI went to a file or to stdout: piping it to a file is an export too.
	await io.writeFile(settingsPath, locked);
	for (const [key, commit] of Object.entries(next)) {
		const was = locks[key];
		io.err(
			was === undefined
				? `Locked \`${key}\` at \`${shortCommit(commit)}\` in ${settingsPath}.\n`
				: `[WARNING] Re-locked \`${key}\` at \`${shortCommit(commit)}\` in ${settingsPath}: the tag was moved from \`${shortCommit(was)}\`, so its questions may have changed.\n`,
		);
	}
	return OK;
}

/**
 * The instrument as a Qualtrics survey, made from its DDI: every finding said at its step,
 * and nothing written while any is an error.
 */
async function exportQsf(
	file: string,
	source: string,
	result: ReturnType<typeof instrumentOf>,
	args: ReturnType<typeof parse>,
	io: Io,
): Promise<number> {
	const made = qsfOf(result.ddi, {
		name: result.draft.name ?? basename(file, extname(file)),
		created: qsfTime(new Date()),
	});
	for (const f of placeFindings(made.findings, result.places))
		io.err(`${findingLine(file, source, result.ranges, f)}\n`);
	if (made.kind === "refused") {
		io.err(`Not exported: ${qsfRefusalReason(made.errors)}\n`);
		return PROBLEMS;
	}
	const text = `${JSON.stringify(made.qsf, null, 2)}\n`;
	if (args.values.output === undefined) io.out(text);
	else await io.writeFile(args.values.output, text);
	return OK;
}
