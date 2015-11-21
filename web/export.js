var udManager = require('../helper/udManager');

var udManagerHelper = {
  init: function (storageName, options) {
    var storageMod;
    switch (storageName) {
    case 'Sample':
      storageMod = require('../clouddrive/Sample');
      break;
    case 'Dropbox':
      storageMod = require('../clouddrive/Dropbox');
      break;
    case 'BaiduYun':
      storageMod = require('../clouddrive/pcs');
      break;
    }
    udManager.init({
      moduleOpt: options,
      metaCacheModule: require('../helper/MetaCache'),
      dataCacheModule: require('../helper/DataCache'),
      webStorageModule: storageMod
    });
  }
};

window.udManagerHelper = udManagerHelper;
window.udManager = udManager;
