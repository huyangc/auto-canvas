# LAN HTTP editor startup — round 1

## Summary

The web entry installs a UUIDv4 fallback before loading the editor when the
browser omits crypto.randomUUID. Each ID uses 16 bytes from getRandomValues
with the UUID version and variant bits set.

## Steps

| Step      | Status | Notes                                                                                                      |
| --------- | ------ | ---------------------------------------------------------------------------------------------------------- |
| Reproduce | Done   | Starting the web entry with getRandomValues alone produced the reported TypeError in the model's createId. |
| Fix       | Done   | The fallback covers model and editor callers in the web page.                                              |
| Verify    | Done   | Tests exercise startup with and without native randomUUID.                                                 |

## Review findings addressed

First implementation round.

## Acceptance results

- Vitest ran the web entry tests and model ID tests. All 11 passed.
- Type checking, editor production build, and formatting checks passed.
- Repository lint completed with warnings and zero errors.
- Headless Chrome loaded the built assets at an intercepted HTTP origin.
  The browser reported an insecure context and an initially absent randomUUID.
  The schematic canvas became visible and a subsequent UUID call succeeded.

## Investigation results

The model's document ID factory and several editor features call randomUUID
directly. Installing the fallback at the web entry covers both paths.

## Deviations and open questions

The user authorized work directly on main for this repair. Browser verification
used local build artifacts. Deployment to the user's LAN server was outside scope.
