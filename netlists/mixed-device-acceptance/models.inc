* Local model declarations for the mixed-device acceptance fixture.
* Values are intentionally simple: this fixture validates topology conversion,
* not simulator accuracy or process characterization.
.model DACC D (is=1e-15)
.model QNACC NPN (bf=100)
.model QPACC PNP (bf=80)
.model SWACC SW (ron=10 roff=1G vt=0.5 vh=0.05)
