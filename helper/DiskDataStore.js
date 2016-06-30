var fs = require('fs');
var Settings = require('./Settings');
var logger = require('./log');

var DiskDataStore = {};

var fs = require('fs');
var deleteFolderRecursive = function(path) {
  if( fs.existsSync(path) ) {
    fs.readdirSync(path).forEach(function(file,index){
      var curPath = path + '/' + file;
      if(fs.lstatSync(curPath).isDirectory()) { // recurse
        deleteFolderRecursive(curPath);
      } else { // delete file
        fs.unlinkSync(curPath);
      }
    });
    fs.rmdirSync(path);
  }
};

DiskDataStore.init = function (){
  this._CACHE_PATH = Settings.get('cache_path');
  deleteFolderRecursive(this._CACHE_PATH);
  fs.mkdirSync(this._CACHE_PATH);
};

DiskDataStore.deleteEntry = function (key){
  var fileName = this._CACHE_PATH + '/' + key;
  fs.unlink(fileName, function (err){
    if (err) throw err;
    logger.verbose('successfully deleted ' + fileName);
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
