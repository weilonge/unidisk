var f4js = require('fuse4js');
var fs = require('fs');
var obj = null;   // The JSON object we'll be exposing as a file system
var options = {};  // See parseArgs()
var udManager = require('./helper/udManager');
require('./helper/ObjectExtend');

const EPERM = -1;
const ENOENT = -2;

function getattr(path, cb) {
	console.log("[DEBUG] " + new Date().getTime() + " " + __function + " : " + __line + " " + path);
	udManager.getFileMeta(path, function (error, response){
		var stat = {};
		var err = 0; // assume success
		if( !response.data || !response.data.list){
			err = ENOENT; // -ENOENT
		}else if( response.data.list[0].isdir == 1 ){
			stat.size = 4096;   // standard size of a directory
			stat.mode = 040550; // directory with 777 permissions
			stat.mtime = new Date(response.data.list[0].mtime * 1000);
			stat.atime = new Date(response.data.list[0].mtime * 1000);
			stat.ctime = new Date(response.data.list[0].ctime * 1000);
			stat.uid = process.getuid();
			stat.gid = process.getgid();
		}else{
			stat.size = response.data.list[0].size;
			stat.mode = 0100440; // file with 666 permissions
			stat.mtime = new Date(response.data.list[0].mtime * 1000);
			stat.atime = new Date(response.data.list[0].mtime * 1000);
			stat.ctime = new Date(response.data.list[0].ctime * 1000);
			stat.uid = process.getuid();
			stat.gid = process.getgid();
		}
		cb( err, stat );
	});
};

function readdir(path, cb) {
	console.log("[DEBUG] " + new Date().getTime() + " " + __function + " : " + __line + " " + path);
	udManager.getFileList(path, function(error, response){
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
	udManager.getFileMeta(path, function (error, response){
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

function read(path, offset, len, buf, fh, cb) {
	console.log("[DEBUG] " + new Date().getTime() + " " + __function + " : " + __line + " " + path);
	udManager.getFileMeta(path, function (error, response){
		var err = 0; // assume success
		if( !response.data || !response.data.list){
			err = ENOENT; // -ENOENT
			cb( err );
		}else if( response.data.list[0].isdir == 1 ){
			// directory
			err = EPERM; // -EPERM
			cb( err );
		}else{
			udManager.downloadFileInRangeByCache(path, buf, offset, len, function(error){
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
	udManager.init();
	cb();
}

function setxattr(path, name, value, size, a, b, c) {
	console.log("[DEBUG] " + new Date().getTime() + " " + __function + " : " + __line + " " + path);
	console.log("Setxattr called:", path, name, value, size, a, b, c)
	cb(0);
}

function statfs(cb) {
	console.log("[DEBUG] " + new Date().getTime() + " " + __function + " : " + __line);
	udManager.showStat(function(error, response){
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
	if (options.outJson) {
		try {
			fs.writeFileSync(options.outJson, JSON.stringify(obj, null, '  '), 'utf8');
		} catch (e) {
			console.log("Exception when writing file: " + e);
		}
	}
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
	console.log("Usage: node jsonFS.js [options] inputJsonFile mountPoint");
	console.log("(Ensure the mount point is empty and you have wrx permissions to it)\n")
	console.log("Options:");
	console.log("-o outputJsonFile  : save modified data to new JSON file. Input file is never modified.");
	console.log("-d                 : make FUSE print debug statements.");
	console.log("-a                 : add allow_other option to mount (might need user_allow_other in system fuse config file).");
	console.log();
	console.log("Example:");
	console.log("node example/jsonFS.fs -d -o /tmp/output.json example/sample.json /tmp/mnt");
	console.log();
}

function parseArgs() {
	var i, remaining;
	var args = process.argv;
	if (args.length < 4) {
		return false;
	}
	options.mountPoint = args[args.length - 1];
	options.inJson = args[args.length - 2];
	remaining = args.length - 4;
	i = 2;
	while (remaining--) {
		if (args[i] === '-d') {
			options.debugFuse = true;
			++i;
		} else if (args[i] === '-o') {
			if (remaining) {
				options.outJson = args[i+1];
				i += 2;
				--remaining;
			} else return false;
		} else if (args[i] === '-a') {
			options.allowOthers = true;
			++i;
		} else return false;
	}
	return true;
}

(function main() {
	if (parseArgs()) {
		console.log("\nInput file: " + options.inJson);
		console.log("Mount point: " + options.mountPoint);
		if (options.outJson)
			console.log("Output file: " + options.outJson);
		if (options.debugFuse)
			console.log("FUSE debugging enabled");
		content = fs.readFileSync(options.inJson, 'utf8');
		obj = JSON.parse(content);
		try {
			var opts = [];
			if (options.allowOthers) {
				opts.push('-o');
				opts.push('allow_other');
			}
			f4js.start(options.mountPoint, handlers, options.debugFuse, opts);
		} catch (e) {
			console.log("Exception when starting file system: " + e);
		}
	} else {
		usage();
	}
})();
