var pcs = require('./clouddrive/pcs');

var filePath = "/apps/APP_ROOT/H_M/Mirror Mirror 2012 720p BluRay x264 AC3-HDChina [EtHD]/Mirror.Mirror.2012.720p.BluRay.x264.AC3-HDChina.mkv";

pcs.getFileMetaBatch({list:[
	{path: filePath}
	]}, function(req, res){
	console.log(res);
});

/*
function retryGetFileDownload(filePath, offset, size, cb){
	pcs.getFileDownload(filePath, offset, size, function(req, res){
		if(!res){
			retryGetFileDownload(filePath, offset, size, cb);
		}else{
			//console.log("=== ( " + filePath + " ) " + offset + ":" + size + " - " + typeof res);
			cb(req, res);
		}
	});
}

for(var i = 0; i < 10; i++){
	retryGetFileDownload(filePath, i*1024*1024, 1*1024*1024, function(req, res){
		console.log("Done!");
	});
}
*/

