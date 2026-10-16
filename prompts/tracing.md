# Confident AI tracing setup

You are adding Confident AI tracing to the AI application in the current working
directory, running it once, and reporting what happened. Tracing means the
application's LLM calls, agent steps, tool calls, and retrieval show up as spans
in Confident AI.

Work through the steps in order. Read before you write, and do not invent an
API: every name below comes from the `confident-trace` documentation, and its
README is the authority when anything here is unclear:

- Python: https://github.com/confident-ai/confident-trace/blob/main/python/README.md
- TypeScript and JavaScript:
  https://github.com/confident-ai/confident-trace/blob/main/typescript/README.md

## Safety and boundaries

- Never open, print, parse, search, or otherwise read `.env.local`.
- Never hardcode `CONFIDENT_API_KEY`, and never print it or copy its value into
  source, commands, logs, or the result file. The runtime context says where it
  is.
- Tracing only. Do not add evaluations, metrics, datasets, or test suites, and
  do not refactor code that tracing does not need.
- Keep the diff small. Tracing must not change what the application returns, and
  must not break its build, tests, or startup.
- Instrument AI components only: LLM calls, agent loops, tool calls, and
  retrieval. Do not trace web servers, databases, or other infrastructure.
- Do not check for the trace in Confident AI yourself. The setup wizard does
  that after you finish.
- Do not commit or push.

## Step 1 — Orient

1. Read the repository from the git root in the runtime context, so a monorepo's
   workspaces, shared packages, and scripts make sense. Only instrument
   applications in or below the working directory. A workspace lockfile at the
   root may still change when you install a dependency, and that is fine.
2. For each application there, note its language and runtime version, its
   package manager, its entry point, and the LLM providers and frameworks it
   calls, such as OpenAI, Anthropic, LangChain, LangGraph, LlamaIndex, CrewAI,
   Pydantic AI, the OpenAI Agents SDK, the Vercel AI SDK, or Mastra. Note whether
   its code is bundled (webpack, Vite, esbuild, or a framework that bundles
   server code) and whether it already sets up OpenTelemetry.
3. If nothing here calls an LLM, retrieves documents, or uses tools, stop and
   report `failed` with that reason.
4. Python, JavaScript, and TypeScript applications follow step 2. Any other
   language follows step 3.

## Step 2 — Python, JavaScript, and TypeScript: `confident-trace`

Install `confident-trace` as a regular dependency with the project's own package
manager: pip, uv, or Poetry for Python; npm, pnpm, Yarn, or Bun for JavaScript
and TypeScript. It needs Python 3.10 or newer, or Node.js 22 or newer. If the
project's runtime is older, do not upgrade it or force the install: report
`failed` with the version you found.

Use the automatic integrations first. Add manual spans only where they do not
reach.

### Python

Call `init()` once at startup, before the application creates model clients or
imports function aliases an integration has to wrap:

```python
import confident_trace as ct

ct.init()
```

`init()` reads `CONFIDENT_API_KEY` from the environment and instruments the
supported SDKs that are installed: OpenAI, Anthropic, Google GenAI, Bedrock,
LangChain, LangGraph, LlamaIndex, CrewAI, Pydantic AI, Agno, smolagents, Google
ADK, Strands, LiteLLM, and the others the README lists. Do not wrap calls an
integration already covers.

The OpenAI Agents SDK needs the extra: install `confident-trace[openai-agents]`
instead of `confident-trace`.

Python registers its own shutdown when the interpreter exits, so a script that
ends normally flushes its spans. A process that exits with `os._exit` must call
`ct.shutdown()` first.

### JavaScript and TypeScript

Automatic instrumentation needs both parts:

1. `init()` once in the existing entry file, before application work:

   ```ts
   import { init } from "confident-trace";

   const tracing = init();
   ```

2. The preload, added to the start command the project already uses, keeping
   its entry filename:

   ```sh
   node --import confident-trace/register dist/index.js
   node --import tsx --import confident-trace/register src/index.ts
   ```

   Put it in the package script that starts the application.

