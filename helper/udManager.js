var EventEmitter = require('events').EventEmitter;
var foco = require('foco');
var Settings = require('./Settings');
var logger = require('./log');

var UD_BLOCK_SIZE = Settings.get('block_size');
var UD_QUEUE_CONCURRENCY = Settings.get('queue_concurrency');
var UD_PREFETCH_SIZE = Settings.get('prefetch_blocks') * UD_BLOCK_SIZE;

var udManager = function(){
  this.taskEvent = new EventEmitter();
};

udManager.prototype._isIllegalFileName = function (path) {
  return this.webStorage.isIllegalFileName(path);
};

udManager.prototype.queueHandler = function (id, task, callback) {
  logger.verbose('  [B] ' + task.path + '|' + task.offset + '| downloading...');
  var self = this;
  task.status = "DOWNLOADING";
  this.downloadFileInRange(task.path, task.offset, task.size, function(error, response){
    logger.verbose(task.path + '|' + task.offset + '| done!! ' + response.length);

    // Write the buffer to the cache file.
    self.dataCache.writeCache(task, response.data, function(){
      self.taskEvent.emit('done');
      callback();
    });
  });
};

udManager.prototype.init = function(options){
  var self = this;
  this.webStorage = new options.webStorageModule();
  this.metaCache = options.metaCacheModule;
  this.dataCache = options.dataCacheModule;

  this.webStorage.init(options.moduleOpt);
  this.webStorage.on('fileChange', function (evt) {
    self.metaCache.clear(evt.path, evt.recursive);
    self.dataCache.clear(evt.path, evt.recursive);
  });
  this.metaCache.init();
  this.dataCache.init(UD_BLOCK_SIZE);
  this.FileDownloadQueue = foco.priorityQueue(
    this.queueHandler.bind(this), UD_QUEUE_CONCURRENCY);
};

udManager.prototype.showStat = function (cb) {
  var self = this;
  var retry = function () {
    if( self.QuotaCache ) {
      process.nextTick(function () {
        cb(null, self.QuotaCache );
      });
    } else {
      self.webStorage.quota(function(error, response){
        if(error){
          logger.error('showStat: ' + JSON.stringify(error));
          retry();
        }else{
          self.QuotaCache = response;
          cb(error, response);
        }
      });
    }
  };
  retry();
};

udManager.prototype.getFileMeta = function (path, cb) {
  if(this._isIllegalFileName(path)){
    process.nextTick(function () {
      cb(null, {data: null});
    });
    return ;
  }
  var self = this;
  var retry = function () {
    var meta = self.metaCache.get(path);
    if (meta) {
      process.nextTick(function () {
        cb(null, { data : meta });
      });
    }else{
      self.webStorage.getFileMeta(path, function(error, response){
        if(error){
          logger.error('getFileMeta: ' + JSON.stringify(error));
          retry();
        }else{
          self.metaCache.update(path, response.data);
          cb(error, response);
        }
      });
    }
  };
  retry();
};

udManager.prototype.getFileList = function (path, cb) {
  if(this._isIllegalFileName(path)){
    process.nextTick(function () {
      cb(null, {data: null});
    });
    return ;
  }
  var self = this;
  var retry = function () {
    var list = self.metaCache.getList(path);
    if (list) {
      process.nextTick(function () {
        cb(null, { data : list });
      });
    }else{
      self.webStorage.getFileList(path, function(error, response){
        if(error){
          logger.error('getFileList: ' + JSON.stringify(error));
          retry();
        }else{
          self.metaCache.updateList(path, response.data);
          cb(error, response);
        }
      });
    }
  };
  retry();
};

udManager.prototype._generateRequestList = function(fileMeta, offset, size, fileSize){
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
    var taskMd5sum = this.dataCache.generateKey(task);
    task.md5sum = taskMd5sum;

    requestList.push(task);
  }

  const prefetchEndPos = endPos + UD_PREFETCH_SIZE;
  for(; alignedOffset < prefetchEndPos && alignedOffset < fileSize; alignedOffset += UD_BLOCK_SIZE ){
    var prefetchTask = {
      path: fileMeta.path,
      totalSize: fileMeta.size,
      mtime: fileMeta.mtime,
      status: "INIT",
      priority: "PREFETCH",
      md5sum: "",
      offset: alignedOffset,
      size: ((alignedOffset + UD_BLOCK_SIZE) > fileSize ? (fileSize - alignedOffset) : UD_BLOCK_SIZE )
    };
    var prefetchTaskMd5sum = this.dataCache.generateKey(prefetchTask);
    prefetchTask.md5sum = prefetchTaskMd5sum;

    requestList.push(prefetchTask);
  }

  return requestList;
};

