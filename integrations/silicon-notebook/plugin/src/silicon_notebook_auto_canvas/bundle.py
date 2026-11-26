"""The auto-canvas plugin bundle: the canvas runs as a companion service.

The companion service itself is declared in the deployment's extensions TOML.
The bundle provides one capability, ``auto_canvas.integration.available``,
whose decision is always "available" and does no I/O, and declares the
workspace UI entry gated on it: the side-panel button 打开电路画布 of the UI
package ``integrations/silicon-notebook/ui/auto-canvas`` (built into
silicon-notebook with ``SILICON_NOTEBOOK_UI_PLUGINS``). The manifest's
``id`` and ``version`` and the declaration's ``id``, ``slot`` and
``capability`` match that package's ``ui-plugin.json`` character for
character. Importing this module has no side effect.
"""

from dataclasses import dataclass, field
from types import MappingProxyType
from collections.abc import Mapping

from app.extension_sdk import (
    EXTENSION_API_VERSION,
    Availability,
    ExtensionManifest,
)
from app.extension_sdk.ui import UiContributionDeclaration

PLUGIN_ID = "auto_canvas.integration"
AVAILABLE_CAPABILITY = f"{PLUGIN_ID}.available"

_ENTRY = UiContributionDeclaration(
    id=f"{PLUGIN_ID}.entry",
    slot="workspace.side_panel",
    capability=AVAILABLE_CAPABILITY,
)


def _available(_context: object | None) -> Availability:
    """The entry is available wherever the plugin is configured; no I/O."""

    return Availability.available()


@dataclass(frozen=True)
class AutoCanvasBundle:
    manifest: ExtensionManifest
    capability_decisions: Mapping[str, object] = field(
        default_factory=lambda: MappingProxyType(
            {AVAILABLE_CAPABILITY: _available}
        )
    )

    def register(self, registrar) -> None:
        """There are no contributions and no service-start side effects.

        The UI entry is metadata only and travels on ``ui_contributions``.
        """


BUNDLE = AutoCanvasBundle(
    ExtensionManifest(
        id=PLUGIN_ID,
        # 0.3.0: adds group & per-notebook circuit/component libraries; `ui-plugin.json` carries the same version.
        version="0.3.0",
        api_version=EXTENSION_API_VERSION,
        display_name="电路画布",
        trust="deployment",
        contributions=(),
        requires=(),
        provides=(AVAILABLE_CAPABILITY,),
        ui_contributions=(_ENTRY,),
    )
)
