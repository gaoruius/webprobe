#!/bin/sh
# CI for the Android app, run inside reactivecircus/android-emulator-runner once the emulator is
# up: install the APK (built in the step before), then run android-mcp's smoke test through the
# real MCP tools. No model is called, so no API key is needed.
set -e
cd "$(dirname "$0")"

adb install -r app/build/outputs/apk/debug/app-debug.apk
cd ../android-mcp
npm ci
npm run smoke
