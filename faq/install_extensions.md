# How to install browser extensions

OpenVault launches Chromium through Playwright using its own saved browser profile. Chrome Web Store installs may fail in this automated browser, so OpenVault loads unpacked extensions from a local folder instead.

## Default folder

Put unpacked extensions under:

```bash
~/.openvault/brower-extensions
```

OpenVault loads any extension folder that directly contains a `manifest.json` file.

This works:

```text
~/.openvault/brower-extensions/zeroblur/manifest.json
```

This does not work by itself:

```text
~/.openvault/brower-extensions/zeroblur/1.2.1_0/manifest.json
```

In that second case, copy the contents of `1.2.1_0` into `zeroblur`, or put `1.2.1_0` directly under `brower-extensions`.

## Copy an extension from an existing Chrome profile

Chrome stores installed extensions by extension ID and version. On macOS, the path usually looks like:

```text
~/Library/Application Support/Google/Chrome/<Profile>/Extensions/<extension-id>/<version>/
```

The folder to copy is the version folder, because that is the folder with `manifest.json`.

For example, ZeroBlur has extension ID `ckmpibbifmcamfmfelkencbbiilpcfjg`. If it is installed in Chrome Profile 1, copy:

```bash
mkdir -p ~/.openvault/brower-extensions/zeroblur
ditto \
  "$HOME/Library/Application Support/Google/Chrome/Profile 1/Extensions/ckmpibbifmcamfmfelkencbbiilpcfjg/1.2.1_0" \
  "$HOME/.openvault/brower-extensions/zeroblur"
```

Then confirm:

```bash
ls ~/.openvault/brower-extensions/zeroblur/manifest.json
```

## Launch the browser

Run:

```bash
npm run cli -- browser
```

OpenVault will create the extension folder if needed, discover any unpacked extensions inside it, and load them into Chromium.

## Why OpenVault removes `--disable-extensions`

Playwright starts Chromium with extensions disabled by default. When OpenVault finds extensions to load, it removes that default `--disable-extensions` flag and passes Chromium:

```text
--load-extension=<extension-folder>
--disable-extensions-except=<extension-folder>
```

That lets Chrome load only the unpacked extensions in `~/.openvault/brower-extensions`.
