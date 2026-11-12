# T048 — Training and validation of schematic layout

## Result

The frozen optimizer meets the 110% ceiling on all three totals of the nine-schematic validation set. Seven of nine schematics also pass all three limits individually.

| Set | Count | Wire length, human / auto | Bends, human / auto | Crossings, human / auto |
| --- | ---: | ---: | ---: | ---: |
| Training (mixed reference provenance) | 21 | 14,840.6 / 7,875 | 61 / 28 | 8 / 4 |
| Validation (human-tagged) | 9 | 8,342.1 / 3,400 | 44 / 24 | 7 / 7 |

The Diamond Buffer has 2 bends versus 1 in the reference. Widlar has 2 crossings versus 0. All nine have shorter wires. All nine complete electrical graphs match the originals. The physical audit found zero shorts, missing connections, floating pins, or unsafe routes on all 30 results.

## Method and qualification

A deterministic hash ranking within each device-count bucket reserved 4 small and 5 medium human-tagged projects for validation. All 30 file digests are pinned in the split. Labels of authorship come from the dataset. The 21 remaining examples include the five unverified references and the one AI-tagged reference. A name-independent device/net graph fingerprint found no matching topology across subsets. The preceding APR development rounds had already seen these schematics. This split measures the frozen method on the current collection.

Both subsets used the same electrical extraction. It clears instance locations, orientation, route geometry, junctions, layout guides and drafting. It initializes reference, port and power text from their electrical owners. Inference uses the actual symbol definitions and electrical connectivity. The benchmark checks that extraction preserves terminal partitions. A perturbation check over all 30 verified that overwriting all device positions and orientations and removing routes and junctions yields identical inputs. Decorative drafting, visual symmetry and designer preference have no human-relative acceptance threshold in this experiment.

The optimized profile starts from the ordinary APR result and searches grid positions and orientations using a bounded simulated annealing schedule. A horizontal or vertical median trunk estimates wire length, bends, crossings and symbol obstruction. A pin-alignment move can propose a face-to-face landing. The existing clearance rules and complete transaction replay decide which candidates are legal. The final score uses actual routed geometry and adds costs for label collisions and clearance. Each design uses one shared set of weights and a fixed seed. The profile is available through the public planner and the evaluation CLI. It falls back to existing planning for fixed, explicitly grouped, constrained, partitioned, inductor-coupled or larger inputs. This round covers the two requested small-circuit buckets.

Nine training configurations combined bend costs of 2, 4 or 8 with crossing costs of 16, 48 or 96, in units of one grid pitch of wire. The fitter minimized the worst of the three aggregate ratios, breaking ties by their sum. The selected costs were 4 and 16. Training, model selection and source hashes were recorded before validation. After validation the benchmark entry point gained an import guard for scoring new folders. Its frozen copy is retained alongside the exported results as `bench-at-freeze.mjs`. Replaying the new-folder command with renamed filenames reproduced the validation metrics.

## Acceptance and reproduction

All 21 training and 9 validation outputs were committed in memory through the normal edit transaction, serialized as native projects and reopened. The benchmark checked terminal partitions, physical shorts, missing connections, floating pins, unsafe routes and full graph equivalence for all extractable source graphs (18/21 training and 9/9 validation). The remaining three training projects have explicit terminal and physical checks. The package build, repository typecheck, package lint, changed-file formatting and whitespace checks passed. The existing 582 auto-layout tests and three new renamed-input/zero-budget tests passed.

From the implementation worktree, after building the packages, the following commands reproduce this experiment. Set GALLERY to the directory containing the two bucket folders and OUT to an existing output directory.

```sh
node tasks/T048-general-layout/bench.mjs "$GALLERY" train "$OUT/train.json" optimized
node tasks/T048-general-layout/fit.mjs "$OUT/train.json" "$OUT/refit.json"
node tasks/T048-general-layout/bench.mjs "$GALLERY" validation "$OUT/validation.json" optimized
node tasks/T048-general-layout/audit.mjs "$GALLERY" "$OUT"
```

To measure an independent batch, put its reference projects in a flat input folder and run the reusable command below with a separate destination folder. It uses the same frozen weights, strips drawing geometry, exports native projects and SVGs, and exits nonzero if any drawing is invalid or any aggregate exceeds the threshold.

```sh
node tasks/T048-general-layout/evaluate-folder.mjs <input-folder> <output-folder>
```

During normal application development call `planAutoLayout(document, resolver, { quality: "optimized" })`. The ordinary APR evaluation script also accepts `--optimized`. That script measures the document supplied to it. Use the new-folder command above for the geometry-blind human comparison.
