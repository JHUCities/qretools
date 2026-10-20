/**
 * Pure caches. Not state: the same inputs always give the same outputs; the caches
 * only save work.
 *
 * The bank's environment is memoised on the working scheme files' slice, by reference,
 * as Elm's `lazy` does. That is exact because `update` replaces that slice only when a
 * scheme file changes: editing a question keeps the environment, and every other
 * question its evaluation.
 *
 * An instrument is read against the banks it uses as they are being edited: this
 * workspace's scope (`bankFrom`) is built from the evaluations kept here, and kept for
 * as long as they are, so a keystroke in an instrument that doesn't use it builds nothing.
 */
import {
	type AddressKey,
	agencyWritten,
	type BankScope,
	bankFrom,
	type Env,
	type Evaluation,
	envAt,
	evaluate,
	evaluateScheme,
	type InstrumentIn,
	importsOf,
	instrumentIn,
	type RemoteBank,
	remoteScope,
	resolveUses,
	type SchemeEvaluation,
	type SchemeFileEvaluation,
} from "@qretools/core";
import { questionJsonSchema } from "@qretools/core/editor";
import {
	agencyOf,
	detailsOf,
	envOf,
	type Id,
	type InstrumentEntry,
	knownBank,
	type Model,
	type Question,
	type SchemeEntry,
} from "./model.js";
import { claimOf } from "./sync.js";

/** The slices of the Model a bank's or an instrument's evaluation reads. */
type Slices = Pick<Model, "local" | "remote">;
/** An instrument also reads the banks in other repositories read so far. */
type WorkspaceSlices = Slices & Pick<Model, "remoteBanks">;

export interface Evaluations {
	/** The bank's environment, from the model's slices it is built from. */
	env(model: Slices): Env;
	/** The DDI agency the bank declares, as it is being edited; absent while it declares none. */
	agency(model: Slices): string | undefined;
	/**
	 * What an instrument reads of this workspace's bank: its working copies, unsaved
	 * edits included. A question never saved has no path, so no instrument can ask it
	 * until it is.
	 */
	scope(model: Slices): BankScope;
	/**
	 * The banks in other repositories as an instrument is given them: each read one's
	 * files or why not (one still being read is left out, so it reads as pending), and
	 * the read ones' scopes, each evaluated once per read.
	 */
	remote(model: Pick<Model, "remoteBanks">): RemoteGiven;
	/** An instrument, read against the banks it uses as they are being edited. */
	instrument(model: WorkspaceSlices, e: InstrumentEntry): InstrumentIn;
	/** The banks an instrument uses that are read (this workspace's, and others'), by its alias for each: what completion offers. */
	usedScopes(
		model: WorkspaceSlices,
		e: InstrumentEntry,
	): Readonly<Record<string, BankScope>>;
	/**
	 * The environment a question is read against: its bank's `env`, with what its folder
	 * also requires (`envAt`). One reference per environment and folder, so it keys a cache.
	 */
	at(q: Question, env: Env): Env;
	/**
	 * A question's evaluation, given its bank's environment: read against it as the
	 * question's folder has it (`at`), here and nowhere else, so every pane agrees.
	 */
	get(q: Question, env: Env): Evaluation;
	scheme(e: SchemeEntry, env: Env): SchemeEvaluation;
	schema(env: Env): Record<string, unknown>;
}

const sameList = <T>(a: readonly T[], b: readonly T[]): boolean =>
	a.length === b.length && a.every((x, i) => x === b[i]);

export interface RemoteGiven {
	readonly reads: Readonly<Record<AddressKey, RemoteBank>>;
	readonly scopes: Readonly<Record<AddressKey, BankScope>>;
}

/** A remote bank's files, read: one evaluation per read, never per keystroke. */
const remoteScopes = new WeakMap<object, BankScope>();
const scopeOfRead = (
	key: AddressKey,
	read: Extract<RemoteBank, { kind: "files" }>,
): BankScope => {
	const kept = remoteScopes.get(read);
	if (kept !== undefined) return kept;
	const scope = remoteScope(key, read);
	remoteScopes.set(read, scope);
	return scope;
};

