/**
 * (C) 2013 Sean Lee (Wei-Lun Lee) <weilonge@gmail.com>
 **/

// argv = [ cmd, p1, p2, ...]
exports.invokeCommand = function (argv, commandSet, ignoreArgNum, cb){
  if( 1 > argv.length){
    return "(1) Need more arguments.";
  }
  var cmd = argv[0];
  var funcP = null, funcS = null;
  funcP = commandSet[cmd];
  funcS = commandSet;

  if( null === funcP || null === funcS ){
    return "(2) Cannot find this command - " + cmd;
  }

  if( funcP.length !== argv.length ){
    return "(3) Arguments amount incorrect - cmd \"" + cmd + "\" needs " + funcP.length + " arguments.";
  }

  var cmdArgv = [];
  // Push arguments from index ignoreArgNum. Ignore the fisrt-n parameter.
  for(var i = ignoreArgNum; i < funcP.length; i++){
    cmdArgv.push(argv[i]);
  }
  cmdArgv.push(cb);
  // argv = [ cmd, p1, p2] >>> functionSet.cmd(p1, p2, callback);
  if(funcS.init){
    funcS.init({});
  }
  funcP.apply(funcS, cmdArgv);
  return 0;
}
