/**
 * The banks the open instrument is read against, each evaluated once (`bankOf`) and
 * kept for as long as the bank as read is: memoised on that very object, which the
 * Model keeps until a reload or a sign-out. A view concern; pure apart from the cache.
 */
import { type Bank, bankOf } from "@qretools/core";
import type { BankLoad } from "./model.ts";
import { type UsesInput, usesOf } from "./uses.ts";

type Read = Extract<BankLoad, { kind: "loaded" }>;

const evaluated = new WeakMap<Read, Bank>();

function bankFor(load: Read): Bank {
	const kept = evaluated.get(load);
	if (kept !== undefined) return kept;
	const bank = bankOf(
		Object.fromEntries(load.files.map((f) => [f.path, f.text])),
	);
	evaluated.set(load, bank);
	return bank;
}

/** Each bank the open instrument uses that has been read and found, by its alias. */
export function banksOf(model: UsesInput): Readonly<Record<string, Bank>> {
	return Object.fromEntries(
		usesOf(model).flatMap((u) =>
			u.state.kind === "loaded" &&
			u.state.load.kind === "loaded" &&
			u.state.load.found
				? [[u.alias, bankFor(u.state.load)]]
				: [],
		),
	);
}
