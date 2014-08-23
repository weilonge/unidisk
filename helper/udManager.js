var pcs = require("../clouddrive/pcs");
var async = require('async');
var fs = require('fs');

var UD_BLOCK_SIZE = 1*1024*1024;
var UD_QUEUE_SIZE = 3;
var UD_CACHE_PATH = "/tmp/ud/cache";
var UD_PREFETCH_SIZE = 10 * UD_BLOCK_SIZE;

var udManager = {};

udManager._writeCache = function (task, data, cb){
	fs.writeFile(UD_CACHE_PATH + "/" + task.md5sum, data, function(err) {
		if(err) {
			console.log(err);
		} else {
			console.log("The file was saved!");
		}
		cb();
	});
}

udManager._readCache = function (path, offset, size, requestList, cb){
	var buffer = new Buffer(size),
		seek = 0,
		writeSize = 0,
		cursor_moved = 0;

	for(var i in requestList ){
		var task = requestList[i];
		if( task.priority === "PREFETCH" ){
			continue;
		}
		if( this.FileDataCache[task.md5sum] && this.FileDataCache[task.md5sum].status === "DONE" ){
			seek = ( offset + cursor_moved ) % UD_BLOCK_SIZE;
			writeSize = UD_BLOCK_SIZE - seek;
			if( (writeSize + cursor_moved ) > size ){
				writeSize = size - cursor_moved;
			}

			var fd = fs.openSync(UD_CACHE_PATH + "/" + task.md5sum, "rs");
			fs.readSync(fd, buffer, cursor_moved, writeSize, seek);
			fs.closeSync(fd);

			cursor_moved += writeSize ;
		} else {
			console.error("======= Critical Error =======");
			console.error(path);
			console.error(offset);
			console.error(size);
			console.error(requestList);
			console.error(this.FileDataCache);

			throw Error("data is not finished.");
		}
	}
	cb(buffer);
}

udManager.init = function(){
	this.FileMetaCache = {};
	this.FileListCache = {};
	this.FileDataCache = {};
	this.FileDownloadQueue = async.queue(function (task, callback) {
		console.log('  [B] ' + task.path + "|" + task.offset + '| downloading...');
		task.status = "DOWNLOADING";
		udManager.FileDataCache[task.md5sum] = task;
		udManager.downloadFileInRange(task.path, task.offset, task.size, function(error, response){
			console.log(task.path + "|" + task.offset + '| done!! ' + response.data.length);

			// Write the buffer to the cache file.
			udManager._writeCache(task, response.data, function(){
				udManager.FileDataCache[task.md5sum].status = "DONE";
				callback();
			});
		});
	}, UD_QUEUE_SIZE);
}

udManager.showStat = function (cb) {
	pcs.quota(cb);
}

udManager.getFileMeta = function (path, cb) {
	var retry = function () {
		if( udManager.FileMetaCache.hasOwnProperty(path) ){
			cb(null, { data : udManager.FileMetaCache[path] });
		}else{
			pcs.getFileMeta(path, function(error, response){
				if(error){
					console.log("" + new Date () + "| " + error);
					retry();
				}else{
					udManager.FileMetaCache[path] = response.data;
					cb(error, response);
				}
			});
		}
	};
	retry();
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

udManager._genmd5sum = function (task){
	var crypto = require('crypto');
	var name = task.path + "" + task.offset + "";
	var hash = crypto.createHash('md5').update(name).digest('hex');
	return hash;
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
		var taskMd5sum = this._genmd5sum(task);
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
		var taskMd5sum = this._genmd5sum(task);
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
		if(this.FileDataCache[taskMd5sum] && this.FileDataCache[taskMd5sum].status === "DONE" ){
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

		if(udManager.FileDataCache[taskMd5sum]){
			console.log('  [C1] ' + udManager.FileDataCache[taskMd5sum].path + " is in cache: " + udManager.FileDataCache[taskMd5sum].status);
			callback();
		} else if ( task.priority === "PREFETCH" ) {
			udManager.FileDownloadQueue.push(task, function (err){
				console.log('  [C3] ' + 'pushed task is done.');
			});
			callback();
		}else{
			noNewTask = false;
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

udManager.downloadFileInRangeByCache = function(path, offset, size, cb) {
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
			udManager._readCache(path, offset, size, requestList, function(data){
				console.log('  [E] data is prepared.');
				console.log('}}');
				cb(null, {
					data: data
				});
			});
		});
	});
}

udManager.downloadFileInRange = function(path, offset, size, cb) {
	var retry = function () {
		pcs.getFileDownload(path, offset, size, function(error, response){
			if(error){
				console.log('[ERROR] retry, error happened: ' + error);
				retry();
			}else if( !response || !response.data instanceof Buffer ){
				console.log('[ERROR] retry, error response: ' + response);
				retry();
			}else if( size != response.data.length ){
				console.log('[ERROR] retry, size error: ' + size + " " + response.data.length );
				retry();
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
