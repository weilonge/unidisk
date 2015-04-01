var SegfaultHandler = require('segfault-handler');
SegfaultHandler.registerHandler();
var udManager = require('./helper/udManager');

udManager.init();

udManager.getFileMeta("/Movies/UE美歐/Battleground/sprinter-battleground.avi", function (error, response) {
	for(var i = 0; i < 300; i++ ){(function (index){
		var task = {
			path: "/Movies/UE美歐/Battleground/sprinter-battleground.avi",
			offset: index * 131072,
			len: 131072
		}
		udManager.downloadFileInRangeByCache(task.path, task.offset, task.len, function(error, response){
			console.log(response.data.length);
		});
	})(i);}
});

