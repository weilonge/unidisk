var logger = require('../helper/log');
const EventEmitter = require('events');
const util = require('util');
const https = require('https');

// HuggingFace Hub provider for UniDisk.
//
// Mounts a single HuggingFace model repository as a read-only filesystem.
// Files in the repo appear as entries under the root directory.
//
// Profile options:
//   model    (required) — e.g. "bartowski/Llama-3.2-1B-Instruct-GGUF"
//   token    (optional) — HF access token for gated models
//   revision (optional) — branch/tag/commit, defaults to "main"
//
// Example config entry in settings.json:
//   "Llama1B": {
//     "type": "mount",
//     "module": "HuggingFace",
//     "writable": false,
//     "cacheStore": "disk",
//     "model": "bartowski/Llama-3.2-1B-Instruct-GGUF",
//     "token": "hf_..."
//   }

var HuggingFace = function () {
  EventEmitter.call(this);
};
util.inherits(HuggingFace, EventEmitter);

HuggingFace.prototype.init = function (options) {
  this._model    = options.model;
  this._token    = options.token || null;
  this._revision = options.revision || 'main';
  this._siblingsCache = null; // lazy-loaded file list from HF API
};

HuggingFace.prototype.isIllegalFileName = function (path) {
  return path.indexOf('/._') !== -1;
};

// ------------------------------------------------------------------
// Internal helpers
// ------------------------------------------------------------------

HuggingFace.prototype._authHeaders = function () {
  var headers = { 'User-Agent': 'unidisk/1.0' };
  if (this._token) {
    headers['Authorization'] = 'Bearer ' + this._token;
  }
  return headers;
};

// Fetches https://huggingface.co/api/models/{model} once and caches the
// siblings list (filename → size mapping).
HuggingFace.prototype._getSiblings = function (cb) {
  if (this._siblingsCache) {
    process.nextTick(function () { cb(null, this._siblingsCache); }.bind(this));
    return;
  }

  var self = this;
  var url = 'https://huggingface.co/api/models/' + this._model;
  var headers = this._authHeaders();

  var req = https.get(url, { headers: headers }, function (res) {
    var body = '';
    res.on('data', function (chunk) { body += chunk; });
    res.on('end', function () {
      if (res.statusCode !== 200) {
        cb({ error: 'HF API returned HTTP ' + res.statusCode + ' for ' + url });
        return;
      }
      try {
        var parsed = JSON.parse(body);
        // Build a flat map: filename -> size
        var siblings = {};
        (parsed.siblings || []).forEach(function (s) {
          siblings[s.rfilename] = { size: s.size || 0 };
        });
        self._siblingsCache = siblings;
        cb(null, siblings);
      } catch (e) {
        cb({ error: 'Failed to parse HF API response: ' + e.message });
      }
    });
  });

  req.on('error', function (e) {
    cb({ error: 'HF API request failed: ' + e.message });
  });
};

// ------------------------------------------------------------------
// Provider interface (matches Dropbox.js)
// ------------------------------------------------------------------

HuggingFace.prototype.quota = function (cb) {
  this._getSiblings(function (error, siblings) {
    if (error) { cb(error, null); return; }
    var totalSize = Object.keys(siblings).reduce(function (acc, k) {
      return acc + siblings[k].size;
    }, 0);
    cb(null, { data: { quota: totalSize, used: totalSize } });
  });
};

HuggingFace.prototype.getFileMeta = function (path, cb) {
  var self = this;

  if (path === '/') {
    process.nextTick(function () {
      cb(null, {
        data: {
          list: [{
            isdir: 1,
            path: '/',
            size: 0,
            mtime: new Date(0).getTime(),
            ctime: new Date(0).getTime()
          }]
        }
      });
    });
    return;
  }

  var filename = path.replace(/^\//, '');
  this._getSiblings(function (error, siblings) {
    if (error) { cb(error, null); return; }

    var entry = siblings[filename];
    if (!entry) {
      cb(null, { data: null });
      return;
    }
    cb(null, {
      data: {
        list: [{
          isdir: 0,
          path: path,
          size: entry.size,
          mtime: new Date(0).getTime(),
          ctime: new Date(0).getTime()
        }]
      }
    });
  });
};

HuggingFace.prototype.getFileList = function (path, cb) {
  this._getSiblings(function (error, siblings) {
    if (error) { cb(error, null); return; }

    var list = Object.keys(siblings).map(function (filename) {
      return {
        isdir: 0,
        path: '/' + filename,
        size: siblings[filename].size,
        mtime: new Date(0).getTime(),
        ctime: new Date(0).getTime()
      };
    });

    cb(null, { data: { list: list } });
  });
};

// Range-based download from the HF CDN.
// URL pattern: https://huggingface.co/{model}/resolve/{revision}/{filename}
HuggingFace.prototype.getFileDownload = function (path, offset, size, cb) {
  var self = this;
  var filename = path.replace(/^\//, '');
  var url = 'https://huggingface.co/' + this._model +
            '/resolve/' + this._revision + '/' + filename;
  var headers = this._authHeaders();
  headers['Range'] = 'bytes=' + offset + '-' + (offset + size - 1);

  logger.verbose('[HF] GET ' + filename + ' bytes=' + offset + '-' + (offset + size - 1));

  // HF CDN redirects to S3/CloudFront; follow redirects manually.
  function doRequest(requestUrl, redirectCount) {
    if (redirectCount > 5) {
      cb({ error: 'Too many redirects for ' + requestUrl });
      return;
    }

    var parsedUrl = new URL(requestUrl);
    var reqOptions = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: headers,
      method: 'GET'
    };

    var req = https.request(reqOptions, function (res) {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
        res.resume(); // discard body
        doRequest(res.headers.location, redirectCount + 1);
        return;
      }

      if (res.statusCode !== 206 && res.statusCode !== 200) {
        res.resume();
        cb({ error: 'HF download returned HTTP ' + res.statusCode });
        return;
      }

      var chunks = [];
      var received = 0;
      res.on('data', function (chunk) {
        chunks.push(chunk);
        received += chunk.length;
      });
      res.on('end', function () {
        var data = Buffer.concat(chunks);
        cb(null, { data: data, length: data.length });
      });
    });

    req.on('error', function (e) {
      cb({ error: 'HF download request failed: ' + e.message });
    });

    req.end();
  }

  doRequest(url, 0);
};

// Read-only provider — write operations are not supported.
HuggingFace.prototype.openFile = function (path, flags, fd, cb) {
  cb(null, null);
};

HuggingFace.prototype.closeFile = function (path, fd, cb) {
  cb(null, null);
};

HuggingFace.prototype.createEmptyFile = function (path, cb) {
  cb({ error: 'HuggingFace provider is read-only' }, null);
};

HuggingFace.prototype.writeFileData = function (path, fd, buffer, offset, length, cb) {
  cb({ error: 'HuggingFace provider is read-only' }, null);
};

HuggingFace.prototype.commitFileData = function (path, fd, cb) {
  cb(null, null);
};

HuggingFace.prototype.deleteFile = function (path, cb) {
  cb({ error: 'HuggingFace provider is read-only' }, null);
};

HuggingFace.prototype.deleteFolder = function (path, cb) {
  cb({ error: 'HuggingFace provider is read-only' }, null);
};

HuggingFace.prototype.createFolder = function (path, cb) {
  cb({ error: 'HuggingFace provider is read-only' }, null);
};

HuggingFace.prototype.move = function (src, dst, cb) {
  cb({ error: 'HuggingFace provider is read-only' }, null);
};

module.exports = HuggingFace;
