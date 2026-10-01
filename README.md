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

Write survey questions and their documentation in the browser, and get
[DDI-Lifecycle 4.0](https://ddialliance.org/Specification/DDI-Lifecycle) out of them.

**Use it:** <https://bank.qretools.com/>

QREtools is a question editor for survey teams that keep a question bank. Each question
is a short YAML file; QREtools checks it as you type, shows it as a respondent and a
codebook would, and elaborates it to DDI. The bank lives in a GitHub repository, so
every change is a commit on your own branch and joins the bank through a pull request.

It is built for any team with a question bank. The
[Baltimore Area Survey](https://jhucities.github.io/baltimore-area-survey-data/bas-2025/codebook.html)
(Johns Hopkins 21st Century Cities) is its first user and reference case.

## What a question looks like

```yaml
name: service_satisfaction
title: Overall satisfaction
text: Overall, how satisfied are you with the service you received?
intent: Estimates overall satisfaction with the service.
concept: service_satisfaction
universe: all_respondents
responses: satisfied5
instruction: select_one
```

A question is answered one way: `responses` (a list of options, or the name of a shared
scale; `select: many` for select all that apply), `number` (a range and a unit) or
`open` (free text). `name`, `text` and `intent` are required. Nothing about DDI is
written by hand: identifiers, versions and references are the tool's.

## What it does

- **Unfinished is fine.** An empty or missing field is a place to fill in, not an
  error: every draft still previews and exports, and you can save it.
- **Live previews.** The question as a respondent sees it, its codebook entry, and its
  DDI, which is validated against the official schema.
- **Shared values, named once.** Concepts, response scales, units, universes,
  instructions and the bank's missing-value codes each live in their own file and are
  named from any question. Completion offers the names; the inspector under the editor
  says what a name refers to and who uses it.
- **A bank without duplicates.** The same question text, response list, universe or
  instruction written twice, two shared scales with the same labels, or a question
  worded much like another: each is pointed out on every file involved, with a link to
  the others. Where there is something to replace a duplicate with, one click does it
  ("Use `satisfied5`"). Questions alike on purpose say so with `variant_of`.
- **Advice from survey practice.** Double-barreled wording, the same option twice, a
  missing "none of these", an intent that says too little: advice, never a blocker.
- **Git underneath, not in the way.** Saving commits to your own branch
  (`qretools-<login>`); proposing opens a pull request; the bank changes when it is
  merged. Review, history and conflicts stay on GitHub.

## Start a bank

Create one from the [bank template](https://github.com/JHUCities/qretools-bank-template)
("Use this template"), install the QREtools GitHub App on it, and sign in at the site
above with the repository's `owner/name`. The template's README walks through it,
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
validation, built with Vite and tested with Vitest. It runs entirely in the browser: a
functional core (`src/core/`: parse, check, elaborate, render) and an imperative shell
in the Elm style (`src/app/`: one Model, one `update`, effects described as data).

Signing in with GitHub needs a GitHub App and one small token-exchange Worker
(`worker/`, Cloudflare), the only server-side piece; `.env` names them. The site
deploys to GitHub Pages from `main` (`.github/workflows/pages.yml`).

[`AGENTS.md`](AGENTS.md) records every design decision and why; read it before
changing anything.
