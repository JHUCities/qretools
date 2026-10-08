/**
 * Pure caches. Not state: the same inputs always give the same outputs; the caches
 * only save work.
 *
 * Each bank's environment is memoised on the list of its own scheme entries, element
 * by element, as Elm's `lazy` does on a reference. That is exact because entries are
 * immutable values: editing a question replaces no scheme entry, and editing a scale
 * replaces only that scale's entry, so every other bank's list holds the same
 * references and keeps its environment, and its questions their evaluations.
 *
 * An instrument is read against the banks it uses as they are being edited: each
 * bank's scope (`bankFrom`) is built from the evaluations kept here, and kept for as
 * long as they are, so a keystroke in one bank re-reads only the instruments that use it.
 */
import {
	type AddressKey,
	type BankScope,
	bankFrom,
	type Env,
	type Evaluation,
	evaluate,
	evaluateScheme,
	type InstrumentIn,
	importsOf,
	instrumentIn,
	instrumentPath,
	type RemoteBank,
	relIn,
	resolveUses,
	type SchemeEvaluation,
	type SchemeFileEvaluation,
	scopeOf,
	type WorkspaceFile,
	workspaceFileOf,
} from "@qretools/core";
import { questionJsonSchema } from "@qretools/core/editor";
import {
	envOf,
	type Id,
	type InstrumentEntry,
	knownBank,
	type Model,
	type Question,
	type SchemeEntry,
	schemesOf,
} from "./model.js";
import { claimOf } from "./sync.js";

/** The slices of the Model a bank's or an instrument's evaluation reads. */
type Slices = Pick<Model, "local" | "remote" | "banks">;
/** An instrument also reads the banks in other repositories read so far. */
type WorkspaceSlices = Slices & Pick<Model, "remoteBanks">;

export interface Evaluations {
	/** A bank's environment, from the model's slices it is built from. */
	env(model: Slices, bank: string): Env;
	/**
	 * What an instrument reads of a bank: its working copies, unsaved edits included.
	 * A question never saved has no path, so no instrument can ask it until it is.
	 */
	scope(model: Slices, bank: string): BankScope;
	/** `workspace.yaml` as it is being edited; absent while the workspace has none. */
	workspaceFile(model: Slices): WorkspaceFile | undefined;
	/**
	 * The banks in other repositories as an instrument is given them: each read one's
	 * files or why not (one still being read is left out, so it reads as pending), and
	 * the read ones' scopes, each evaluated once per read.
	 */
	remote(model: Pick<Model, "remoteBanks">): RemoteGiven;
	/** An instrument, read against the banks it uses as they are being edited. */
	instrument(model: WorkspaceSlices, e: InstrumentEntry): InstrumentIn;
	/** The banks an instrument uses that are in this workspace, by its alias for each: what completion offers. */
	usedScopes(
		model: WorkspaceSlices,
		e: InstrumentEntry,
	): Readonly<Record<string, BankScope>>;
	get(q: Question, env: Env): Evaluation;
	scheme(e: SchemeEntry, env: Env): SchemeEvaluation;
	schema(env: Env): Record<string, unknown>;
}

const sameEntries = (
	a: readonly SchemeEntry[],
	b: readonly SchemeEntry[],
): boolean => a.length === b.length && a.every((e, i) => e === b[i]);

const sameList = <T>(a: readonly T[], b: readonly T[]): boolean =>
	a.length === b.length && a.every((x, i) => x === b[i]);

export interface RemoteGiven {
	readonly reads: Readonly<Record<AddressKey, RemoteBank>>;
	readonly scopes: Readonly<Record<AddressKey, BankScope>>;
}

/** A remote bank's files, read: one evaluation per read, never per keystroke. */
const remoteScopes = new WeakMap<object, BankScope>();
const scopeOfRead = (files: Readonly<Record<string, string>>): BankScope => {
	const kept = remoteScopes.get(files);
	if (kept !== undefined) return kept;
	const scope = scopeOf(files);
	remoteScopes.set(files, scope);
	return scope;
};

