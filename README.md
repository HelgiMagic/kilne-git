# kilne-git

Native Obsidian-vault git sync for Android (Expo + Nitro Modules + libgit2). Manual Pull / Push — no background sync, no cloud.

## Build

```bash
# Requirements:
#   - Node.js LTS + pnpm
#   - Android Studio with NDK (side-by-side) ≥ 27 and CMake ≥ 3.22.1
#   - JAVA_HOME → JDK 17+

pnpm install
pnpm prebuild:clean          # macOS / Linux
# pnpm prebuild:clean:win    # Windows
pnpm android:release
```

APK: `android/app/build/outputs/apk/release/`. First build fetches native deps via CMake (~100 MB), then caches them. Expo Go will not work — this needs a custom native build.

Dev / install on a device:

```bash
pnpm android
```

After changing `modules/kilne-git-native/src/Git.nitro.ts`, run `pnpm nitrogen`.

## Usage

1. **Add repo** (`+ Add`): HTTPS clone URL, PAT (`Contents: Read and write`), local path (e.g. `Documents/my-vault`). On Android 11+ grant **All files access**.
2. **Sync** (repo screen): **Pull**, **Push only**, or **Commit all & push**. Status shows branch, ahead/behind, and dirty files.

## Limitations

- HTTPS + PAT only (no SSH / OAuth)
- No background sync
- Conflicts are shown; resolve them elsewhere (e.g. on a PC)

## Security

On-device only — no telemetry. Tokens in `expo-secure-store` (Keystore). Repo config (URL / branch / path, not the token) is a local JSON file.

## Layout

```
src/                     UI, services, zustand store
modules/kilne-git-native/
  src/Git.nitro.ts       JS ↔ native contract
  android/.../HybridGit.cpp   libgit2 wrapper
```

## License

TBD. Bundled deps: libgit2 (GPL-2.0 + linking exception), mbedTLS (Apache-2.0), zlib, http-parser (MIT).
