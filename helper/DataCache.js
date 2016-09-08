var Settings = require('./Settings');
var Path = require('path');
var logger = require('./log');

var DataCache = function () {};

DataCache.prototype.init = function (profile, blockSize) {
  this._MAX_DATA_CACHE_ENTRY = Settings.get('max_data_cache_entry');
  this._BLOCK_SIZE = blockSize;

  function selectDataStore(storeName) {
    var store;
    switch (storeName) {
    case 'memory':
      store = require('./MemoryDataStore');
      break;
    case 'disk':
      store = require('./DiskDataStore');
    }
    return store;
  }

  var DataStore = selectDataStore(profile.cacheStore);
  this._dataStore = new DataStore();
  this._dataStore.init();

  this._fileDataCache = {};
  this._priorityQueue = [];
};

DataCache.prototype.update = function (key, data) {
  if (this._fileDataCache.hasOwnProperty(key) ) {
    // Update an exist cache entry.
    this._updateEntry(key, data);
  } else {
    // Add a new data cache.
    if (this._priorityQueue.length < this._MAX_DATA_CACHE_ENTRY) {
      // Entry is sufficient to add a new one.
      this._pushEntry(key, data);
    } else {
      // Remove an entry and delete cache file.
      var deletingCandidateKey = this._popLowPriorityKey();
      // TODO: the task should be made sure it's in the status DONE.
      this._removeEntry(deletingCandidateKey);
      this._pushEntry(key, data);
    }
  }
};

DataCache.prototype._updateEntry = function (key, data) {
  this._fileDataCache[key] = data;
};

DataCache.prototype._pushEntry = function (key, data) {
  this._fileDataCache[key] = data;
  this._priorityQueue.push(key);
};

DataCache.prototype._removeEntry = function (key) {
  delete this._fileDataCache[key];
  this._dataStore.deleteEntry(key);
};

DataCache.prototype._popLowPriorityKey = function () {
  return this._priorityQueue.shift();
};

DataCache.prototype.updateStatus = function (md5sum, status) {
  this._fileDataCache[md5sum].status = status;
};

DataCache.prototype.get = function (md5sum) {
  if (this._fileDataCache.hasOwnProperty(md5sum)) {
    return this._fileDataCache[md5sum];
  }
  return null;
};

DataCache.prototype.writeCache = function (task, data, cb){
  var self = this;
  this._dataStore.writeEntry(task.md5sum, data, function(err) {
    if(err) {
      logger.error('writeCache: ' + JSON.stringify(err));
    } else {
      self.updateStatus(task.md5sum, 'DONE');
      logger.verbose('The file was saved!');
    }
    cb();
  });
};

DataCache.prototype.readCache = function (path, buffer, offset, size, requestList, cb){
  var seek = 0,
    writeSize = 0,
    cursor_moved = 0;

  for (var i in requestList) {
    var task = requestList[i];
    if (task.priority === 'PREFETCH') {
      continue;
    }
    if (this._fileDataCache[task.md5sum] &&
      this._fileDataCache[task.md5sum].status === 'DONE') {
      seek = ( offset + cursor_moved ) % this._BLOCK_SIZE;
      writeSize = this._BLOCK_SIZE - seek;
      if ((writeSize + cursor_moved ) > size) {
        writeSize = size - cursor_moved;
      }

      this._dataStore.readEntry(task.md5sum,
        buffer, cursor_moved, seek, writeSize);

      cursor_moved += writeSize ;
    } else {
      logger.error(JSON.stringify({
        msg: '======= Critical Error =======',
        path: path,
        offset: offset,
        size: size,
        requestList: requestList,
        fileDataCache: this._fileDataCache
      }));

      throw Error('data is not finished.');
    }
  }
  cb();
};

DataCache.prototype._generateKeyListByPath = function (path, recursive) {
  var list = [];
  for (var i in this._fileDataCache) {
    var t = this._fileDataCache[i].path;
    if (recursive) {
      if (Path.relative(path, t).indexOf('..') !== 0) {
        list.push(this._fileDataCache[i].md5sum);
      }
    } else if (path === t) {
      list.push(this._fileDataCache[i].md5sum);
    }
  }
  return list;
};

DataCache.prototype.clear = function (path, recursive){
  var list = this._generateKeyListByPath(path, recursive);
  for (var i = 0; i < list.length; i++) {
    var key = list[i];
    this._removeEntry(key);
    var index = this._priorityQueue.indexOf(key);
    if (index !== -1) {
      this._priorityQueue.splice(index, 1);
    }
  }
};

DataCache.prototype.generateKey = function (task){
  function hashCode(str) {
    var hash = 0, i, chr, len;
    if (str.length === 0) return hash;
    for (i = 0, len = str.length; i < len; i++) {
      chr   = str.charCodeAt(i);
      hash  = ((hash << 5) - hash) + chr;
      hash |= 0; // Convert to 32bit integer
    }
    return hash;
  }

  var obscured = task.path.replace(/\//g, ':');
  return hashCode(task.path) + '@' + obscured + '@' + task.offset;
};

module.exports = DataCache;
