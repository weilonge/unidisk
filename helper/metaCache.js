var MetaCache = {};

MetaCache._fileMetaCache = {};
MetaCache._fileListCache = {};

MetaCache.updateMeta = function (path, data) {
  this._fileMetaCache[path] = data;
};

MetaCache.getMeta = function (path) {
  if (this._fileMetaCache.hasOwnProperty(path)) {
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

module.exports = MetaCache;
