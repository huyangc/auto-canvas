"""The auto-canvas plugin bundle: the canvas runs as a companion service.

It has no contributions yet; the companion service itself is declared in the
deployment's extensions TOML. Importing this module has no side effect.
"""

from dataclasses import dataclass

from app.extension_sdk import EXTENSION_API_VERSION, ExtensionManifest


@dataclass(frozen=True)
class AutoCanvasBundle:
    manifest: ExtensionManifest

    def register(self, registrar) -> None:
        """There are no contributions and no service-start side effects."""


BUNDLE = AutoCanvasBundle(
    ExtensionManifest(
        id="auto_canvas.integration",
        version="0.1.0",
        api_version=EXTENSION_API_VERSION,
        display_name="电路画布",
        trust="deployment",
        contributions=(),
        requires=(),
        provides=(),
        ui_contributions=(),
    )
)
