# Confident Setup Wizard

Interactive setup for a focused, rerunnable Confident AI evaluation powered by
DeepEval. The wizard pairs through the browser, creates a project API key, and
helps a coding agent build and run a multi-level evaluation.

## Run

Run the checksum-verified standalone release from an interactive terminal:

```sh
curl -fsSL "https://www.confident-ai.com/wizard/setup.sh" | sh
```

Options:

```text
--from <source>   Setup entry point attribution (default: direct)
--project-dir <path>
                    Project directory (default: current directory)
--app-url <url>   Confident app URL
--api-url <url>   Confident API URL
--org-id <id>     Require this organization
--proj-id <id>    Select this project
```

The default services are `https://app.confident-ai.com` and
`https://api.confident-ai.com`.

## What it does

1. Checks Git and asks explicitly before continuing in a dirty or non-Git
   directory.
2. Opens browser device pairing and retrieves onboarding state from Confident
   AI.
3. Validates or selects a project and creates a project-scoped API key.
4. Safely merges `CONFIDENT_API_KEY` into `.env.local`, sets mode `0600`, and
   ensures the file is ignored by Git.
5. Offers three evaluation setup modes:
   - built-in Claude Code or Codex;
   - your own agent via a copied or printed prompt;
   - manual setup using the
     [DeepEval quickstart](https://www.confident-ai.com/docs/llm-evaluation/quickstart).
6. Validates the agent's structured result and verifies a completed test run
   with the Confident API.

Built-in agents first pass executable discovery, authentication, and read-only
smoke checks. The wizard then shows a separate warning and asks again before
starting full-permission execution.

## Security

- API keys are never included in prompts, telemetry, command arguments, or
  result files.
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

`npm run build:sea` creates a Node Single Executable Application in `release/`.
Tagged releases build darwin/linux x64/arm64 archives and `SHA256SUMS`.

## License

MIT