export function createEvaluations(): Evaluations {
	const cache = new Map<Id, { source: string; env: Env; ev: Evaluation }>();
	const schemes = new Map<
		Id,
		{ source: string; name: string; env: Env; ev: SchemeEvaluation }
	>();
	let kept:
		| {
				schemes: Model["local"]["schemes"];
				known: boolean;
				env: Env;
				agency: string | undefined;
		  }
		| undefined;
	// The settings' agency as written, valid or not, per text: an instrument reports an
	// invalid one, where the DDI pane and the scope use only a valid one (`agencyOf`).
	let written: { source: string; agency: string | undefined } | undefined;
	// The bank's environment as each folder has it, kept for as long as the bank's is.
	const placed = new WeakMap<Env, Map<string, Env>>();
	// The editor's schema, kept for as long as its environment is.
	const schemas = new WeakMap<Env, Record<string, unknown>>();
	let scoped:
		| {
				env: Env;
				agency: string | undefined;
				keys: readonly unknown[];
				scope: BankScope;
		  }
		| undefined;
	const instruments = new Map<
		Id,
		{
			source: string;
			remote: Readonly<Record<AddressKey, RemoteBank>>;
			agency: string | undefined;
			bank: BankScope | undefined;
			read: InstrumentIn;
		}
	>();
	let given: { banks: Model["remoteBanks"]; given: RemoteGiven } | undefined;
	/** The bank's environment and agency, kept while its scheme entries are. */
	const bankEntry = (model: Slices) => {
		const { schemes } = model.local;
		const known = knownBank(model.remote.schemes);
		if (kept && kept.known === known && kept.schemes === schemes) return kept;
		kept = {
			schemes,
			known,
			env: envOf(schemes, known),
			agency: agencyOf(schemes),
		};
		return kept;
	};
	const self: Evaluations = {
		remote({ remoteBanks }) {
			if (given?.banks === remoteBanks) return given.given;
			const reads: Record<AddressKey, RemoteBank> = {};
			const scopes: Record<AddressKey, BankScope> = {};
			for (const [key, read] of Object.entries(remoteBanks)) {
				if (read.kind === "loading") continue;
				reads[key] = read;
				if (read.kind === "files") scopes[key] = scopeOfRead(key, read);
			}
			given = { banks: remoteBanks, given: { reads, scopes } };
			return given.given;
		},
		env: (model) => bankEntry(model).env,
		agency: (model) => bankEntry(model).agency,
		at(q, base) {
			// A draft has no folder yet: it is read against the bank's own.
			if (q.base === undefined) return base;
			const { path } = q.base;
			const folder = path.slice(0, path.lastIndexOf("/") + 1);
			const kept = placed.get(base) ?? new Map<string, Env>();
			placed.set(base, kept);
			const hit = kept.get(folder);
			if (hit !== undefined) return hit;
			const env = envAt(base, path);
			kept.set(folder, env);
			return env;
		},
		get(q, base) {
			// Keyed on the folder's environment: a question saved or moved into a folder
			// that requires more is read again, one left where it was is not.
			const env = self.at(q, base);
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
			const ev = evaluateScheme(e.kind, e.source, env);
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
		scope(model) {
			const env = self.env(model);
			const questions: [string, Evaluation][] = [];
			for (const q of Object.values(model.local.questions))
				if (q.base !== undefined)
					questions.push([q.base.path, self.get(q, env)]);
			const shared: [string, SchemeEntry, SchemeEvaluation][] = [];
			for (const e of Object.values(model.local.schemes)) {
				const at = claimOf(e);
				if (at !== undefined) shared.push([at, e, self.scheme(e, env)]);
			}
			// The scope is the same while every path and evaluation is.
			const keys = [
				...questions.flat(),
				...shared.flatMap(([path, , ev]) => [path, ev]),
			];
			const agency = self.agency(model);
			if (
				scoped &&
				scoped.env === env &&
				scoped.agency === agency &&
				sameList(scoped.keys, keys)
			)
				return scoped.scope;
			const schemes: Record<string, SchemeFileEvaluation> = {};
			for (const [path, e, ev] of shared)
				schemes[path] = { ...ev, kind: e.kind, name: e.name };
			const scope = bankFrom({
				env,
				agency,
				questions: Object.fromEntries(questions),
				schemes,
			});
			scoped = { env, agency, keys, scope };
			return scope;
		},
		instrument(model, e) {
			const hit = instruments.get(e.id);
			const { reads: remote, scopes: remoteBanks } = self.remote(model);
			// This workspace's bank is built only when its uses name it, so editing the
			// bank leaves an instrument that doesn't use it alone.
			const bank = Object.values(resolveUses(importsOf(e.source), remote)).some(
				(r) => r.kind === "local",
			)
				? self.scope(model)
				: undefined;
			// As `workspace.yaml` writes it while it is being edited, valid or not.
			const details = detailsOf(model.local.schemes);
			if (details === undefined) written = undefined;
			else if (written?.source !== details.source)
				written = {
					source: details.source,
					agency: agencyWritten(details.source),
				};
			const agency = written?.agency;
			if (
				hit &&
				hit.source === e.source &&
				hit.agency === agency &&
				hit.remote === remote &&
				hit.bank === bank
			)
				return hit.read;
			const read = instrumentIn(e.source, {
				bank,
				remote,
				remoteBanks,
				agency,
			});
			instruments.set(e.id, {
				source: e.source,
				remote,
				agency,
				bank,
				read,
			});
			return read;
		},
		usedScopes(model, e) {
			const { scopes } = self.remote(model);
			return Object.fromEntries(
				Object.entries(self.instrument(model, e).uses).flatMap(
					([alias, r]): [string, BankScope][] => {
						if (r.kind === "local") return [[alias, self.scope(model)]];
						const scope = r.kind === "remote" ? scopes[r.key] : undefined;
						return scope === undefined ? [] : [[alias, scope]];
					},
				),
			);
		},
	};
	return self;
}
