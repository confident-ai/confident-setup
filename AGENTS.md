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
- Preserve `.env.local` contents when changing the Confident key, reject
  symlinks, and retain mode `0600`.
- Network behavior must be mockable; unit tests must not access the network.
- Browser auth and onboarding endpoints are existing API contracts. Validate
  their responses.
- Full-permission agent execution must always follow a separate explicit user
  confirmation.
- `prompts/evaluation.md` is the canonical agent prompt. Avoid duplicate prompt
  copies.
- Do not commit or push unless the user explicitly asks.
