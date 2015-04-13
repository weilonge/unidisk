var fs = require('fs');

var DiskDataStore = {};

DiskDataStore.init = function (){
  this._CACHE_PATH = '/tmp/ud/cache';
};

DiskDataStore.deleteEntry = function (key){
  var fileName = this._CACHE_PATH + '/' + key;
  fs.unlink(fileName, function (err){
    if (err) throw err;
    console.log('successfully deleted ' + fileName);
  });
};

DiskDataStore.readEntry =
  function (key, targetBuffer, targetOffset, sourceOffset, length){
  var fileName = this._CACHE_PATH + '/' + key;
  var fd = fs.openSync(fileName, 'rs');
  fs.readSync(fd, targetBuffer, targetOffset, length, sourceOffset);
  fs.closeSync(fd);
};

DiskDataStore.writeEntry = function (key, data, cb){
  var fileName = this._CACHE_PATH + '/' + key;
  fs.writeFile(fileName, data, cb);
};

module.exports = DiskDataStore;
