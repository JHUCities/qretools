/**
 * The look every QREtools app shares, imported once, first, by each app's entry:
 * GitHub's typefaces, served with the app (Mona Sans for the interface, Monaspace Neon
 * for code, which app.css points Primer's font stacks at; Radon for "QRE" and Krypton
 * for "tools" in the header's wordmark, one weight each), Primer's tokens, then our
 * stylesheet. The order is the cascade's: keep it.
 */
import "@fontsource-variable/mona-sans";
import "@fontsource/monaspace-neon/400.css";
// Its italic: a name from a bank in another repository is drawn in it (editor.ts).
import "@fontsource/monaspace-neon/400-italic.css";
import "@fontsource/monaspace-radon/latin-700.css";
import "@fontsource/monaspace-krypton/latin-500.css";
import "@primer/primitives/dist/css/primitives.css";
import "@primer/primitives/dist/css/functional/themes/light.css";
import "@primer/primitives/dist/css/functional/themes/dark.css";
import "./app.css";
