var MetaCache = require('../helper/MetaCache');
var assert = require('chai').assert;
describe('MetaCache', function() {
  describe('#init()', function () {
    it('local cache should be empty', function () {
      MetaCache.init();
      assert.equal(MetaCache._fileMetaCache.length, null);
      assert.equal(MetaCache._fileListCache.length, null);
    });
  });

  describe('#get()', function () {
    it('a unknown entry should be empty', function () {
      assert.equal(MetaCache.get('unknown'), null);
    });
  });

  describe('#getList()', function () {
    it('a unknown list entry should be empty', function () {
      assert.equal(MetaCache.getList('unknown'), null);
    });
  });

  describe('#update()', function () {
    it('an existing entry should have the expected result.', function () {
      var template = {data: 'A'};
      MetaCache.update('dataA', template)
      assert.deepEqual(MetaCache.get('dataA'), template);
    });
  });

  describe('#updateList()', function () {
    it('an existing list entry should have the expected result.', function () {
      var template = {data: 'B'};
      MetaCache.updateList('dataB', template)
      assert.deepEqual(MetaCache.getList('dataB'), template);
    });
  });

  describe('#clear()', function () {
    it('remove with an empty path', function () {
      var template = {data: 'C'};
      MetaCache.update('/data/C', template)
      MetaCache.updateList('/data/C', template)
      MetaCache.clear();
      assert.deepEqual(MetaCache.get('/data/C'), template);
      assert.deepEqual(MetaCache.getList('/data/C'), template);
    });

    it('remove a specific path list when recursive = true', function () {
      var template = {data: 'D'};
      MetaCache.update('/data/D', template)
      MetaCache.updateList('/data/D', template)
      MetaCache.clear('/data/D', true);
      assert.equal(MetaCache.get('/data/D'), null);
      assert.equal(MetaCache.getList('/data/D'), null);
    });

    it('remove a specific path list when recursive = false', function () {
      var template = {data: 'E'};
      MetaCache.update('/data/E', template)
      MetaCache.updateList('/data/E', template)
      MetaCache.clear('/data/E', false);
      assert.equal(MetaCache.get('/data/E'), null);
      assert.equal(MetaCache.getList('/data/E'), null);
    });

    it('remove a path list which has a similar one when recursive = true', function () {
      var template = {data: 'F__'};
      MetaCache.update('/data/F__', template)
      MetaCache.updateList('/data/F__', template)
      MetaCache.clear('/data/F', true);
      assert.deepEqual(MetaCache.get('/data/F__'), template);
      assert.deepEqual(MetaCache.getList('/data/F__'), template);
    });

    it('remove a path list which has a similar one when recursive = false', function () {
      var template = {data: 'G__'};
      MetaCache.update('/data/G__', template)
      MetaCache.updateList('/data/G__', template)
      MetaCache.clear('/data/G', false);
      assert.deepEqual(MetaCache.get('/data/G__'), template);
      assert.deepEqual(MetaCache.getList('/data/G__'), template);
    });
  });
});
