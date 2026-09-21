/**
 * The whole runtime: hold the model, fold messages into it, render, run commands.
 * `dispatch` is created once and handed to `mount`, so the view is built once and
 * `view(model)` only ever receives the model.
 */
export interface Mounted<Model, Cmd> {
	readonly view: (model: Model) => void;
	readonly exec: (cmd: Cmd) => void;
}

export function run<Model, Msg, Cmd>(
	init: readonly [Model, readonly Cmd[]],
	update: (model: Model, msg: Msg) => readonly [Model, readonly Cmd[]],
	mount: (dispatch: (msg: Msg) => void) => Mounted<Model, Cmd>,
): void {
	let model = init[0];
	const dispatch = (msg: Msg): void => {
		const [next, cmds] = update(model, msg);
		model = next;
		view(model);
		for (const cmd of cmds) exec(cmd);
	};
	const { view, exec } = mount(dispatch);
	view(model);
	for (const cmd of init[1]) exec(cmd);
}
