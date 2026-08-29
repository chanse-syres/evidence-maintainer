import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";

const RelativeJsonPathSchema = z.string().min(1).refine((value) => {
  if (value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) return false;
  return !value.split("/").some((segment) => segment === "" || segment === "..");
}, "must be a normalized relative path");

const SummaryPathSchema = RelativeJsonPathSchema.refine(
  (value) => value.split("/").at(-1) === "summary.json",
  "must identify a campaign summary.json",
);

const PublicComparisonConfigSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.string().min(1),
  selectedCampaign: z.string().min(1).nullable(),
  selectedSummary: SummaryPathSchema.nullable(),
  selectionRule: z.string().min(1),
  excludedCampaigns: z.array(z.object({
    campaign: z.string().min(1),
    invalidation: RelativeJsonPathSchema,
  }).strict()),
}).strict().superRefine((config, context) => {
  if ((config.selectedCampaign === null) !== (config.selectedSummary === null)) {
    context.addIssue({
      code: "custom",
      message: "selectedCampaign and selectedSummary must be set together",
    });
  }
  if (
    config.selectedCampaign !== null &&
    config.excludedCampaigns.some((entry) => entry.campaign === config.selectedCampaign)
  ) {
    context.addIssue({
      code: "custom",
      message: "an invalidated campaign cannot be selected for public comparison",
    });
  }
});

export type PublicComparisonSelection =
  | {
      state: "pending";
      status: string;
      selectionRule: string;
    }
  | {
      state: "selected";
      status: string;
      campaign: string;
      summaryPath: string;
      evaluationRoot: string;
    };

export async function loadPublicComparisonSelection(
  configPath = resolve(process.cwd(), "config", "public-comparison.json"),
): Promise<PublicComparisonSelection> {
  const parsed = PublicComparisonConfigSchema.parse(
    JSON.parse(await readFile(configPath, "utf8")),
  );
  if (parsed.selectedCampaign === null || parsed.selectedSummary === null) {
    return {
      state: "pending",
      status: parsed.status,
      selectionRule: parsed.selectionRule,
    };
  }
  const summaryPath = resolve(process.cwd(), ...parsed.selectedSummary.split("/"));
  return {
    state: "selected",
    status: parsed.status,
    campaign: parsed.selectedCampaign,
    summaryPath,
    evaluationRoot: dirname(summaryPath),
  };
}
