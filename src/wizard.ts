import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  cancel,
  intro,
  isCancel,
  multiselect,
  note,
  outro,
  select,
  taskLog,
  text,
} from "@clack/prompts";
import clipboard from "clipboardy";
import open from "open";
import pc from "picocolors";

import {
  checkAgent,
  executeAgent,
  supportedAgents,
  type AgentDefinition,
} from "./agents.js";
import { parseAgentProgressLine } from "./agent-progress.js";
import type {
  Onboarding,
  QuestionnaireAnswer,
  QuestionnaireAnswers,
} from "./api.js";
import { ConfidentApi } from "./api.js";
import type { CliArgs } from "./args.js";
import {
  otelEndpointForKey,
  resolveCredentials,
  type Credentials,
  type KeySource,
} from "./credentials.js";
import {
  CONFIDENT_API_KEY,
  ensureEnvLocalIgnored,
  writeEnvValues,
} from "./env.js";
import { restoreTerminalFocus } from "./focus.js";
import { describeGitStatus, inspectGit, runCommand } from "./git.js";
import {
  applyCustomSelection,
  enforceExclusiveSelection,
  selectProject,
  setQuestionnaireAnswer,
  validateOrganization,
} from "./onboarding.js";
import {
  deferredSetupMessage,
  fullPermissionWarning,
  GITHUB_ISSUE_URL,
  listLabels,
  promptDeliveryOptions,
  setupModeOptions,
  SUPPORT_URL,
  TRACING_DOCS_URL,
  TRACING_QUICKSTART_URL,
  type PromptDelivery,
  type SetupMode,
} from "./modes.js";
import { buildAgentPrompt } from "./prompt.js";
import { readSetupResult } from "./result.js";
import {
  finishAgentRun,
  finishManualRun,
  nextSteps,
  type RunContext,
  type RunFinish,
  type RunIo,
} from "./run.js";
import {
  classifyErrorCode,
  FINAL_STEP,
  SetupTelemetry,
  type TelemetryEvent,
} from "./telemetry.js";
import { accent, alert, banner, brand, stepHeading } from "./theme.js";
import { log, spinner } from "./ui.js";
import {
  buildTracesUrl,
  verifyFirstTrace,
  type TraceVerification,
} from "./verification.js";

class WizardCancelledError extends Error {}

const showCancellation = (message = "Setup cancelled."): void => {
  cancel(
    [
      message,
      "",
      `If you ran into an issue, please open a GitHub issue: ${GITHUB_ISSUE_URL}`,
      "",
      pc.dim(`- Contact support: ${SUPPORT_URL}`),
      pc.dim(`- Tracing documentation: ${TRACING_DOCS_URL}`),
    ].join("\n"),
  );
};

const requiredPrompt = <T>(value: T | symbol | undefined): T => {
  if (isCancel(value)) {
    showCancellation();
    throw new WizardCancelledError("Setup cancelled.");
  }
  if (value === undefined) {
    throw new Error("The interactive prompt returned no value.");
  }
  return value as T;
};

export const pairingUrlForApp = (
  appUrl: string,
  verificationUriComplete: string,
): string => {
  const provided = new URL(verificationUriComplete);
  const configured = new URL(appUrl);
  configured.pathname = provided.pathname;
  configured.search = provided.search;
  configured.hash = provided.hash;
  return configured.toString();
};

const ignoreEnvLocal = async (projectDirectory: string): Promise<void> => {
  const changed = await ensureEnvLocalIgnored(projectDirectory, runCommand);
  if (changed) log.info("Added .env.local to .gitignore.");
};

const confirmUnsafeGitState = async (
  status: Awaited<ReturnType<typeof inspectGit>>,
): Promise<void> => {
  const proceed = requiredPrompt<"continue" | "exit">(
    await select({
      message: [
        status.isRepository
          ? `${alert(pc.bold("Git changes detected."))} This repository already has local changes:`
          : `${alert(pc.bold("Warning:"))} This folder is not a Git repository.`,
        "",
        describeGitStatus(status),
        "",
        status.isRepository
          ? `${pc.bold("Setup can continue, but its edits will be mixed with these changes. Continue?")}`
          : pc.bold("Continue without Git safety checks?"),
      ].join("\n"),
      options: [
        {
          label: "Yes",
          value: "continue",
          hint: status.isRepository
            ? "Continue with local changes"
            : "Continue without Git",
        },
        {
          label: status.isRepository
            ? "Exit and protect current changes"
            : "Exit and change directories (recommended)",
          value: "exit",
          hint: status.isRepository
            ? "Commit or stash changes, then rerun setup"
            : "Rerun setup from your project directory",
        },
      ],
    }),
  );
  if (proceed === "exit") {
    showCancellation("Setup cancelled. No changes were made by the wizard.");
    throw new WizardCancelledError("Git preflight declined.");
  }
};

