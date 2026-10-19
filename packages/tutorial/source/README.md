# The QREtools tutorial

Learn QREtools by doing: 33 short lessons, each a file with a gap or two for you to fill
in. Part 1 builds a small bank of questions about a neighborhood's parks. Part 2 builds
a survey that asks them.

Every lesson works the same way. Open its file, read the comment at the top, and do
what it says. The dashed circle beside the file in the tree turns into a green tick when
you're done. Then move on to the next one.

## Before you start

1. **Make your own copy.** Press **Use this template** → **Create a new repository**,
   at the top of this page. A private repository is fine. Leave "Include all branches"
   unticked.
2. **Install the QREtools app** on your copy:
   <https://github.com/apps/qretools/installations/new>. Choose your account, then
   "Only select repositories", then your copy. Without it you can read the lessons, but
   not save.
3. **Open it in QREtools.** Go to <https://bank.qretools.com>, enter your copy as
   `owner/name`, and sign in with GitHub.
4. **Open lesson 1.** In the tree on the left, open Questions → `lesson01_intent` →
   `consent`.

**Saving:** press **Save** on each file once its tick is green. Save saves the file
that's open, to your own branch on GitHub (`qretools-<your login>`), so it's safe if you
close the tab. Nothing changes in `main` until you open a pull request and merge it:
the pull-request icon beside your branch name ("Propose changes") opens one.

**Stuck?** The finished tutorial is on the
[`solutions` branch](https://github.com/JHUCities/qretools-tutorial/tree/solutions) of the original repository. Compare your file
with the same file there.

## The lessons

**Part 1: the question bank** (Questions, in the tree)

| # | Folder | You learn |
|---|---|---|
| 1 | `lesson01_intent` | a question's parts; the intent; to-fill-in circles and the Findings list |
| 2 | `lesson02_text` | the question text; the optional title, source and note |
| 3 | `lesson03_options` | response options: codes and labels |
| 4 | `lesson04_number` | a number question: min, max, decimals |
| 5 | `lesson05_open` | a free-text question; completion (Cmd-I) |
| 6 | `lesson06_craft` | advice on wording: one question, one thing; saving |
| 7 | `lesson07_shared_scale` | shared scales; the inspector; go to a definition |
| 8 | `lesson08_use_the_name` | warnings and quick fixes |
| 9 | `lesson09_new_scale` | making a new shared scale |
| 10 | `lesson10_concept` | shared concepts |
| 11 | `lesson11_universe` | the universe: whom a question is for |
| 12 | `lesson12_instruction` | instructions to the respondent |
| 13 | `lesson13_unit` | units |
| 14 | `lesson14_select_all` | select all that apply; "None of these" |
| 15 | `lesson15_fill` | fills: an earlier answer's words in the text |
| 16 | `lesson16_required` | settings: a field every question must have |
| 17 | `lesson17_required_in` | settings: a field one folder must have |
| 18 | `lesson18_missing` | settings: missing values |
| 19 | `lesson19_select_all_storage` | settings: how select all that apply is stored |
| 20 | `lesson20_variants` | duplicates across the bank, and deliberate variants |
| 21 | `lesson21_your_own` | your own question from scratch; moving and deleting |

**Part 2: the instrument** (Instruments, in the tree)

| # | File | You learn |
|---|---|---|
| 22 | `lesson22_first_instrument` | an instrument: say, ask, the Outline |
| 23 | `lesson23_stop` | stop |
| 24 | `lesson24_branch` | if, then; whom a branch's questions are for |
| 25 | `lesson25_else_if` | else, and else if; `in {…}` |
| 26 | `lesson26_compute` | computed values; and, or |
| 27 | `lesson27_fill` | what fills a question's text |
| 28 | `lesson28_ask_twice` | asking a question twice: `as` |
| 29 | `lesson29_roster` | a roster: once per person; `{{index}}` |
| 30 | `lesson30_more` | a roster that asks "another?"; each |
| 31 | `lesson31_checks` | checks: info, warning, blocking |
| 32 | `lesson32_order` | order, timing and inputs |
| 33 | `lesson33_survey` | the whole survey; DDI and Qualtrics downloads |

## Not in the tutorial

- **A bank in another repository.** An instrument can ask questions from another
  workspace at a tag (`uses: other: owner/repo@v1`). The
  [workspace template](https://github.com/JHUCities/qretools-template) explains it.
- **`legacy`.** It's a field for migrating an older bank.

What QREtools is: [About QREtools](https://github.com/JHUCities/qretools#readme).
