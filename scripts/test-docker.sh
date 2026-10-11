#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose version >/dev/null
# A unique project name protects any running development stack and its volumes.
export COMPOSE_PROJECT_NAME="shopping-e2e-$(date +%s)-$$"
export E2E_UID="$(id -u)" E2E_GID="$(id -g)"
export E2E_OUTPUT="$(pwd)/artifacts/e2e/$COMPOSE_PROJECT_NAME"
mkdir -p "$E2E_OUTPUT"
compose=(docker compose -f compose.e2e.yml)
if [[ -n "${VANE_DOCKER_PROXY_CA:-}" ]]; then
  compose+=(-f compose.proxy.yml)
fi
cleanup() {
  local result=$?
  trap - EXIT
  "${compose[@]}" logs --no-color > "$E2E_OUTPUT/containers.log" 2>&1 || true
  if ! "${compose[@]}" down --volumes --remove-orphans > "$E2E_OUTPUT/cleanup.log" 2>&1; then
    cat "$E2E_OUTPUT/cleanup.log" >&2
    [[ "$result" != 0 ]] || result=1
  fi
  if [[ "$result" == 0 ]]; then
    printf '{"status":"PASS","checks":true,"httpBeforeCrash":true,"sigkillRecovery":true,"volumeRecovery":true,"cleanup":true}\n' > "$E2E_OUTPUT/summary.json"
    printf 'Docker E2E: PASS\n'
  else
    printf '{"status":"FAIL","exitCode":%s}\n' "$result" > "$E2E_OUTPUT/summary.json"
  fi
  printf 'Relatórios: %s\n' "$E2E_OUTPUT"
  exit "$result"
}
trap cleanup EXIT

"${compose[@]}" up --build --detach --wait --wait-timeout 120 api 2>&1 | tee "$E2E_OUTPUT/startup.log"
"${compose[@]}" run --rm --no-deps checks 2>&1 | tee "$E2E_OUTPUT/checks.log"
E2E_PHASE=before "${compose[@]}" run --rm --no-deps e2e

api_id="$("${compose[@]}" ps --quiet api)"
"${compose[@]}" kill --signal SIGKILL api
exit_code="$(docker inspect --format '{{.State.ExitCode}}' "$api_id")"
[[ "$exit_code" == 137 ]]
printf '{"signal":"SIGKILL","containerId":"%s","exitCode":%s}\n' "$api_id" "$exit_code" > "$E2E_OUTPUT/crash.json"
"${compose[@]}" up --detach --wait --wait-timeout 120 api
E2E_PHASE=after-crash "${compose[@]}" run --rm --no-deps e2e

# Recreate both containers, retaining only the test database volume.
"${compose[@]}" down
"${compose[@]}" up --detach --wait --wait-timeout 120 api
new_api_id="$("${compose[@]}" ps --quiet api)"
[[ "$api_id" != "$new_api_id" ]]
printf '{"before":"%s","after":"%s","sameDatabaseVolume":true}\n' "$api_id" "$new_api_id" > "$E2E_OUTPUT/recreation.json"
E2E_PHASE=after-recreate "${compose[@]}" run --rm --no-deps e2e
