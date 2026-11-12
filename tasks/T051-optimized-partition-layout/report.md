# T051 optimized partition layout

Optimized partition placement now treats inferred block members as rigid groups when closing empty rows and columns. Each accepted move keeps block intrusion, missing connections, floating pins and all three wire metrics at or below their previous values. Crossed signal nets may be rerouted with the placement fixed. Explicit block arrangements retain their spacing.

The asynchronous LLM entry evaluates an ordinary optimized alternative with the default budget. A complete safe alternative can replace an incomplete partitioned drawing. For two complete drawings, the alternative must improve the routed score and at least one wire metric, with no increase in the three wire metrics or label overlap. Ties retain the blocks. The result carries a fallback reason. This second plan adds runtime. Callers that specify a search budget dedicate it to their partitioned plan.

## Evaluation

The twelve prior 11–54 device projects were rerun with electrical-only input. Each had one frozen proposal made by the Codex session from anonymized circuit units, checked against the payload digest. These are development comparisons, and come from a different model and sampling method than the historical three-sample DeepSeek runs. The current provider cache had no matches for these twelve. No new provider API requests were made.

| Set | Fully connected | All three wire metrics within 110% of the human drawing |
| --- | --- | --- |
| 11–20 devices | 6/6 | 3/6 |
| 21–54 devices | 5/6 | 1/6 |

Ten drawings passed the electrical checks both before and after optimization with inferred blocks supplied. On these same ten, retaining the blocks reduced total wire length from 68,080 to 66,760, bends from 248 to 247, and left crossings at 158. Selecting the final plan brought these totals to 40,260, 174 and 102. For the twelve drawings, eleven final plans used ordinary placement. The 54-device result retained the blocks and has nine missing connections and thirteen floating pins, compared with seventeen and nineteen for ordinary placement. Its crossing count rose from 62 to 117 compared with ordinary placement. None of the twelve selected results had a physical short or overlapping visible labels.

An additional cache-only replay used all three existing DeepSeek responses for each of the three largest documents among 33 historical cache hits. The 70-, 94- and 103-instance documents all selected the partitioned drawing and passed the physical and terminal checks. On the 103-instance drawing ordinary placement missed one connection. On the two others partitioned placement reduced length and crossings at the cost of more bends.

## Validation

The auto-layout package build, repository TypeScript check and all 587 auto-layout tests passed. The new public-entry test covers advisory fallback, explicit partitions and explicit search budgets. The previous 30 small gallery inputs passed the electrical checks. All 30 emitted project files matched the saved post-label-fix results byte-for-byte.

The per-project comparison, proposals, source-independent wire metrics, diagnostics and historical replays are under the main workspace's ignored output/apr-t051 directory. The remaining physical failures in the largest new drawing include invisible substrate pins and obstructed signal pins. The 110% target is still open.
