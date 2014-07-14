var pcs = require('./clouddrive/pcs');

var filePath = "/apps/APP_ROOT/H_M/Mirror Mirror 2012 720p BluRay x264 AC3-HDChina [EtHD]/Mirror.Mirror.2012.720p.BluRay.x264.AC3-HDChina.mkv";

pcs.getFileMetaBatch({list:[
	{path: filePath}
	]}, function(req, res){
	console.log(res);
});

