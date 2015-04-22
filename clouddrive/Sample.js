var Sample = function (){};

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
  if (this._IS_WEB) {
    var xmlhttp = new XMLHttpRequest();
    xmlhttp.open('get', jsonFileName, false);
    xmlhttp.setRequestHeader('Accept', 'application/json');
    xmlhttp.send(null);
    this._TEST_DATA = JSON.parse(xmlhttp.responseText);
  } else {
    this._TEST_DATA = require(jsonFileName);
  }
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
    }else {
      return null;
    }
  }
  return currentNode;
};

Sample.prototype._getMeta = function (path) {
  var meta = this._findMeta(path);
  if (meta) {
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
      request_id: 1741802854
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
    for(var i = 0; i < keys.length; i++){
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

module.exports = Sample;
