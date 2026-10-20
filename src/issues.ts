import { readFile as readFileFromDisk } from "node:fs/promises";

import { z } from "zod";

import type { ConfidentApi } from "./api.js";

// Exactly this name: the classifier every new project is seeded with.
export const ISSUES_CLASSIFIER = "Issues";
const PAGE_SIZE = 100;

const issuesSchema = z
  .array(
    z.object({
      name: z.string().trim().min(1),
      description: z.string().trim().min(1),
    }),
  )
  .min(1);

export type Issue = z.infer<typeof issuesSchema>[number];

export type IssueUpload =
  | { status: "uploaded"; created: boolean; labels: number }
  | { status: "failed"; uploaded: number };

type IssuesApi = Pick<
  ConfidentApi,
  "listClassifiers" | "createClassifier" | "createClassifierLabel"
>;

/** Returns the id of the project's "Issues" classifier, creating it if missing. */
const findOrCreateIssuesClassifier = async (
  api: IssuesApi,
  apiKey: string,
): Promise<{ id: string; created: boolean }> => {
  for (let page = 1; ; page += 1) {
    const list = await api.listClassifiers(apiKey, {
      dataModel: "TRACE",
      page,
      pageSize: PAGE_SIZE,
    });
    const match = list.classifiers.find(
      (classifier) => classifier.name === ISSUES_CLASSIFIER,
    );
    if (match) return { id: match.id, created: false };
    if (!list.classifiers.length || page * PAGE_SIZE >= list.totalClassifiers) {
      break;
    }
  }
  const { id } = await api.createClassifier(apiKey, {
    name: ISSUES_CLASSIFIER,
    dataModel: "TRACE",
    preset: "ISSUES",
  });
  return { id, created: true };
};

/**
 * Adds the issues the agent wrote to the "Issues" classifier as unfavorable,
 * recommended labels, so the first traces are checked for them. Stops at the
 * first failure and never throws: setup carries on either way.
 */
export const uploadIssues = async (
  api: IssuesApi,
  apiKey: string,
  issues: Issue[],
): Promise<IssueUpload> => {
  let uploaded = 0;
  try {
    const classifier = await findOrCreateIssuesClassifier(api, apiKey);
    for (const issue of issues) {
      await api.createClassifierLabel(apiKey, classifier.id, {
        name: issue.name,
        description: issue.description,
        status: "RECOMMENDED",
        enabled: true,
        polarity: "LOWER_IS_BETTER",
      });
      uploaded += 1;
    }
    return {
      status: "uploaded",
      created: classifier.created,
      labels: uploaded,
    };
  } catch {
    return { status: "failed", uploaded };
  }
};

export const parseIssues = (text: string): Issue[] | undefined => {
  try {
    const parsed = issuesSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

export interface IssuesWatcher {
  /** Stops polling and waits for an upload already under way. */
  stop: () => Promise<IssueUpload | undefined>;
}

/**
 * Polls for the issues file the agent writes early in its run and uploads it
 * once, as soon as it parses. A half-written or invalid file is retried on the
 * next tick.
 */
export const watchIssuesFile = ({
  path,
  upload,
  intervalMs = 1_000,
  readFile = (file) => readFileFromDisk(file, "utf8"),
}: {
  path: string;
  upload: (issues: Issue[]) => Promise<IssueUpload>;
  intervalMs?: number;
  readFile?: (path: string) => Promise<string>;
}): IssuesWatcher => {
  let pending: Promise<IssueUpload> | undefined;
  let checking = false;

  const check = async (): Promise<void> => {
    if (pending || checking) return;
    checking = true;
    try {
      const issues = parseIssues(await readFile(path));
      if (issues && !pending) {
        clearInterval(timer);
        pending = upload(issues);
      }
    } catch {
      // Not written yet.
    } finally {
      checking = false;
    }
  };

  const timer = setInterval(() => void check(), intervalMs);
  timer.unref?.();

  return {
    stop: async () => {
      clearInterval(timer);
      return pending;
    },
  };
};
