# unidisk

This project can help you to use Cloud Storage in a new way and provide the following features:

*   Available storages

    *   JSON FS, Dropbox, TeraBox

*   Data/Meta Cache to improve response time

*   Read-only (or support write-able file system partially)

*   Adjustable Data Cache Pool size

*   Prefetch data to improve the performance

*   Download blocks in multi-threading

*   Support Linux and macOS (Intel and Apple Silicon)

## Platform support

unidisk uses [fuse-native](https://github.com/fuse-friends/fuse-native) for the FUSE layer.
Prebuilt native binaries are included for macOS Intel and Linux x86_64.
All other targets must build the native addon from source after installing the system FUSE library.

| Platform | Architecture | Prebuilt? | Extra steps |
|---|---|---|---|
| macOS | Intel (x86_64) | Yes | Install [macFUSE](https://macfuse.io) |
| macOS | Apple Silicon (arm64) | No | Install [macFUSE](https://macfuse.io), then `npm rebuild fuse-native` |
| Linux | x86_64 | Yes | `sudo apt install libfuse2` |
| Linux (Raspberry Pi) | arm64 / armv7l | No | See Raspberry Pi section below |

## Prerequisite

### macOS (Intel)

1. Install [macFUSE](https://macfuse.io) (download the `.pkg` from the releases page).
2. Install pkg-config:
   ~~~
   brew install pkg-config
   ~~~

### macOS (Apple Silicon — M1/M2/M3)

1. Install [macFUSE](https://macfuse.io).
2. Install Xcode Command Line Tools if not already present:
   ~~~
   xcode-select --install
   ~~~
3. Rebuild the native addon:
   ~~~
   npm rebuild fuse-native
   ~~~

### Linux (x86_64)

~~~
sudo apt install libfuse2
~~~

### Linux (Raspberry Pi — arm64 or armv7l)

1. Install the FUSE development library and build tools:
   ~~~
   sudo apt install libfuse-dev build-essential
   ~~~
2. Rebuild the native addon:
   ~~~
   npm rebuild fuse-native
   ~~~

### Prepare settings.json

*   Copy `settings.json` to your home folder and customize `cache_path`.

~~~
$ mkdir ~/.unidisk && cp dist/settings.json.SAMPLE ~/.unidisk/settings.json
~~~

## Let's start

unidisk supports several storage backends. The general mount command is:

~~~
$ npx tsx src/udFuse.ts -m <Module> -p <profile.json> [mount point]
~~~

Add `-w` to enable write support (create/delete/move).

### TeraBox

1. Log in at terabox.com, open DevTools → Application → Cookies, and copy the `ndus` cookie value.
   You can also run this in the browser console:
   ~~~js
   document.cookie.split('; ').find(c => c.startsWith('ndus='))?.split('=')[1]
   ~~~

2. Create a profile JSON file (e.g. `~/.unidisk/terabox.json`):
   ~~~json
   {
     "module": "TeraBox",
     "cacheStore": "disk",
     "cachePath": "/tmp/terabox-cache",
     "ndus": "<paste ndus value here>"
   }
   ~~~

3. Mount:
   ~~~
   $ npx tsx src/udFuse.ts -m TeraBox -p ~/.unidisk/terabox.json ~/mnt/terabox
   ~~~

### Sample JSON FS

*   Prepare a valid JSON file or use `examples/sample-fs.json`
*   Create a profile pointing to it:
   ~~~json
   {
     "module": "Sample",
     "cacheStore": "memory",
     "JSONPath": "/path/to/sample-fs.json"
   }
   ~~~
*   Mount:
   ~~~
   $ npx tsx src/udFuse.ts -m Sample -p profile.json [mount point]
   ~~~

### Dropbox

*   Apply for a Dropbox development account and obtain your `accessToken`.
*   Create a profile:
   ~~~json
   {
     "module": "Dropbox",
     "cacheStore": "disk",
     "cachePath": "/tmp/dropbox-cache",
     "token": "<accessToken>"
   }
   ~~~
*   Mount:
   ~~~
   $ npx tsx src/udFuse.ts -m Dropbox -p profile.json [mount point]
   ~~~

## Reference

*   [FUSE: Filesystem in Userspace](http://fuse.sourceforge.net/)
