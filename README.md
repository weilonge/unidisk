# unidisk

Mount cloud storage as a local filesystem using FUSE.

**Supported providers:** TeraBox · Dropbox · Box · JSON FS (local test filesystem)

**Features:**
- Read-only or read-write (create / delete / move)
- Block-level data cache with prefetch
- Configurable cache pool size and concurrency
- Linux and macOS (Intel and Apple Silicon)

---

## Installation

### Global install (recommended)

```
npm install -g unidisk
```

After installation the `unidisk` command is available system-wide.

### Run without installing

```
npx unidisk [options] <mountPoint>
```

### Development (from source)

```
git clone https://github.com/weilonge/unidisk
cd unidisk
npm install
npx tsx src/udFuse.ts [options] <mountPoint>
```

---

## System requirements

### macOS (Intel)

1. Install [macFUSE](https://macfuse.io) (download the `.pkg` from the releases page).
2. Install pkg-config:
   ```
   brew install pkg-config
   ```

### macOS (Apple Silicon — M1/M2/M3)

1. Install [macFUSE](https://macfuse.io).
2. Install Xcode Command Line Tools if not already present:
   ```
   xcode-select --install
   ```
3. Rebuild the native addon:
   ```
   npm rebuild fuse-native
   ```

### Linux (x86_64)

```
sudo apt install libfuse2
```

### Linux (Raspberry Pi — arm64 or armv7l)

`fuse-native` bundles an x86_64 libfuse that the arm64 linker rejects.
Use the following sequence instead of a plain `npm install`:

1. Install the FUSE library and build tools:
   ```
   sudo apt install libfuse2 libfuse-dev build-essential
   ```
2. Install JS dependencies without running native build scripts:
   ```
   npm install --ignore-scripts
   ```
3. Patch the bundled library and rebuild the native addon:
   ```
   npm run setup:rpi
   ```
   This copies the system arm64 libfuse into place and runs `npm rebuild fuse-native`.

---

## Setup

Copy the sample settings file and customize `cache_path`:

```
mkdir -p ~/.unidisk
cp node_modules/unidisk/dist/settings.json.SAMPLE ~/.unidisk/settings.json
```

> When running from source use `dist/settings.json.SAMPLE` directly.

`~/.unidisk/settings.json` controls global tunables (block size, cache size, concurrency)
and named profiles.  The full set of keys with their defaults:

```json
{
  "block_reading_size":  1048576,
  "block_writing_size":  8388608,
  "fuse_iosize":         65536,
  "queue_concurrency":   1,
  "prefetch_blocks":     3,
  "max_data_cache_entry": 25,
  "cache_path":          "/tmp/ud/cache",
  "profile": {}
}
```

Global settings can also be placed directly in the profile JSON file instead of (or
alongside) `~/.unidisk/settings.json`.  When `-p /path/to/profile.json` is used,
unidisk reads settings from that file, so a single self-contained profile file is
enough:

```json
{
  "module":              "Dropbox",
  "token":               "<accessToken>",
  "cacheStore":          "disk",
  "cachePath":           "/tmp/dropbox-cache",
  "block_reading_size":  4194304,
  "queue_concurrency":   2,
  "prefetch_blocks":     3
}
```

---

## Usage

```
unidisk [options] <mountPoint>

Options:
  -m <module>   Provider name: Sample | Dropbox | TeraBox
                Optional when the profile JSON already has a "module" field.
  -p <profile>  Path to a profile JSON file, or a named profile from
                ~/.unidisk/settings.json
  -w            Enable write support (create / delete / move)
  -v            Verbose logging
  -d            FUSE debug output
```

---

## Providers

### TeraBox

1. Log in at terabox.com, open DevTools → Application → Cookies, and copy
   the `ndus` cookie value.  Or run this in the browser console:
   ```js
   document.cookie.split('; ').find(c => c.startsWith('ndus='))?.split('=')[1]
   ```

2. Create a profile file, e.g. `~/.unidisk/terabox.json`:
   ```json
   {
     "module": "TeraBox",
     "cacheStore": "disk",
     "cachePath": "/tmp/terabox-cache",
     "ndus": "<paste ndus value here>"
   }
   ```

3. Mount:
   ```
   mkdir -p ~/mnt/terabox
   unidisk -p ~/.unidisk/terabox.json ~/mnt/terabox
   ```

4. Unmount:
   ```
   fusermount -u ~/mnt/terabox        # Linux
   umount ~/mnt/terabox               # macOS
   ```

> **Tip (Raspberry Pi / slow connections):** set `"queue_concurrency": 1` in the
> profile to avoid CDN throttle errors.

---

### Box

1. Go to the [Box Developer Console](https://developer.box.com/console), create
   an app (Custom App → User Authentication OAuth 2.0), then under
   **Configuration → Developer Token** click **Generate Developer Token**.

2. Create a profile, e.g. `~/.unidisk/box.json`:
   ```json
   {
     "module": "Box",
     "cacheStore": "disk",
     "cachePath": "/tmp/box-cache",
     "token": "<developer token>"
   }
   ```

3. Mount:
   ```
   mkdir -p ~/mnt/box
   unidisk -p ~/.unidisk/box.json ~/mnt/box
   ```

4. Unmount:
   ```
   fusermount -u ~/mnt/box        # Linux
   umount ~/mnt/box               # macOS
   ```

> **Note:** Developer tokens expire after 60 minutes.  For long-running mounts
> use a proper OAuth 2.0 refresh-token flow and supply a long-lived access token.

> **Upload limit:** The simple upload path supports files up to ~50 MB.
> Larger files require Box's chunked upload API (not yet implemented).

---

### JSON FS (local test filesystem)

1. Prepare a JSON file or use `examples/sample-fs.json`.

2. Create a profile, e.g. `~/.unidisk/sample.json`:
   ```json
   {
     "module": "Sample",
     "cacheStore": "memory",
     "JSONPath": "/path/to/sample-fs.json"
   }
   ```

3. Mount:
   ```
   mkdir -p /tmp/mnt
   unidisk -p ~/.unidisk/sample.json /tmp/mnt
   ```

4. Unmount:
   ```
   fusermount -u /tmp/mnt             # Linux
   umount /tmp/mnt                    # macOS
   ```

---

### Dropbox

1. Obtain an access token from the [Dropbox developer console](https://www.dropbox.com/developers).

2. Create a profile, e.g. `~/.unidisk/dropbox.json`:
   ```json
   {
     "module": "Dropbox",
     "cacheStore": "disk",
     "cachePath": "/tmp/dropbox-cache",
     "token": "<accessToken>"
   }
   ```

3. Mount:
   ```
   mkdir -p ~/mnt/dropbox
   unidisk -p ~/.unidisk/dropbox.json ~/mnt/dropbox
   ```

4. Unmount:
   ```
   fusermount -u ~/mnt/dropbox        # Linux
   umount ~/mnt/dropbox               # macOS
   ```

---

## Named profiles (settings.json)

Instead of passing a JSON file path every time, add a named profile to
`~/.unidisk/settings.json`:

```json
{
  "profile": {
    "MyTeraBox": {
      "module": "TeraBox",
      "cacheStore": "disk",
      "cachePath": "/tmp/terabox-cache",
      "ndus": "<ndus value>"
    },
    "MySample": {
      "module": "Sample",
      "cacheStore": "memory",
      "JSONPath": "/home/user/sample-fs.json"
    }
  }
}
```

Then mount by profile name:

```
unidisk -p MyTeraBox ~/mnt/terabox
unidisk -p MySample  /tmp/mnt
```

---

## Reference

- [FUSE: Filesystem in Userspace](http://fuse.sourceforge.net/)
- [fuse-native](https://github.com/fuse-friends/fuse-native)
- [macFUSE](https://macfuse.io)
