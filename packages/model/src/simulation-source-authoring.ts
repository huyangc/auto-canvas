import {
  SimulationExperimentConfigSchema,
  NativeSimulationExperimentConfigSchema,
  type ProjectSimulationFolder,
  type SimulationExperimentConfig,
} from "./schema.js";

/** Broken JSON is normal authoring state, not a thrown error or a fallback configuration.
 * @internal Tests cover editable experiment files with invalid JSON.
 */
export function readSimulationExperimentConfig(
  folder: ProjectSimulationFolder,
):
  | {
      ok: true;
      config: SimulationExperimentConfig;
      authority: "code" | "legacy-config";
    }
  | {
      ok: false;
      message: string;
      path: string;
      fields: Array<{ field: string; message: string }>;
    } {
  const path = folder.input.configPath;
  const text = folder.input.files.find((file) => file.path === path)?.text;
  let value: unknown;
  try {
    value = JSON.parse(text ?? "");
  } catch {
    return {
      ok: false,
      message: "The experiment configuration must contain valid JSON",
      path,
      fields: [],
    };
  }
  const native =
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    value.version === 2;
  const parsed = native
    ? NativeSimulationExperimentConfigSchema.safeParse(value)
    : SimulationExperimentConfigSchema.safeParse(value);
  return parsed.success
    ? {
        ok: true,
        authority: native ? "code" : "legacy-config",
        // Compatibility-shaped execution metadata is derived, never persisted beside Code.
        config: native
          ? SimulationExperimentConfigSchema.parse({
              version: 1,
              environment: parsed.data.environment,
            })
          : (parsed.data as SimulationExperimentConfig),
      }
    : {
        ok: false,
        message: "Correct the experiment configuration",
        path,
        fields: parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      };
}
