# QREtools

[![Deploy](https://github.com/JHUCities/qretools/actions/workflows/pages.yml/badge.svg)](https://github.com/JHUCities/qretools/actions/workflows/pages.yml)
[![DDI-Lifecycle 4.0](https://img.shields.io/badge/DDI--Lifecycle-4.0-0B6E99)](https://ddialliance.org/Specification/DDI-Lifecycle)
[![TypeScript 7](https://img.shields.io/badge/TypeScript-7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Primer 38](https://img.shields.io/badge/Primer-38-24292F?logo=github&logoColor=white)](https://primer.style/)
[![CodeMirror 6](https://img.shields.io/badge/CodeMirror-6-D30707?logo=codemirror&logoColor=white)](https://codemirror.net/)
[![Zod 4](https://img.shields.io/badge/Zod-4-3E67B1?logo=zod&logoColor=white)](https://zod.dev/)
[![Vite 8](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Vitest 5](https://img.shields.io/badge/Vitest-5-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![Biome 2](https://img.shields.io/badge/Biome-2-60A5FA?logo=biome&logoColor=white)](https://biomejs.dev/)
[![Node 26](https://img.shields.io/badge/Node-26-5FA04E?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![pnpm 10](https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)

Write survey questions and instruments in the browser, and get
[DDI-Lifecycle 4.0](https://ddialliance.org/Specification/DDI-Lifecycle) out of them.

**Use it:** <https://qretools.com/>

QREtools is a question editor and instrument builder for survey teams that keep a
question bank. Each question is a short YAML file. An instrument, also YAML, puts the
bank's questions in order, with the conditions that decide who is asked what. QREtools
checks a question as you type, shows it as a respondent and a codebook would, and turns
it into DDI. The bank lives in a GitHub repository: you save to your own branch, and
your changes join the bank through a pull request.

It's built for any team with a question bank. The
[Baltimore Area Survey](https://jhucities.github.io/baltimore-area-survey-data/bas-2025/codebook.html)
(Johns Hopkins 21st Century Cities) is its first user and reference case.

## What a question looks like

![A question in the QREtools editor: service_satisfaction, with its title, text and intent written out, and its concept, universe, response scale and instruction named from the bank's shared files, shown in green.](docs/images/question.png)

A question is answered in one of three ways: `responses` (a list of options, or the name
of a shared scale; add `select: many` for select all that apply), `number` (a range and a
unit) or `open` (free text). `name`, `text` and `intent` are required. You never write
DDI by hand: QREtools adds the identifiers, versions and references.

## What an instrument looks like

![An instrument in the QREtools editor: it asks service_satisfaction, then asks service_comments only if the answer was 4 or 5, then library_visits.](docs/images/instrument.png)

`uses` names the workspaces an instrument reads, each under a short alias: `../` is its
own. `ask` asks a bank's question, written `alias.name`. `if` follows its `then` list
when its condition is true (here, an answer of 4 or 5), and its `else` list, if it has
one, when it isn't.

## What's in it

- **The web app** (`apps/bank/`, [qretools.com](https://qretools.com/)). Write questions and
  instruments, checked as you type, and save them to your branch.
- **The `qretools` command** (`packages/cli/`, [on npm](https://www.npmjs.com/package/qretools)).
  Run `check`, `export`, `codebook` or `build` on a workspace, and `instrument check` or
  `instrument export` on an instrument.
- **The codebook package** (`packages/codebook/`). Turns a DDI-Lifecycle 4.0 document into an
  HTML codebook. It also works as a `<ddi-codebook>` element on any web page.
- **The Qualtrics export** (`packages/qsf/`). Turns an instrument into a Qualtrics survey.
  Use "Download QSF" in the app, or `qretools instrument export --qsf`.

## Start a workspace

Create one from the [template](https://github.com/JHUCities/qretools-template)
("Use this template"). It holds `workspace.yaml` (the DDI agency, and the fields
questions must have: `required` for all, `required_in` by folder), example questions in
`questions/example/`, the shared folders, `missing.yaml`, `select_all.yaml` and
`instruments/`. An instrument asks its own workspace's questions with `uses: bank: ../`,
and another workspace's at a tag, `owner/repo@v1`.

Install the [QREtools GitHub App](https://github.com/apps/qretools) on the repository,
then sign in at the site above with its `owner/name`. New, then Instrument, starts an
instrument. If the workspace has questions in `questions/example/`, QREtools also offers
an example instrument that asks them. The template's README walks through all of this,
including protecting `main`.

## Develop

Requires [mise](https://mise.jdx.dev/) (it pins Node and pnpm).

```sh
mise install
pnpm install
pnpm dev          # http://localhost:5199
pnpm check        # typecheck, lint, tests
pnpm build
```

The app is TypeScript, React 19 and GitHub's [Primer](https://primer.style/) design
system, with CodeMirror 6 for the editor, Zod for the question schema and ajv for DDI
validation, built with Vite and tested with Vitest. It runs entirely in the browser. It
has a functional core (`packages/core/`, `@qretools/core`: parse, check, turn into DDI,
render) and an imperative shell in the Elm style (`apps/bank/`: one Model, one `update`,
effects described as data). `packages/editor/` is the CodeMirror editor and
`packages/shell/` what the apps share at their edge (sign-in, storage, links, the look).

Signing in with GitHub needs a GitHub App and one small Cloudflare Worker (`worker/`)
that swaps the sign-in code for a token. It's the only part that runs on a server.
`apps/bank/.env` names both. The Worker keeps its own lockfile outside the workspace:
install it with `pnpm --dir worker --ignore-workspace install`. The site deploys to
GitHub Pages from `main` (`.github/workflows/pages.yml`).

[`AGENTS.md`](AGENTS.md) records every design decision and why. Read it before
changing anything.
