# Agent Instructions

## Commands

- Build: `npm run build` (tsc, outputs to `lib/`)
- Test one file or case: `npx vitest run test/index.test.ts -t "<name>"`. Use this while working.
- Full test suite: `npx vitest run`. Plain `npm test` starts watch mode, so don't use it.
- Type-check: `npx tsc --noEmit`. No linter or formatter is configured.

## Conventions

- Probot app (ESM, `"type": "module"`): relative imports need the `.js` extension.
- Tests mock GitHub with `nock`; fixtures live in `test/fixtures/`.

## Warnings

- Commits and PR titles must follow Conventional Commits (commitlint enforces it). semantic-release
  derives the version from them on every push to `main`; don't edit `version` in `package.json`.
- `lib/` is build output; never edit it by hand.
- Never commit `.env` or `*.pem` files (see `.env.example`).

## Housekeeping

- Delete branches, local and remote, whose work is finished: the pull request is merged or closed
  and the branch has no commits that are not already in it. Squash merges hide this from
  `git branch --merged`, so match each branch to its pull request and compare the branch tip with
  the pull request's head commit.
- Never delete the default or integration branches, a branch with an open pull request, or one with
  commits its pull request lacks; list those instead. Remove a worktree only after checking it has
  no uncommitted changes.

## Subagents

You are the only agent that edits files. Subagents only read and report. Use the `delegate` skill
before starting one, and the `progress-notes` skill for work that spans sessions.

## Single source for all AI tools

- Instructions: `AGENTS.md` only. `CLAUDE.md`, `.gemini/settings.json` and
  `.github/copilot-instructions.md` point to it; never add rules to them.
- Skills: `.agents/skills/` only. `.claude/skills` and `.github/skills` are symlinks to it.
- Roles: `.rulesync/subagents/` only. Every other role directory is generated output.

## More context

- `.out-of-scope/` lists ideas that were considered and rejected. Check it before proposing a
  feature.
