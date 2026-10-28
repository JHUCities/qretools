/**
 * `@qretools/form`: a test form from an instrument's DDI. `pageOf` writes the instruments
 * `readInstruments` reads as one HTML page that runs their routing; `walk` is where a run
 * leads, pure. `pathsPageOf` writes the same instruments' paths and reach (core's
 * `pathsOf`) as a page to read.
 */
export { pageOf } from "./page.ts";
export { pathsPageOf } from "./paths.ts";
export {
	type Answer,
	type Event,
	type Place,
	type Run,
	type Walked,
	walk,
} from "./walk.ts";
