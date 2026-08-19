# Agent guide

## Purpose

This repository contains the standalone Confident Setup Wizard. Keep it focused
on creating and running evaluations, not general tracing setup.

## Commands

```sh
npm run format
npm run lint
npm run typecheck
npm test
npm run build
```

## Constraints

- Keep source TypeScript strict, ESM, modular, and dependency-injected at I/O
  boundaries.
- Never log, serialize, pass as an argument, or send telemetry containing an
  API key or setup token.
- Preserve `.env.local` contents when changing the Confident key or judge-model
  keys, reject symlinks, and retain mode `0600`.
- `src/judge.ts` mirrors DeepEval's own judge resolution: `USE_*` flags first,
  then the OpenAI fallback. Change it only against DeepEval's
  `initialize_model`, `config/settings.py`, and `models/llms/constants.py`, and
  keep judge secrets masked at entry and absent from logs and prompts, which
  name only their variables. A provider's `settings` list only what DeepEval has
  no default for, so never prompt for a value DeepEval would supply itself.
- Network behavior must be mockable; unit tests must not access the network.
- Browser auth and onboarding endpoints are existing API contracts. Validate
  their responses.
- Full-permission agent execution must always follow a separate explicit user
  confirmation.
- Every agent in `src/agents.ts` needs a genuinely read-only invocation for its
  smoke check, a status command, and a `src/agent-progress.ts` parser. Those
  flags are third-party contracts: check them against the vendor's current CLI
  reference rather than from memory, since a wrong flag lands on a real project.
- `prompts/evaluation.md` is the canonical agent prompt. Avoid duplicate prompt
  copies.
- `examples/` is git-ignored scratch space for manual end-to-end runs, never
  part of the published package. A sandbox target app there keeps its support
  history unlabeled on purpose: curating evaluation datasets is the work being
  tested, so do not add expected outputs or relevance labels to its data.
- Terminal color must go through `src/theme.ts`, which honors `NO_COLOR` and
  non-TTY output. It keeps one accent plus ember for problems, so do not add
  hues. Clack's own blue/green/yellow symbols are re-themed in `src/ui.ts`;
  import `log` and `spinner` from there rather than from `@clack/prompts`.
- Do not commit or push unless the user explicitly asks.
