import { init } from "./model.js";
import { mount } from "./mount.js";
import { run } from "./runtime.js";
import { update } from "./update.js";

const root = document.querySelector<HTMLElement>("#app");
if (root) run(init, update, (dispatch) => mount(root, dispatch));
