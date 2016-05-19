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
      var template = {data: 'A'};
      MetaCache.updateList('dataA', template)
      assert.deepEqual(MetaCache.getList('dataA'), template);
    });
  });
});