export function createEvaluations(): Evaluations {
	const cache = new Map<Id, { source: string; env: Env; ev: Evaluation }>();
	const schemes = new Map<
		Id,
		{ source: string; name: string; env: Env; ev: SchemeEvaluation }
	>();
	const envs = new Map<
		string,
		{ entries: readonly SchemeEntry[]; known: boolean; env: Env }
	>();
	// A bank's editor schema, kept for as long as its environment is.
	const schemas = new WeakMap<Env, Record<string, unknown>>();
	const scopes = new Map<
		string,
		{
			env: Env;
			keys: readonly unknown[];
			scope: BankScope;
		}
	>();
	let file: { source: string; file: WorkspaceFile } | undefined;
	const instruments = new Map<
		Id,
		{
			source: string;
			banks: readonly string[];
			remote: Readonly<Record<AddressKey, RemoteBank>>;
			file: WorkspaceFile | undefined;
			used: readonly BankScope[];
			read: InstrumentIn;
		}
	>();
	let given: { banks: Model["remoteBanks"]; given: RemoteGiven } | undefined;
	const self: Evaluations = {
		remote({ remoteBanks }) {
			if (given?.banks === remoteBanks) return given.given;
			const reads: Record<AddressKey, RemoteBank> = {};
			const scopes: Record<AddressKey, BankScope> = {};
			for (const [key, read] of Object.entries(remoteBanks)) {
				if (read.kind === "loading") continue;
				reads[key] = read;
				if (read.kind === "files") scopes[key] = scopeOfRead(read.files);
			}
			given = { banks: remoteBanks, given: { reads, scopes } };
			return given.given;
		},
		env(model, bank) {
			const entries = schemesOf(model.local.schemes, bank);
			const known = knownBank(model.remote.schemes, bank, model.banks);
			const hit = envs.get(bank);
			if (hit && hit.known === known && sameEntries(hit.entries, entries))
				return hit.env;
			const env = envOf(entries, known);
			envs.set(bank, { entries, known, env });
			return env;
		},
		get(q, env) {
			const hit = cache.get(q.id);
			if (hit && hit.source === q.source && hit.env === env) return hit.ev;
			const ev = evaluate(q.source, env);
			cache.set(q.id, { source: q.source, env, ev });
			return ev;
		},
		scheme(e, env) {
			const hit = schemes.get(e.id);
			if (
				hit &&
				hit.source === e.source &&
				hit.name === e.name &&
				hit.env === env
			)
				return hit.ev;
			const ev = evaluateScheme(e.kind, e.source, env, e.name);
			schemes.set(e.id, { source: e.source, name: e.name, env, ev });
			return ev;
		},
		schema(env) {
			const kept = schemas.get(env);
			if (kept !== undefined) return kept;
			const schema = questionJsonSchema(env);
			schemas.set(env, schema);
			return schema;
		},
		scope(model, bank) {
			const env = self.env(model, bank);
			const questions: [string, Evaluation][] = [];
			for (const q of Object.values(model.local.questions))
				if (q.bank === bank && q.base !== undefined)
					questions.push([relIn(bank, q.base.path), self.get(q, env)]);
			const shared: [string, SchemeEntry, SchemeEvaluation][] = [];
			for (const e of schemesOf(model.local.schemes, bank)) {
				const at = claimOf(e);
				if (at !== undefined)
					shared.push([relIn(bank, at), e, self.scheme(e, env)]);
			}
			// The scope is the same while every path and evaluation is.
			const keys = [
				...questions.flat(),
				...shared.flatMap(([path, , ev]) => [path, ev]),
			];
			const hit = scopes.get(bank);
			if (hit && hit.env === env && sameList(hit.keys, keys)) return hit.scope;
			const schemes: Record<string, SchemeFileEvaluation> = {};
			for (const [path, e, ev] of shared)
				schemes[path] = { ...ev, kind: e.kind, name: e.name };
			const scope = bankFrom({
				env,
				questions: Object.fromEntries(questions),
				schemes,
			});
			scopes.set(bank, { env, keys, scope });
			return scope;
		},
		workspaceFile(model) {
			const e = Object.values(model.local.workspace).find(
				(f) => f.kind === "workspaceFile",
			);
			if (e === undefined) return undefined;
			if (file?.source !== e.source)
				file = { source: e.source, file: workspaceFileOf(e.source) };
			return file.file;
		},
		instrument(model, e) {
			const path = instrumentPath(e.name);
			const hit = instruments.get(e.id);
			const { reads: remote, scopes: remoteBanks } = self.remote(model);
			// Only the banks its uses name are built, so editing another leaves it alone.
			const used: Record<string, BankScope> = {};
			const uses = resolveUses(
				path,
				importsOf(e.source),
				new Set(model.banks),
				remote,
			);
			for (const r of Object.values(uses))
				if (r.kind === "local" && !(r.folder in used))
					used[r.folder] = self.scope(model, r.folder);
			const scopes = Object.values(used);
			const ws = self.workspaceFile(model);
			if (
				hit &&
				hit.source === e.source &&
				hit.file === ws &&
				hit.remote === remote &&
				sameList(hit.banks, model.banks) &&
				sameList(hit.used, scopes)
			)
				return hit.read;
			const read = instrumentIn(path, e.source, {
				banks: used,
				remote,
				remoteBanks,
				...(ws !== undefined && { file: ws }),
			});
			instruments.set(e.id, {
				source: e.source,
				banks: model.banks,
				remote,
				file: ws,
				used: scopes,
				read,
			});
			return read;
		},
		usedScopes(model, e) {
			const { scopes } = self.remote(model);
			return Object.fromEntries(
				Object.entries(self.instrument(model, e).uses).flatMap(
					([alias, r]): [string, BankScope][] => {
						if (r.kind === "local")
							return [[alias, self.scope(model, r.folder)]];
						const scope = r.kind === "remote" ? scopes[r.key] : undefined;
						return scope === undefined ? [] : [[alias, scope]];
					},
				),
			);
		},
	};
	return self;
}
