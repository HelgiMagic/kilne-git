# kilne-git

A minimal native Obsidian-vault git sync client for Android, built with Expo + Nitro Modules + libgit2.

The whole point: native C++ git via libgit2 (not isomorphic-git) so it's as fast on Android as on a desktop. Manual sync — open the app, tap **Pull**, edit in Obsidian Mobile, tap **Push**.

## Architecture

```
┌─────────────────────────────────────────────────┐
│  TypeScript UI (Expo Router)                     │
│   src/app/…           screens                    │
│   src/components/…    RepoCard, Field, …         │
│   src/services/…      git.ts, storage.ts, secure │
│   src/store.ts        zustand global state       │
└──────────────────┬──────────────────────────────┘
                   │ JS calls (via JSI)
┌──────────────────▼──────────────────────────────┐
│  kilne-git-native (Nitro Module, C++20)          │
│   android/…/cpp/HybridGit.cpp  libgit2 wrapper   │
│   src/Git.nitro.ts             HybridObject spec │
└──────────────────┬──────────────────────────────┘
                   │ C calls
┌──────────────────▼──────────────────────────────┐
│  libgit2 1.9.0 + mbedTLS 3.6.2 + zlib + parser  │
│  (built from source via CMake FetchContent)      │
└─────────────────────────────────────────────────┘
```

Files worth reading first:

- `modules/kilne-git-native/src/Git.nitro.ts` — the contract between JS and native.
- `modules/kilne-git-native/android/src/main/cpp/HybridGit.cpp` — libgit2 calls.
- `modules/kilne-git-native/android/src/main/cpp/CMakeLists.txt` — how deps are wired.
- `src/app/repo/[id].tsx` — the Pull / Commit & Push / Status screen.
- `src/services/git.ts` — high-level wrapper used by the UI.

## Build

### Prerequisites

- Node.js LTS + pnpm
- Android Studio with NDK (side-by-side) ≥ 27 and CMake ≥ 3.22.1
- A working `JAVA_HOME` (JDK 17+)

### One-time setup

```bash
pnpm install
pnpm nitrogen        # generates C++/Kotlin specs from Git.nitro.ts
```

### Generate the native Android project

```bash
pnpm exec expo prebuild --platform android
```

This produces an `android/` folder at the repo root with the Nitro module autolinked.

### Build & run on a device / emulator

```bash
pnpm exec expo run:android --device
```

The first build will download libgit2, mbedTLS, zlib and http-parser sources via CMake `FetchContent` (≈100 MB). Cached afterwards.

> Expo Go cannot run this app — Nitro Modules require a custom dev build. `expo run:android` produces one automatically.

### Regenerating specs after editing `Git.nitro.ts`

Any change to the TypeScript spec must be followed by:

```bash
pnpm nitrogen
```

The generated files live in `modules/kilne-git-native/nitrogen/generated/`. They're checked in so reviewers can see the diff.

## Usage

1. **Add repository**: tap `+ Add` on the home screen.
   - Clone URL (HTTPS, e.g. `https://github.com/you/vault.git`)
   - Personal access token (GitHub: `Settings → Developer settings → Personal access tokens → fine-grained`, scope `Contents: Read and write`)
   - Local path: defaults to `<documentDirectory>/vaults/<name>`. If you want Obsidian Mobile to see the files, pick a path under shared storage (e.g. `/storage/emulated/0/Documents/vault`).
2. **Sync**: open the repo detail screen.
   - **Pull** — fetch + merge upstream.
   - **Push** — push HEAD without committing.
   - **Commit all & push** — stage everything, commit with the given message, push.
   - Status panel shows branch, upstream, ahead/behind, staged/working/untracked/conflicted files.

## Caveats / known limitations

This is an MVP — intentional scope cuts:

- **HTTPS + PAT only**. SSH and OAuth are not wired (libgit2 is built with `USE_SSH=OFF`).
- **No background sync**. Everything is triggered manually. If you want auto-sync-on-Obsidian-open, that needs a separate foreground service + accessibility / usage-stats plumbing — see `docs/` (TBD).
- **Merge conflicts**: the UI shows conflicted paths but resolution must happen elsewhere (PC).
- **Auth callback retries**: capped at 4 attempts to avoid loops. Wrong token → fast fail.
- **No shallow clone by default**; pass `depth` in `CloneOptions` to enable.
- **No `.gitignore` editor** in the UI; edit it via Obsidian or another file manager.
- **CMake hashes are not pinned** in `CMakeLists.txt` for the third-party tarballs. After your first successful build, copy the SHA-256 from the configure log into a `URL_HASH` line to lock it down.

## Security / privacy

- **No telemetry, no analytics, no cloud.** Everything happens on-device.
- Tokens live in `expo-secure-store` (Android Keystore, hardware-backed when available).
- Repo configs (URL, branch, path — **not** the token) live in a JSON file in the app's document directory.
- The native library is built from upstream libgit2 sources — you can `git diff` the pinned tarballs against `github.com/libgit2/libgit2` releases.

## Verifying the build

```bash
pnpm exec tsc --noEmit   # type-check the TS / TSX
pnpm lint                # ESLint
```

C++ side: there's no static-analysis CI yet. The libgit2 calls follow the official docs at <https://libgit2.org/libgit2/HEAD/>.

## License

TBD — pick one before publishing. (The bundled dependencies are all permissive: libgit2 GPL-2.0 with linking exception, mbedTLS Apache-2.0, zlib zlib, http-parser MIT.)
