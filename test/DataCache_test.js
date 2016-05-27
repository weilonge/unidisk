var Settings = require('../helper/Settings');
var DataCache = require('../helper/DataCache');
var assert = require('chai').assert;
var foco = require('foco');
describe('DataCache', function() {
  function generateData(start, n) {
    var result = [];
    for (var i = start; i < n + start; i++) {
      result.push({
        task: {
          path: 'test' + i,
          totalSize: i,
          mtime: 1000000,
          status: "INIT",
          priority: "HIGH",
          md5sum: "",
          offset: 0,
          size: 0
        },
        data: Math.random().toString(36)
      });
    }
    return result;
  }

  const MAX_DATA_CACHE_ENTRY = 5;
  const NUM_TOTAL_TEST_TASKS = 8;

  Settings.init();
  Settings.set('max_data_cache_entry', MAX_DATA_CACHE_ENTRY);

  it('initializing state', function () {
    var blockSize = 1048576;
    DataCache.init(1048576);
    assert.equal(DataCache._fileDataCache.length, null);
    assert.equal(DataCache._priorityQueue.length, 0);
    assert.equal(DataCache.get('unknown'), null);
  });

  describe('#writeCache && #readCache()', function () {
    it('write data into cache.', function (done) {
      function verifyCache(index, t, callback) {
        var taskA = t.task;
        var dataA = t.data;
        var taskMd5sum = DataCache.generateKey(taskA);
        taskA.md5sum = taskMd5sum;
        DataCache.update(taskMd5sum, taskA);
        assert.deepEqual(DataCache.get(taskMd5sum), taskA);
        DataCache.writeCache(taskA, dataA, function() {
          const LENGTH = 5;
          var buffer = new Buffer(LENGTH);
          assert.equal(DataCache.get(taskA.md5sum).status, 'DONE');
          DataCache.readCache(taskA.path, buffer, 0, LENGTH, [taskA], function() {
            assert.equal(DataCache.get(taskA.md5sum).status, 'DONE');
            assert.equal(buffer.toString('ascii'), dataA.substring(0, LENGTH));
            callback();
          });
        });
      }
      var tasks = generateData(0, NUM_TOTAL_TEST_TASKS);
      foco.each(tasks, verifyCache, function () {
        for (var i = 0; i < NUM_TOTAL_TEST_TASKS - MAX_DATA_CACHE_ENTRY; i++) {
          var task = tasks[i];
          assert.equal(DataCache.get(task.md5sum, null));
        }
        done();
      });
    });
  });
});
