import { describe, expect, it } from "vitest";
import { installUrl, signInConfig } from "./signin.ts";

const env = (values: Record<string, string>) => values;

describe("sign-in configuration", () => {
	it("needs a client id and the Worker; the app's slug gives the install link", () => {
		expect(signInConfig(env({}), "https://x.io", "/")).toBeUndefined();
		const c = signInConfig(
			env({
				VITE_GITHUB_CLIENT_ID: "id",
				VITE_AUTH_URL: "https://w.dev/",
				VITE_GITHUB_APP_SLUG: "qretools",
			}),
			"https://x.io",
			"/app/",
		);
		expect(c).toEqual({
			clientId: "id",
			authUrl: "https://w.dev",
			appSlug: "qretools",
			redirectUri: "https://x.io/app/",
		});
		expect(installUrl("qretools")).toBe(
			"https://github.com/apps/qretools/installations/select_target",
		);
	});
});
