<img src="assets/confident-setup-banner-radial-4s.svg" alt="Confident Setup — a luminous gateway opening onto a golden path beneath the stars" width="100%" />

# `confident-setup`: Your First AI Trace

Confident Setup takes your AI application from setup to its first trace in
Confident AI. Sign in, choose a project, and let a coding agent add tracing and
run your app. The wizard confirms the trace arrived and shows you where to find it.

- **Tracing for your stack:** Python and TypeScript use
  [`confident-trace`](https://github.com/confident-ai/confident-trace). Other
  languages use their own OpenTelemetry SDK over OTLP/HTTP.
- **Choose how to set up:** use Claude Code, Codex, or Cursor CLI, copy a prompt
  into your own coding agent, or follow the tracing quickstart by hand.
- **Reuse your credentials:** an existing `CONFIDENT_API_KEY` can skip sign-in
  and key creation after validation.
- **Confirm the first trace:** run your app once, check that Confident AI received
  it, and get the next steps if anything is missing.

## Quickstart

Run the checksum-verified standalone release from an interactive terminal:

```sh
curl -fsSL "https://www.confident-ai.com/setup.sh" | sh
```

Run from your application's directory. The wizard checks your Git state and
asks before starting a coding agent with full permissions.

## How it works

The wizard runs five labeled steps and shows the whole route up front. Before
step one it checks Git and asks explicitly before continuing in a dirty or
non-Git directory.

If the project already has a `CONFIDENT_API_KEY`, in the shell environment or in
`.env.local`, the wizard offers to reuse it instead of creating another key. It
checks the key with one read of the trace list, then skips steps one to three
and writes nothing. A key Confident AI rejects falls back to signing in. With
`--proj-id`, the key is reused only when Confident AI confirms it belongs to that
project. A reused key's project is unknown to the wizard, so the final trace link
points at the app and names the trace ID instead of opening the trace directly.

1. **Sign in.** Opens browser device pairing and retrieves onboarding state from
   Confident AI.
2. **Choose project.** Validates or selects a project and creates a
   project-scoped API key.
3. **Save credentials.** Safely merges `CONFIDENT_API_KEY` into `.env.local`,
   sets mode `0600`, and makes sure Git ignores the file.
4. **Choose how to add tracing.**
   - a detected coding agent, named in the prompt when Claude Code, Codex, or
     Cursor CLI is installed and authenticated;
   - a prompt you paste into your own coding agent;
   - the [tracing quickstart](https://www.confident-ai.com/docs/llm-tracing/quickstart),
     followed by hand.
5. **Run your app and confirm the first trace.** The agent installs
   `confident-trace` with the project's own package manager, prefers its
   automatic integrations, adds manual spans only where they do not reach, and
   runs the smallest real entry point once with test data. Python and
   TypeScript use `confident-trace`; any other language exports through its own
   OpenTelemetry SDK over OTLP/HTTP. The wizard validates the agent's structured
   result, then polls Confident AI's trace list for up to three minutes and links
   the first trace it finds.

When the agent cannot run the app, for example because a provider key or a
database is missing, it says what is needed and the exact command to run. The
wizard shows both and waits until you have run it before checking for the
trace.

Detected agents first pass executable discovery, authentication, and read-only
smoke checks (Claude plan mode, the Codex read-only sandbox, Cursor ask mode).
The wizard then shows a separate warning and asks again before starting
full-permission execution.

If the run or the trace check fails, the wizard keeps the instrumentation and
credentials in place and prints the run command, the traces link, and the
[troubleshooting guide](https://www.confident-ai.com/docs/llm-tracing/troubleshooting).

## CLI options

```text
--from <source>        Where setup was launched from (default: direct)
--project-dir <path>   Project directory (default: current directory)
--app-url <url>        Confident app URL
--api-url <url>        Confident API URL
--org-id <id>          Require this organization
--proj-id <id>         Select this project
```

The default services are `https://app.confident-ai.com` and
`https://api.confident-ai.com`.

## Security

- API keys are never included in prompts, telemetry, command arguments, or
  result files, and the wizard never prints one.
- Built-in agents receive the key only through their child-process environment.
- In the other setup modes, the run command loads the key from the ignored
  `.env.local`, so its value never enters the agent prompt.
- The canonical prompt forbids reading `.env.local` and hardcoding the key.
- Setup telemetry is best-effort, redacted, contains no secrets, and never
  blocks setup. Disable it with `CONFIDENT_TELEMETRY_DISABLED=1`.
- The wizard does not commit or push.

## Development

```sh
npm install
npm run check
npm run build
```

`src/prompt.ts` imports `prompts/tracing.md` as text, which only the bundler
resolves, so run the built CLI rather than the TypeScript entry point:

```sh
node dist/cli.js --help
```

`examples/` is git-ignored scratch space for end-to-end runs. When a sandbox
project exists at `examples/agent-sandbox`, `npm run wizard:sandbox` points the
built CLI at it; otherwise pass `--project-dir` to any throwaway folder.

`npm run build:sea` creates a Node Single Executable Application in `release/`.
Tagged releases build darwin/linux x64/arm64 archives and `SHA256SUMS`. The
install script is served by confident-ai.com from the `confident-landing`
repository and downloads those archives.

## License

[MIT](LICENSE).
