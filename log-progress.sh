#!/usr/bin/env bash
# =========================================================
# log-progress.sh — catat setiap commit baru ke PROGRESS.md
# ---------------------------------------------------------
# Dipanggil otomatis dari git hook post-commit. Menyambung
# entri "Update otomatis" di PROGRESS.md untuk setiap commit
# baru sejak titik terakhir yang tercatat (file .last-progress).
#
# Matikan sementara:
#   KSP_DISABLE_PROGRESS_LOG=1 <perintah git>
#   git -c core.hooksPath=/dev/null commit ...
# =========================================================
set -uo pipefail

if [ "${KSP_DISABLE_PROGRESS_LOG:-0}" = "1" ]; then exit 0; fi

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$ROOT" || exit 0

PROG="PROGRESS.md"
STATE=".last-progress"
HEAD="$(git rev-parse HEAD 2>/dev/null)" || exit 0
LAST="$(cat "$STATE" 2>/dev/null || true)"

if [ -n "$LAST" ] && [ "$LAST" = "$HEAD" ]; then exit 0; fi

# Tentukan rentang commit baru.
if [ -n "$LAST" ] && git merge-base --is-ancestor "$LAST" HEAD 2>/dev/null; then
  RANGE="${LAST}..HEAD"
else
  # Belum ada titik awal → catat isi commit kepala saja (safe)
  RANGE="HEAD~0..HEAD"
  RANGE_SPECIAL=1
fi

LOG="$(git log --no-decorate --format='%h %s' "$RANGE" 2>/dev/null)" || exit 0
[ -n "$LOG" ] || exit 0

if [ "${RANGE_SPECIAL:-0}" = "1" ]; then
  FILES="$(git show --pretty=format: --name-only HEAD 2>/dev/null | sed '/^$/d' | sed 's/^/    - `/' | sed 's/$/`/')"
else
  FILES="$(git diff --name-only "$RANGE" 2>/dev/null | sed 's/^/    - `/' | sed 's/$/`/')"
fi

DATE="$(date '+%d %b %Y %H:%M')"

{
  printf '\n### Update otomatis — %s\n\n' "$DATE"
  printf 'Commit baru:\n\n'
  printf '%s\n' "$LOG" | sed 's/^/    **`/;s/$/`**/'
  printf '\nFile yang berubah:\n\n%s\n' "$FILES"
} >> "$PROG"

echo "$HEAD" > "$STATE"
exit 0