/** The key itself is never shown, only where it was found. */
const chooseKeyReuse = async ({
  source,
}: {
  source: KeySource;
}): Promise<boolean> => {
  const answer = requiredPrompt<"reuse" | "new">(
    await select({
      message: `Found a Confident AI key in ${
        source === "env-local" ? ".env.local" : "your shell environment"
      }.`,
      options: [
        {
          label: "Use the Confident AI key already in this project",
          value: "reuse",
          hint: "Recommended. Skips sign-in and saves nothing new",
        },
        {
          label: "Sign in and create a new key",
          value: "new",
          hint: "Opens your browser and saves a new key to .env.local",
        },
      ],
    }),
  );
  return answer === "reuse";
};

const promptQuestionnaire = async (
  onboarding: Extract<Onboarding, { state: "new_user" }>,
): Promise<QuestionnaireAnswers> => {
  let answers: QuestionnaireAnswers = {};
  for (const question of onboarding.questionnaire.questions) {
    if (question.type === "text") {
      const defaultValue =
        typeof question.defaultValue === "string"
          ? question.defaultValue
          : undefined;
      const answer = requiredPrompt(
        await text({
          message: question.prompt,
          ...(defaultValue !== undefined
            ? { placeholder: defaultValue, defaultValue }
            : {}),
          validate: (value) => {
            const candidate = value ?? "";
            if (question.required && !candidate.trim()) return "Required";
            if (question.maxLength && candidate.length > question.maxLength) {
              return `Maximum ${question.maxLength} characters`;
            }
            return undefined;
          },
        }),
      );
      answers = setQuestionnaireAnswer(answers, question.id, answer);
      continue;
    }

    const options = question.options ?? [];
    if (question.type === "single_select") {
      const answer = requiredPrompt<QuestionnaireAnswer>(
        await select({
          message: question.prompt,
          options: options.map((option) => ({
            label: option.label,
            value: option.value,
          })),
          ...(question.defaultValue !== undefined
            ? { initialValue: question.defaultValue }
            : {}),
        }),
      );
      answers = setQuestionnaireAnswer(answers, question.id, answer);
      continue;
    }

    let selections = requiredPrompt<string[]>(
      await multiselect({
        message: question.prompt,
        options: options.map((option) => ({
          label: option.label,
          value: String(option.value),
        })),
        required: question.required,
      }),
    );
    selections = enforceExclusiveSelection(
      selections,
      options
        .filter((option) => option.exclusive)
        .map((option) => String(option.value)),
    );
    const custom = options.find(
      (option) =>
        option.acceptsCustomValue && selections.includes(String(option.value)),
    );
    if (custom) {
      const customValue = requiredPrompt(
        await text({
          message: custom.customPrompt ?? "Custom value",
          validate: (value) => (value?.trim() ? undefined : "Required"),
        }),
      );
      selections = applyCustomSelection(
        selections,
        String(custom.value),
        customValue,
      );
    }
    answers = setQuestionnaireAnswer(answers, question.id, selections);
  }
  return answers;
};

const chooseAndCompleteProject = async (
  api: ConfidentApi,
  setupToken: string,
  onboarding: Onboarding,
  args: CliArgs,
): Promise<{ apiKey: string; projectId: string }> => {
  validateOrganization(onboarding, args.orgId);

  if (onboarding.state === "new_user") {
    if (args.projId) {
      throw new Error("--proj-id cannot select a project for a new account.");
    }
    note(
      "Your browser login is new to Confident AI. Complete the short project questionnaire.",
      "Create your first project",
    );
    const questionnaireAnswers = await promptQuestionnaire(onboarding);
    return api.completeOnboarding(setupToken, {
      questionnaireVersion: onboarding.questionnaire.version,
      questionnaireAnswers,
    });
  }

  const preselected = selectProject(onboarding, args.projId);
  const project =
    preselected ??
    requiredPrompt<{ id: string; name: string }>(
      await select({
        message: "Choose the Confident AI project to send traces to",
        options: onboarding.projects
          .filter((candidate) => candidate.canCreateApiKey)
          .map((candidate) => ({
            label: candidate.name,
            value: { id: candidate.id, name: candidate.name },
          })),
      }),
    );
  return api.completeOnboarding(setupToken, { projectId: project.id });
};

