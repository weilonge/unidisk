var fs = require('fs');

var DataCache = {};

DataCache.init = function (blockSize) {
  this._BLOCK_SIZE = blockSize;
  this._fileDataCache = {};
  this._CACHE_PATH = '/tmp/ud/cache';
};

DataCache.update = function (md5sum, data) {
  this._fileDataCache[md5sum] = data;
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
  fs.writeFile(this._CACHE_PATH + '/' + task.md5sum, data, function(err) {
    if(err) {
      console.log(err);
    } else {
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
