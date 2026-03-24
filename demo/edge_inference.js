#!/usr/bin/env node
//
// Edge Inference Demo — UniDisk + HuggingFace provider
//
// Shows how UniDisk lazily fetches model weight blocks from HuggingFace Hub
// on demand, rather than downloading the full model file upfront.
//
// This is the access pattern llama.cpp exercises when it mmap()s a GGUF file
// mounted via UniDisk FUSE:
//
//   llama.cpp                  UniDisk FUSE           HuggingFace CDN
//   ----------                 ------------           ---------------
//   open("/mnt/models/x.gguf") ──────────────────────────────────────
//   mmap(fd)                   → getFileMeta()  ───→ HF API (size only)
//   read header  [0..32KB]     → download block ───→ range: bytes=0-1048575
//   read tensors [680MB..690MB]→ download block ───→ range: bytes=680MB-691MB
//   read KV cache data         → cache hit       ✓   (no network request)
//
// Run:
//   node demo/edge_inference.js [hf_token]
//
// Without a token it uses a small public model. With a token you can swap
// MODEL_ID to any gated model you have access to.

'use strict';

// Seed Settings before requiring udManager — its block/concurrency constants
// are evaluated at module-load time from the Settings singleton.
var Settings = require('../helper/Settings');
if (!Settings.table) { Settings.table = {}; }
Settings.set('block_reading_size',  1024 * 1024); // 1 MB blocks
Settings.set('block_writing_size',  8 * 1024 * 1024);
Settings.set('fuse_iosize',         65536);
Settings.set('queue_concurrency',   3);
Settings.set('prefetch_blocks',     10);
Settings.set('max_data_cache_entry', 100);
Settings.set('cache_path',          '/tmp/ud/cache');

var udManager  = require('../helper/udManager');
var DataCache  = require('../helper/DataCache');
var MetaCache  = require('../helper/MetaCache');
var HuggingFace = require('../clouddrive/HuggingFace');

// -----------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------

// A small, public GGUF model (~1.1 GB) — no token required.
// Swap this out for any model you have access to.
var MODEL_ID  = 'bartowski/Llama-3.2-1B-Instruct-GGUF';
var MODEL_FILE = 'Llama-3.2-1B-Instruct-Q4_K_M.gguf';
var HF_TOKEN  = process.argv[2] || null;

// Block size matches the default in settings.json.SAMPLE (1 MB).
// This is the granularity at which UniDisk fetches from cloud storage.
var BLOCK_SIZE = 1024 * 1024; // 1 MB

// How many blocks llama.cpp typically reads during model init before
// it can produce the first token.  Roughly:
//   - GGUF header: first 1-2 blocks
//   - Embedding table: next 10-20 blocks (model-size dependent)
//   - A handful of attention/FFN tensors: ~20-40 blocks
// Total: ~50-80 MB out of ~1,100 MB.
var SIMULATED_READS = [
  { label: 'GGUF header',        offset: 0,                    size: BLOCK_SIZE },
  { label: 'Token embeddings',   offset: 20 * BLOCK_SIZE,      size: BLOCK_SIZE },
  { label: 'Layer 0 attn.wq',    offset: 100 * BLOCK_SIZE,     size: BLOCK_SIZE },
  { label: 'Layer 0 attn.wv',    offset: 101 * BLOCK_SIZE,     size: BLOCK_SIZE },
  { label: 'Layer 1 attn.wq',    offset: 130 * BLOCK_SIZE,     size: BLOCK_SIZE },
  { label: 'Output norm weight', offset: 980 * BLOCK_SIZE,     size: BLOCK_SIZE },
  // Re-read: block already cached, no network request
  { label: 'GGUF header (re-read, cached)', offset: 0,         size: BLOCK_SIZE },
];

// -----------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------

console.log('');
console.log('UniDisk Edge Inference Demo');
console.log('===========================');
console.log('Model : ' + MODEL_ID);
console.log('File  : ' + MODEL_FILE);
console.log('Token : ' + (HF_TOKEN ? HF_TOKEN.slice(0, 8) + '...' : 'none (public model)'));
console.log('');

var profile = {
  model:    MODEL_ID,
  token:    HF_TOKEN,
  revision: 'main',
  cacheStore: 'memory',
  block_reading_size: BLOCK_SIZE,
  max_data_cache_entry: 100,
};

var udm = new udManager();
udm.init({
  webStorageModule: HuggingFace,
  metaCacheModule: MetaCache,
  dataCacheModule: DataCache,
  profile: profile
});

