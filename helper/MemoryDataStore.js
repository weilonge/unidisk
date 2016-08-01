var MemoryDataStore = function () {};

MemoryDataStore.prototype.init = function (){
  this._data = {};
  this._IS_WEB = typeof document !== 'undefined' &&
    typeof window !== 'undefined';
  if (this._IS_WEB) {
    this.BufferType = Uint8Array;
    this.readEntry = this._webReadEntry;
  } else {
    this.BufferType = Buffer;
    this.readEntry = this._nodeReadEntry;
  }
};

MemoryDataStore.prototype.deleteEntry = function (key){
  delete this._data[key];
  this._data[key] = null;
};

MemoryDataStore.prototype._webReadEntry =
  function (key, targetBuffer, targetOffset, sourceOffset, length){
  var uint8a = this._data[key];
  var sliced = uint8a.slice(sourceOffset, sourceOffset + length);
  for(var i = targetOffset, copied = 0; i < length; i++, copied++){
    targetBuffer[i] = sliced[copied];
  }
};

MemoryDataStore.prototype._nodeReadEntry =
  function (key, targetBuffer, targetOffset, sourceOffset, length){
  this._data[key].copy(targetBuffer,
    targetOffset, sourceOffset, sourceOffset + length);
};

MemoryDataStore.prototype.writeEntry = function (key, data, cb){
  this._data[key] = new this.BufferType(data);
  cb(null);
};

module.exports = MemoryDataStore;
