var fs = require('fs');

var Settings = {};

Settings.init = function (){};

Settings.get = function (key){
  var tokenFileName = process.env.HOME + '/.unidisk/' + key;
  var value;
  try {
    var stats = fs.statSync(tokenFileName);
    value = stats.isFile() ? fs.readFileSync( tokenFileName ) : null;
  } catch (e) {
    value = null;
  }
  return value;
};

Settings.set = function (key, value){

};

module.exports = Settings;