/** Steps 1-3: browser pairing, project choice, and the key in `.env.local`. */
const signIn = async (
  args: CliArgs,
  telemetry: SetupTelemetry,
): Promise<Credentials> => {
  log.message(stepHeading(1));
  const api = new ConfidentApi(args.apiUrl);
  const session = await api.createAuthSession({
    source: args.from,
    ...(args.orgId ? { organizationId: args.orgId } : {}),
    ...(args.projId ? { projectId: args.projId } : {}),
  });
  telemetry.setTelemetryToken(session.telemetryToken);
  await telemetry.send({
    event: "wizard_started",
    step: "bootstrap",
    result: "succeeded",
  });
  await telemetry.send({
    event: "authentication_started",
    step: "authentication",
    result: "started",
  });
  const pairingUrl = pairingUrlForApp(
    args.appUrl,
    session.verificationUriComplete,
  );
  log.info(
    [
      pc.bold(
        "Sign in to continue setup. Your browser should have opened automatically.",
      ),
      "",
      `Verification code: ${pc.bold(session.userCode)}`,
      "",
      pc.dim(
        "If your browser did not open automatically, open the link below:",
      ),
      accent(pairingUrl),
    ].join("\n"),
  );
  await open(pairingUrl).catch(() => {
    log.warn("Could not open the browser automatically. Use the URL above.");
  });

  const waiting = spinner();
  waiting.start("Waiting for browser setup (the link remains valid briefly)…");
  const { authorization, onboarding } = await (async () => {
    try {
      const authorized = await api.pollAuthSession(session);
      const state = await api.getOnboarding(authorized.setupToken);
      return { authorization: authorized, onboarding: state };
    } catch (error) {
      waiting.error("Browser setup stopped.");
      throw error;
    }
  })();
  await restoreTerminalFocus();
  const browserProject =
    onboarding.state === "existing_user"
      ? onboarding.projects.find(
          (candidate) =>
            candidate.id === args.projId ||
            (onboarding.projects.length === 1 && candidate.canCreateApiKey),
        )
      : undefined;
  waiting.stop(
    onboarding.state === "existing_user" &&
      onboarding.organization &&
      browserProject
      ? `Browser setup complete. (org: ${accent(onboarding.organization.name)}, project: ${accent(browserProject.name)})`
      : authorization.email
        ? `Browser sign-in complete (${authorization.email}).`
        : "Browser sign-in complete.",
  );
  await telemetry.send({
    event: "authentication_completed",
    step: "authentication",
    result: "succeeded",
  });

  log.message(stepHeading(2));
  const completion = await chooseAndCompleteProject(
    api,
    authorization.setupToken,
    onboarding,
    args,
  );
  if (onboarding.state === "existing_user") {
    const project = onboarding.projects.find(
      (candidate) => candidate.id === completion.projectId,
    );
    const labels = [onboarding.organization?.name, project?.name].filter(
      Boolean,
    );
    if (labels.length && project?.id !== browserProject?.id) {
      log.success(`Project setup complete (${labels.join(" / ")}).`);
    }
  }

  log.message(stepHeading(3));
  await writeEnvValues(args.projectDir, {
    [CONFIDENT_API_KEY]: completion.apiKey,
  });
  log.success("Saved project credentials securely to .env.local.");
  await ignoreEnvLocal(args.projectDir);
  return {
    apiKey: completion.apiKey,
    projectId: completion.projectId,
    inEnvLocal: true,
    reused: false,
  };
};

/** The built-in agent gets the new key, so only the user's own shell can differ. */
const shellKeyDiffers = (credentials: Credentials): boolean => {
  const shell = process.env[CONFIDENT_API_KEY]?.trim();
  return Boolean(shell) && shell !== credentials.apiKey;
};

const prepareResultFile = async (): Promise<{
  directory: string;
  path: string;
}> => {
  const directory = await mkdtemp(join(tmpdir(), "confident-setup-"));
  return { directory, path: join(directory, "result.json") };
};

