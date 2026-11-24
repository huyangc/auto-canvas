# T174 report — round 1

## Summary

In accounts mode, the header user menu (`HeaderAccountMenu`) now holds the
account's circuit library. It sits between the identity row and Sign out as
**My Cloud Projects ›**, an in-place submenu that shows the same
`ProjectShelf` (open, rename, delete, Browse Cloud Projects…). Inside an
`AccountContext`, File no longer shows Open Cloud Project…. No-account modes
keep File's submenu. `CommandSubmenu` moved unchanged to `command-submenu.tsx`.
The implementer committed this as `5e59b1c` (opus subagent).

## Steps

| Step | Status | Notes |
| --- | --- | --- |
| 1 Share the submenu | done | `features/editor-shell/command-submenu.tsx`; the scroll selector adds `.header-account-popover` |
| 2 Account mode leaves File | done | `shelf = cloudEnabled && !account ? …`; the `dialog[open]` guard is kept |
| 3 User menu library | done | `HeaderAccountMenu({ cloudProjects? })`; `onToggle` collapses the submenu and stays open while a `dialog[open]` is inside |
| 4 Wire it | done | `accountCloudProjects?` on `EditorAppChromeProps`; uses a conditional spread (`exactOptionalPropertyTypes`) |
| 5 Styles | done, deviation | `min-width: 22rem`, not ~16rem; the popover has max-height and scrolls |
| 6 Unit tests | done | 4 new cases in `header-account-menu.test.tsx`, 1 in `file-command-menu.test.tsx` |
| 7 E2E fixture | done | `projectTabAction` routes through the user menu in accounts mode; the accounts spec asserts File has no Open Cloud Project… |
| 8 Docs | done | `editor-interaction.md`, `getting-started.md`, both READMEs |
| 9 Format | done | |

## Investigation results

The menu closes after a project opens because `ProjectShelf`
(`project-shelf.tsx:147-150`) closes its closest `details` itself. Inside the
user menu, that `details` is `.header-account-menu`, so no new code was needed.

## Deviations

- **Popover min-width 22rem.** The root font size is 13px, so 16rem cut
  project names short. 22rem (286px) matches File's popover.
  `max-width: calc(100vw - 24px)` keeps it on screen.
- **`accountCloudProjects` is passed whenever `projectStore` exists.** It has
  no effect without an account, because the menu renders nothing.

## Acceptance (implementer)

- typecheck, lint and format:check: exit 0
- Unit tests: 210 passed
- deadcode: exit 0, no findings before or after
- e2e: project-tabs, editor-modes, cloud-projects-server and chrome-isolation,
  96 passed
- Accounts e2e: standalone-accounts, 3 passed
