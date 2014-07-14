/**
 * (C) 2013 Sean Lee (Wei-Lun Lee) <weilonge@gmail.com>
 **/

var udCore = require('../clouddrive/pcs');
var async = require('async');

// argv = [ cmd, p1, p2, ...]
exports.invokeCommand = function (argv, cccb){
	if( 1 > argv.length){
		return "(1) Need more arguments. " + argv;
	}
	var cmd = argv[0];
	var funcP = null, funcS = null;
	var cmdSet = [udCore];
	for(var i in cmdSet){
		if( cmdSet[i][cmd] ){
			funcP = cmdSet[i][cmd];
			funcS = cmdSet[i];
		}
	}
	if( null === funcP || null === funcS ){
		return "(2) Cannot find this command - " + cmd;
	}

	if( funcP.length !== argv.length ){
		return "(3) Arguments amount incorrect - cmd \"" + cmd + "\" needs " + funcP.length + " arguments.";
	}

	var cmdArgv = [];
	for(var i = 0; i < (funcP.length - 1); i++){
		cmdArgv.push(argv[i+1]);
	}
	cmdArgv.push(cccb);
	funcP.apply(funcS, cmdArgv);
	return 0;
}
