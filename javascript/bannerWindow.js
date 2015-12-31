Ext.define('Application.components.BannerWindow', {
  extend: 'Ext.Window',
  width: 400,
  height: 300,
  boxMaxHeight: 500,
  boxMaxWidth: 700,
  boxMinHeight: 300,
  boxMinWidth: 400,
  defaultButton: 0,
  closable: false,

  initComponent: function() {
    this.newsTpl = new Ext.XTemplate(
      '<tpl for=".">' +
        '<div>{modal_text}</div>' +
      '</tpl>'
    );

    if (!this.store) {
      this.store = getNewsStore();
    }

    this.items = {
      xtype: 'dataview',
      tpl: this.newsTpl,
      store: this.store,
      ref: 'ctrl_content'
    };

    this.buttons = [{
      text: "Закрыть",
      listeners: {
        scope: this,
        click: this.closeWindow
      }
    }];

    Application.components.BannerWindow.superclass.initComponent.call(this);

    this.on('beforeshow', this.updateTitle, this);
  },

  updateTitle: function(data) {
    this.setTitle(this.store.getAt(0).get("text"));
  },

  closeWindow: function() {
    this.setTitle("");
    this.close();
  }
});