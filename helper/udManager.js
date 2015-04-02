var webStorage;
var async = require('async');
var MetaCache = require('./metaCache');
var DataCache = require('./dataCache');

var UD_BLOCK_SIZE = 1*1024*1024;
var UD_QUEUE_SIZE = 3;
var UD_PREFETCH_SIZE = 10 * UD_BLOCK_SIZE;

var udManager = {};

udManager._isIllegalFileName = function (path) {
	var list = path.split('/');
	for(var i = 0; i < list.length; i++){
		if( list[i].indexOf('.') === 0 ){
			return true;
		}
	}
	return false;
}

udManager.init = function(webStorageModule){
	DataCache.init(UD_BLOCK_SIZE);
	webStorage = require("../clouddrive/" + webStorageModule);
	this.FileDownloadQueue = async.queue(function (task, callback) {
		console.log('  [B] ' + task.path + "|" + task.offset + '| downloading...');
		task.status = "DOWNLOADING";
		udManager.downloadFileInRange(task.path, task.offset, task.size, function(error, response){
			console.log(task.path + "|" + task.offset + '| done!! ' + response.data.length);

			// Write the buffer to the cache file.
			DataCache.writeCache(task, response.data, function(){
				DataCache.updateStatus(task.md5sum, 'DONE');
				callback();
			});
		});
	}, UD_QUEUE_SIZE);
}

udManager.showStat = function (cb) {
	var retry = function () {
		if( udManager.QuotaCache ) {
			cb(null, udManager.QuotaCache );
		} else {
			webStorage.quota(function(error, response){
				if(error){
					console.log("" + new Date () + "| " + error);
					retry();
				}else{
					udManager.QuotaCache = response;
					cb(error, response);
				}
			});
		}
	};
	retry();
}

udManager.getFileMeta = function (path, cb) {
	if(udManager._isIllegalFileName(path)){
		cb(null, {data: null});
		return ;
	}
	var retry = function () {
		var meta = MetaCache.getMeta(path);
		if (meta) {
			cb(null, { data : meta });
		}else{
			webStorage.getFileMeta(path, function(error, response){
				if(error){
					console.log("" + new Date () + "| " + error);
					retry();
				}else{
					MetaCache.updateMeta(path, response.data);
					cb(error, response);
				}
			});
		}
	};
	retry();
}

udManager.getFileList = function (path, cb) {
	if(udManager._isIllegalFileName(path)){
		cb(null, {data: null});
		return ;
	}
	var retry = function () {
		var list = MetaCache.getList(path);
		if (list) {
			cb(null, { data : list });
		}else{
			webStorage.getFileList(path, function(error, response){
				if(error){
					console.log("" + new Date () + "| " + error);
					retry();
				}else{
					MetaCache.updateList(path, response.data);
					cb(error, response);
				}
			});
		}
	};
	retry();
}

udManager._generateRequestList = function(fileMeta, offset, size, fileSize){
	const endPos = offset + size;
	var requestList = [];

	var alignedOffset = Math.floor( offset / UD_BLOCK_SIZE) * UD_BLOCK_SIZE;
	for(; alignedOffset < endPos && alignedOffset < fileSize; alignedOffset += UD_BLOCK_SIZE ){
		var task = {
			path: fileMeta.path,
			totalSize: fileMeta.size,
			mtime: fileMeta.mtime,
			status: "INIT",
			priority: "HIGH",
			md5sum: "",
			offset: alignedOffset,
			size: ((alignedOffset + UD_BLOCK_SIZE) > fileSize ? (fileSize - alignedOffset) : UD_BLOCK_SIZE )
		};
		var taskMd5sum = DataCache.generateKey(task);
		task.md5sum = taskMd5sum;

		requestList.push(task);
	}

	const prefetchEndPos = endPos + UD_PREFETCH_SIZE;
	for(; alignedOffset < prefetchEndPos && alignedOffset < fileSize; alignedOffset += UD_BLOCK_SIZE ){
		var task = {
			path: fileMeta.path,
			totalSize: fileMeta.size,
			mtime: fileMeta.mtime,
			status: "INIT",
			priority: "PREFETCH",
			md5sum: "",
			offset: alignedOffset,
			size: ((alignedOffset + UD_BLOCK_SIZE) > fileSize ? (fileSize - alignedOffset) : UD_BLOCK_SIZE )
		};
		var taskMd5sum = DataCache.generateKey(task);
		task.md5sum = taskMd5sum;

		requestList.push(task);
	}

	return requestList;
}

udManager._isAllRequestDone = function (downloadRequest){
	var done = true;
	for(var req in downloadRequest){
		var task = downloadRequest[req];
		var taskMd5sum = task.md5sum;
		if( task.priority === "PREFETCH" ){
			continue;
		}
		var data = DataCache.get(taskMd5sum);
		if (data && data.status === 'DONE') {
			// do nothing.
		}else{
			done = false;
			break;
		}
	}
	return done;
}

udManager._requestPushAndDownload = function (path, downloadRequest, cb){
	async.each(downloadRequest, function(task, callback){
		var taskMd5sum = task.md5sum;
		var data = DataCache.get(taskMd5sum);

		if (data) {
			console.log('  [C1] ' + data.path + " is in cache: " + data.status + "| " + task.offset);
			callback();
		} else if ( task.priority === "PREFETCH" ) {
			DataCache.update(taskMd5sum, task);
			udManager.FileDownloadQueue.push(task, function (err){
				console.log('  [C3] ' + 'pushed task is done.');
			});
			callback();
		}else{
			DataCache.update(taskMd5sum, task);
			udManager.FileDownloadQueue.push(task, function (err){
				console.log('  [C2] ' + 'pushed task is done.');
				callback();
			});
		}
	}, function(err){
		// Verify the download request is all finished or not.
		function retry () {
			if( udManager._isAllRequestDone(downloadRequest) ){
				console.log('  [D] ' + 'All requests are done.');
				cb();
			}else {
				console.log("retry to wait all requests done...");
				setTimeout(function () {
					retry();
				}, 1000);
			}
		}
		retry();
	});
}

udManager.downloadFileInRangeByCache = function(path, buffer, offset, size, cb) {
	console.log('{{');
	console.log('  [A] ' + path + ' ' + offset + ' ' + size);
	udManager.getFileMeta(path, function(error, response){
		const totalSize = response.data.list[0].size;
		// 1. Split the download request.
		var requestList = udManager._generateRequestList(response.data.list[0], parseInt(offset), parseInt(size), totalSize);

		// 2. Push downloading request.
		udManager._requestPushAndDownload(path, requestList, function(){
			// 3. All requests are done. Aggregate all data.
			// Read the request data from files.
			DataCache.readCache(path, buffer, offset, size, requestList, function(){
				console.log('  [E] data is prepared.');
				console.log('}}');
				cb(null);
			});
		});
	});
}

udManager.downloadFileInRange = function(path, offset, size, cb) {
	var retry = function () {
		webStorage.getFileDownload(path, offset, size, function(error, response){
			if(error){
				console.log('[ERROR] retry, error happened: ' + error);
				setTimeout(function () { retry(); }, 800);
			}else if( !response || !response.data || !response.data instanceof Buffer ){
				console.log('[ERROR] retry, error response: ' + response);
				setTimeout(function () { retry(); }, 800);
			}else if( size != response.data.length ){
				console.log('[ERROR] retry, size error: ' + offset + " " + size + " " + response.data.length + " " + response.data);
				setTimeout(function () { retry(); }, 800);
			}else{
				cb(error, response);
			}
		});
	}
	retry();
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
