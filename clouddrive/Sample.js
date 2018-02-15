const EventEmitter = require('events');
const util = require('util');
const fs = require('fs');
const pathUtil = require('path');
const logger = require('../helper/log');

var Sample = function (){
  EventEmitter.call(this);
};
util.inherits(Sample, EventEmitter);

function str2ab(str) {
  var buf = new ArrayBuffer(str.length*2); // 2 bytes for each char
  var bufView = new Uint16Array(buf);
  for (var i=0, strLen=str.length; i<strLen; i++) {
    bufView[i] = str.charCodeAt(i);
  }
  return buf;
}

Sample.prototype.init = function (options){
  this._IS_WEB = typeof document !== 'undefined' &&
    typeof window !== 'undefined';
  var jsonFileName = options.JSONPath;
  this._jsonFileName = jsonFileName;
  if (this._IS_WEB) {
    var xmlhttp = new XMLHttpRequest();
    xmlhttp.open('get', jsonFileName, false);
    xmlhttp.setRequestHeader('Accept', 'application/json');
    xmlhttp.send(null);
    this._TEST_DATA = JSON.parse(xmlhttp.responseText);
  } else {
    this._TEST_DATA = require(jsonFileName);
  }

  this._writePendingData = {};
};

Sample.prototype.registerChange = function () {
  var self = this;
  if (this._IS_WEB) {
    logger.info('File watcher for Sample module ' +
                'does not support in browser yet.');
    return;
  }
  fs.watchFile(this._jsonFileName, function (curr, prev) {
    self.emit('fileChange', {
      path: '/',
      recursive: true,
      DEBUG: {
        current: curr,
        previous: prev
      }
    });
    self._TEST_DATA = null;
    // A technique here to remove the cached module by require.
    delete require.cache[require.resolve(self._jsonFileName)];
    self._TEST_DATA = require(self._jsonFileName);
  });
};

Sample.prototype.isIllegalFileName = function (path) {
  return path.indexOf('/._') !== -1;
};

Sample.prototype._isObject = function (obj) {
  return typeof obj === 'object';
};

Sample.prototype._findMeta = function (path) {
  if (path === '/') {
    return this._TEST_DATA;
  }
  var nodes = path.split('/');
  var currentNode = this._TEST_DATA[nodes[1]];
  for (var i = 2; i < nodes.length; i++) {
    if (currentNode) {
      currentNode = currentNode[nodes[i]];
    } else {
      return null;
    }
  }
  return currentNode;
};

Sample.prototype._getMeta = function (path) {
  var meta = this._findMeta(path);
  if (meta || typeof meta === 'string') {
    if (typeof meta === 'string') {
      var length = this._IS_WEB ? meta.length * 2 : meta.length; // for UTF-16
      return {
        isdir: 0,
        path: path,
        size: length,
        mtime: Date.now(),
        ctime: Date.now()
      };
    } else if (this._isObject(meta)) {
      return {
        isdir: 1,
        path: path,
        size: 0,
        mtime: Date.now(),
        ctime: Date.now()
      };
    }
  } else {
    return null;
  }
};

Sample.prototype.quota = function (cb){
  cb(null, {
    data:{
      quota: 2313913630720,
      used: 58410672308,
    }
  });
};

Sample.prototype.getFileMeta = function (path, cb){
  var meta = this._getMeta(path);
  var result = meta ? {list: [meta]} : null;
  cb(null, {
    data: result
  });
};

Sample.prototype._exportData = function (result) {
  if (this._IS_WEB) {
    var ab = str2ab(result);
    return {
      data: ab,
      length: ab.byteLength
    };
  } else {
    return {
      data: result,
      length: result.length
    };
  }
};

Sample.prototype.getFileDownload = function (path, offset, size, cb){
  var meta = this._findMeta(path);
  if (meta && typeof meta === 'string') {
    var result = meta.substr(offset, size);
    cb(null, this._exportData(result));
  } else {
    cb(null, null);
  }
};

Sample.prototype.getFileList = function (path, cb){
  var meta = this._getMeta(path);
  var resultList = [];
  if (meta && meta.isdir === 1) {
    var list = this._findMeta(path);
    var keys = Object.keys(list);
    for (var i = 0; i < keys.length; i++) {
      var childPath = path + '/' + keys[i];
      childPath = childPath.replace('//', '/', 'gi');
      var childMeta = this._getMeta(childPath);
      resultList.push(childMeta);
    }
    cb(null, {data: {
      list: resultList
    }});
  } else {
    cb(null, null);
  }
};

Sample.prototype.openFile = function (path, flags, fd, cb) {
  var pendingData = this._writePendingData;
  if (pendingData[fd]) {
    cb({error:'File is opened'});
  } else {
    pendingData[fd] = {
      path: path,
      flags: flags,
      blocks: []
    };
    cb(null, null);
  }
};

Sample.prototype.createEmptyFile = function (path, cb){
  if (this._findMeta(path)) {
    cb({ error: 'File exists already.' }, null);
  } else {
    var folders = path.split('/');
    folders.shift();
    var current = this._TEST_DATA;
    for (var i = 0; i < folders.length - 1; i++) {
      current = current[folders[i]];
    }
    current[folders[folders.length - 1]] = '';
    cb(null, null);
  }
};

Sample.prototype.writeFileData = function (path, fd, buffer, offset, length, cb){
  var pendingData = this._writePendingData, error;
  if (pendingData[fd] && pendingData[fd].path === path) {
    if (pendingData[fd].blocks.length === 0) {
      if (offset !== 0) {
        logger.error('Write operation does not start at offset 0.');
        error = 'Write operation does not start at offset 0.';
      }
    } else {
      var blocks = pendingData[fd].blocks;
      var lastBlock = blocks[blocks.length - 1];
      if ((lastBlock.offset + lastBlock.length) !== offset) {
        logger.error('Non-sequential write operation.');
        error = 'Non-sequential write operation.';
      }
    }

    if (error) {
      cb({error: error});
    } else {
      pendingData[fd].blocks.push({
        offset: offset,
        length: length,
        buffer: buffer.toString('binary')
      });
      cb(null, {
        data: {length: length}
      });
    }
  } else {
    cb({error:'Incorrect fd and path'});
  }
};

Sample.prototype.commitFileData = function (path, fd, cb){
  var pendingData = this._writePendingData, currentIndex = 0;
  if (pendingData[fd] && pendingData[fd].path === path) {
    var baseName = pathUtil.basename(path);
    var dirName = this._findMeta(pathUtil.dirname(path));
    for (var i in pendingData[fd].blocks) {
      if (pendingData[fd].blocks[i].offset === currentIndex) {
        dirName[baseName] += pendingData[fd].blocks[i].buffer;
        currentIndex = pendingData[fd].blocks[i].offset + pendingData[fd].blocks[i].length;
      } else {
        logger.error('Incorrect offset while writing file.');
      }
    }
    pendingData[fd] = null;
    cb(null, null);
  } else {
    cb({error:'Unable to close a non-opened file.'});
  }
};

module.exports = Sample;