const showOwnAgentPrompt = async (
  delivery: PromptDelivery,
  prompt: string,
  resultFile: string,
  keyInEnvLocal: boolean,
): Promise<void> => {
  if (delivery === "clipboard") {
    try {
      await clipboard.write(prompt);
      log.success("Copied the tracing setup prompt to the clipboard.");
    } catch (error) {
      log.warn(
        `Could not copy the prompt: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.stdout.write(`\n${prompt}\n\n`);
    }
  } else {
    process.stdout.write(`\n${prompt}\n\n`);
  }
  note(
    [
      "Paste the prompt into your coding agent as the next message.",
      "Let it add tracing and run your app on a batch of sample inputs.",
      "Come back here and confirm when it is done.",
      "",
      keyInEnvLocal
        ? "The prompt tells the agent to load CONFIDENT_API_KEY from .env.local without reading it."
        : "Your key is in your shell environment, not .env.local. Make sure your agent's shell has CONFIDENT_API_KEY.",
      `The prompt already includes the result path: ${resultFile}`,
    ].join("\n"),
    "What to do next",
  );
};

const completionOutro = (finish: RunFinish): string =>
  [
    finish === "verified"
      ? `${brand("Confident AI")} ${pc.dim("tracing setup complete. Your first trace is in.")}`
      : `${brand("Confident AI")} ${pc.dim("tracing setup finished without a confirmed trace.")}`,
    "",
    `If you encountered an issue, please open a GitHub issue: ${GITHUB_ISSUE_URL}`,
    "",
    pc.dim(`- Contact support: ${SUPPORT_URL}`),
    pc.dim(`- Tracing documentation: ${TRACING_DOCS_URL}`),
  ].join("\n");

const completionTelemetry = (
  finish: RunFinish,
): Pick<TelemetryEvent, "step" | "result"> =>
  finish === "verified"
    ? { step: FINAL_STEP, result: "succeeded" }
    : finish === "deferred"
      ? { step: "configuration", result: "cancelled" }
      : { step: FINAL_STEP, result: "failed" };

const verifyWithProgress = async (
  args: CliArgs,
  credentials: Credentials,
  since: Date,
): Promise<TraceVerification> => {
  const waiting = spinner();
  const label = "Waiting for the first trace to reach Confident AI";
  waiting.start(`${label}…`);
  try {
    const result = await verifyFirstTrace(
      {
        apiUrl: credentials.apiUrl ?? args.apiUrl,
        appUrl: args.appUrl,
        apiKey: credentials.apiKey,
        projectId: credentials.projectId,
        since,
      },
      {
        onPoll: (elapsedMs) =>
          waiting.message(
            `${label} (${Math.round(elapsedMs / 1000)}s, up to 3 minutes)…`,
          ),
      },
    );
    if (result.status === "found") waiting.stop("First trace found.");
    else if (result.status === "timeout") waiting.error("No trace yet.");
    else waiting.error("Could not check for traces.");
    return result;
  } catch (error) {
    waiting.error("Could not check for traces.");
    return {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
      tracesUrl: buildTracesUrl(args.appUrl, credentials.projectId),
    };
  }
};

const runIo = (
  args: CliArgs,
  credentials: Credentials,
  since: Date,
): RunIo => ({
  info: (message) => log.info(message),
  warn: (message) => log.warn(message),
  note: (message, title) => note(message, title),
  confirmRan: async (message) =>
    requiredPrompt<boolean>(
      await select<boolean>({
        message,
        options: [
          {
            label: "I ran it",
            value: true,
            hint: "Check Confident AI for the first trace",
          },
          {
            label: "I'll do it later",
            value: false,
            hint: "Keep the changes and finish on your own",
          },
        ],
      }),
    ),
  verify: () => verifyWithProgress(args, credentials, since),
});

const executeAgentWithProgress = async (
  agent: AgentDefinition,
  projectDirectory: string,
  prompt: string,
  apiKey: string,
  resultFile: string,
): Promise<void> => {
  const output = taskLog({
    title: `Running ${agent.label} to add tracing`,
    limit: 9,
    spacing: 0,
    retainLog: false,
  });
  let lastLine: string | undefined;
  output.message("Starting agent…");
  try {
    await executeAgent(
      agent,
      projectDirectory,
      prompt,
      apiKey,
      resultFile,
      undefined,
      (line) => {
        for (const message of parseAgentProgressLine(
          agent.kind,
          line,
          projectDirectory,
        )) {
          if (message === lastLine) continue;
          lastLine = message;
          output.message(message);
        }
      },
    );
    output.success(`${agent.label} finished.`);
  } catch (error) {
    output.error(`${agent.label} failed.`);
    throw error;
  }
};

const discoverReadyAgents = async (
  projectDirectory: string,
): Promise<AgentDefinition[]> => {
  const checking = spinner();
  checking.start("Searching for available coding agents…");
  const checks = await Promise.all(
    supportedAgents.map((agent) => checkAgent(agent, projectDirectory)),
  );
  const readyAgents = checks
    .filter((check) => check.readOnlyReady)
    .map((check) => check.agent);
  if (readyAgents.length) {
    checking.stop(
      `Detected ${listLabels(
        readyAgents.map((agent) => agent.label),
        "and",
      )}.`,
    );
    return readyAgents;
  }

  checking.stop("No usable coding agents found.");
  const details = checks.map((check) => {
    const status = !check.discovered
      ? "not installed"
      : !check.authenticated
        ? "not authenticated"
        : "read-only smoke check failed";
    return `- ${check.agent.label}: ${status}`;
  });
  note(
    `${details.join("\n")}\n\nPaste the prompt into your own coding agent, or follow the tracing quickstart instead.`,
    "No agent to launch for you",
  );
  return [];
};

interface StepFive {
  args: CliArgs;
  credentials: Credentials;
  gitRoot: string | undefined;
  context: RunContext;
  io: RunIo;
}

const runBuiltInMode = async (
  { args, credentials, gitRoot, context, io }: StepFive,
  readyAgents: AgentDefinition[],
): Promise<RunFinish> => {
  if (!readyAgents.length) {
    throw new Error("No built-in coding agent is available.");
  }
  const agent =
    readyAgents.length === 1
      ? readyAgents[0]!
      : requiredPrompt<AgentDefinition>(
          await select({
            message: "Which detected agent should we launch?",
            options: readyAgents.map((candidate) => ({
              label: candidate.label,
              value: candidate,
              hint: `We run ${candidate.label} for you here`,
            })),
          }),
        );

  const permissionChoice = requiredPrompt<"proceed" | "cancel">(
    await select({
      message: `${fullPermissionWarning(agent.label)}\n\n${pc.bold("Proceed?")}`,
      options: [
        {
          label: "Confirm",
          value: "proceed",
          hint: `Run ${agent.label}`,
        },
        {
          label: "Cancel setup",
          value: "cancel",
          hint: "Exit without running the coding agent",
        },
      ],
    }),
  );
  if (permissionChoice === "cancel") {
    showCancellation("Setup cancelled. The coding agent was not started.");
    throw new WizardCancelledError("Full-permission execution declined.");
  }

  const resultFile = await prepareResultFile();
  const prompt = buildAgentPrompt({
    projectDirectory: args.projectDir,
    gitRoot,
    resultFile: resultFile.path,
    delivery: "built-in",
    keyInEnvLocal: credentials.inEnvLocal,
    shellKeyDiffers: shellKeyDiffers(credentials),
    otelEndpoint: otelEndpointForKey(credentials.apiKey),
  });
  try {
    try {
      await executeAgentWithProgress(
        agent,
        args.projectDir,
        prompt,
        credentials.apiKey,
        resultFile.path,
      );
    } catch (error) {
      log.warn(nextSteps(context));
      throw error;
    }
    return await finishAgentRun(
      await readSetupResult(resultFile.path),
      context,
      io,
    );
  } finally {
    await rm(resultFile.directory, { recursive: true, force: true });
  }
};

const runOwnAgentMode = async ({
  args,
  credentials,
  gitRoot,
  context,
  io,
}: StepFive): Promise<RunFinish> => {
  const resultFile = await prepareResultFile();
  const delivery = requiredPrompt<PromptDelivery>(
    await select({
      message: "How should we give you the prompt to paste?",
      options: promptDeliveryOptions,
    }),
  );
  await showOwnAgentPrompt(
    delivery,
    buildAgentPrompt({
      projectDirectory: args.projectDir,
      gitRoot,
      resultFile: resultFile.path,
      delivery: "pasted",
      keyInEnvLocal: credentials.inEnvLocal,
      shellKeyDiffers: shellKeyDiffers(credentials),
      otelEndpoint: otelEndpointForKey(credentials.apiKey),
    }),
    resultFile.path,
    credentials.inEnvLocal,
  );

  const decision = requiredPrompt<"finished" | "later">(
    await select({
      message:
        "After you paste the prompt into your coding agent and it finishes, continue here.",
      options: [
        {
          label: "The agent finished",
          value: "finished",
          hint: "Read its result and check for the first trace",
        },
        {
          label: "I'll finish later",
          value: "later",
          hint: "Keep the prompt and finish on your own",
        },
      ],
    }),
  );
  if (decision === "later") {
    // The agent may still write its result, so the file stays where it is.
    log.info(
      [deferredSetupMessage("own-agent"), "", nextSteps(context)].join("\n"),
    );
    return "deferred";
  }

  try {
    return await finishAgentRun(
      await readSetupResult(resultFile.path),
      context,
      io,
    );
  } finally {
    await rm(resultFile.directory, { recursive: true, force: true });
  }
};

const runManualMode = async ({
  credentials,
  context,
  io,
}: StepFive): Promise<RunFinish> => {
  await open(TRACING_QUICKSTART_URL).catch(() => undefined);
  log.info(
    credentials.inEnvLocal
      ? "CONFIDENT_API_KEY is saved in .env.local. confident-trace reads it from the environment, so load that file when you run your app."
      : "CONFIDENT_API_KEY is in your shell environment. confident-trace reads it from there.",
  );
  return finishManualRun(context, io);
};

export const runWizard = async (args: CliArgs): Promise<void> => {
  const directory = await stat(args.projectDir).catch(() => undefined);
  if (!directory?.isDirectory()) {
    throw new Error(`Project directory does not exist: ${args.projectDir}`);
  }

  intro(pc.bold("Tracing setup"));
  const telemetry = new SetupTelemetry(args.apiUrl);
  process.stdout.write(`\n${banner(process.stdout.columns ?? 80)}\n\n`);

  try {
    const gitStatus = await inspectGit(args.projectDir);
    if (!gitStatus.isRepository || gitStatus.dirty) {
      await confirmUnsafeGitState(gitStatus);
    }

    const credentials = await resolveCredentials(
      args,
      () => signIn(args, telemetry),
      {
        chooseReuse: chooseKeyReuse,
        checking: async (work) => {
          const checking = spinner();
          checking.start("Checking the key with Confident AI…");
          try {
            return await work();
          } finally {
            checking.stop();
          }
        },
        info: (message) => log.info(message),
        warn: (message) => log.warn(message),
      },
    );

    log.message(stepHeading(4));
    const readyAgents = await discoverReadyAgents(args.projectDir);
    const mode = requiredPrompt<SetupMode>(
      await select({
        message: "How should we add tracing?",
        options: setupModeOptions(readyAgents).filter(
          (option) => option.value !== "built-in" || readyAgents.length > 0,
        ),
      }),
    );
    await telemetry.send({
      event: "setup_started",
      step: "configuration",
      result: "started",
    });

    /**
     * Only traces created after this count. The app runs on this machine and
     * reads the same clock, so a minute of slack covers a run that starts the
     * moment this step does.
     */
    const since = new Date(Date.now() - 60_000);
    log.message(stepHeading(5));
    const stepFive: StepFive = {
      args,
      credentials,
      gitRoot: gitStatus.gitRoot,
      context: {
        appUrl: args.appUrl,
        projectId: credentials.projectId,
        apiKey: credentials.apiKey,
      },
      io: runIo(args, credentials, since),
    };
    const finish =
      mode === "built-in"
        ? await runBuiltInMode(stepFive, readyAgents)
        : mode === "own-agent"
          ? await runOwnAgentMode(stepFive)
          : await runManualMode(stepFive);

    await telemetry.send({
      event: "setup_completed",
      ...completionTelemetry(finish),
    });
    outro(completionOutro(finish));
  } catch (error) {
    if (error instanceof WizardCancelledError) throw error;
    await telemetry.send({
      event: "setup_failed",
      step: "configuration",
      result: "failed",
      errorCode: classifyErrorCode(error),
    });
    throw error;
  }
};

export const isWizardCancellation = (
  error: unknown,
): error is WizardCancelledError => error instanceof WizardCancelledError;
