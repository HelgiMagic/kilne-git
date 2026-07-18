# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Sync core idea

Sync/Pull must stay bidirectional and automatic for Obsidian vaults:

1. Commit local dirty changes first.
2. Fetch upstream.
3. Fast-forward when possible; when diverged, **union-merge** — keep both sides of conflicts (no manual conflict resolution), create a merge commit.
4. Push if ahead.

Do not change union-merge / “keep both sides” behavior without an explicit product decision.