This covers OpenAI, Anthropic, Google GenAI, the Vercel AI SDK, LangChain,
LangGraph, Mastra, and OpenAI Agents.

The preload cannot instrument SDK code a bundler has packed into the
application. A bundled application calls `init({ instrumentations: [] })` and
uses the matching manual adapter instead. Read that adapter's README section
before writing it.

- OpenAI: `instrumentOpenAI(client)` from `confident-trace/openai`.
- Anthropic: `instrumentAnthropic(client)` from `confident-trace/anthropic`.
- Google GenAI: `instrumentGoogleGenAI(client)` from
  `confident-trace/google-genai`.
- LangChain or LangGraph: `new ConfidentLangChainCallbackHandler()` from
  `confident-trace/langchain`, or `new ConfidentLangGraphCallbackHandler()` from
  `confident-trace/langgraph`, in the root invocation's `callbacks`.
- Vercel AI SDK: `createVercelAITracer()` from `confident-trace/vercel-ai`,
  passed as the tracer of `@ai-sdk/otel`'s `OpenTelemetry` integration.
- Mastra: `new ConfidentMastraExporter()` from `confident-trace/mastra`, in
  Mastra's observability exporters.
- OpenAI Agents: `new ConfidentOpenAIAgentsProcessor()` from
  `confident-trace/openai-agents`, registered with `addTraceProcessor`.

JavaScript and TypeScript have no exit hook. A short-lived script must
`await tracing.shutdown()` before it exits, in a `finally` block, or its spans
are lost. A server shuts tracing down in its existing graceful-shutdown path,
never after each request.

### An existing OpenTelemetry setup

If the application already owns a tracer provider, keep it. In Python, pass it
to `init(tracer_provider=provider)`. In TypeScript, add `createSpanProcessor()`
from `confident-trace/otel` where the provider is constructed, since `init()`
cannot attach to an existing provider. Never register a second global provider.

### Manual spans

Add a span only around an entry point or component no integration sees, such as
the function that handles one user request, or a tool the framework does not
trace. Span types are `agent`, `llm`, `retriever`, `tool`, and `custom`.

```python
@ct.span(type="tool")
def lookup_order(order_id: str) -> dict: ...

with ct.span("answer", type="agent", input=question):
    ...
```

```ts
import { span, withSpan } from "confident-trace";

const lookupOrder = span({ name: "lookup_order", type: "tool" }, fetchOrder);
const answer = await withSpan({ name: "answer", type: "agent" }, async () => {
  /* ... */
});
```

### Threads and users

Only when the code already has a conversation, session, or user id that reaches
the traced code. Never invent one.

- Python: `ct.update_trace(thread_id=..., user_id=...)`, or
  `with ct.turn(thread_id=..., turn_id=...):` around each conversation turn.
- TypeScript: `updateTrace({ threadId, userId })`, or
  `await turn({ threadId, turnId }, async () => { ... })` around each turn.

## Step 3 — Any other language: OpenTelemetry

`confident-trace` has no package for this language, so use the language's own
OpenTelemetry SDK and export straight to Confident AI. Before writing any code,
open https://www.confident-ai.com/docs/integrations/opentelemetry and confirm
these three values. If the page does not confirm all three, stop, change
nothing, and report `failed` naming what you could not confirm.

- Protocol: OTLP over HTTP with protobuf encoding. Not gRPC.
- Endpoint: the OTLP traces endpoint in the runtime context, which is
  `https://otel.confident-ai.com/v1/traces`, or
  `https://eu.otel.confident-ai.com/v1/traces` for an EU key. When you configure
  it through `OTEL_EXPORTER_OTLP_ENDPOINT`, give the base URL without
  `/v1/traces`, since the SDK appends it.
- Header: `x-confident-api-key`, its value read from `CONFIDENT_API_KEY` in the
  environment at runtime.

Then:

1. Add the SDK and its OTLP/HTTP exporter with the project's own dependency
   tooling.
