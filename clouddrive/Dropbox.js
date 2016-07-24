var Settings = require('../helper/Settings');
var logger = require('../helper/log');
const EventEmitter = require('events');
const util = require('util');

var Dropbox = function (){
  EventEmitter.call(this);
};
util.inherits(Dropbox, EventEmitter);

Dropbox.prototype.init = function (options){
  this._IS_WEB = typeof document !== 'undefined' &&
    typeof window !== 'undefined';
  this.XHR = this._IS_WEB ? window.XMLHttpRequest : require('xhr2');

  this._writePendingData = {};

  if (options.token) {
    this.USERTOKEN = options.token;
  } else {
    this.USERTOKEN = Settings.get('dropbox_token');
  }
  this.registerChange();
};

Dropbox.prototype.isIllegalFileName = function (path) {
  return path.indexOf('/._') !== -1;
};

Dropbox.prototype.registerChange = function (){
  var self = this;
  var latestCursor;
  function getLatestCursor(callback) {
    var xmlhttp = new self.XHR();
    xmlhttp.open('post', 'https://api.dropboxapi.com/1/delta/latest_cursor', true);
    xmlhttp.setRequestHeader('Authorization', 'Bearer ' + self.USERTOKEN);
    xmlhttp.setRequestHeader('Accept', 'application/json');
    xmlhttp.onload = function () {
      self._handleJson(xmlhttp, callback);
    };
    xmlhttp.send();
  }

  function sendLongPoll(cursor, callback) {
    var xmlhttp = new self.XHR();
    xmlhttp.open('get', 'https://notify.dropboxapi.com/1/longpoll_delta?cursor=' + cursor, true);
    xmlhttp.setRequestHeader('Authorization', 'Bearer ' + self.USERTOKEN);
    xmlhttp.setRequestHeader('Accept', 'application/json');
    xmlhttp.onload = function () {
      self._handleJson(xmlhttp, callback);
    };
    xmlhttp.send();
  }

  function getDelta(cursor, callback) {
    var xmlhttp = new self.XHR();
    xmlhttp.open('post', 'https://api.dropboxapi.com/1/delta?cursor=' + cursor, true);
    xmlhttp.setRequestHeader('Authorization', 'Bearer ' + self.USERTOKEN);
    xmlhttp.setRequestHeader('Accept', 'application/json');
    xmlhttp.onload = function () {
      self._handleJson(xmlhttp, callback);
    };
    xmlhttp.send();
  }

  function repeat(callback) {
    sendLongPoll(latestCursor, function (error, response) {
      getDelta(latestCursor, function (error, response){
        var delta = response.data;
        getLatestCursor(function (error, response) {
          latestCursor = response.data.cursor;
          callback(null, delta);
          repeat(callback);
        });
      });
    });
  }

  getLatestCursor(function (error, response) {
    latestCursor = response.data.cursor;
    repeat(function (error, response) {
      logger.verbose(response);
      if (response.entries && response.entries.length === 0) {
        return;
      }
      self.emit('fileChange', {
        path: '/',
        recursive: true,
        DEBUG: {
          response: response
        }
      });
    });
  });
};

Dropbox.prototype._handleJson = function (xmlhttp, cb){
  var response = {
    data: null
  };
  if (xmlhttp.status == 200) {
    try {
      response.data = JSON.parse(xmlhttp.responseText);
      cb(null, response);
    } catch (e) {
      cb({
        error: 'parsing failed.'
      }, response);
    }
  } else if (xmlhttp.status == 404){
    cb(null, response); // File not found
  } else {
    cb({
      error: 'http status: ' + xmlhttp.status
    }, response);
  }
};

Dropbox.prototype.quota = function (cb){
  var self = this;
  var xmlhttp = new this.XHR();
  xmlhttp.open('get', 'https://api.dropbox.com/1/account/info', true);
  xmlhttp.setRequestHeader('Authorization', 'Bearer ' + self.USERTOKEN);
  xmlhttp.setRequestHeader('Accept', 'application/json');
  xmlhttp.onload = function () {
    self._handleJson(xmlhttp, function (error, response){
      if (response.data) {
        var quotaInfo = response.data.quota_info;
        var result = {
          data:{
            quota: quotaInfo.quota,
            used: (quotaInfo.normal + quotaInfo.shared)
          }
        };
        cb(error, result);
      } else {
        cb(error, response);
      }
    });
  };

  xmlhttp.send();
};

Dropbox.prototype._convertItem = function (data){
  return {
    isdir: data.is_dir ? 1 : 0,
    path: data.path,
    size: data.bytes,
    // Date format:
    // "%a, %d %b %Y %H:%M:%S %z"
    //
    // Example: "Sat, 21 Aug 2010 22:31:20 +0000"
    mtime: new Date(data.modified).getTime(),
    ctime: new Date(data.modified).getTime()
  };
};

