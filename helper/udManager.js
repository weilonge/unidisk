var pcs = require("../clouddrive/pcs");
var async = require('async');

var udManager = {};

udManager.init = function(){
	this.FileMetaCache = {};
	this.FileListCache = {};
}

udManager.showStat = function (cb) {
	pcs.quota(cb);
}

udManager.getFileMeta = function (path, cb) {
	if( this.FileMetaCache.hasOwnProperty(path) ){
		cb(null, { data : this.FileMetaCache[path] });
	}else{
		pcs.getFileMeta(path, function(error, response){
			udManager.FileMetaCache[path] = response.data;
			cb(error, response);
		});
	}
}

udManager.getFileList = function (path, cb) {
	if( this.FileListCache.hasOwnProperty(path) ){
		cb(null, { data : this.FileListCache[path] });
	}else{
		pcs.getFileList(path, function(error, response){
			udManager.FileListCache[path] = response.data;
			cb(error, response);
		});
	}
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