2. Attach the exporter through a batch span processor. If the application
   already has a tracer provider, add the processor to it instead of registering
   a second one.
3. Wrap the AI components in spans. Set `confident.span.type` to `llm`, `tool`,
   `agent`, `retriever`, or `base`, and `confident.span.input` and
   `confident.span.output` as strings. Look up any other `confident.*` attribute
   on the docs page rather than guessing it.
4. Flush or shut down the provider before a short-lived process exits.

## Step 4 — Load the key without reading it

`confident-trace` reads `CONFIDENT_API_KEY` from the process environment. It does
not load `.env` or `.env.local`.

- If the application already loads a dotenv file, make sure `.env.local` is
  loaded the way its loader does it, before `init()` runs.
- Otherwise load it in the run command, without displaying it:
  `node --env-file=.env.local ...`, `uv run --env-file .env.local ...`, or
  `set -a; . ./.env.local; set +a; ...`.
- When the runtime context says the key is in the shell environment rather than
  `.env.local`, rely on the environment and load no file.

`confident-trace` sends to the US endpoint by default. For an EU key, set
`CONFIDENT_OTEL_ENDPOINT` to the EU traces endpoint from the runtime context in
the run command or the application's existing non-secret config, or pass it to
`init()` as `endpoint`. The endpoint is not a secret.

## Step 5 — Run the application once

Find the smallest real entry point that reaches an LLM call: a script, a CLI
command, an existing test, or a local server plus one request. Send it one
representative input made of test data.

- No side effects. Do not send messages, emails, or notifications, charge
  cards, or write to production data. If the only entry point would, report
  `partial` instead of running it.
- If the run needs secrets or services you do not have, such as a model
  provider key that is not set, a database, or a queue, do not fake them, mock
  the model, or stub the call. Report `partial`, list exactly what is needed in
  `needsFromUser`, and put the exact command in `runCommand`.
- Run it once. If it fails because of your tracing change, fix that and run it
  once more. If it fails for an unrelated reason, report `partial`.
- `runCommand` is the command the user can paste into a fresh shell in the
  working directory to repeat the run, including how it loads the key, but
  never the key itself.

## Step 6 — Report

Write the result file described below. Then finish with a short summary in plain
sentences, under eight lines: what you changed in each file, which integrations
you used, the run command on its own line, and whether the run succeeded. Do not
paste the result JSON or list its fields again, since the wizard prints them. No
secrets.

## Required result

Write the result to the path in the `CONFIDENT_SETUP_RESULT_FILE` environment
variable. If that variable is not set, use the result destination from the
runtime context. It is the only file outside the project you may write. Before
finishing, write valid UTF-8 JSON there with this exact shape:

```json
{
  "status": "completed",
  "changedFiles": ["relative/path"],
  "sdks": ["confident-trace-python"],
  "integrations": ["OpenAI"],
  "runCommand": "exact command",
  "runSucceeded": true,
  "needsFromUser": ["only when status is partial"],
  "errors": ["only for problems worth reporting"]
}
```

- `status` is `completed`, `partial`, or `failed`.
  - `completed`: tracing is added and the run command succeeded, so
    `runSucceeded` is `true`.
  - `partial`: tracing is added but the application could not be run here, so
    `runSucceeded` is `false` and `needsFromUser` lists what the user must
    provide.
  - `failed`: tracing could not be added. `errors` says why.
- `sdks` lists what you used: `confident-trace-python`,
  `confident-trace-typescript` (also for JavaScript), or `opentelemetry`. At
  least one is required unless the status is `failed`.
- `integrations` names the integrations, adapters, or manual spans you used,
  such as `OpenAI`, `LangGraph`, or `manual spans`. It may be empty.
- `changedFiles` lists the files you added or edited, relative to the working
  directory.
- `runCommand` is required unless the status is `failed`.
- `runSucceeded` is `true` only when the run command exited successfully after
  reaching at least one traced LLM call.

Never include secret values. Report what actually happened, and never claim a
run that did not happen.
