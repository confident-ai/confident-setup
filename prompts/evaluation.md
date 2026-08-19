# Confident AI evaluation setup

You are configuring a real, rerunnable **DeepEval evaluation** for the project in
the current working directory. This is evaluation work, not a generic tracing
integration.

## Safety and boundaries

- Never open, print, parse, search, or otherwise read `.env.local`.
- When the runtime context says Confident AI is configured, `CONFIDENT_API_KEY`
  is already available to DeepEval through the process environment or the
  project dotenv. Use it only through the SDK; never copy it into source,
  output, commands, logs, or result files.
- When the runtime context says the run is local-only, do not upload to
  Confident AI, do not read or set `CONFIDENT_API_KEY`, and do not produce a
  test run ID.
- Judge-model credentials reach DeepEval the same way. The runtime context below
  names the configured provider; select metrics that its judge can serve, and
  never read, print, or hardcode provider keys. When no judge is configured,
  ship deterministic metrics only.
- Inspect the application, package manifests, tests, and existing evaluation
  code before editing. Preserve the project's conventions.
- Obtain user consent before generating synthetic dataset rows or running
  evaluations that invoke paid models. If the runtime context records consent
  already gathered by the wizard, honor it without asking again.
- Do not add tracing unless the evaluation genuinely needs application spans,
  traces, or threads. Do not turn this task into observability setup.
- Make focused changes only. Do not commit or push.

## Build the evaluation

Create and run a rerunnable multi-level evaluation using the current DeepEval
Python SDK and/or DeepEval TypeScript SDK, whichever fits this repository.

1. Prefer an existing representative dataset. Otherwise create a small,
   deterministic, source-controlled fixture from existing non-sensitive
   examples. Do not fabricate generated examples without asking first.
2. Map every dataset row to fields compatible with the selected DeepEval test
   case type. Typical single-turn fields are `input`, `actual_output`,
   `expected_output`, `context`, `retrieval_context`, `tools_called`, and
   `expected_tools`; use only fields supported by the installed SDK. For
   conversations, preserve ordered turns and the SDK's supported scenario,
   expected-outcome, and user-description fields.
3. Cover the test-case level. Add component/span-level evaluation only when the
   app has meaningful components such as retrieval, tool use, routing, or
   generation. Choose **one to three meaningful span metrics maximum**.
4. Add trace-level metrics when the end-to-end path needs a distinct judgment.
   Add thread/conversational metrics only when multi-turn behavior exists.
5. Avoid redundant metrics across levels. Each metric must test a distinct
   failure mode and have the fields it requires. Prefer deterministic metrics
   where they answer the question; ask before any paid model-judge run.
6. Add one documented command that reruns the same evaluation. If Confident AI
   is configured, that command should also upload a Confident AI test run.
   Execute safe local checks. Run the evaluation only after satisfying the
   consent rules above.
7. If the repository already has evaluation infrastructure, extend it instead
   of creating a parallel framework.

Use current installed APIs and inspect package documentation or type definitions
when uncertain. Do not invent SDK methods.

## Required result

The environment variable `CONFIDENT_SETUP_RESULT_FILE` points to the only result
file you should write. Before finishing, write valid UTF-8 JSON there with this
exact shape:

```json
{
  "status": "completed",
  "changedFiles": ["relative/path"],
  "sdks": ["deepeval-python"],
  "levels": ["test-case", "span", "trace", "thread"],
  "datasetSource": "short description of the existing or fixture data",
  "metrics": ["metric names"],
  "rerunCommand": "exact safe command",
  "testRunId": "id returned by the completed Confident AI run",
  "testRunUrl": "optional URL returned by tooling",
  "errors": ["only when partial or failed"]
}
```

Allowed `status` values are `completed`, `partial`, and `failed`. Allowed SDKs
are `deepeval-python` and `deepeval-typescript`. Allowed levels are `test-case`,
`span`, `trace`, and `thread`. `changedFiles`, `sdks`, `levels`,
`datasetSource`, `metrics`, and `rerunCommand` are always required. A completed
result requires `testRunId` when Confident AI is configured; omit `testRunId`
and `testRunUrl` for a local-only run. A failed result requires at least one
`errors` entry. Use repository-relative paths and never include secret values.

If consent is needed or execution cannot finish, leave the implementation
rerunnable and report `partial` with concise errors and no invented test run ID.