// Step 1: List the model repository
console.log('Step 1 — List model repository files');
console.log('--------------------------------------');
udm.getFileList('/', function (error, response) {
  if (error) {
    console.error('Error listing files:', error);
    process.exit(1);
  }

  var files = response.data.list;
  console.log('Files in ' + MODEL_ID + ':');
  files.forEach(function (f) {
    var sizeMB = (f.size / (1024 * 1024)).toFixed(1);
    console.log('  ' + f.path + '  (' + sizeMB + ' MB)');
  });
  console.log('');

  // Step 2: Get metadata for the specific GGUF file
  console.log('Step 2 — Inspect model file metadata');
  console.log('--------------------------------------');
  udm.getFileMeta('/' + MODEL_FILE, function (error, response) {
    if (error || !response.data) {
      console.error('Error getting file metadata:', error || 'File not found');
      process.exit(1);
    }

    var meta = response.data.list[0];
    var fileSizeMB  = (meta.size / (1024 * 1024)).toFixed(1);
    var fileSizeBlocks = Math.ceil(meta.size / BLOCK_SIZE);

    console.log('File  : ' + meta.path);
    console.log('Size  : ' + fileSizeMB + ' MB  (' + fileSizeBlocks + ' blocks of ' + (BLOCK_SIZE / 1024) + ' KB each)');
    console.log('');

    // Step 3: Simulate the reads llama.cpp would make during model init
    console.log('Step 3 — Simulate llama.cpp model initialisation reads');
    console.log('--------------------------------------------------------');
    console.log('Each read fetches exactly one ' + (BLOCK_SIZE / 1024) + ' KB block from HF Hub.');
    console.log('Subsequent reads to the same block are served from cache — no network.');
    console.log('');

    var networkFetches = 0;
    var cacheHits = 0;
    var totalBytesFromNetwork = 0;
    var index = 0;

    function runNextRead() {
      if (index >= SIMULATED_READS.length) {
        printSummary(meta.size, networkFetches, cacheHits, totalBytesFromNetwork);
        return;
      }

      var read = SIMULATED_READS[index++];
      var buf  = Buffer.alloc(read.size);
      var blockIndex = Math.floor(read.offset / BLOCK_SIZE);

      // Peek at the cache BEFORE the read to determine hit/miss for reporting.
      var cacheKey = udm.dataCache.generateKey({
        path:      '/' + MODEL_FILE,
        offset:    blockIndex * BLOCK_SIZE,
        totalSize: meta.size,
        mtime:     meta.mtime
      });
      var inCache = !!udm.dataCache.get(cacheKey);

      var start = Date.now();
      udm.downloadFileInRangeByCache('/' + MODEL_FILE, buf, read.offset, read.size, function (error) {
        var elapsed = Date.now() - start;
        if (error) {
          console.error('Error reading block:', error);
          process.exit(1);
        }

        if (inCache) {
          cacheHits++;
          console.log('  [CACHE HIT ] ' + read.label);
          console.log('               block #' + blockIndex + ', offset ' + read.offset + ', ' + elapsed + 'ms');
        } else {
          networkFetches++;
          totalBytesFromNetwork += BLOCK_SIZE;
          console.log('  [NETWORK   ] ' + read.label);
          console.log('               block #' + blockIndex + ', offset ' + read.offset + ', ' + elapsed + 'ms  ← fetched ' + (BLOCK_SIZE / 1024) + ' KB from HF CDN');
        }
        console.log('');

        runNextRead();
      });
    }

    runNextRead();
  });
});

function printSummary(fileSize, networkFetches, cacheHits, bytesFromNetwork) {
  var fileSizeMB   = (fileSize / (1024 * 1024)).toFixed(1);
  var networkMB    = (bytesFromNetwork / (1024 * 1024)).toFixed(1);
  var savedMB      = ((fileSize - bytesFromNetwork) / (1024 * 1024)).toFixed(1);
  var savedPercent = ((1 - bytesFromNetwork / fileSize) * 100).toFixed(1);

  console.log('Summary');
  console.log('-------');
  console.log('Model file size          : ' + fileSizeMB + ' MB');
  console.log('Blocks fetched over network : ' + networkFetches + '  (' + networkMB + ' MB)');
  console.log('Cache hits               : ' + cacheHits);
  console.log('Bytes saved              : ' + savedMB + ' MB  (' + savedPercent + '% of model never downloaded)');
  console.log('');
  console.log('On a Raspberry Pi 5 with a slow uplink, this is the difference between');
  console.log('"wait 8 minutes to download the model" and "first token in ~30 seconds".');
  console.log('');
  console.log('FUSE mount equivalent:');
  console.log('  # Mount the model repo as a local directory');
  console.log('  ./udFuse.js -p Llama1B /mnt/models');
  console.log('');
  console.log('  # llama.cpp reads the file normally — UniDisk handles block fetching');
  console.log('  llama-cli -m /mnt/models/' + MODEL_FILE + ' -p "Hello, world" -n 128');
  console.log('');
  console.log('Settings for ~/.unidisk/settings.json:');
  console.log(JSON.stringify({
    block_reading_size: BLOCK_SIZE,
    prefetch_blocks: 10,
    max_data_cache_entry: 200,
    cache_path: '/tmp/ud/cache',
    profile: {
      Llama1B: {
        type: 'mount',
        module: 'HuggingFace',
        writable: false,
        cacheStore: 'disk',
        model: MODEL_ID,
        token: 'hf_...'
      }
    }
  }, null, 2));
}
