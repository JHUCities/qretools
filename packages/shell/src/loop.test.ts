import { describe, expect, it } from "vitest";
import { createLoop } from "./loop.ts";

type Msg = { kind: "add"; n: number } | { kind: "noted" };

describe("the Elm loop", () => {
	it("runs the first commands, then each message's update and its commands", () => {
		const ran: string[] = [];
		const { store, dispatch } = createLoop<number, Msg, string>(
			[0, ["start"]],
			(model, msg) =>
				msg.kind === "add"
					? [model + msg.n, [`added ${msg.n}`]]
					: [model + 100, []],
			(cmd, send) => {
				ran.push(cmd);
				if (cmd.startsWith("added")) send({ kind: "noted" });
			},
			"test",
		);
		expect(ran).toEqual(["start"]);
		dispatch({ kind: "add", n: 2 });
		// The command's message went back through update: 2, then 100 for "noted".
		expect(store.getState().model).toBe(102);
		expect(ran).toEqual(["start", "added 2"]);
	});
});
