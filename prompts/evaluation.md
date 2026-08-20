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
  already gathered by the wizard, honor it without asking again. Consent
  recorded as not granted withholds the model-backed metrics, never the run
  itself.
- Instrument the application only as far as the evaluation needs it. Traced
  evaluations and span-level metrics require spans, so a native DeepEval
  integration, or `@observe` on the components being evaluated, is in scope.
  Production monitoring, dashboards, and trace tagging for observability are
  not.
- Make focused changes only. Do not commit or push.

## Build the evaluation

Create and run a rerunnable multi-level evaluation using the current DeepEval
Python SDK and/or DeepEval TypeScript SDK, whichever fits this repository.

1. Confirm DeepEval is installed in the environment that will run the
   evaluation, and install it with the project's own package manager and
   virtual environment if it is missing. The Python SDK needs Python 3.9 or
   newer. Never run `deepeval login`; credentials are already configured. If
   DeepEval cannot be installed, stop and report `failed` with the reason.
2. Prefer an existing representative dataset, including one already stored on
   Confident AI. Otherwise generate goldens with `deepeval generate` rather
   than writing them by hand, honoring the consent rules above. If generation
   is declined, build a small deterministic, source-controlled fixture from
   existing non-sensitive examples.
3. Default to a traced single-turn suite whenever the application can produce
   spans: prefer a native DeepEval integration, fall back to `@observe` at the
   application entry point, run each golden through the traced application, and
   assert with the golden itself rather than a hand-built test case. Construct
   `LLMTestCase` values only in an explicit no-tracing suite, when no tracing
   path is viable, mapping each row to fields the installed SDK supports.
4. Put the suite in the project's existing evaluation directory, or in
   `tests/evals/` as `test_<app>.py`, `metrics.py`, and `.dataset.json`. Keep
   metric instances in the metrics module and import explicit lists instead of
   constructing metrics inline.
5. Keep the first suite to three to five end-to-end metrics, each testing a
   distinct failure mode, reusing the project's existing metrics and thresholds
   when it has them. Single-turn suites take single-turn metrics and multi-turn
   suites take conversational ones; never mix the two. Include only the
   reference fields the dataset actually has, since a metric needing
   `expected_output`, `retrieval_context`, or `expected_tools` fails at runtime
   without them. Prefer deterministic metrics where they answer the question,
   and express a product-specific criterion as a custom LLM-judge metric.
6. Add component metrics only where a span-level diagnosis is genuinely useful,
   and keep them inside the same traced suite rather than a separate component
   test file: attach them at the component boundary, using the SDK's staging
   helper for spans an integration creates or the metrics argument of
   `@observe` for spans you instrument, and leave the end-to-end assertion at
   the trace level. Name each list after the component it evaluates, never one
   shared list, and choose **one to three meaningful span metrics maximum**.
7. Add thread/conversational coverage only when multi-turn behavior exists,
   using simulated conversational test cases and conversational metrics.
   Record in the result which levels the suite actually evaluates.
8. Add one documented command that reruns the same evaluation, using
   `deepeval test run <path>` rather than a raw `pytest` invocation for Python
   suites. On a non-trivial dataset, a run identifier and DeepEval's own
   process-count, error-tolerance, and missing-parameter flags are worth
   setting. If Confident AI is configured, that command should also upload a
   Confident AI test run. Execute the evaluation exactly once through that
   command: every metric when model-backed runs are consented to, otherwise the
   deterministic metrics alone. Finishing without running it is not an
   acceptable outcome.
9. Rerun only to repair a failure, and only after fixing its cause. Never
   execute the evaluation, a slice of it, or an ad-hoc copy of it to explore how
   the SDK behaves: judge metrics spend money on every call, and each run that
   reaches Confident AI creates another test run, so the reported `testRunId`
   must come from the single run the documented command produced.
10. If the repository already has evaluation infrastructure, extend it instead
    of creating a parallel framework.

When an API is unclear, read the installed package's documentation, type
definitions, or source. Do not invent SDK methods, and do not learn one by
calling it: read a metric's or helper's signature rather than constructing and
running it in a scratch script.

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
  "errors": ["only for skipped metrics, partial work, or failures"]
}
```

Allowed `status` values are `completed`, `partial`, and `failed`. Allowed SDKs
are `deepeval-python` and `deepeval-typescript`. Allowed levels are `test-case`,
`span`, `trace`, and `thread`. `changedFiles`, `sdks`, `levels`,
`datasetSource`, `metrics`, and `rerunCommand` are always required. A completed
result requires `testRunId` when Confident AI is configured; omit `testRunId`
and `testRunUrl` for a local-only run. A failed result requires at least one
`errors` entry. Use repository-relative paths and never include secret values.

Report `completed` once the evaluation has actually run, naming any metric you
had to skip in `errors`. Reserve `partial` for an implementation that is
rerunnable but could not be executed at all, and never invent a test run ID.
