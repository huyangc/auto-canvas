# Phase 9 held-out 8-channel chopper AFE

This circuit was created after the first external Flash-ADC quality run was
scored and after its general label/text remediation rules were frozen. It is the
second held-out input and must not be used to revise the Skill or knowledge
pages before its own four-tier blind score is frozen.

The fixture is topology-only. It does not claim chopper stability, noise,
linearity, bandwidth, clock feedthrough, device sizing quality, or any simulated
analog performance.

It contains one 18-MOS `chopper_channel` definition and eight hierarchical
references in `chopper_afe_8ch`, for 144 elaborated MOS instances. Unlike the
first held-out ladder, this circuit emphasizes differential channel boundaries,
shared clock/bias/power Nets, switching devices, active loads, and paired
outputs.

The `.subckt` interfaces and instance pin order are frozen evaluation facts.
