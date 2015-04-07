var fs = require('fs');

var DataCache = {};

DataCache.init = function (blockSize) {
  this._CACHE_PATH = '/tmp/ud/cache';
  this._MAX_DATA_CACHE_ENTRY = 50;
  this._BLOCK_SIZE = blockSize;

  this._fileDataCache = {};
  this._priorityQueue = [];
};

DataCache.update = function (key, data) {
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
      this._removeEntry(deletingCandidateKey);
      this._pushEntry(key, data);
    }
  }
};

DataCache._updateEntry = function (key, data) {
  this._fileDataCache[key] = data;
};

DataCache._pushEntry = function (key, data) {
  this._fileDataCache[key] = data;
  this._priorityQueue.push(key);
};

DataCache._removeEntry = function (key) {
  var fileName = this._CACHE_PATH + '/' + key;

  delete this._fileDataCache[key];

  fs.unlink(fileName, function (err){
    if (err) throw err;
    console.log('successfully deleted ' + fileName);
  });
};

DataCache._popLowPriorityKey = function () {
  return this._priorityQueue.shift();
};

DataCache.updateStatus = function (md5sum, status) {
  this._fileDataCache[md5sum].status = status;
};

DataCache.get = function (md5sum) {
  if (this._fileDataCache.hasOwnProperty(md5sum)) {
    return this._fileDataCache[md5sum];
  }
  return null;
};

DataCache.writeCache = function (task, data, cb){
  var self = this;
  fs.writeFile(this._CACHE_PATH + '/' + task.md5sum, data, function(err) {
    if(err) {
      console.log(err);
    } else {
      self.updateStatus(task.md5sum, 'DONE');
      console.log('The file was saved!');
    }
    cb();
  });
};

DataCache.readCache = function (path, buffer, offset, size, requestList, cb){
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

      var fd = fs.openSync(this._CACHE_PATH + '/' + task.md5sum, 'rs');
      fs.readSync(fd, buffer, cursor_moved, writeSize, seek);
      fs.closeSync(fd);

      cursor_moved += writeSize ;
    } else {
      console.error('======= Critical Error =======');
      console.error(path);
      console.error(offset);
      console.error(size);
      console.error(requestList);
      console.error(this._fileDataCache);

      throw Error('data is not finished.');
    }
  }
  cb();
};

DataCache.generateKey = function (task){
  var crypto = require('crypto');
  var name = task.path + '' + task.offset + '';
  var hash = crypto.createHash('md5').update(name).digest('hex');
  return hash;
};

module.exports = DataCache;
