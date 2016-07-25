var MetaCache = {};
var Path = require('path');

MetaCache.init = function (){
  this._fileMetaCache = {};
  this._fileListCache = {};
};

MetaCache.update = function (path, data) {
  this._fileMetaCache[path] = data;
};

MetaCache.hasEntry = function (path) {
  return this._fileMetaCache.hasOwnProperty(path);
};

MetaCache.get = function (path) {
  if (this.hasEntry(path)) {
    return this._fileMetaCache[path];
  }
  return null;
};

MetaCache.updateList = function (path, data) {
  this._fileListCache[path] = data;
};

MetaCache.getList = function (path) {
  if (this._fileListCache.hasOwnProperty(path)) {
    return this._fileListCache[path];
  }
  return null;
};

MetaCache.clear = function (path, recursive){
  if (!path) {
    //this._fileMetaCache = {};
    //this._fileListCache = {};
    return;
  }
  if (recursive) {
    for (var p in this._fileMetaCache) {
      if (typeof p === 'string' && Path.relative(path, p).indexOf('..') !== 0) {
        delete this._fileMetaCache[p];
      }
    }
    for (var t in this._fileListCache) {
      if (typeof t === 'string' && Path.relative(path, t).indexOf('..') !== 0) {
        delete this._fileListCache[t];
      }
    }
  } else {
    if (this._fileMetaCache[path]) {
      delete this._fileMetaCache[path];
    }
    if (this._fileListCache[path]) {
      delete this._fileListCache[path];
    }
  }
};

module.exports = MetaCache;
