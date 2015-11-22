#!/usr/bin/env node
var fuse = require('fuse-bindings');
var options = {};  // See parseArgs()
var udManager = require('./helper/udManager');
require('./helper/ObjectExtend');

const EPERM = -1;
const ENOENT = -2;

var udm;

function getattr(path, cb) {
	//console.log("[DEBUG] " + new Date().getTime() + " " + __function + " : " + __line + " " + path);
	udm.getFileMeta(path, function (error, response){
		var stat = {};
		var err = 0; // assume success
		if( !response.data || !response.data.list){
			err = ENOENT; // -ENOENT
		}else if( response.data.list[0].isdir == 1 ){
			stat.size = 4096;   // standard size of a directory
			stat.mode = 040550; // directory with 777 permissions
			stat.mtime = new Date(response.data.list[0].mtime);
			stat.atime = new Date(response.data.list[0].mtime);
			stat.ctime = new Date(response.data.list[0].ctime);
			stat.uid = process.getuid();
			stat.gid = process.getgid();
		}else{
			stat.size = response.data.list[0].size;
			stat.mode = 0100440; // file with 666 permissions
			stat.mtime = new Date(response.data.list[0].mtime);
			stat.atime = new Date(response.data.list[0].mtime);
			stat.ctime = new Date(response.data.list[0].ctime);
			stat.uid = process.getuid();
			stat.gid = process.getgid();
		}
		cb( err, stat );
	});
}

function readdir(path, cb) {
	console.log("[DEBUG] " + new Date().getTime() + " " + __function + " : " + __line + " " + path);
	udm.getFileList(path, function(error, response){
		var names = [];
		var err = 0; // assume success
		if( !response.data ){
			err = ENOENT; // -ENOENT
		}else{
			for(var fp in response.data.list){
				var filePathSplited = response.data.list[fp].path.split("/");
				var fileName = filePathSplited[filePathSplited.length - 1];
				names.push(fileName);
			}
		}
		cb( err, names );
	});
}

function open(path, flags, cb) {
	console.log("[DEBUG] " + new Date().getTime() + " " + __function + " : " + __line + " " + path);
	udm.getFileMeta(path, function (error, response){
		var stat = {};
		var err = 0; // assume success
		if( !response.data || !response.data.list){
			err = ENOENT; // -ENOENT
		}else if( response.data.list[0].isdir == 1 ){
		}else{
		}
		cb(err); // we don't return a file handle, so fuse4js will initialize it to 0
	});
}

function read(path, fd, buf, len, offset, cb) {
	console.log("[DEBUG] " + new Date().getTime() + " " + __function + " : " + __line + " " + path);
	udm.getFileMeta(path, function (error, response){
		var err = 0; // assume success
		if( !response.data || !response.data.list){
			err = ENOENT; // -ENOENT
			cb( err );
		}else if( response.data.list[0].isdir == 1 ){
			// directory
			err = EPERM; // -EPERM
			cb( err );
		}else{
			udm.downloadFileInRangeByCache(path, buf, offset, len, function(error){
				cb(len);
			});
		}
	});
}

function write(path, offset, len, buf, fh, cb) {
	console.log("[DEBUG] " + new Date().getTime() + " " + __function + " : " + __line + " " + path);
	cb(EPERM);
}

function release(path, fh, cb) {
	console.log("[DEBUG] " + new Date().getTime() + " " + __function + " : " + __line + " " + path);
	cb(0);
}

function create (path, mode, cb) {
	console.log("[DEBUG] " + new Date().getTime() + " " + __function + " : " + __line + " " + path);
	cb(EPERM);
}

function unlink(path, cb) {
	console.log("[DEBUG] " + new Date().getTime() + " " + __function + " : " + __line + " " + path);
	cb(EPERM);
}

function rename(src, dst, cb) {
	console.log("[DEBUG] " + new Date().getTime() + " " + __function + " : " + __line);
	cb(EPERM);
}

function mkdir(path, mode, cb) {
	console.log("[DEBUG] " + new Date().getTime() + " " + __function + " : " + __line + " " + path);
	cb(EPERM);
}

