# Confident Setup Wizard

Interactive setup for a focused, rerunnable Confident AI evaluation powered by
DeepEval. The wizard pairs through the browser, creates a project API key, and
helps a coding agent build and run a multi-level evaluation.

## Run

Run the checksum-verified standalone release from an interactive terminal.

From Confident AI:

```sh
curl -fsSL "https://www.confident-ai.com/setup.sh" | sh
```

From DeepEval (asks whether to use Confident AI first):

```sh
curl -fsSL "https://deepeval.com/setup.sh" | sh
```

Answering yes signs in, saves a project API key, and verifies the run in the
cloud. Answering no skips those steps and still sets up a local DeepEval
evaluation.

Options:

```text
--from <source>        Setup entry point (deepeval asks first; default: direct)
--project-dir <path>   Project directory (default: current directory)
--app-url <url>        Confident app URL
--api-url <url>        Confident API URL
--org-id <id>          Require this organization
--proj-id <id>         Select this project
```

The default services are `https://app.confident-ai.com` and
`https://api.confident-ai.com`.

## What it does

The wizard runs six labeled steps and shows the whole route up front. Before
step one it checks Git and asks explicitly before continuing in a dirty or
non-Git directory. A DeepEval user who declines Confident AI skips the first
three steps, then still sets the judge model, adds the evaluation, and runs it
locally.

1. Opens browser device pairing and retrieves onboarding state from Confident
   AI.
2. Validates or selects a project and creates a project-scoped API key.
3. Safely merges `CONFIDENT_API_KEY` into `.env.local`, sets mode `0600`, and
   ensures the file is ignored by Git.
4. Sets up the judge model that powers LLM metrics, covering every provider
   DeepEval's `initialize_model` can select: OpenAI, Anthropic, Gemini, Azure
   OpenAI, Bedrock, OpenRouter, DeepSeek, Grok, Moonshot, LiteLLM, Portkey,
   Ollama, and any OpenAI-compatible local server. Keys already in the
   environment or `.env.local` are detected the way DeepEval resolves them and
   offered for reuse, including a key whose `USE_*` flag is not set yet. Keys
   are entered masked and merged into the same `.env.local`, along with the
   provider flag and only the settings DeepEval has no default for. Credentials
   DeepEval can infer are never demanded: Bedrock can use your AWS credential
   chain, Gemini on Vertex AI needs no key, and LiteLLM reuses an upstream one.
   Skipping is allowed and restricts the evaluation to deterministic metrics.
5. Offers three ways to add the evaluation:
   - a detected coding agent, named in the prompt when Claude Code, Codex, or
     Cursor CLI is installed and authenticated;
   - a prompt you paste into your own coding agent;
   - manual setup using the
     [evaluation quickstart](https://www.confident-ai.com/docs/llm-evaluation/quickstart),
     or the [DeepEval docs](https://deepeval.com/docs/getting-started) for a
     local-only run.
6. Runs the evaluation, validates the agent's structured result, and verifies
   its test run with the Confident API. Declining model-backed judge metrics
   still runs the deterministic ones rather than leaving the evaluation
   unexecuted.

Detected agents first pass executable discovery, authentication, and read-only
smoke checks (Claude plan mode, the Codex read-only sandbox, Cursor ask mode).
The wizard then shows a separate warning and asks again before starting
full-permission execution.

If verification fails, the wizard reports why and keeps the generated
evaluation and credentials in place instead of discarding the run.

## Security

- API keys are never included in prompts, telemetry, command arguments, or
  result files.
- Judge-model keys are typed into a masked prompt, written only to `.env.local`,
  and named in the agent prompt by environment variable, never by value.
- Built-in agents receive the key only through their child-process environment.
- Other setup modes let DeepEval load the key from the ignored `.env.local`
  without exposing its value to the agent prompt.
- The canonical prompt forbids reading `.env.local`.
- Setup telemetry is best-effort, redacted, contains no secrets, and never
  blocks setup. Disable it with `CONFIDENT_TELEMETRY_DISABLED=1`.
- The wizard does not commit or push.

## Development

```sh
npm install
npm run check
npm run build
```

`src/prompt.ts` imports `prompts/evaluation.md` as text, which only the bundler
resolves, so run the built CLI rather than the TypeScript entry point:

```sh
node dist/cli.js --help
```

`examples/` is git-ignored scratch space for end-to-end runs. When a sandbox
project exists at `examples/agent-sandbox`, `npm run wizard:sandbox` points the
built CLI at it; otherwise pass `--project-dir` to any throwaway folder.

`npm run build:sea` creates a Node Single Executable Application in `release/`.
Tagged releases build darwin/linux x64/arm64 archives and `SHA256SUMS`.
Both install scripts are served by the sites themselves, from the
`confident-landing` and `deepeval` repositories, and download those archives.
The DeepEval entry passes `--from deepeval`, so keep the two copies in sync.

## License

MIT
