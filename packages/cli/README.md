# The `qretools` command

For a workspace on disk, in CI or at a terminal. Install it from npm (Node 22 or later),
or run it without installing. `check` and `export` of a folder need only Node. Reading a
workspace in another repository (`owner/repo@v1`) and `build` also need
[git](https://git-scm.com) on your PATH.

```sh
npm install -g qretools       # then `qretools …`
npx qretools check .          # or one run; pin a version in CI: npx qretools@2.0.0-alpha.1
```


```sh
qretools check path/to/workspace            # findings, one per line; exit 1 on anything to fill in or fix
qretools check path/to/workspace --strict   # warnings fail too
qretools export path/to/workspace -o questions.json   # its questions' DDI, validated
qretools build path/to/workspace             # its last commit's DDI, versioned from git history, in path/to/workspace/dist/ddi.json
qretools codebook path/to/workspace -o codebook.html  # its questions' codebook, one HTML page
qretools codebook ddi.json -o codebook.html  # the codebook of any DDI-Lifecycle 4.0 JSON
qretools form wave1.json -o form.html        # a test form of an instrument's DDI, one HTML page
```

A workspace is one folder: `workspace.yaml` (its settings), `questions/<folder>/`, the
shared folders (`scales/` and so on), `missing.yaml`, `select_all.yaml` and
`instruments/`. `check` reports findings for its questions, its shared files and every
instrument. An instrument reads its own workspace as `../`, under the agency in
`workspace.yaml`. `check` also notes YAML files it ignores.

## Workspaces in other repositories

A workspace in another repository (`owner/repo@v1`, or `owner/repo/folder@v1`) is read at
that tag with your own `git`, so any credentials git has reach a private repository. Only
`refs/tags/v1` is fetched, never a branch of that name. The fetch is shallow and takes only
the folder. It goes into a cache by tag and folder (`$XDG_CACHE_HOME/qretools`, else
`~/.cache/qretools`), with the commit the tag pointed to. Later runs read the cache.

A tag can move; a commit can't. So `instrument export` records the commit each tag points
to, under `locked:` in the workspace's `workspace.yaml`, as a build tool writes its
lockfile (Cargo, npm). Commit that file with the rest. Saving an instrument in the app does
the same.

- A tag that now points to another commit is a `moved-tag` warning on its `uses` line in
  `check` (so `--strict` fails on it). The next export or save records the new commit and
  says `[WARNING]`. Reviewers see the changed line in `workspace.yaml`.
- A tag with no record (an instrument written by hand, never saved in the app or
  exported) is an `unlocked-tag` warning in `check`.
- Records are only added or updated, never removed. This relies only on git, so it works
  on any forge.
- A tag is read from the cache, so a moved tag shows where the cache is fresh, as in CI.
  To read a tag again here, delete its entry in the cache.
- An instrument outside a workspace, or in one without a `workspace.yaml`, still exports,
  but its tags aren't recorded.

Its questions' DDI says where each was read: the UserAttributePairs `git-repository`,
`git-path`, `git-tag` and `git-commit` (the commit the tag pointed to), beside the file's
`git-blob` UserID. Versions come from the tag's message when it is a release's
(`build --tag-message`, below) and matches the files at the tag. Otherwise every version is
1, and a message that doesn't match is a warning on the `uses` line. A workspace read from
a folder with `--bank` records nothing about where it came from.

In CI, a private repository needs git credentials, such as `GITHUB_TOKEN` given to git
(`git config --global url."https://x-access-token:${GITHUB_TOKEN}@github.com/".insteadOf https://github.com/`)
or a deploy key.

## Instruments

`qretools instrument check <file>` and `qretools instrument export <file>` work on one
instrument. They use its workspace's agency (`workspace.yaml`), or `--agency <agency>`
for a file outside a workspace's `instruments/`. The instrument reads its own workspace
(`../`, the folder above it) and others at their tags. `--bank alias=dir` reads an alias
written as `owner/repo@v1` from a folder instead, to work offline. Any other local address
is refused.

`qretools instrument export <file> --qsf` writes the instrument as a Qualtrics survey
(QSF), made from its DDI. Import it under Projects → Create project → Survey. Anything
Qualtrics can't do as the DDI says is reported at its line, and an error writes nothing.

## Build

`build` is `export` with real versions. Each question's version counts the changes to its
file, and to every shared file it names, along the first-parent history of HEAD. So a
question gets a new version when its scale changes. Its date is that commit's, and its git
blob is a UserID.

- It builds the last commit, not your working files. Uncommitted changes are left out,
  and it says so.
- It needs the whole history. A shallow clone is refused; in CI, use `fetch-depth: 0`.
- It writes `<outdir>/ddi.json`. `-o` names the folder (default `<dir>/dist`).

`--tag-message <file>` also writes the text for a release's tag: a line, a blank line,
then each file's version, date and blob as JSON. Tag the built commit with it, verbatim,
so git keeps it whole: `git tag -a --cleanup=verbatim -F <file> v2 HEAD`. A workspace can
do this in a workflow it runs by hand with the tag's name (qretools-gss's `release.yml`
is one). The tag points at the default branch's own commit, and only the tag is pushed.

