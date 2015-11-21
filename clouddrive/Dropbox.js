var Settings = require('../helper/Settings');

var Dropbox = function (){};

Dropbox.prototype.init = function (options){
  this._IS_WEB = typeof document !== 'undefined' &&
    typeof window !== 'undefined';
  this.XHR = this._IS_WEB ? window.XMLHttpRequest : require('xhr2');

  if (options.token) {
    this.USERTOKEN = options.token;
  } else {
    this.USERTOKEN = Settings.get('dropbox_token');
  }
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
  xmlhttp.open('get', 'https://api.dropbox.com/1/metadata/auto' + path, true);
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
  xmlhttp.open('get', 'https://api.dropbox.com/1/metadata/auto' + path, true);
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
  xmlhttp.open('get', 'https://api-content.dropbox.com/1/files/auto' + path, true);
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
