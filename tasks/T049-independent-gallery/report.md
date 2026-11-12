# Independent Gallery validation and label collision repair

Before selecting samples, saved 634 source, executable and evaluation files with their SHA-256 hashes to the main workspace under output/apr-t049. The frozen.tar.gz SHA-256 is e111d735a9c1e0fadcdc62d2d9b9f7ed90d7236bc6252b4e8ab973dcb343d179. The bulk input came from previously downloaded, public Gallery responses; no new requests or cookies were needed. The split uses six previously unused community drawings per bucket, following Gallery's Human made classification (community authorship and no affirmative AI flag) with additional import-tag exclusions. Source membership is recorded as Gallery metadata, not independently attested authorship. Existing Gallery IDs, prior fixture/example topologies, and duplicate topologies were excluded before scoring. All input digests and source links are in samples.json.

| Devices | Length, human / auto | Bends | Crossings | Individual passes |
| --- | ---: | ---: | ---: | ---: |
| 0–4 | 1,850 / 1,320 | 12 / 2 | 1 / 0 | 5/6 |
| 5–10 | 6,251.42 / 3,760 | 22 / 12 | 3 / 7 | 4/6 |
| Total | 8,101.42 / 5,080 | 34 / 14 | 4 / 7 | 9/12 |

All twelve output projects were reopened and checked. No physical component joins distinct reference nets, no missing connections, floating pins or unsafe routes. All twelve full electrical graphs match. The three per-case failures are Self-biased Inverter (length 270 to 510), Alternative low-voltage BG circuit (bends 0 to 4 and crossings 0 to 2), and LevelShifter (crossings 2 to 5). A zero baseline requires zero. The frozen model fails the crossing limit on this independent sample. Every row, the three-way drawings and native projects are under output/apr-t049/index.html.

Object-anchored power or net names sharing a symbol with its reference sometimes shared the exact same label slot. The new final text-only pass measures visible ink after routing and label anchoring. For unlocked labels that actually overlap, it searches bounded nearby positions, accounting for other text, conductors and symbols. Bindings and owner IDs are retained.

The frozen results had 10 overlapping label pairs on 4 independent drawings, and 18 pairs on 12 drawings from the earlier 30. All 42 drawings now have zero overlapping visible annotation pairs. Comparison of the reopened projects verified all non-annotation document fields identical, as well as each label's text, metadata and owner. The repair did not change any wire metric. The 585 existing package tests passed, as did the focused suite with the additional shared-owner test. Source formatting and repository typecheck were checked.
