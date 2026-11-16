#!/bin/sh
# Agent runs against the Android app, for .github/workflows/android-agent.yml. Runs inside the
# emulator step: install the APK, then run the agent RUNS times. Each run calls the model, so this
# only ever runs by hand. Results land in agent/runs/, which the workflow uploads.
set -e
cd "$(dirname "$0")"

adb install -r app/build/outputs/apk/debug/app-debug.apk
(cd ../android-mcp && npm ci)
cd ../agent
npm ci
for i in $(seq "${RUNS:-3}"); do
  WEBPROBE_PLATFORM=android npm start
done
