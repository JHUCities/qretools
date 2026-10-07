/**
 * `@qretools/shell`: what the QREtools apps share at their edge: signing in with GitHub
 * (the App, the Worker, PKCE), the storage port and its GitHub adapter (Octokit), which
 * bank or project a repository folder is, and links in the address. Internal to this
 * repository. Nothing here decides survey policy; that is the core's.
 */
export {
	authorizeUrl,
	base64url,
	type Callback,
	type Credentials,
	callbackOf,
	exchange,
	PendingSchema,
	type PendingSignIn,
	refresh,
	stale,
} from "./auth.ts";
export { makeGitHubStore } from "./github.ts";
export { formatLink, type Link, parseLink } from "./link.ts";
export {
	installUrl,
	type SignInConfig,
	type SignInEnv,
	signInConfig,
} from "./signin.ts";
export {
	type Access,
	AuthError,
	type BankRef,
	type BankSettings,
	type BranchTarget,
	bankText,
	type Change,
	type CommitFailure,
	type Committed,
	type CredentialStore,
	type Failure,
	type File,
	type Loaded,
	type MakeStore,
	parseBank,
	parseRepo,
	type Store,
	sameBank,
	type Who,
} from "./storage.ts";
