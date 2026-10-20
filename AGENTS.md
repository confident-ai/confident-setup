# Agent guide

## Purpose

This repository contains the standalone Confident Setup Wizard. Keep it focused
on adding Confident AI tracing to an application, running it once, and
confirming the first trace arrived.

The one addition: while it orients, the agent writes the issues this
application is likely to have to `CONFIDENT_SETUP_ISSUES_FILE`, and
`src/issues.ts` adds them as labels to the project's "Issues" classifier
(exactly that name, created if missing) before the batch runs, so the first
traces are checked for them. That upload stops at its first failure and never
fails setup.

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
  API key or setup token. Anything the wizard shows from an agent's result goes
  through `src/run.ts`, which scrubs the key.
- Preserve `.env.local` contents when changing the Confident key, reject
  symlinks, and retain mode `0600`.
- An existing `CONFIDENT_API_KEY`, from the shell environment first and then
  `.env.local`, is offered for reuse before step one, and the reuse path writes
  nothing. `src/credentials.ts` checks it against `GET /v2/traces?pageSize=1`:
  401 falls back to signing in, and with `--proj-id` the
  `confident-project-id` header must be accepted, since the API answers 400 for
  a key from another project. The license gate answers 403 before the key is
  looked at, so a 403 never confirms `--proj-id`.
- Network behavior must be mockable; unit tests must not access the network.
- Browser auth and onboarding endpoints are existing API contracts. Validate
  their responses.
- Full-permission agent execution must always follow a separate explicit user
  confirmation.
- Every agent in `src/agents.ts` needs a genuinely read-only invocation for its
  smoke check, a status command, and a `src/agent-progress.ts` parser. Those
  flags are third-party contracts: check them against the vendor's current CLI
  reference rather than from memory, since a wrong flag lands on a real project.
- `prompts/tracing.md` is the canonical agent prompt. Avoid duplicate prompt
  copies. It mirrors confident-trace's own skills, `skills/confident-tracing`
  and `skills/confident-otel` in the confident-trace repository, so keep it
  aligned with them: automatic integrations first, manual spans only where
  integrations do not reach, AI components only, and no evaluation work beyond the issues file.
- Every API name, import path, flag, and environment variable the prompt names
  is a third-party contract. Check it against confident-trace's
  `python/README.md`, `typescript/README.md`, and the package sources rather
  than from memory: `init()`, the `confident-trace/register` preload, the manual
  adapters, `span`/`withSpan`, `update_trace`/`updateTrace`, `turn`, the
  `confident-trace[openai-agents]` extra, `CONFIDENT_OTEL_ENDPOINT`, and the
  Python 3.10 and Node.js 22 floors. TypeScript has no exit hook, so the prompt
  must keep requiring `await tracing.shutdown()` in short-lived scripts.
- Languages without a confident-trace package export through their own
  OpenTelemetry SDK over OTLP/HTTP with protobuf, never gRPC, with the
  `x-confident-api-key` header. The prompt makes the agent confirm the endpoint,
  protocol, and header against
  https://www.confident-ai.com/docs/integrations/opentelemetry before writing
  code, and stop when it cannot. The region endpoint comes from the key's
  `confident_eu_` prefix; only the endpoint is passed to the prompt, never the
  key.
- confident-trace reads `CONFIDENT_API_KEY` from the environment and does not
  load `.env.local`, so the prompt has the run command load that file without
  reading it, unless the application already uses a dotenv loader.
- The agent runs the application once, with test data and no side effects. When
  it needs secrets or services that are not available, it reports `partial`
  with what is needed and the exact command, and never fakes the run.
- `src/result.ts` is the result contract: `completed` means the app ran,
  `partial` means it did not and says what the user must provide, and `failed`
  carries errors. A rejected result still has its run command and changed files
  salvaged, and the trace check is still offered.
- Trace verification uses the documented `GET /v2/traces` with the
  `CONFIDENT_API_KEY` header the API reads, never `x-confident-api-key` or a
  bearer token on the API host. It counts only traces created since one minute
  before step five, checks `traces.length` rather than the cached
  `totalTraces`, and polls every five seconds for up to three minutes. Links use
  `/project/<id>/observatory/traces`.
- Once traces arrive, polling stops and the wizard opens the browser: a new
  account goes to `/onboarding`, which shows its first traces arriving and then
  opens the project's traces; anyone else goes to
  `/project/<id>/observatory/traces`, or the app when a reused key leaves the
  project unknown. It never opens one over SSH, in CI, or without a TTY, and it
  always prints the link. Success ends on a congratulations panel and an outro
  with no issue or support links; only other endings point at help.
- Failure never removes anything: instrumentation and credentials stay in
  place, and the wizard prints the run command, the traces link, and the
  troubleshooting docs.
- The telemetry contract has no tracing step yet. Send only existing wire
  values; `FINAL_STEP` in `src/telemetry.ts` stays `evaluation` until the
  backend adds one.
- DeepEval appears nowhere in this repository's user-facing surface: source,
  prompts, copy, README, or package metadata. `tests/copy.test.ts` enforces it.
  The evaluation wizard lives in the DeepEval repository.
- Copy is plain, short sentences with no emoji.
- `examples/` is git-ignored scratch space for manual end-to-end runs, never
  part of the published package.
- Terminal color must go through `src/theme.ts`, which honors `NO_COLOR` and
  non-TTY output. Brand violet is only the Confident AI wordmark and name;
  everything else the wizard highlights uses the cyan accent, plus ember for
  problems, so do not add hues. Clack's own blue/green/yellow symbols are
  re-themed in `src/ui.ts`; import `log` and `spinner` from there rather than
  from `@clack/prompts`.
- Do not commit or push unless the user explicitly asks.
