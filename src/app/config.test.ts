import { describe, expect, it } from "vitest";
import { bankTemplate, installUrl, signInConfig } from "./config.js";

const env = (values: Record<string, string>) =>
	values as unknown as ImportMetaEnv;

describe("the template a new bank starts from", () => {
	it("is read as owner/name, or a pasted URL, and links GitHub's Use this template", () => {
		expect(
			bankTemplate(
				env({ VITE_BANK_TEMPLATE: "JHUCities/qretools-bank-template" }),
			),
		).toBe("https://github.com/JHUCities/qretools-bank-template/generate");
		expect(
			bankTemplate(env({ VITE_BANK_TEMPLATE: "https://github.com/a/b" })),
		).toBe("https://github.com/a/b/generate");
	});

	it("is absent when not set, blank or malformed: no link rather than a broken one", () => {
		expect(bankTemplate(env({}))).toBeUndefined();
		expect(bankTemplate(env({ VITE_BANK_TEMPLATE: "  " }))).toBeUndefined();
		expect(
			bankTemplate(env({ VITE_BANK_TEMPLATE: "not a repository" })),
		).toBeUndefined();
	});
});

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
