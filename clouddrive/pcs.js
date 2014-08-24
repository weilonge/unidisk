var curl = require('node-curl');
var http = require('https');

var XFR_ESTIMATING_MIN_SPEED = 20 * 1024; // n bytes/sec
var XFR_ESTIMATING_MIN_TIME = 20; // secs
var XFR_CONNECTION_TIMEOUT = 10; // secs
var XFR_PROXY = "proxy.hinet.net:80";

var PCS_HOSTNAME = "pcs.baidu.com";
var PCS_HOSTNAME_D = "pcs.baidu.com"; // "d.pcs.baidu.com";
var PCS_HOSTNAME_C = "c.pcs.baidu.com";
var PCSURI = "/rest/2.0/pcs";
var UD_ROOTPATH = "/apps/APP_ROOT"
var USERTOKEN = require('fs').readFileSync( process.env.HOME + '/.baidu_pcs_token' );

var pcs = {};

pcs._trimRootPath = function (fileMeta){
	if(fileMeta.list){
		for(var i in fileMeta.list){
			var path = fileMeta.list[i].path;
			if( 0 === path.indexOf(UD_ROOTPATH) ){
				fileMeta.list[i].path = path.replace(UD_ROOTPATH, "");
			}
		}
	}
	return fileMeta;
}

pcs._generatePath = function (options){
	var path = "";
	path += PCSURI + "/" + encodeURIComponent(options.cmd);
	path += "?access_token=" + encodeURIComponent(USERTOKEN);

	if( options.method ) path += "&method=" + encodeURIComponent(options.method);
	if( options.path ) path += "&path=" + encodeURIComponent(options.path);
	if( options.param ) path += "&param=" + encodeURIComponent(options.param);

	return path;
}

pcs._execute = function (options, cb){
	var link = "https://" + PCS_HOSTNAME + this._generatePath(options);
	var handle = curl.create();
	handle(link, {
		RAW: 0,
		CONNECTTIMEOUT: XFR_CONNECTION_TIMEOUT,
		PROXY: XFR_PROXY,
		POST: ( options.httpMethod === "POST" ? 1 : 0 ),
		SSL_VERIFYPEER: 0
	}, function(err){
		var errorOutput = null;
		var response = {
			queryPara: options,
			uri: link,
			data: null
		};
		if(err){
			errorOutput = err;
		}else{
			try {
				var responseJson = JSON.parse(this.body);
				if ( responseJson.error_code && responseJson.error_code !== 31066 ) { // file does not exist
					//{ error_code: 31326, error_msg: 'anti hotlinking' }
					errorOutput = responseJson;
					console.log(errorOutput);
				} else {
					response.data = pcs._trimRootPath(responseJson);
				}
			} catch (e) {
				errorOutput = this.body;
			}
		}
		cb(errorOutput, response);
	});
}

pcs._download = function (options, cb){
	var link = "https://" + PCS_HOSTNAME_D + this._generatePath(options);
	var handle = curl.create();
	var estimationTime = (options.size / XFR_ESTIMATING_MIN_SPEED);
	handle(link, {
		RAW: 1,
		//REFERER: "http://www.baidu.com",
		CONNECTTIMEOUT: XFR_CONNECTION_TIMEOUT,
		PROXY: XFR_PROXY,
		FOLLOWLOCATION: 1,
		AUTOREFERER: 1,
		//USERAGENT: "",
		TIMEOUT: ( estimationTime > XFR_ESTIMATING_MIN_TIME ? estimationTime : XFR_ESTIMATING_MIN_TIME ),
		SSL_VERIFYPEER: 0,
		RANGE: '' + options.offset + '-' + ( options.offset + options.size - 1 )
	}, function(err){
		var errorOutput = null;
		var response = {
			queryPara: options,
			uri: link,
			data: null
		};
		if(err){
			errorOutput = err;
		}else{
			response.data = this.body;
		}
		cb(errorOutput, response);
	});
}

pcs.quota = function (cb){
	this._execute({
		cmd: "quota",
		method: "info",
		httpMethod: "GET"
	}, cb);
}

pcs.getFileMeta = function (path, cb){
	this._execute({
		cmd: "file",
		method: "meta",
		httpMethod: "GET",
		path: UD_ROOTPATH + path
	}, cb);
}

pcs.getFileMetaBatch = function (param, cb){
	this._execute({
		cmd: "file",
		method: "meta",
		httpMethod: "GET",
		param: ( typeof(param) === 'string' ? param : JSON.stringify(param) )
	}, cb);
}

pcs.getFileDownload = function (path, offset, size, cb){
	this._download({
		cmd: "file",
		method: "download",
		httpMethod: "GET",
		offset: offset,
		size: size,
		path: UD_ROOTPATH + path
	}, cb);
}

pcs.getFileList = function (path, cb){
	this._execute({
		cmd: "file",
		method: "list",
		httpMethod: "GET",
		path: UD_ROOTPATH + path
	}, cb);
}

pcs.getFileListRecycle = function (cb){
	this._execute({
		cmd: "file",
		method: "listrecycle"
	}, cb);
}

module.exports = pcs;
