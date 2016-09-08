var fs = require('fs-extra');
var Settings = require('./Settings');
var logger = require('./log');

var DiskDataStore = function () {};

DiskDataStore.prototype.retrieveFileName = function(key) {
  return this._CACHE_PATH + '/' + key;
};

DiskDataStore.prototype.init = function (){
  this._CACHE_PATH = Settings.get('cache_path');
  fs.removeSync(this._CACHE_PATH);
  fs.mkdirsSync(this._CACHE_PATH);
};

DiskDataStore.prototype.deleteEntry = function (key){
  var fileName = this.retrieveFileName(key);
  fs.unlink(fileName, function (err){
    if (err) throw err;
    logger.verbose('successfully deleted ' + fileName);
  });
};

DiskDataStore.prototype.readEntry =
  function (key, targetBuffer, targetOffset, sourceOffset, length){
  var fileName = this.retrieveFileName(key);
  var fd = fs.openSync(fileName, 'rs');
  fs.readSync(fd, targetBuffer, targetOffset, length, sourceOffset);
  fs.closeSync(fd);
};

DiskDataStore.prototype.writeEntry = function (key, data, cb){
  var fileName = this.retrieveFileName(key);
  fs.writeFile(fileName, data, cb);
};

module.exports = DiskDataStore;
