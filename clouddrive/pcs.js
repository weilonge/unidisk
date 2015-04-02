var unirest = require('unirest');

var XFR_ESTIMATING_MIN_SPEED = 20 * 1024; // n bytes/sec
var XFR_ESTIMATING_MIN_TIME = 20; // secs
var XFR_CONNECTION_TIMEOUT = 10; // secs
var XFR_PROXY = "http://proxy.hinet.net:80";

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
	unirest.get(link)
	.proxy(XFR_PROXY)
	.timeout(XFR_CONNECTION_TIMEOUT * 1000)
	.end(function (httpResponse) {
		var errorOutput = null;
		var response = {
			queryPara: options,
			uri: link,
			data: null
		};
		if(httpResponse.serverError){
			errorOutput = httpResponse.body;
			console.log({
				code: httpResponse.code,
				status: httpResponse.status,
				statusType: httpResponse.statusType
			});
		}else{
			try {
				var responseJson = JSON.parse(httpResponse.body);
				if ( responseJson.error_code && responseJson.error_code !== 31066 ) { // file does not exist
					//{ error_code: 31326, error_msg: 'anti hotlinking' }
					errorOutput = responseJson;
					console.log(errorOutput);
				} else {
					response.data = pcs._trimRootPath(responseJson);
				}
			} catch (e) {
				errorOutput = httpResponse.body;
			}
		}
		cb(errorOutput, response);
	});
}

pcs._download = function (options, cb){
	var link = "https://" + PCS_HOSTNAME_D + this._generatePath(options);
	var estimationTime = (options.size / XFR_ESTIMATING_MIN_SPEED);
	unirest.get(link)
	.proxy(XFR_PROXY)
	.timeout(XFR_CONNECTION_TIMEOUT * 1000)
	.encoding(null)
	.headers({
		'Range': 'bytes=' + options.offset + '-' + ( options.offset + options.size - 1 )
	})
	.end(function (httpResponse){
		var errorOutput = null;
		var response = {
			queryPara: options,
			uri: link,
			data: null
		};
		if(httpResponse.serverError){
			errorOutput = {
				code: httpResponse.code,
				status: httpResponse.status,
				statusType: httpResponse.statusType
			};
		}else{
			response.data = httpResponse.raw_body;
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
	for(var i = 0; i < param.list.length; i++){
		param.list[i].path = UD_ROOTPATH + param.list[i].path;
	}
	this._execute({
		cmd: "file",
		method: "meta",
		httpMethod: "GET",
		param: ( typeof(param) === 'string' ? param : JSON.stringify(param) )
	}, function (errorOutput, response) {
		if( response && response.data ){
			for(var i = 0; i < response.data.list.length; i++){
				response.data.list[i] =  pcs._trimRootPath(response.data.list[i]);
			}
		}
		cb(errorOutput, response);
	});
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


pcs._tokenRequest = function (link, cb){
	unirest.get(link)
	.header('Accept', 'application/json')
	.proxy(XFR_PROXY)
	.timeout(XFR_CONNECTION_TIMEOUT * 1000)
	.end(function (httpResponse) {
		var errorOutput = null;
		var response = {
			data: null
		};
		if (httpResponse.serverError) {
			errorOutput = httpResponse.body;
			console.log({
				code: httpResponse.code,
				status: httpResponse.status,
				statusType: httpResponse.statusType
			});
		} else {
			response.data = httpResponse.body;
		}
		cb(errorOutput, response);
	});
};

pcs.getAccessToken = function (api_key, api_secret, cb){
	var self = this;
	var device_code = null;
	var interval = 10;

	function request1st (){
		var link = 'https://openapi.baidu.com/oauth/2.0/device/code?' +
			'client_id=' + api_key + '&' +
			'response_type=device_code&scope=basic,netdisk';
		self._tokenRequest(link, request2nd);
	}

	function request2nd (error, response){
		var msg = response ? response.data : {};
		if (msg.verification_url && msg.user_code) {
			console.log(msg.verification_url);
			console.log(msg.user_code);
		}
		if (msg.interval) {
			interval = msg.interval;
		}
		if (msg.device_code) {
			device_code = msg.device_code;
		}
		var link = 'https://openapi.baidu.com/oauth/2.0/token?' +
			'grant_type=device_token&' +
			'code=' + device_code + '&' +
			'client_id=' + api_key + '&' +
			'client_secret=' + api_secret;

		self._tokenRequest(link, requestEnd);
	}

	function requestEnd (error, response){
		if(response.data.error === 'authorization_pending'){
			console.log('waiting for verification...');
			setTimeout(request2nd, interval * 1000);
		} else if (response.data.access_token){
			console.log(response.data.access_token);
		} else {
			console.error('Unknown Error');
		}
	}

	request1st();
};

module.exports = pcs;