udManager.prototype._isAllRequestDone = function (downloadRequest){
  var done = true;
  for(var req in downloadRequest){
    var task = downloadRequest[req];
    var taskMd5sum = task.md5sum;
    if( task.priority === "PREFETCH" ){
      continue;
    }
    var data = this.dataCache.get(taskMd5sum);
    if (data && data.status === 'DONE') {
      // do nothing.
    }else{
      done = false;
      break;
    }
  }
  return done;
};

udManager.prototype._requestPushAndDownload = function (path, downloadRequest, cb){
  var self = this;

  function checkRequest() {
    // Verify the download requests are all finished or not.
    if( self._isAllRequestDone(downloadRequest) ){
      logger.verbose('  [D] ' + 'All requests are done.');
      self.taskEvent.removeListener('done', checkRequest);
      cb();
    }else {
      logger.verbose('keep waiting for all requests done...');
    }
  }
  self.taskEvent.on('done', checkRequest);
  foco.each(downloadRequest, function(index, task, callback){
    var taskMd5sum = task.md5sum;
    var data = self.dataCache.get(taskMd5sum);

    if (data) {
      logger.verbose('  [C1] ' + data.path + ' is in cache: ' + data.status + '| ' + task.offset);
      self.FileDownloadQueue.priorityChange(taskMd5sum, 0);
      callback();
    } else if ( task.priority === "PREFETCH" ) {
      self.dataCache.update(taskMd5sum, task);
      self.FileDownloadQueue.push(taskMd5sum, 1, task);
      callback();
    }else{
      self.dataCache.update(taskMd5sum, task);
      self.FileDownloadQueue.push(taskMd5sum, 0, task);
      callback();
    }
  }, function(err){
    checkRequest();
  });
};

udManager.prototype.downloadFileInRangeByCache = function(path, buffer, offset, size, cb) {
  logger.verbose('{{');
  logger.verbose('  [A] ' + path + ' ' + offset + ' ' + size);
  var self = this;
  self.getFileMeta(path, function(error, response){
    const totalSize = response.data.list[0].size;
    // 1. Split the download request.
    var requestList = self._generateRequestList(response.data.list[0], parseInt(offset), parseInt(size), totalSize);

    // 2. Push downloading request.
    self._requestPushAndDownload(path, requestList, function(){
      // 3. All requests are done. Aggregate all data.
      // Read the request data from files.
      self.dataCache.readCache(path, buffer, offset, size, requestList, function(){
        logger.verbose('  [E] data is prepared.');
        logger.verbose('}}');
        cb(null);
      });
    });
  });
};

udManager.prototype.downloadFileInRange = function(path, offset, size, cb) {
  var self = this;
  var retry = function () {
    self.webStorage.getFileDownload(path, offset, size, function(error, response){
      if(error){
        logger.error('retry, error happened: ' + JSON.stringify(error));
        setTimeout(retry , 800);
      }else if( !response || !response.data || !response.length){
        logger.error('retry, error response: ' + JSON.stringify(response));
        setTimeout(retry , 800);
      }else if( size != response.length ){
        logger.error('retry, size error: ' + offset + ' ' + size + ' ' + response.length);
        setTimeout(retry , 800);
      }else{
        cb(error, response);
      }
    });
  };
  retry();
};

udManager.prototype.downloadFileInMultiRange = function(path, list, cb) {
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
  foco.each(listArray, function(index, item, callback){
    self.downloadFileInRange(path, item.offset, item.size, function(error, response){
      logger.verbose(response.data);
      callback();
    });
  }, function(){
    cb(null, {
      data: "OK!"
    });
  });
};

module.exports = udManager;