## Codebook

`codebook` writes the codebook of the DDI that `export` writes, and refuses when `export`
does. It's one HTML page with its style inside, no script and nothing fetched, so it can
be opened from a file, attached or published as it is. Each variable shows its name and
label, its question's words, its codes (missing values last) and, where it has them, its
format, universe and concept. Each has its own anchor
(`codebook.html#org.example:variable-consent`), which stays the same when its version
changes. The title is "Codebook": a workspace has no name of its own yet.

Given a file, `codebook` reads it as DDI-Lifecycle 4.0 JSON, from any tool. So the
codebook of one instrument, with its map after the contents and its routing beside each
question, comes from its export:

```sh
qretools instrument export instruments/wave1.yaml -o wave1.json
qretools codebook wave1.json -o wave1.html
```

In CI, make the codebook of what `build` versioned. Its anchors match every earlier
build's, since an anchor leaves out the version:

```sh
qretools build . -o dist
qretools codebook dist/ddi.json -o dist/codebook.html --strict
```

If the DDI refers to something it doesn't contain, the page shows it, and stderr says it
as `check` says a finding (`ddi.json: error: <where>: <message> [codebook-dangling]`).
With `--strict` the command fails, but the page is still written.

## Test form

`form` writes a test form of an instrument's DDI: one HTML page that asks its questions
one at a time and follows its routing, so you can see who is asked what. Beside each
question it shows why it's asked, the values so far and the route taken. "Random
answers" runs to the end. The page saves nothing and sends nothing.

```sh
qretools instrument export instruments/wave1.yaml -o wave1.json
qretools form wave1.json -o wave1-form.html
```

It reads any DDI-Lifecycle 4.0 JSON with an instrument in it. What it can't read is said
on stderr as `check` says a finding. Not run yet: select all that apply questions, and
loops written in a form it doesn't recognise. Checks on answers aren't run.

## Output

`check` writes `path:line:col: level: message [code]`, as compilers do, so editors and CI
can annotate it. `export` writes the DDI of every question in one document. It refuses
when the DDI would be wrong: no agency, two things sharing one DDI name, or a document
the official schema rejects. In this repository, `pnpm qretools check <dir>` runs it.

## Development

In this repository it runs from source under Node 26, which strips TypeScript's types, so
there's no build step. The published package is a bundle (`pnpm --dir packages/cli bundle`,
rolldown): `dist/qretools.js` with the core, the Qualtrics export and their dependencies
inside, since Node won't strip types under `node_modules`. The DDI schema is in a chunk of
its own, loaded only to export. It depends on nothing.

**Releasing.** Set `version` in `packages/cli/package.json`, merge, then push a tag
`cli-v<version>` (`git tag cli-v2.0.0-alpha.1 && git push origin cli-v2.0.0-alpha.1`).
`.github/workflows/release-cli.yml` checks the repository, checks that the tag names that
version, packs, installs the tarball and runs it, then stages it with provenance through
npm's trusted publishing (no token). Staged isn't public: a maintainer approves it with
2FA, `npm stage list qretools` then `npm stage approve <id>` (or on npmjs.com). Every
version goes to the dist-tag `latest`, prereleases included, so `npx qretools` runs the
newest (npm requires the tag named for a prerelease). A published version can't be
replaced: fix forward with the next one.

This is the one package that knows both the core (`@qretools/core`) and the Qualtrics
export (`@qretools/qsf`). The core knows nothing of any export target.
