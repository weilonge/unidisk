/**
 * postinstall patch for fuse-native on Linux arm64 (e.g. Raspberry Pi 64-bit).
 *
 * fuse-shared-library ships a pre-built x86_64 libfuse.so for Linux but has
 * no arm64 equivalent. On arm64 the linker rejects the x86_64 binary with
 * "file in wrong format". This script replaces it with the system libfuse.so
 * so that `npm rebuild fuse-native` can succeed.
 *
 * It is a no-op on all other platforms / architectures.
 */

'use strict'

const os   = require('os')
const fs   = require('fs')
const path = require('path')
const { execSync } = require('child_process')

if (os.platform() !== 'linux' || os.arch() !== 'arm64') {
  process.exit(0)
}

const destLib = path.join(
  __dirname,
  '../node_modules/fuse-shared-library-linux/libfuse/lib/libfuse.so'
)

// Locate the system libfuse.so.2 via ldconfig, falling back to the canonical
// Debian/RPi path for aarch64.
let srcLib
try {
  srcLib = execSync(
    'ldconfig -p | grep "libfuse\\.so\\.2 " | head -1 | awk \'{print $NF}\''
  ).toString().trim()
} catch (_) {
  // ignore — use fallback below
}

if (!srcLib || !fs.existsSync(srcLib)) {
  srcLib = '/usr/lib/aarch64-linux-gnu/libfuse.so.2'
}

if (!fs.existsSync(srcLib)) {
  console.warn(
    'patch-fuse-native: system libfuse not found — skipping arm64 patch.\n' +
    'Install it with: sudo apt install libfuse2'
  )
  process.exit(0)
}

fs.mkdirSync(path.dirname(destLib), { recursive: true })
fs.copyFileSync(srcLib, destLib)
console.log(`patch-fuse-native: copied ${srcLib} → ${destLib}`)
