var fs = require('fs');

var Settings = {};

Settings.init = function (){};

Settings._loadNodeSettings = function (){
  var settingsFileName = process.env.HOME + '/.unidisk/' + 'settings.json';
  try {
    var stats = fs.statSync(settingsFileName);
    var value = stats.isFile() ? fs.readFileSync( settingsFileName ) : {};
    this.table = JSON.parse(value);
  } catch (e) {
    console.error('failed to load settings');
    this.table = {};
  }
};

Settings._loadWebSettings = function (){
  var xmlhttp = new XMLHttpRequest();
  xmlhttp.open('get', 'settings.json', false);
  xmlhttp.setRequestHeader('Accept', 'application/json');
  xmlhttp.send(null);
  this.table = JSON.parse(xmlhttp.responseText);
};

Settings.get = function (key){
  if (this.table) {
    return this.table[key];
  }

  if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    this._loadWebSettings();
  } else {
    this._loadNodeSettings();
  }

  return this.table[key];
};

Settings.set = function (key, value){

};

module.exports = Settings;
