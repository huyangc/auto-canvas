import { describe, expect, it } from "vitest";
import { deriveImportedProjectName, importSpiceSources } from "./importer.js";

describe("deriveImportedProjectName", () => {
  it("prefers a meaningful entry filename and preserves its original identifier", () => {
    expect(deriveImportedProjectName("my_ota.sp", "ota_5t")).toBe("my_ota");
    expect(deriveImportedProjectName("reset-chain.scs", "dut")).toBe(
      "reset-chain",
    );
    expect(deriveImportedProjectName("rc_filter.sp", "__flat__")).toBe(
      "rc_filter",
    );
    expect(deriveImportedProjectName("dir/amp.v2.cir", "__flat__")).toBe(
      "amp.v2",
    );
  });

  it("falls back to a meaningful top cell when the filename is generic", () => {
    expect(
      deriveImportedProjectName("netlists/sky130-ota-5t/circuit.spi", "ota_5t"),
    ).toBe("ota_5t");
    expect(deriveImportedProjectName("top.spi", "bandgap_ref")).toBe(
      "bandgap_ref",
    );
  });

  it("falls back to a meaningful parent directory for flat generic files", () => {
    expect(
      deriveImportedProjectName(
        "netlists/native-common-source/circuit.spi",
        "__flat__",
      ),
    ).toBe("native-common-source");
    expect(
      deriveImportedProjectName(
        "C:\\designs\\bandgap\\circuit.spi",
        "__flat__",
      ),
    ).toBe("bandgap");
  });

  it("never emits __flat__ or an import suffix, and clamps long names", () => {
    expect(deriveImportedProjectName("circuit.spi", "__flat__")).toBe(
      "circuit",
    );
    expect(deriveImportedProjectName("netlists/circuit.spi", "__flat__")).toBe(
      "circuit",
    );
    expect(deriveImportedProjectName(".spi", "__flat__")).toBe("Untitled");
    expect(deriveImportedProjectName(`${"a".repeat(150)}.sp`, "__flat__")).toBe(
      "a".repeat(120),
    );
    expect(
      deriveImportedProjectName(`${"a".repeat(119)}🔌.sp`, "__flat__"),
    ).toBe("a".repeat(119));
  });
});

describe("importSpiceSources project naming", () => {
  it("names flat imports from the entry filename without a SPICE Import suffix", async () => {
    const result = await importSpiceSources(
      [
        {
          path: "rc_lowpass.sp",
          bytes: new TextEncoder().encode(
            "* RC lowpass\nV1 in 0 1\nR1 in out 1k\nC1 out 0 1p\n.end\n",
          ),
        },
      ],
      "rc_lowpass.sp",
    );
    expect(result.successful).toBe(true);
    expect(result.project?.name).toBe("rc_lowpass");
  });

  it("names generic-filename subckt imports from the top subcircuit", async () => {
    const result = await importSpiceSources(
      [
        {
          path: "sky130-ota/circuit.spi",
          bytes: new TextEncoder().encode(
            ".subckt ota_5t in out\nR1 in out 1k\n.ends ota_5t\n.end\n",
          ),
        },
      ],
      "sky130-ota/circuit.spi",
    );
    expect(result.successful).toBe(true);
    expect(result.project?.name).toBe("ota_5t");
  });

  it("prefers a meaningful filename over a generic subckt name like dut", async () => {
    const result = await importSpiceSources(
      [
        {
          path: "reset-chain.spi",
          bytes: new TextEncoder().encode(
            ".subckt dut in out\nR1 in out 1k\n.ends dut\n.end\n",
          ),
        },
      ],
      "reset-chain.spi",
    );
    expect(result.successful).toBe(true);
    expect(result.project?.name).toBe("reset-chain");
  });
});
