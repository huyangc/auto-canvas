# T185 report

The repository entry and Claude Code delivery skill now point to the task owner's cleanup procedure. It covers PR-only handoff and authorized merges, protects local-only work, preserves branches and uses a fresh worktree for the next request.

The repository Markdown check passed for 74 files. Both new cleanup links point to the documented heading. In a temporary Git repository, ordinary removal refused a worktree with an untracked input. After preserving that input outside the worktree, removal succeeded, the task branch remained and a separate worktree for the next task could be created. The staged whitespace check passed.
