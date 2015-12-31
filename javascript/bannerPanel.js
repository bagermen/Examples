Ext.define('Application.components.bannerPanel', {
  extend: 'Ext.panel.Panel',
  frame: false,
  border: false,
  minHeight: 84,
  maxHeight: 100,
  width: 400,
  linkUrl: 'http://etp.gpb.ru/',
  bannerText: '',
  bannerURI: '',

  initComponent: function() {
    var bannerTpl = new Ext.XTemplate(
      '<tpl if="values.length">' +
        '<div class="banner-box" style="float:left; height:56px; width:350px;">' +
          '<tpl for=".">' +
            '<div class="uib-info">{text}</div>' +
          '</tpl>' +
        '</div>' +
      '</tpl>'
    );

    this.store = getNewsStore();

    this.items = {
      xtype: 'dataview',
      autoHeight: true,
      itemSelector: 'div.uib-info',
      tpl: bannerTpl,
      store: this.store,
      ref: 'ctrl_dv'
    }
    Application.components.bannerPanel.superclass.initComponent.call(this);

    this.changeTextTask = {
      run: this.loadBanner,
      interval: 30000,
      scope: this
    };

    this.on('login', this.startTaskMng, this);
    this.on('beforerender', this.startTaskMng, this);
    this.on('logout', this.stopTaskMng, this);
    this.on('beforedestroy', this.destroyStore, this);
  },

  onRender: function() {
    Application.components.bannerPanel.superclass.onRender.apply(this, arguments);
    this.body.on('click', this.clickBannerHandler, this);
  },

  startTaskMng: function() {
    if ( !isGuest() && !isEtpGazprom() ) {
      Ext.TaskManager.start(this.changeTextTask);
    }
  },

  stopTaskMng: function() {
    Ext.TaskManager.stop(this.changeTextTask);
    // clear BoxView
    this.store.removeAll();
  },

  clickBannerHandler: function() {
    var rec = this.store.getAt(0);
    if (rec.get('modal')) {
      // show modal window
      var win = new Application.components.BannerWindow({
        store: this.store
      });
      win.show();
    } else {
      if( !Ext.isEmpty(rec.get('url')) ) {
        window.open(rec.get('url'));
      } else {
        window.open(this.linkUrl);
      }
    }
  },

  loadBanner: function() {
    var self = this;
    var rec = self.store.getAt(0);
    var last_news = rec ? rec.get('id') : 0;
    performRPCCall(
      RPC.News.getBannerText,
      [{ last_news: last_news }],
      {wait_disable: true},
      function(query, response){
      if (!Ext.isEmpty(response) && !Ext.isEmpty(response.result) && response.result.success) {
        self.store.loadData(response.result);
      }
    });
  },

  destroyStore: function() {
    this.store.destroy();
  }
});