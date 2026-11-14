#!/bin/sh
# CI for the iOS app on a GitHub macOS runner: pick the newest Xcode and an iPhone simulator,
# build the app and the driver, then run ios-mcp's smoke test through the real MCP tools.
# No model is called, so no API key is needed.
set -e
cd "$(dirname "$0")"

XCODE=$(ls -d /Applications/Xcode_*.app 2>/dev/null | sort -V | tail -1)
if [ -n "$XCODE" ]; then sudo xcode-select -s "$XCODE"; fi
xcodebuild -version

# The newest iOS runtime's first iPhone, by UDID: names repeat across runtimes.
UDID=$(xcrun simctl list devices available -j | node -e '
  const all = JSON.parse(require("fs").readFileSync(0, "utf8")).devices;
  const ios = Object.keys(all).filter((r) => r.includes("iOS")).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const r of ios) {
    const phone = all[r].find((d) => d.name.startsWith("iPhone"));
    if (phone) { console.error(`simulator: ${phone.name} (${r})`); console.log(phone.udid); break; }
  }')
[ -n "$UDID" ] || { echo "No iPhone simulator found"; exit 1; }
export WEBPROBE_IOS_DESTINATION="platform=iOS Simulator,id=$UDID"
xcrun simctl boot "$UDID" 2>/dev/null || true

./build.sh
cd ../ios-mcp
npm ci
npm run smoke
