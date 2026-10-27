/**
 * `@qretools/form`: a test form from an instrument's DDI. `pageOf` writes the instruments
 * `readInstruments` reads as one HTML page that runs their routing; `walk` is where a run
 * leads, pure.
 */
export { pageOf } from "./page.ts";
export {
	type Answer,
	type Event,
	type Place,
	type Run,
	type Walked,
	walk,
} from "./walk.ts";
