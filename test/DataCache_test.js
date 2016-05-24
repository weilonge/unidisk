var DataCache = require('../helper/DataCache');
var assert = require('chai').assert;
describe('DataCache', function() {
  var taskA = {
    path: '/path/to/file/A',
    totalSize: 12,
    mtime: 1000000,
    status: "INIT",
    priority: "HIGH",
    md5sum: "",
    offset: 0,
    size: 0
  };
  var dataA = '12345';

  describe('#init()', function () {
    it('local cache should be empty', function () {
      var blockSize = 1048576;
      DataCache.init(1048576);
      assert.equal(DataCache._fileDataCache.length, null);
      assert.equal(DataCache._priorityQueue.length, 0);
    });
  });

  describe('#get()', function () {
    it('a unknown entry should be empty', function () {
      assert.equal(DataCache.get('unknown'), null);
    });
  });

  describe('#update()', function () {
    it('an existing entry should have the expected result.', function () {
      var taskMd5sum = DataCache.generateKey(taskA);
      taskA.md5sum = taskMd5sum;
      DataCache.update(taskMd5sum, taskA);
      assert.deepEqual(DataCache.get(taskMd5sum), taskA);
    });
  });

  describe('#updateStatus()', function () {
    it('update the status of an entry', function () {
      DataCache.updateStatus(taskA.md5sum, 'DOWNLOADING');
      assert.equal(DataCache.get(taskA.md5sum).status, 'DOWNLOADING');
    });
  });

  describe('#writeCache()', function () {
    it('write data into cache.', function () {
      DataCache.writeCache(taskA, dataA, function() {
        assert.equal(DataCache.get(taskA.md5sum).status, 'DONE');
      });
    });
  });

  describe('#readCache()', function () {
    it('read data from cache.', function () {
      var buffer = new Buffer(5);
      DataCache.updateStatus(taskA.md5sum, 'DONE');
      DataCache.readCache(taskA.path, buffer, 0, 5, [taskA], function() {
        assert.equal(DataCache.get(taskA.md5sum).status, 'DONE');
        assert.equal(buffer.toString('hex'), '3132333435');
      });
    });
  });
});
