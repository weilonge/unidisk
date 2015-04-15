var readline = require('readline');
var unirest = require('unirest');
var Settings = require('../helper/Settings');

var Dropbox = {};

Dropbox.init = function (){
  this.USERTOKEN = Settings.get('dropbox_token');
};

Dropbox._handleJson = function (httpResponse, cb){
  var errorOutput = null;
  var response = {
    data: null
  };
  if (httpResponse.serverError) {
    errorOutput = httpResponse.body;
    console.log({
      code: httpResponse.code,
      status: httpResponse.status,
      statusType: httpResponse.statusType
    });
  } else {
    response.data = httpResponse.body;
  }
  cb(errorOutput, response);
};

Dropbox.quota = function (cb){
  var self = this;
  unirest.get('https://api.dropbox.com/1/account/info')
  .header('Authorization', 'Bearer ' + self.USERTOKEN)
  .header('Accept', 'application/json')
  .end(function (httpResponse) {
    self._handleJson(httpResponse, function (error, response){
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
  });
};

Dropbox._convertItem = function (data){
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

Dropbox.getFileMeta = function (path, cb){
  var self = this;
  unirest.get('https://api.dropbox.com/1/metadata/auto' + path)
  .header('Authorization', 'Bearer ' + self.USERTOKEN)
  .header('Accept', 'application/json')
  .query({
    list: false
  })
  .end(function (httpResponse) {
    self._handleJson(httpResponse, function (error, response){
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
  });
};

Dropbox.getFileList = function (path, cb){
  var self = this;
  unirest.get('https://api.dropbox.com/1/metadata/auto' + path)
  .header('Authorization', 'Bearer ' + self.USERTOKEN)
  .header('Accept', 'application/json')
  .query({
    list: true
  })
  .end(function (httpResponse) {
    self._handleJson(httpResponse, function (error, response){
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
  });
};

Dropbox.getFileDownload = function (path, offset, size, cb){
  var self = this;
  unirest.get('https://api-content.dropbox.com/1/files/auto' + path)
  .header('Authorization', 'Bearer ' + self.USERTOKEN)
  .header('Range', 'bytes=' + offset + '-' + ( offset + size - 1 ))
  .encoding(null)
  .end(function (httpResponse) {
    var errorOutput = null;
    var response = {
      data: null
    };
    if(httpResponse.serverError){
      errorOutput = {
        code: httpResponse.code,
        status: httpResponse.status,
        statusType: httpResponse.statusType
      };
    }else{
      response.data = httpResponse.raw_body;
    }
    cb(errorOutput, response);
  });
};

Dropbox._tokenRequest = function (link, auth, params, cb){
  var self = this;
  unirest.post(link)
  .auth(auth)
  .header('Accept', 'application/json')
  .send(params)
  .end(function (httpResponse) {
    self._handleJson(httpResponse, cb);
  });
};

/*
step 1:
https://www.dropbox.com/1/oauth2/authorize?
client_id=<API_KEY>&
response_type=code

step 2:
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

Dropbox.getAccessToken = function (api_key, api_secret, cb){
  var self = this;
  var device_code = null;

  var link = 'https://www.dropbox.com/1/oauth2/authorize?' +
    'client_id=' + api_key + '&' +
    'response_type=code';

  var rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.question("Please go to the link\n" + link + "\nand input the code for oauth:\n", function(answer) {
    device_code = answer;
    console.log('\nYour code: ' + device_code);
    rl.close();

    var linkToken = 'https://api.dropbox.com/1/oauth2/token';
    self._tokenRequest(linkToken, {
      'user': api_key,
      'pass': api_secret
    }, {
      'code': device_code,
      'grant_type': 'authorization_code'
    }, function(error, response){
      console.log(response);
    });
  });

};

module.exports = Dropbox;
