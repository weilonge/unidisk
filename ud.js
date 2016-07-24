#!/usr/bin/env node
/**
 * (C) 2013 Sean Lee (Wei-Lun Lee) <weilonge@gmail.com>
 **/

var udUtility = require('./helper/cmdWrapper');
var path = require('path');
var logger = require('./helper/log');

function showHelp(exeName){
  console.log(
    '-- Universal Drive --\n' +
    'Usage: " + exeName + " MODULE COMMAND [P1] [P2]\n' +
    '     MODULE: command of udManager or other cloud storage APIs.\n' +
    '\n' +
    'Example: " + exeName + " quota\n'
  );
}

var cccb = function(error, response){
  if( error ){
    logger.error(error);
  }else{
    console.log(response.data);
  }
}

if( '--help' === process.argv[2] || '-h' === process.argv[2] ){
  showHelp(path.basename(process.argv[1]));
  return ;
}

var moduleSet = {
  pcs: require('./clouddrive/pcs'),
  Dropbox: require('./clouddrive/Dropbox'),
  udManager: require('./helper/udManager')
};

var ret = udUtility.invokeCommand(process.argv.slice(3),
  new moduleSet[process.argv[2]](), 1, cccb);

if( 0 !== ret ){
  showHelp(path.basename(process.argv[1]));
  logger.error(ret);
}
