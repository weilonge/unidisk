#!/usr/bin/env node
/**
 * (C) 2013 Sean Lee (Wei-Lun Lee) <weilonge@gmail.com>
 **/

var udUtility = require('./helper/cmdWrapper');
var path = require('path');
var logger = require('./helper/log');
var Settings = require('./helper/Settings');

function showHelp(exeName){
  /* eslint-disable no-console */
  console.log(
    '-- Universal Drive --\n' +
    'Usage: ' + exeName + ' PROFILE COMMAND [P1] [P2]\n' +
    '     PROFILE: profile name.\n' +
    '     COMMAND: the invoking API name.\n' +
    '\n' +
    'Example: ' + exeName + ' myDropbox getFileList /\n'
  );
  /* eslint-enable no-console */
}

var cccb = function(error, response){
  if (error) {
    logger.error(error);
  } else {
    /* eslint-disable no-console */
    console.log(response.data);
    /* eslint-enable no-console */
  }
}

if ('--help' === process.argv[2] || '-h' === process.argv[2]) {
  showHelp(path.basename(process.argv[1]));
  process.exit(1);
}

var moduleSet = {
  Dropbox: require('./clouddrive/Dropbox'),
  udManager: require('./helper/udManager')
};

var profileName = process.argv[2];
var profile = Settings.getProfile(profileName);

if (!profile) {
  logger.error('Invalid profile');
  process.exit(1);
}

var cmdAndOpts = process.argv.slice(3);

var ret = udUtility.invokeCommand(profile, cmdAndOpts,
  new moduleSet[profile.module](), 1, cccb);

if (0 !== ret) {
  showHelp(path.basename(process.argv[1]));
  logger.error(ret);
}