function rmdir(path, cb) {
	console.log("[DEBUG] " + new Date().getTime() + " " + __function + " : " + __line + " " + path);
	cb(EPERM);
}

function init(cb) {
	console.log("[DEBUG] " + new Date().getTime() + " " + __function + " : " + __line);
	console.log("File system started at " + options.mountPoint);
	console.log("To stop it, type this in another shell: fusermount -u " + options.mountPoint);
	udm = new udManager();
	udm.init({
		moduleOpt: options.moduleOpt,
		metaCacheModule: require('./helper/MetaCache'),
		dataCacheModule: require('./helper/DataCache'),
		webStorageModule: require('./clouddrive/' + options.module)
	});
	cb();
}

function setxattr(path, name, value, size, a, b, c) {
	console.log("[DEBUG] " + new Date().getTime() + " " + __function + " : " + __line + " " + path);
	console.log("Setxattr called:", path, name, value, size, a, b, c);
	cb(0);
}

function statfs(path, cb) {
	console.log("[DEBUG] " + new Date().getTime() + " " + __function + " : " + __line);
	udm.showStat(function(error, response){
		var block_size = 4096;
		//f_bsize = block_size;
		//f_blocks = (fsblkcnt_t) (quota/block_size);
		//f_bfree = (fsblkcnt_t) ( baidu_data->statistic_cache->f_blocks - ( used / block_size ));
		//f_bavail = baidu_data->statistic_cache->f_bfree;     // normal user should has no different

		cb(0, {
				bsize: block_size,
				//frsize: 1000000,
				blocks: (response.data.quota / block_size),
				bfree: ((response.data.quota / block_size) - (response.data.used / block_size) ),
				bavail: ((response.data.quota / block_size) - (response.data.used / block_size) ),
				//files: 1000000,
				//ffree: 1000000,
				//favail: 1000000,
				//fsid: 1000000,
				//flag: 1000000,
				namemax: 1000
		});
	});
}

function destroy(cb) {
	console.log("[DEBUG] " + new Date().getTime() + " " + __function + " : " + __line);
	console.log("File system stopped");
	cb();
}

var handlers = {
	getattr: getattr,
	readdir: readdir,
	open: open,
	read: read,
	write: write,
	release: release,
	create: create,
	unlink: unlink,
	rename: rename,
	mkdir: mkdir,
	rmdir: rmdir,
	init: init,
	destroy: destroy,
	setxattr: setxattr,
	statfs: statfs
};

function usage() {
	console.log();
	console.log("Usage: node udFuse.js [options] mountPoint\n");
	console.log("Options:");
	console.log("-d                 : make FUSE print debug statements.");
	console.log("-m                 : specify web storage module.");
	console.log("-o                 : options for the module.");
	console.log();
	console.log("Example:");
	console.log("node udFuse.fs -d /tmp/mnt");
	console.log();
}

function parseArgs() {
	var i, remaining;
	var args = process.argv;
	if (args.length < 3) {
		return false;
	}
	options.mountPoint = args.pop();
	options.moduleOpt = {};

	function createModuleOpt(item, index){
		var pair = item.split('=');
		var key = pair[0];
		var val = pair[1];
		options.moduleOpt[key] = val;
	}

	for( i = 2; i < args.length; i++) {
		if (args[i] === '-d') {
			options.debugFuse = true;
		} else if (args[i] === '-m') {
			options.module = args[++i];
		} else if (args[i] === '-o') {
			var mOpts = args[++i].split(',');
			mOpts.forEach(createModuleOpt);
		} else {
			return false;
		}
	}
	return true;
}

(function main() {
	if (parseArgs()) {
		console.log("\nMount point: " + options.mountPoint);
		if (options.debugFuse)
			console.log("FUSE debugging enabled");
		try {
			fuse.mount(options.mountPoint, handlers);
		} catch (e) {
			console.log("Exception when starting file system: " + e);
		}
	} else {
		usage();
	}
})();

process.on('SIGINT', function () {
  fuse.unmount(options.mountPoint, function () {
    process.exit();
  });
});

