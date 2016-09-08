var udManager = require('../helper/udManager');

var UnidiskHelper = {
  create: function (storageName, profile) {
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
      profile: profile,
      metaCacheModule: require('../helper/MetaCache'),
      dataCacheModule: require('../helper/DataCache'),
      webStorageModule: storageMod
    });
    return udm;
  }
};

window.UnidiskHelper = UnidiskHelper;
