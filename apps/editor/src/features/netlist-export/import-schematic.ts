import {
  compileSpiceSources,
  importCompileResult,
  type SpiceSourceInput,
} from "@icm/spice";
import { prepareImportSources } from "./convert-import-sources";

export async function importSchematic(
  sources: SpiceSourceInput[],
  entryPath: string,
  namingProfile: "native" | "cadence-bang",
  choosePolarity?: (name: string) => string | null | Promise<string | null>,
) {
  const prepared = prepareImportSources(sources);
  const compiled = await compileSpiceSources(prepared.inputs, entryPath);
  const modelTypes = new Map([
    ["p18", "pmos"],
    ["n18", "nmos"],
  ]);
  const importDrawing = () =>
    importCompileResult(compiled, {
      originalSources: sources,
      namingProfile,
      builtInBodies: prepared.builtInBodies,
      modelTypes,
    });
  const result = importDrawing();
  const missing = new Set(
    result.diagnostics.flatMap((d) =>
      d.undeclaredMosModel ? [d.undeclaredMosModel.toLowerCase()] : [],
    ),
  );
  if (!choosePolarity || !missing.size) return result;
  for (const name of missing) {
    const type = (await choosePolarity(name))?.trim().toLowerCase();
    if (type !== "pmos" && type !== "nmos") return result;
    modelTypes.set(name, type);
  }
  return importDrawing();
}
