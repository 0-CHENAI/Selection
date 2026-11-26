# macOS native switch

The bundled `resources/native/switch.node` contains macOS arm64 and x64
slices. It uses Node-API, so normal Electron builds use the prebuilt binary
without compiling this source. If the binary fails to load, the desktop app
keeps the standard web switch.

To rebuild from the Electron directory on macOS with Xcode Command Line Tools,
Node.js and Python installed:

```sh
electron_dir=$PWD
work=$(mktemp -d)
cp native/switch/binding.gyp native/switch/native_switch.mm "$work/"
cd "$work"
npm install --no-save --ignore-scripts node-addon-api@8 node-gyp@11
for arch in arm64 x64; do
  ./node_modules/.bin/node-gyp rebuild --arch="$arch" || exit 1
  cp build/Release/native_switch.node "$arch.node" || exit 1
done
lipo -create arm64.node x64.node -output switch.node
lipo -verify_arch arm64 x86_64 switch.node
codesign --force --sign - switch.node
codesign --verify --all-architectures --strict switch.node
cp switch.node "$electron_dir/resources/native/switch.node"
```

Verify both appearances in Electron after rebuilding, including OFF and
switching states. AppKit does not expose an accent override for `NSSwitch`:
the binary desaturates the layer and adjusts ON contrast for light/dark
appearance. Check the signed addon in both macOS installers before shipping —
`bun run scripts/check-macos-native-switch.ts` (`--repo`, `--app`, `--dmg`,
`--launch`) verifies presence, architecture, signature, and that the
installed app actually loads it; a successful launch alone is not proof
because the renderer falls back to the web switch.
