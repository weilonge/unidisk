var udManager = require('../helper/udManager');

var UnidiskHelper = {
  create: function (storageName, options) {
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
    var udm = new udManager();
    udm.init({
      moduleOpt: options,
      metaCacheModule: require('../helper/MetaCache'),
      dataCacheModule: require('../helper/DataCache'),
      webStorageModule: storageMod
    });
    return udm;
  }
};

window.UnidiskHelper = UnidiskHelper;
