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

  this.USERTOKEN = options.token;
};

Dropbox.prototype.isIllegalFileName = function (path) {
  return path.indexOf('/._') !== -1;
};

Dropbox.prototype.registerChange = function (){
  var self = this;
  var latestCursor;
  function getLatestCursor(callback) {
    var xmlhttp = new self.XHR();
    xmlhttp.open('post', 'https://api.dropboxapi.com/2/files/list_folder/get_latest_cursor', true);
    xmlhttp.setRequestHeader('Authorization', 'Bearer ' + self.USERTOKEN);
    xmlhttp.setRequestHeader('Content-Type', 'application/json');
    xmlhttp.onload = function () {
      self._handleJson(xmlhttp, callback);
    };
    xmlhttp.send(JSON.stringify({
      'path': '',
      'recursive': true,
      'include_media_info': false,
      'include_deleted': false,
      'include_has_explicit_shared_members': false,
      'include_mounted_folders': true
    }));
  }

  function sendLongPoll(cursor, callback) {
    var xmlhttp = new self.XHR();
    xmlhttp.open('post', 'https://notify.dropboxapi.com/2/files/list_folder/longpoll', true);
    xmlhttp.setRequestHeader('Content-Type', 'application/json');
    xmlhttp.onload = function () {
      self._handleJson(xmlhttp, callback);
    };
    xmlhttp.send(JSON.stringify({
      'cursor': cursor
    }));
  }

  function getDelta(cursor, callback) {
    var xmlhttp = new self.XHR();
    xmlhttp.open('post', 'https://api.dropboxapi.com/2/files/list_folder/continue', true);
    xmlhttp.setRequestHeader('Authorization', 'Bearer ' + self.USERTOKEN);
    xmlhttp.setRequestHeader('Content-Type', 'application/json');
    xmlhttp.onload = function () {
      self._handleJson(xmlhttp, callback);
    };
    xmlhttp.send(JSON.stringify({
      'cursor': cursor
    }));
  }

  function repeat(callback) {
    sendLongPoll(latestCursor, function () {
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
  } else if (xmlhttp.status == 404 || xmlhttp.status == 409){
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
  xmlhttp.open('post', 'https://api.dropboxapi.com/2/users/get_space_usage', true);
  xmlhttp.setRequestHeader('Authorization', 'Bearer ' + self.USERTOKEN);
  xmlhttp.onload = function () {
    self._handleJson(xmlhttp, function (error, response){
      if (response.data) {
        var quotaInfo = response.data;
        var result = {
          data:{
            quota: quotaInfo.allocation.allocated,
            used: quotaInfo.used
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
  let isFolder = data['.tag'] === 'folder';
  return {
    isdir: isFolder ? 1 : 0,
    path: data.path_lower,
    size: isFolder ? 0 : data.size,
    // Date format:
    // "%a, %d %b %Y %H:%M:%S %z"
    //
    // Example: "Sat, 21 Aug 2010 22:31:20 +0000"
    mtime: new Date(0).getTime(),
    ctime: new Date(0).getTime()
  };
};

Dropbox.prototype.getFileMeta = function (path, cb){
  var self = this;
  if (path === '/') {
    process.nextTick(function () {
      cb(null, {
        data: {
          list: [self._convertItem({
            '.tag': 'folder',
            'path_lower': '/'
          })]
        }
      });
    }, 0);
    return;
  }
  var xmlhttp = new this.XHR();
  xmlhttp.open('post', 'https://api.dropboxapi.com/2/files/get_metadata', true);
  xmlhttp.setRequestHeader('Authorization', 'Bearer ' + self.USERTOKEN);
  xmlhttp.setRequestHeader('Content-Type', 'application/json');
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

  xmlhttp.send(JSON.stringify({
    'path': path === '/' ? '' : path,
    'include_media_info': false,
    'include_deleted': false,
    'include_has_explicit_shared_members': false
  }));
};

Dropbox.prototype.getFileList = function (path, cb){
  var self = this;
  var xmlhttp = new this.XHR();
  xmlhttp.open('post', 'https://api.dropboxapi.com/2/files/list_folder', true);
  xmlhttp.setRequestHeader('Authorization', 'Bearer ' + self.USERTOKEN);
  xmlhttp.setRequestHeader('Content-Type', 'application/json');
  xmlhttp.onload = function () {
    self._handleJson(xmlhttp, function (error, response){
      if (response.data) {
        var data = response.data;
        var resultList = [];
        for (var i = 0; i < data.entries.length; i++) {
          var content = data.entries[i];
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

  xmlhttp.send(JSON.stringify({
    'path': path === '/' ? '' : path,
    'recursive': false,
    'include_media_info': false,
    'include_deleted': false,
    'include_has_explicit_shared_members': false,
    'include_mounted_folders': true
  }));
};

Dropbox.prototype.getFileDownload = function (path, offset, size, cb){
  var self = this;
  var xmlhttp = new this.XHR();
  xmlhttp.open('post', 'https://content.dropboxapi.com/2/files/download', true);
  xmlhttp.setRequestHeader('Authorization', 'Bearer ' + self.USERTOKEN);
  xmlhttp.setRequestHeader('Range', 'bytes=' + offset + '-' + ( offset + size - 1 ));
  xmlhttp.setRequestHeader('Dropbox-API-Arg', JSON.stringify({
    'path': path === '/' ? '' : path
  }));
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
      sessionId: null,
      uploadedOffset: 0
    };
    console.log(this._writePendingData);
    cb(null, null);
  }
};

Dropbox.prototype.createEmptyFile = function (path, fd, cb){
  var self = this;
  var pendingData = this._writePendingData;
  var currentFile = pendingData[fd];
  if (!currentFile) {
    process.nextTick(function () {
      cb({error: 'File is not opened yet:' + path + ' ' + fd});
    });
    return;
  }
  var xmlhttp = new this.XHR();
  xmlhttp.open('post', 'https://content.dropboxapi.com/2/files/upload_session/start', true);
  xmlhttp.setRequestHeader('Authorization', 'Bearer ' + self.USERTOKEN);
  xmlhttp.setRequestHeader('Dropbox-API-Arg', JSON.stringify({'close': false}));
  xmlhttp.setRequestHeader('Content-Type', 'application/octet-stream');
  xmlhttp.onload = function () {
    console.log(xmlhttp.responseText);
    self._handleJson(xmlhttp, function (error, response){
      if (response.data) {
        var data = response.data;
        var result = {
          data: data
        };
        currentFile.sessionId = data.session_id;
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
  var currentFile = pendingData[fd];
  if (!currentFile) {
    process.nextTick(function () {
      cb({error: 'File is not opened yet:' + path + ' ' + fd});
    });
    return;
  }

  var xmlhttp = new this.XHR();
  xmlhttp.open('post', 'https://content.dropboxapi.com/2/files/upload_session/append_v2', true);
  xmlhttp.setRequestHeader('Authorization', 'Bearer ' + self.USERTOKEN);
  xmlhttp.setRequestHeader('Dropbox-API-Arg', JSON.stringify({
    'cursor': {
      'session_id': currentFile.sessionId,
      'offset': offset
    },
    'close': false
  }));
  xmlhttp.setRequestHeader('Content-Type', 'application/octet-stream');
  xmlhttp.onload = function () {
    console.log(xmlhttp.responseText);
    self._handleJson(xmlhttp, function (error, response){
      if (response.data) {
        var data = response.data;
        data.length = length;
        currentFile.uploadedOffset = offset + length;
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
  var self = this;
  var pendingData = this._writePendingData;
  var currentFile = pendingData[fd];
  if (!currentFile) {
    process.nextTick(function () {
      cb({error: 'File is not opened yet:' + path + ' ' + fd});
    });
    return;
  }

  if (!currentFile.sessionId) {
    process.nextTick(function () {
      logger.info('commitFileData with no blocks');
      pendingData[fd] = null;
      cb(null, null);
    });
    return;
  }

  var xmlhttp = new this.XHR();
  xmlhttp.open('post', 'https://content.dropboxapi.com/2/files/upload_session/finish', true);
  xmlhttp.setRequestHeader('Authorization', 'Bearer ' + self.USERTOKEN);
  xmlhttp.setRequestHeader('Dropbox-API-Arg', JSON.stringify({
    'cursor': {
      'session_id': currentFile.sessionId,
      'offset': currentFile.uploadedOffset
    },
    'commit': {
      'path': path,
      'mode': 'overwrite',
      'autorename': false,
      'mute': false
    }
  }));
  xmlhttp.setRequestHeader('Content-Type', 'application/octet-stream');
  xmlhttp.onload = function (){
    console.log(xmlhttp.responseText);
    self._handleJson(xmlhttp, function (error, response){
      pendingData[fd] = null;
      cb(error, response);
    });
  };
  xmlhttp.send();
};

Dropbox.prototype.deleteFile = function (path, cb){
  var self = this;
  var xmlhttp = new this.XHR();
  xmlhttp.open('post', 'https://api.dropboxapi.com/2/files/delete_v2', true);
  xmlhttp.setRequestHeader('Authorization', 'Bearer ' + self.USERTOKEN);
  xmlhttp.setRequestHeader('Content-Type', 'application/json');
  xmlhttp.onload = function (){
    self._handleJson(xmlhttp, function (error, response){
      cb(error, response);
    });
  };
  xmlhttp.send(JSON.stringify({
    'path': path
  }));
};

Dropbox.prototype.deleteFolder = function (path, cb){
  this.deleteFile(path, cb);
};

Dropbox.prototype.createFolder = function (path, cb){
  var self = this;
  var xmlhttp = new this.XHR();
  xmlhttp.open('post', 'https://api.dropboxapi.com/2/files/create_folder_v2', true);
  xmlhttp.setRequestHeader('Authorization', 'Bearer ' + self.USERTOKEN);
  xmlhttp.setRequestHeader('Content-Type', 'application/json');
  xmlhttp.onload = function (){
    self._handleJson(xmlhttp, function (error, response){
      cb(error, response);
    });
  };
  xmlhttp.send(JSON.stringify({
    'path': path,
    'autorename': false
  }));
};

Dropbox.prototype.move = function (src, dst, cb){
  var self = this;
  var xmlhttp = new this.XHR();
  xmlhttp.open('post', 'https://api.dropboxapi.com/2/files/move_v2', true);
  xmlhttp.setRequestHeader('Authorization', 'Bearer ' + self.USERTOKEN);
  xmlhttp.setRequestHeader('Content-Type', 'application/json');
  xmlhttp.onload = function (){
    self._handleJson(xmlhttp, function (error, response){
      if (xmlhttp.status === 404) {
        cb({
          error: 'The source file wasn\'t found at the specified path.'
        }, response);
      } else {
        cb(error, response);
      }
    });
  };
  xmlhttp.send(JSON.stringify({
    'from_path': src,
    'to_path': dst,
    'allow_shared_folder': false,
    'autorename': false,
    'allow_ownership_transfer': false
  }));
};

/*
step 1: Dropbox.getAuthLink
Visit the link: https://www.dropbox.com/1/oauth2/authorize?
client_id=<API_KEY>&
response_type=code
*/

Dropbox.prototype.getAuthLink = function (apiKey, cb){
  var link = 'https://www.dropbox.com/1/oauth2/authorize?' +
    'client_id=' + apiKey + '&' +
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
Dropbox.prototype.getAccessToken = function (apiKey, apiSecret, deviceCode, cb){
  var self = this;
  var linkToken = 'https://' + apiKey + ':' + apiSecret + '@' +
    'api.dropbox.com/1/oauth2/token';
  var params = {
    'code': deviceCode,
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
            accessToken: data.access_token
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