Dropbox.prototype.getFileMeta = function (path, cb){
  var self = this;
  var xmlhttp = new this.XHR();
  xmlhttp.open('get', 'https://api.dropbox.com/1/metadata/auto' + encodeURIComponent(path), true);
  xmlhttp.setRequestHeader('Authorization', 'Bearer ' + self.USERTOKEN);
  xmlhttp.setRequestHeader('Accept', 'application/json');
  xmlhttp.onload = function () {
    self._handleJson(xmlhttp, function (error, response){
      if (response.data) {
        var data = response.data;
        var result = {
          data:{
            list: [self._convertItem(data)]
          }
        };
        cb(error, result);
      } else {
        cb(error, response);
      }
    });
  };

  xmlhttp.send('list=false');
};

Dropbox.prototype.getFileList = function (path, cb){
  var self = this;
  var xmlhttp = new this.XHR();
  xmlhttp.open('get', 'https://api.dropbox.com/1/metadata/auto' + encodeURIComponent(path), true);
  xmlhttp.setRequestHeader('Authorization', 'Bearer ' + self.USERTOKEN);
  xmlhttp.setRequestHeader('Accept', 'application/json');
  xmlhttp.onload = function () {
    self._handleJson(xmlhttp, function (error, response){
      if (response.data) {
        var data = response.data;
        var resultList = [];
        for(var i = 0; i < data.contents.length; i++){
          var content = data.contents[i];
          resultList.push(self._convertItem(content));
        }
        var result = {
          data:{
            list: resultList
          }
        };
        cb(error, result);
      } else {
        cb(error, response);
      }
    });
  };

  xmlhttp.send('list=true');
};

Dropbox.prototype.getFileDownload = function (path, offset, size, cb){
  var self = this;
  var xmlhttp = new this.XHR();
  xmlhttp.open('get', 'https://api-content.dropbox.com/1/files/auto' + encodeURIComponent(path), true);
  xmlhttp.setRequestHeader('Authorization', 'Bearer ' + self.USERTOKEN);
  xmlhttp.setRequestHeader('Range', 'bytes=' + offset + '-' + ( offset + size - 1 ));
  xmlhttp.responseType = this._IS_WEB ? 'arraybuffer' : 'buffer';
  xmlhttp.onload = function () {
    var res = xmlhttp.response;
    var length = self._IS_WEB ? res.byteLength : res.length;
    cb(null, {
      data: res,
      length: length
    });
  };

  xmlhttp.send();
};

