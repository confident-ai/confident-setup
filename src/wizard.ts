import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  multiselect,
  note,
  outro,
  select,
  spinner,
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
import type {
  Onboarding,
  QuestionnaireAnswer,
  QuestionnaireAnswers,
} from "./api.js";
import { ConfidentApi } from "./api.js";
import type { CliArgs } from "./args.js";
import { ensureEnvLocalIgnored, writeApiKey } from "./env.js";
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
  MANUAL_QUICKSTART_URL,
  promptDeliveryOptions,
  setupModeOptions,
  type PromptDelivery,
  type SetupMode,
} from "./modes.js";
import { buildAgentPrompt } from "./prompt.js";
import { readSetupResult, type SetupResult } from "./result.js";
import { SetupTelemetry } from "./telemetry.js";
import { verifyTestRun } from "./verification.js";

class WizardCancelledError extends Error {}

const requiredPrompt = <T>(value: T | symbol): T => {
  if (isCancel(value)) {
    cancel("Setup cancelled. No further changes were made.");
    throw new WizardCancelledError("Setup cancelled.");
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

const confirmUnsafeGitState = async (
  status: Awaited<ReturnType<typeof inspectGit>>,
): Promise<void> => {
  log.warn(describeGitStatus(status));
  const proceed = requiredPrompt(
    await confirm({
      message: status.isRepository
        ? "Continue with uncommitted changes?"
        : "Continue without Git safety checks?",
      initialValue: false,
    }),
  );
  if (!proceed) throw new WizardCancelledError("Git preflight declined.");
};

const promptQuestionnaire = async (
  onboarding: Extract<Onboarding, { state: "new_user" }>,
): Promise<QuestionnaireAnswers> => {
  let answers: QuestionnaireAnswers = {};
  for (const question of onboarding.questionnaire.questions) {
    if (question.type === "text") {
      const answer = requiredPrompt(
        await text({
          message: question.prompt,
          placeholder:
            typeof question.defaultValue === "string"
              ? question.defaultValue
              : undefined,
          defaultValue:
            typeof question.defaultValue === "string"
              ? question.defaultValue
              : undefined,
          validate: (value) => {
            if (question.required && !value.trim()) return "Required";
            if (question.maxLength && value.length > question.maxLength) {
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
          initialValue: question.defaultValue,
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
        option.acceptsCustomValue &&
        selections.includes(String(option.value)),
    );
    if (custom) {
      const customValue = requiredPrompt(
        await text({
          message: custom.customPrompt ?? "Custom value",
          validate: (value) => (value.trim() ? undefined : "Required"),
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
      "Create your first evaluation project",
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
        message: "Choose the Confident AI project for this evaluation",
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
): Promise<void> => {
  if (delivery === "clipboard") {
    await clipboard.write(prompt);
    log.success("Evaluation setup prompt copied to the clipboard.");
  } else {
    note(prompt, "Canonical evaluation setup prompt");
  }
  note(
    `Start your agent with CONFIDENT_API_KEY and CONFIDENT_SETUP_RESULT_FILE injected into its environment.\nResult file: ${resultFile}\nNever ask the agent to read .env.local.`,
    "Run with your own agent",
  );
};

const summarizeResult = (result: SetupResult, testRunUrl?: string): string => {
  const lines = [
    `Status: ${result.status}`,
    `SDKs: ${result.sdks.join(", ")}`,
    `Levels: ${result.levels.join(", ")}`,
    `Dataset: ${result.datasetSource}`,
    `Metrics: ${result.metrics.join(", ") || "none"}`,
    `Rerun: ${result.rerunCommand}`,
  ];
  if (testRunUrl) lines.push(`Test run: ${testRunUrl}`);
  if (result.errors?.length) lines.push(`Issues: ${result.errors.join("; ")}`);
  return lines.join("\n");
};

const runBuiltInMode = async (
  args: CliArgs,
  apiKey: string,
  projectId: string,
): Promise<SetupResult> => {
  const checking = spinner();
  checking.start("Checking Claude Code and Codex");
  const checks = await Promise.all(
    supportedAgents.map((agent) => checkAgent(agent, args.from)),
  );
  checking.stop("Agent checks complete");

  for (const check of checks) {
    const status = !check.discovered
      ? "not installed"
      : !check.authenticated
        ? "not authenticated"
        : !check.readOnlyReady
          ? "read-only smoke check failed"
          : "ready";
    log.info(`${check.agent.label}: ${status}`);
  }
  const readyAgents = checks
    .filter((check) => check.readOnlyReady)
    .map((check) => check.agent);
  if (!readyAgents.length) {
    throw new Error(
      "No built-in agent passed discovery, authentication, and read-only smoke checks.",
    );
  }

  const agent =
    readyAgents.length === 1
      ? readyAgents[0]!
      : requiredPrompt<AgentDefinition>(
          await select({
            message: "Choose an agent",
            options: readyAgents.map((candidate) => ({
              label: candidate.label,
              value: candidate,
            })),
          }),
        );

  note(fullPermissionWarning(agent.label), "Full-permission execution warning");
  const allowed = requiredPrompt(
    await confirm({
      message: `Allow ${agent.label} to run with full permissions now?`,
      initialValue: false,
    }),
  );
  if (!allowed) {
    throw new WizardCancelledError("Full-permission execution declined.");
  }

  const resultFile = await prepareResultFile();
  const prompt = buildAgentPrompt(args.from, resultFile.path);
  try {
    await executeAgent(
      agent,
      args.from,
      prompt,
      apiKey,
      resultFile.path,
    );
    const result = await readSetupResult(resultFile.path);
    if (result.status === "completed") {
      const verified = await verifyTestRun(
        args.apiUrl,
        args.appUrl,
        apiKey,
        projectId,
        result.testRunId!,
      );
      result.testRunUrl = verified.testRunUrl;
    }
    note(summarizeResult(result, result.testRunUrl), "Evaluation setup result");
    return result;
  } finally {
    await rm(resultFile.directory, { recursive: true, force: true });
  }
};

export const runWizard = async (args: CliArgs): Promise<void> => {
  const target = await stat(args.from).catch(() => undefined);
  if (!target?.isDirectory()) {
    throw new Error(`Project directory does not exist: ${args.from}`);
  }

  const telemetry = new SetupTelemetry(args.apiUrl);
  await telemetry.send({ event: "setup_started" });
  intro(pc.bgCyan(pc.black(" Confident Setup Wizard ")));
  log.info(
    "Build a focused, rerunnable Confident AI evaluation with DeepEval.",
  );

  try {
    const gitStatus = await inspectGit(args.from);
    if (!gitStatus.isRepository || gitStatus.dirty) {
      await confirmUnsafeGitState(gitStatus);
    } else {
      log.success("Git working tree is clean.");
    }

    const api = new ConfidentApi(args.apiUrl);
    const pairing = spinner();
    pairing.start("Creating secure browser pairing");
    const session = await api.createAuthSession();
    pairing.stop("Browser pairing ready");
    const pairingUrl = pairingUrlForApp(
      args.appUrl,
      session.verificationUriComplete,
    );
    note(
      `${pc.bold(session.userCode)}\n${pairingUrl}`,
      "Authorize Confident Setup Wizard",
    );
    await open(pairingUrl).catch(() => {
      log.warn("Could not open the browser automatically. Use the URL above.");
    });

    const waiting = spinner();
    waiting.start("Waiting for browser authorization");
    const authorization = await api.pollAuthSession(session);
    waiting.stop(
      authorization.email
        ? `Authorized as ${authorization.email}`
        : "Browser authorization complete",
    );

    const onboarding = await api.getOnboarding(authorization.setupToken);
    const completion = await chooseAndCompleteProject(
      api,
      authorization.setupToken,
      onboarding,
      args,
    );

    await writeApiKey(args.from, completion.apiKey);
    const gitignoreChanged = await ensureEnvLocalIgnored(
      args.from,
      runCommand,
    );
    log.success(
      gitignoreChanged
        ? "Saved .env.local with mode 0600 and updated .gitignore."
        : "Saved .env.local with mode 0600; it is already ignored.",
    );

    const mode = requiredPrompt<SetupMode>(
      await select({
        message: "How would you like to set up the evaluation?",
        options: setupModeOptions,
      }),
    );
    await telemetry.send({
      event: "setup_mode_selected",
      properties: { mode },
    });

    if (mode === "built-in") {
      const result = await runBuiltInMode(
        args,
        completion.apiKey,
        completion.projectId,
      );
      await telemetry.send({
        event: "setup_finished",
        properties: {
          mode,
          status: result.status,
          sdkCount: result.sdks.length,
          levelCount: result.levels.length,
          metricCount: result.metrics.length,
          verified: Boolean(result.testRunUrl),
        },
      });
      outro(
        result.status === "completed"
          ? "Evaluation created, run, and verified."
          : "Evaluation setup is saved and can be finished later.",
      );
      return;
    }

    if (mode === "own-agent") {
      const resultFile = await prepareResultFile();
      const delivery = requiredPrompt<PromptDelivery>(
        await select({
          message: "How should the agent prompt be delivered?",
          options: promptDeliveryOptions,
        }),
      );
      await showOwnAgentPrompt(
        delivery,
        buildAgentPrompt(args.from, resultFile.path),
        resultFile.path,
      );
      log.info(deferredSetupMessage(mode));
    } else {
      note(MANUAL_QUICKSTART_URL, "DeepEval evaluation quickstart");
      await open(MANUAL_QUICKSTART_URL).catch(() => undefined);
      log.info(deferredSetupMessage(mode));
    }
    await telemetry.send({
      event: "setup_deferred",
      properties: { mode },
    });
    outro("Credentials are ready. Finish the evaluation when convenient.");
  } catch (error) {
    if (error instanceof WizardCancelledError) throw error;
    await telemetry.send({
      event: "setup_failed",
      properties: {
        category: error instanceof Error ? error.name : "UnknownError",
      },
    });
    throw error;
  }
};

export const isWizardCancellation = (
  error: unknown,
): error is WizardCancelledError => error instanceof WizardCancelledError;
