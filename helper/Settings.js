var fs = require('fs');

var Settings = {};

Settings.init = function (){};

Settings.get = function (key){
  if (this.table) {
    return this.table[key];
  }

  var settingsFileName = process.env.HOME + '/.unidisk/' + 'settings.json';
  try {
    var stats = fs.statSync(settingsFileName);
    var value = stats.isFile() ? fs.readFileSync( settingsFileName ) : {};
    this.table = JSON.parse(value);
  } catch (e) {
    console.error('failed to load settings');
    this.table = {};
  }
  return this.table[key];
};

Settings.set = function (key, value){

};

module.exports = Settings;
