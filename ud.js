#!/usr/bin/env node
/**
 * (C) 2013 Sean Lee (Wei-Lun Lee) <weilonge@gmail.com>
 **/

var udUtility = require('./helper/udUtility');
var path = require('path');

function showHelp(exeName){
	console.log("\
-- Universal Drive --\n\
Usage: " + exeName + " MODULE [P1] [P2]\n\
     MODULE: command of udManager or other cloud storage APIs.\n\
\n\
Example: " + exeName + " quota\n\
	");
}

var cccb = function(req, data){
	if( req && req.errmsg){
		console.error('== Error =====================');
		console.error(req);
		console.error('==============================');
	}else{
		console.log('== Result ====================');
		console.log(data);
		console.log('==============================');
	}
}

if( '--help' === process.argv[2] || '-h' === process.argv[2] ){
	showHelp(path.basename(process.argv[1]));
	return ;
}

var ret = udUtility.invokeCommand(process.argv.slice(2), cccb);

if( 0 !== ret ){
	showHelp(path.basename(process.argv[1]));
	console.error(ret);
}
