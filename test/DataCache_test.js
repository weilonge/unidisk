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
          path: '/test' + i,
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
  const BLOCK_SIZE = 1048576;

  Settings.init();
  Settings.set('max_data_cache_entry', MAX_DATA_CACHE_ENTRY);
  let dataCache = new DataCache();

  it('initializing state', function () {
    dataCache.init({cacheStore: 'memory'}, BLOCK_SIZE);
    assert.equal(dataCache._fileDataCache.length, null);
    assert.equal(dataCache._priorityQueue.length, 0);
    assert.equal(dataCache.get('unknown'), null);
  });

  describe('#writeCache && #readCache()', function () {
    it('write data into cache.', function (done) {
      function verifyCache(index, t, callback) {
        var taskA = t.task;
        var dataA = t.data;
        var taskMd5sum = dataCache.generateKey(taskA);
        taskA.md5sum = taskMd5sum;
        dataCache.update(taskMd5sum, taskA);
        assert.deepEqual(dataCache.get(taskMd5sum), taskA);
        dataCache.writeCache(taskA, dataA, function() {
          const LENGTH = 5;
          var buffer = new Buffer(LENGTH);
          assert.equal(dataCache.get(taskA.md5sum).status, 'DONE');
          dataCache.readCache(taskA.path, buffer, 0, LENGTH, [taskA], function() {
            assert.equal(dataCache.get(taskA.md5sum).status, 'DONE');
            assert.equal(buffer.toString('ascii'), dataA.substring(0, LENGTH));
            callback();
          });
        });
      }
      var tasks = generateData(0, NUM_TOTAL_TEST_TASKS);
      foco.each(tasks, verifyCache, function () {
        for (var i = 0; i < NUM_TOTAL_TEST_TASKS - MAX_DATA_CACHE_ENTRY; i++) {
          var task = tasks[i];
          assert.equal(dataCache.get(task.md5sum, null));
        }
        dataCache.clear('/test6', true);
        assert.equal(dataCache.get(tasks[6].md5sum, null));
        done();
      });
    });
  });
});
