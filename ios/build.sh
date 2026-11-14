#!/bin/sh
# Build BuggyShop and WebProbeDriver for the iOS Simulator into ios/build.
# ios-mcp runs the driver from there with `xcodebuild test-without-building`.
set -e
cd "$(dirname "$0")"
xcodebuild build-for-testing \
  -project BuggyShop.xcodeproj -scheme BuggyShop \
  -destination "${WEBPROBE_IOS_DESTINATION:-platform=iOS Simulator,name=${WEBPROBE_IOS_DEVICE:-iPhone 17}}" \
  -derivedDataPath build CODE_SIGNING_ALLOWED=NO -quiet
echo "Built. Products in ios/build/Build/Products."
