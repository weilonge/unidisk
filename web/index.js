udManagerHelper.init('Sample', { JSONPath: './test_fixture.json' });

var array = new Uint8Array(12);
var path = '/dir1/dir2/dummy.txt';

udManager.downloadFileInRangeByCache(path, array, 0, 12, function (e, r) {
  var data = String.fromCharCode.apply(null, new Uint16Array(array.buffer));
  console.log(data);
  console.log(data === 'Dummy\n');
});
