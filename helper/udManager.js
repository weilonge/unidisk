var pcs = require("../clouddrive/pcs");
var async = require('async');

var udManager = {};

udManager.showStat = function (cb) {
	pcs.quota(cb);
}

udManager.downloadFileInRange = function(path, offset, size, cb) {
	pcs.getFileDownload(path, offset, size, function(error, response){
		if(error){
			udManager.downloadFileInRange(path, offset, size, cb);
		}else{
			cb(error, response);
		}
	});
}

udManager.downloadFileInMultiRange = function(path, list, cb) {
	var listArray = null;
	if( typeof list === "string" ){
		try {
			listArray = JSON.parse(list).list;
		} catch (e) {
			cb("Incorrect download list.", null);
			return ;
		}
	}else{
		listArray = list.list;
	}
	async.each(listArray, function(item, callback){
		udManager.downloadFileInRange(path, item.offset, item.size, function(error, response){
			console.log(response.data);
			callback();
		});
	}, function(){
		cb(null, {
			data: "OK!"
		});
	});
}

module.exports = udManager;
