# Phase 9 held-out flash ADC

This is a topology-only hierarchical 4-bit flash-ADC fixture created after the
Phase 9 `circuit-layout` Skill and knowledge documents were frozen. It contains
a 16-section resistor ladder and 15 references to a nine-MOS comparator cell,
for 135 elaborated MOS instances plus 16 resistors.

Its purpose is isolated Agent layout/readability evaluation across the four
guidance tiers. It was not used to revise the knowledge cards before those runs.
The transistor sizes are illustrative, no testbench or foundry simulation has
been run, and the repository makes no gain, offset, speed, power, or ADC
linearity claim for this fixture.

The evaluation task is to express both the ladder/comparator hierarchy and the
comparator's differential/load/output structure without changing its imported
electrical topology.
