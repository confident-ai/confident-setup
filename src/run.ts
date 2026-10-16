import pc from "picocolors";

import {
  deferredSetupMessage,
  TRACING_QUICKSTART_URL,
  TRACING_TROUBLESHOOTING_URL,
} from "./modes.js";
import type { SetupResult, SetupResultOutcome } from "./result.js";
import { accent, alert } from "./theme.js";
import { buildTracesUrl, type TraceVerification } from "./verification.js";

/** How step 5 ended, which decides the outro and the telemetry result. */
export type RunFinish = "verified" | "unverified" | "deferred" | "failed";

export interface RunContext {
  appUrl: string;
  /** Unknown when an existing key was reused, so links fall back to the app. */
  projectId?: string | undefined;
  /** Held only to scrub it from anything shown. It is never printed. */
  apiKey: string;
}

/**
 * Everything step 5 does to the outside world, so the flow can be tested
 * without a terminal or a network. None of it can delete files: whatever the
 * agent or the user added stays in place whatever happens here.
 */
export interface RunIo {
  info: (message: string) => void;
  warn: (message: string) => void;
  note: (message: string, title: string) => void;
  /** Ask whether the app has run. True means check for the trace now. */
  confirmRan: (message: string) => Promise<boolean>;
  /** Poll Confident AI for the first trace. */
  verify: () => Promise<TraceVerification>;
}

/** An agent can echo the key into a command; this keeps it off the screen. */
const guard = (context: RunContext, io: RunIo): RunIo => {
  const scrub = (text: string): string =>
    context.apiKey ? text.replaceAll(context.apiKey, "[redacted]") : text;
  return {
    ...io,
    info: (message) => io.info(scrub(message)),
    warn: (message) => io.warn(scrub(message)),
    note: (message, title) => io.note(scrub(message), title),
    confirmRan: (message) => io.confirmRan(scrub(message)),
  };
};

const bullets = (items: string[]): string[] =>
  items.map((item) => `  - ${item}`);

export const summarizeResult = (result: SetupResult): string => {
  const lines = [
    `Status: ${
      result.status === "completed"
        ? accent(result.status)
        : alert(result.status)
    }`,
    `SDKs: ${result.sdks.join(", ") || "none"}`,
    `Integrations: ${result.integrations.join(", ") || "none"}`,
    `Changed files: ${result.changedFiles.join(", ") || "none"}`,
  ];
  if (result.runCommand.trim()) {
    lines.push(`Run command: ${pc.bold(result.runCommand)}`);
  }
  lines.push(`App ran: ${result.runSucceeded ? "yes" : "no"}`);
  if (result.errors?.length) {
    lines.push("Issues:", ...bullets(result.errors));
  }
  return lines.join("\n");
};

/** Printed whenever step 5 ends without a confirmed trace. */
export const nextSteps = (context: RunContext, runCommand?: string): string =>
  [
    "Your tracing changes and credentials were left in place.",
    "Next steps:",
    ...(runCommand?.trim() ? [`  - Run your app: ${pc.bold(runCommand)}`] : []),
    `  - Look for its traces: ${accent(
      buildTracesUrl(context.appUrl, context.projectId),
    )}`,
    `  - If none arrive, see ${accent(TRACING_TROUBLESHOOTING_URL)}`,
  ].join("\n");

const verifyAndReport = async (
  context: RunContext,
  io: RunIo,
  runCommand?: string,
): Promise<RunFinish> => {
  const verification = await io.verify();
  if (verification.status === "found") {
    const { trace } = verification;
    io.note(
      [
        `Trace: ${trace.name ?? "unnamed"}`,
        ...(verification.traceUrl
          ? [accent(verification.traceUrl)]
          : [
              `Trace ID: ${trace.uuid}`,
              `Open ${accent(context.appUrl)} and find this trace in the project this key belongs to.`,
            ]),
      ].join("\n"),
      "First trace received",
    );
    return "verified";
  }
  io.warn(
    verification.status === "timeout"
      ? "No trace reached Confident AI within 3 minutes."
      : verification.message,
  );
  io.info(nextSteps(context, runCommand));
  return "unverified";
};

const askToRun = (needs: string[], runCommand?: string): string =>
  [
    ...(needs.length
      ? ["Before your app can run, you need to:", ...bullets(needs), ""]
      : []),
    ...(runCommand?.trim()
      ? ["Run your app with:", pc.bold(runCommand), ""]
      : ["Run your app once with tracing in place.", ""]),
    pc.bold("Did you run it?"),
  ].join("\n");

/**
 * Step 5 after an agent, built in or pasted, has written its result: verify a
 * completed run, ask the user to run a partial one first, and explain a failed
 * one. A result the contract rejects is still worth checking, since the agent
 * may have run the app before it misreported.
 */
export const finishAgentRun = async (
  outcome: SetupResultOutcome,
  context: RunContext,
  rawIo: RunIo,
): Promise<RunFinish> => {
  const io = guard(context, rawIo);

  if (!outcome.ok) {
    const { runCommand, changedFiles } = outcome.rejected.salvaged;
    io.warn(
      [
        "The agent's result could not be used:",
        ...bullets(outcome.rejected.issues),
        ...(changedFiles?.length
          ? [`Changed files: ${changedFiles.join(", ")}`]
          : []),
      ].join("\n"),
    );
    if (!(await io.confirmRan(askToRun([], runCommand)))) {
      io.info(nextSteps(context, runCommand));
      return "deferred";
    }
    return verifyAndReport(context, io, runCommand);
  }

  const { result } = outcome;
  io.note(summarizeResult(result), "Tracing setup result");

  if (result.status === "failed") {
    io.info(nextSteps(context, result.runCommand));
    return "failed";
  }
  if (result.status === "partial") {
    const ran = await io.confirmRan(
      askToRun(result.needsFromUser ?? [], result.runCommand),
    );
    if (!ran) {
      io.info(nextSteps(context, result.runCommand));
      return "deferred";
    }
  }
  return verifyAndReport(context, io, result.runCommand);
};

/** Step 5 when the user adds tracing by hand. No result file, no trace id. */
export const finishManualRun = async (
  context: RunContext,
  rawIo: RunIo,
): Promise<RunFinish> => {
  const io = guard(context, rawIo);
  const ran = await io.confirmRan(
    [
      "Follow the tracing quickstart for your project:",
      accent(TRACING_QUICKSTART_URL),
      "",
      pc.bold("Did you run your app?"),
    ].join("\n"),
  );
  if (!ran) {
    io.info(
      [deferredSetupMessage("manual"), "", nextSteps(context)].join("\n"),
    );
    return "deferred";
  }
  return verifyAndReport(context, io);
};
