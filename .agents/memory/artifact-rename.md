---
name: Artifact id is immutable when renaming an artifact folder
description: Renaming an artifact's directory does not (and cannot) change its registry id
---

# Renaming an artifact folder

The artifact `id` in `.replit-artifact/artifact.toml` is **immutable** — `verifyAndReplaceArtifactToml` rejects any call that changes it. `mv`-ing the folder to a new name is fine, but the id must stay whatever it was originally.

**Why:** the id is the stable registry/workflow key, decoupled from the on-disk folder name. Changing it breaks the mapping.

**How to apply:** when renaming a folder, update `package.json` name, `artifact.toml` commands/publicDir, and any workspace refs to the NEW folder, but leave `id` as the original value. After `mv`, the old artifact auto-deregisters; re-run `verifyAndReplaceArtifactToml` (id unchanged) to re-register at the new path. The derived workflow name follows the folder (e.g. `artifacts/<newdir>: web`), so restart that new workflow name. A stale vite from the old workflow can hold the port — `pkill -f "vite --config vite.config.ts"` then restart.
