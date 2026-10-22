# Build Resources

Packaging assets that Electron Builder reads (`directories.buildResources`). Commit this folder.

## Assets

- `icon.icns` for macOS
- `icon.ico` for Windows
- `icon.png` for Linux and as the source image
- `icon.svg` for the Linux package icon

All four are drawn from the Spark mark in `assets/logo.svg`.

## Before shipping production builds

- add code signing and notarization settings for release pipelines
- configure Electron Updater publish settings for your release host