Dropbox.prototype.openFile = function (path, flags, fd, cb) {
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

Dropbox.prototype.createEmptyFile = function (path, cb){
  var self = this;
  var xmlhttp = new this.XHR();
  xmlhttp.open('put', 'https://content.dropboxapi.com/1/files_put/auto' + encodeURIComponent(path), true);
  xmlhttp.setRequestHeader('Authorization', 'Bearer ' + self.USERTOKEN);
  xmlhttp.setRequestHeader('Content-Length', 0);
  xmlhttp.onload = function () {
    self._handleJson(xmlhttp, function (error, response){
      if (response.data) {
        var data = response.data;
        var result = {
          data: data
        };
        cb(error, result);
      } else {
        cb(error, response);
      }
    });
  };

  xmlhttp.send();
};

Dropbox.prototype.writeFileData = function (path, fd, buffer, offset, length, cb){
  var self = this;
  var pendingData = this._writePendingData;
  if (!pendingData[fd]) {
    cb({error: 'File is not opened yet.'});
    return;
  }

  var currentFile = pendingData[fd], upload_id, requestParam = '';
  var xmlhttp = new this.XHR();

  if (currentFile.blocks.length > 0) {
    upload_id = currentFile.blocks[currentFile.blocks.length -1];
    requestParam += '?' + 'upload_id=' + upload_id;
    requestParam += '&' + 'offset=' + offset;
  }
  var url = 'https://content.dropboxapi.com/1/chunked_upload' + requestParam;
  xmlhttp.open('put', url, true);
  xmlhttp.setRequestHeader('Authorization', 'Bearer ' + self.USERTOKEN);
  xmlhttp.onload = function () {
    self._handleJson(xmlhttp, function (error, response){
      if (response.data) {
        var data = response.data;
        currentFile.blocks.push(data.upload_id);
        data.length = length;
        var result = {
          data: data
        };
        cb(error, result);
      } else {
        cb(error, response);
      }
    });
  };

  xmlhttp.send(buffer);
};

Dropbox.prototype.commitFileData = function (path, fd, cb){
  var pendingData = this._writePendingData, self = this;

  if (!pendingData[fd]) {
    process.nextTick(function () {
      cb({error: 'File is not opened yet:' + path + ' ' + fd});
    });
    return;
  }

  if (pendingData[fd].blocks.length === 0) {
    process.nextTick(function () {
      logger.info('commitFileData with no blocks');
      pendingData[fd] = null;
      cb(null, null);
    });
    return;
  }

  var currentFile = pendingData[fd], upload_id, requestParam = '';

  var strParams = 'upload_id=' + encodeURIComponent(currentFile.blocks[currentFile.blocks.length -1])
                + '&autorename=false';
  var xmlhttp = new this.XHR();
  xmlhttp.open('post', 'https://content.dropboxapi.com/1/commit_chunked_upload/auto' + encodeURIComponent(path), true);
  xmlhttp.setRequestHeader('Authorization', 'Bearer ' + self.USERTOKEN);
  xmlhttp.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
  xmlhttp.onload = function (){
    self._handleJson(xmlhttp, function (error, response){
      if (response.data) {
        var data = response.data;
        pendingData[fd] = null;
        cb(error, response);
      } else {
        pendingData[fd] = null;
        cb(error, response);
      }
    });
  };
  xmlhttp.send(strParams);
};

Dropbox.prototype.deleteFile = function (path, cb){
  var self = this;
  var strParams = 'path=' + encodeURIComponent(path)
                + '&root=auto';
  var xmlhttp = new this.XHR();
  xmlhttp.open('post', 'https://api.dropboxapi.com/1/fileops/delete', true);
  xmlhttp.setRequestHeader('Authorization', 'Bearer ' + self.USERTOKEN);
  xmlhttp.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
  xmlhttp.onload = function (){
    self._handleJson(xmlhttp, function (error, response){
      if (response.data) {
        var data = response.data;
        cb(error, response);
      } else {
        cb(error, response);
      }
    });
  };
  xmlhttp.send(strParams);
};

Dropbox.prototype.deleteFolder = function (path, cb){
  this.deleteFile(path, cb);
};

Dropbox.prototype.createFolder = function (path, cb){
  var self = this;
  var strParams = 'path=' + encodeURIComponent(path)
                + '&root=auto';
  var xmlhttp = new this.XHR();
  xmlhttp.open('post', 'https://api.dropboxapi.com/1/fileops/create_folder', true);
  xmlhttp.setRequestHeader('Authorization', 'Bearer ' + self.USERTOKEN);
  xmlhttp.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
  xmlhttp.onload = function (){
    self._handleJson(xmlhttp, function (error, response){
      if (response.data) {
        var data = response.data;
        cb(error, response);
      } else {
        cb(error, response);
      }
    });
  };
  xmlhttp.send(strParams);
};

Dropbox.prototype.move = function (src, dst, cb){
  var self = this;
  var strParams = 'from_path=' + encodeURIComponent(src)
                + '&to_path=' + encodeURIComponent(dst)
                + '&root=auto';
  var xmlhttp = new this.XHR();
  xmlhttp.open('post', 'https://api.dropboxapi.com/1/fileops/move', true);
  xmlhttp.setRequestHeader('Authorization', 'Bearer ' + self.USERTOKEN);
  xmlhttp.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
  xmlhttp.onload = function (){
    self._handleJson(xmlhttp, function (error, response){
      if (xmlhttp.status === 404) {
        cb({
          error: 'The source file wasn\'t found at the specified path.'
        }, response);
      } else if (response.data) {
        var data = response.data;
        cb(error, response);
      } else {
        cb(error, response);
      }
    });
  };
  xmlhttp.send(strParams);
};

/*
step 1: Dropbox.getAuthLink
Visit the link: https://www.dropbox.com/1/oauth2/authorize?
client_id=<API_KEY>&
response_type=code
*/

Dropbox.prototype.getAuthLink = function (api_key, cb){
  var link = 'https://www.dropbox.com/1/oauth2/authorize?' +
    'client_id=' + api_key + '&' +
    'response_type=code';
  cb(null, {data: {
    authLink: link
  }});
};

/*
step 2: Dropbox.getAccessToken
curl https://api.dropbox.com/1/oauth2/token \
-d code=<USER_CODE> \
-d grant_type=authorization_code \
-u <API_KEY>:<API_SECRET>

Response:
{
  "access_token": "<ACCESS_TOKEN>",
  "token_type": "bearer",
  "uid": "??????"
}
*/
Dropbox.prototype.getAccessToken = function (api_key, api_secret, device_code, cb){
  var self = this;
  var linkToken = 'https://' + api_key + ':' + api_secret + '@' +
    'api.dropbox.com/1/oauth2/token';
  var params = {
    'code': device_code,
    'grant_type': 'authorization_code'
  };
  var strParams = 'code=' + encodeURIComponent(params.code) +
    '&grant_type=' + encodeURIComponent(params.grant_type);
  var xmlhttp = new this.XHR();
  xmlhttp.open('post', linkToken, true);
  xmlhttp.setRequestHeader('Accept', 'application/json');
  xmlhttp.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
  xmlhttp.setRequestHeader('Content-length', strParams.length);
  xmlhttp.onload = function (){
    self._handleJson(xmlhttp, function (error, response){
      if (response.data) {
        var data = response.data;
        var result = {
          data:{
            access_token: data.access_token
          }
        };
        cb(error, result);
      } else {
        cb(error, response);
      }
    });
  };
  xmlhttp.send(strParams);
};

module.exports = Dropbox;
