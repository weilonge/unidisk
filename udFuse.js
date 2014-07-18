var f4js = require('fuse4js');
var fs = require('fs');
var obj = null;   // The JSON object we'll be exposing as a file system
var options = {};  // See parseArgs()
var udManager = require('./helper/udManager');
require('./helper/ObjectExtend');

function getattr(path, cb) {
	console.log("[DEBUG] " + new Date().getTime() + " " + __function + " : " + __line + " " + path);
	udManager.getFileMeta(path, function (error, response){
		var stat = {};
		var err = 0; // assume success
		if( !response.data || !response.data.list){
			err = -2; // -ENOENT
		}else if( response.data.list[0].isdir == 1 ){
			stat.size = 4096;   // standard size of a directory
			stat.mode = 040770; // directory with 777 permissions
			stat.mtime = new Date(response.data.list[0].mtime * 1000);
			stat.atime = new Date(response.data.list[0].mtime * 1000);
			stat.ctime = new Date(response.data.list[0].ctime * 1000);
			stat.uid = process.getuid();
			stat.gid = process.getgid();
		}else{
			stat.size = response.data.list[0].size;
			stat.mode = 0100660; // file with 666 permissions
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
			err = -2; // -ENOENT
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
			err = -2; // -ENOENT
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
			err = -2; // -ENOENT
			cb( err );
		}else if( response.data.list[0].isdir == 1 ){
			// directory
			err = -1; // -EPERM
			cb( err );
		}else{
			udManager.downloadFileInRange(path, offset, len, function(error, response){
				response.data.copy(buf);
				cb(len);
			});
		}
	});
}

function write(path, offset, len, buf, fh, cb) {
	console.log("[DEBUG] " + new Date().getTime() + " " + __function + " : " + __line + " " + path);
	var err = 0; // assume success
	var info = lookup(obj, path);
	var file = info.node;
	var name = info.name;
	var parent = info.parent;
	var beginning, blank = '', data, ending='', numBlankChars;

	switch (typeof file) {
	case 'undefined':
		err = -2; // -ENOENT
		break;

	case 'object': // directory
		err = -1; // -EPERM
		break;

	case 'string': // a string treated as ASCII characters
		data = buf.toString('ascii'); // read the new data
		if (offset < file.length) {
			beginning = file.substring(0, offset);
			if (offset + data.length < file.length) {
				ending = file.substring(offset + data.length, file.length)
			}
		} else {
			beginning = file;
			numBlankChars = offset - file.length;
			while (numBlankChars--) blank += ' ';
		}
		delete parent[name];
		parent[name] = beginning + blank + data + ending;
		err = data.length;
		break;

	default:
		break;
	}
	cb(err);
}

function release(path, fh, cb) {
	console.log("[DEBUG] " + new Date().getTime() + " " + __function + " : " + __line + " " + path);
	cb(0);
}

function create (path, mode, cb) {
	console.log("[DEBUG] " + new Date().getTime() + " " + __function + " : " + __line + " " + path);
	var err = 0; // assume success
	var info = lookup(obj, path);

	switch (typeof info.node) {
	case 'undefined':
		if (info.parent !== null) {
			info.parent[info.name] = '';
		} else {
			err = -2; // -ENOENT
		}
		break;

	case 'string': // existing file
	case 'object': // existing directory
		err = -17; // -EEXIST
		break;

	default:
		break;
	}
	cb(err);
}

function unlink(path, cb) {
	console.log("[DEBUG] " + new Date().getTime() + " " + __function + " : " + __line + " " + path);
	var err = 0; // assume success
	var info = lookup(obj, path);

	switch (typeof info.node) {
	case 'undefined':
		err = -2; // -ENOENT
		break;

	case 'object': // existing directory
		err = -1; // -EPERM
		break;

	case 'string': // existing file
		delete info.parent[info.name];
		break;

	default:
		break;
	}
	cb(err);
}

function rename(src, dst, cb) {
	console.log("[DEBUG] " + new Date().getTime() + " " + __function + " : " + __line);
	var err = -2; // -ENOENT assume failure
	var source = lookup(obj, src), dest;

	if (typeof source.node !== 'undefined') { // existing file or directory
		dest = lookup(obj, dst);
		if (typeof dest.node === 'undefined' && dest.parent !== null) {
			dest.parent[dest.name] = source.node;
			delete source.parent[source.name];
			err = 0;
		} else {
			err = -17; // -EEXIST
		}
	}
	cb(err);
}

function mkdir(path, mode, cb) {
	console.log("[DEBUG] " + new Date().getTime() + " " + __function + " : " + __line + " " + path);
	var err = -2; // -ENOENT assume failure
	var dst = lookup(obj, path), dest;
	if (typeof dst.node === 'undefined' && dst.parent != null) {
		dst.parent[dst.name] = {};
		err = 0;
	}
	cb(err);
}

function rmdir(path, cb) {
	console.log("[DEBUG] " + new Date().getTime() + " " + __function + " : " + __line + " " + path);
	var err = -2; // -ENOENT assume failure
	var dst = lookup(obj, path), dest;
	if (typeof dst.node === 'object' && dst.parent != null) {
		delete dst.parent[dst.name];
		err = 0;
	}
	cb(err);
}

function init(cb) {
	console.log("[DEBUG] " + new Date().getTime() + " " + __function + " : " + __line);
	console.log("File system started at " + options.mountPoint);
	console.log("To stop it, type this in another shell: fusermount -u " + options.mountPoint);
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
