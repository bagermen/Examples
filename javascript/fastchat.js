/*
 Чат.
 Работает с CJabber объектом (прослойка между Strophe и чатом).
 Note: нужен файл Tools.js (с вспомогательными функциями)
 Инициализация.
 Параметры задаютя объектом в конструктор.
 Параметры.
 {
 R    pref: "user", - пользователи должны начинаться с префикса и быть в формате: user.id@jabber.ru (user - префикс)
 R    connector: CJabber, - CJabber объект. Должен быть соединен и залогинен с сервером под user
 useCache: true, - Нужно ли использовать локальный кэш.
 msgsInLocalCache - число сообщений в локальном кэше (10)
 R    user: {
 id: user_id, - id пользователя
 name: User Name, - Имя Фамилия пользователя
 avatar: avatar.png - фото пользователя (полный путь к картинке)
 },
 R    contactList: { - Параметры для запроса от сервера информации по пользователям
 url: url запроса для получения контактов
 data: объект параметров для запроса на сервер,
 type: [post|get]
 },
 dialogs: { - загрузка / сохранение открытых диалогов
 saveDialogsUrl: url
 loadDialogsUrl: url
 },
 skipFirst: 2, - Большее число контактов переноситься в список неактивных контактов
 writeAdvet: "Leave message...", - Приглашение написать сообщение
 loadMsg: - сообщение загрузки истории сообщений
 activityMsg: { - информация о состоянии написания сообщения
 active: "",
 composing: "User is writing...",
 paused: "...User has stopped...",
 inactive: ""
 },
 activityMins: { - время срабатывания таймеров о состоянии написания сообщения
 paused: 30,
 inactive: 60 * 2
 },
 closeMsg: - Лэйбл на закрытие окна (вверху),
 backToDialogsMsg - Люйбл на возврат обратно к списку диалогов,
 rosterSearchMsg - Приглашение к поиску контактов,
 curPres: [val1, val2] - см. setPresence,
 updatePresMin: min.. обновление состояния пользователя каждые 3 минуты по умолчанию...
 }
 API:
 setPresence(val1, val2) - установка состояния пользователя (http://xmpp.org/rfcs/rfc3921.html#stanzas)
 val1 - одно из значениий [
 "away", - awat
 "chat", - online
 "dnd", - do not disturb
 "xa" - extended away
 ],
 val2 - строка для отображения состояния: "онлайн", "не беспокоить", "занят" и т.п.

 chatWith([ids array], showId) - загрузка контактов
 // Темы и оформления not implemented yet
 */

Chat = function (config) {
	this.contacts = {};
	this.initParams(config);
	this.init();
};

Chat.prototype = {
	initParams : function (config) {
		this.conf = {
			pref             : 'user',
			connector        : CJabber,
			useCache         : true,
			msgsInLocalCache : 10,
			user             : {
				id     : "1",
				name   : "User",
				avatar : "user.11018.png"
			},
			contactList      : {
				url  : window.location.host,
				data : {action: "contacts"},
				type : "post"
			},
			dialogs          : {
				saveDialogsUrl : window.location.host,
				loadDialogsUrl : window.location.host,
				loadHistoryUrl : window.location.host
			},
			skipFirst        : 5,
			writeAdvet       : "Leave message...",
			loadMsg          : "...Loading...",
			activityMsg      : {
				active    : "",
				composing : "User is writing...",
				paused    : "...User has stopped...",
				inactive  : ""
			},
			activityMins     : {
				paused   : 30,
				inactive : 60 * 2
			},
			closeMsg         : "close",
			backToDialogsMsg : "return to dialogs",
			rosterSearchMsg  : "Search...",
			curPres          : "online",
			updatePresMin    : 3
		};
		Tools.apply(this.conf, config);
		this.searchShown = false;
		this.chatOpened = false;
		this.cache = undefined;

		this.totalUnreadedBlock = $('#myMessages .e-number');
		this.totalUnreadedCount = parseInt(this.totalUnreadedBlock.text(), 10) || 0;

		// this.presIntervalID;

		this.lastActive = 0;

		this.loadingContacts = false;
		this.queues = {
			presence : [],
			message  : [],
			update   : []
		};
	},

	init : function () {
		// render Chat
		this.renderChat();
		$('.b-chat .e-messages-count').hide();

		if (this.conf.useCache) {
			this.cache = new WebCache({
				name : "chatcache"
			});
		}
		// create Roster
		this.roster = new Roster({
			backToDialogsMsg : this.conf.backToDialogsMsg,
			rosterSearchMsg  : this.conf.rosterSearchMsg,
			renderTo         : this.chatBar.find('div.e-search'),
			listeners        : {
				scope         : this,
				clickcontact  : function (id) {
					// console.log("clickcontact");
					this.messages.addContact(this.getContactById(id), false, true, false, true);
					this.activate("messages");
				},
				backtodialogs : function () {
					this.activate("messages");
				}
			}
		});

		this.messages = new MsgPanel({
			user         : this.conf.user,
			renderTo     : this.chatBar.find('div.e-contact-list'),
			skipFirst    : this.conf.skipFirst,
			writeAdvet   : this.conf.writeAdvet,
			loadMsg      : this.conf.loadMsg,
			activityMsg  : this.conf.activityMsg,
			activityMins : this.conf.activityMins,
			historyUrl   : this.conf.dialogs.loadHistoryUrl,
			listeners    : {
				scope        : this,
				roster       : function () {
					this.activate("roster");
				},
				sendmessage  : function (id, message) {
					this.sendMessage(id, message);
				},
				queryhistory : function (id, lastid) {
					this.queryHistory(id, lastid);
				},
				sendactivity : function (id, activity) {
					this.sendActivity(id, activity);
				},
				readmsginfo  : function (id, count) {
					this.showNotReadMsg(id, count);
				},
				change       : function (nv, ov) {
					if (!this.conf.useCache) return true;

					if (nv === undefined) nv = [];
					this.saveDialogs(nv, false);
				},
				savestate    : function (msgid, data) {
					if (!this.conf.useCache) return true;

					var common_id = msgid + "c";
					this.cache.save(common_id, data.common, 1);
				}
			}
		});
		this.bindEvents();
		if (this.conf.useCache) this.loadState();
		this.loadRosterList();
	},

	renderChat : function () {
		var chat_bar =
			"<div class='b-chat'>" +
				"<div class='e-container'>" +
				"<a href='#' class='e-chat-button'>" +
				"<i class='b-icon m-small m-message m-white'></i>" +
				"<span class='e-messages-count'></span>" +
				"<span class='e-arrow'></span>" +
				"<span class='e-tooltip'>" + this.conf.closeMsg + "</span>" +
				"</a>" +
				"<div class='e-contact-list'></div>" +
				"<div class='e-search' style='display:none;'>" +
				"</div>" +
				"</div>";
		this.chatBar = $(chat_bar);
		this.chatBar.insertAfter('.b-top-panel');
		// $('body').append(this.chatBar);

		if (this.totalUnreadedCount > 0) {
			$('.b-chat .e-messages-count').text(this.totalUnreadedCount).show();
		}

		this.openButton = this.chatBar.find('a.e-chat-button');
		this.notReadMsgs = this.chatBar.find('.e-messages-count');
	},

	showNotReadMsg : function (id, count) {
		this.contacts[id].notread = count;
		var messages = 0;

		// count not read messages
		for (var i in this.contacts) {
			if (this.contacts[i].notread) {
				messages += this.contacts[i].notread;
			}
		}

		if (messages) {
			this.notReadMsgs.css({
				display : ''
			});
			this.notReadMsgs.text(messages);
			this.totalUnreadedBlock.text('+' + messages);
		} else {
			this.notReadMsgs.css({
				display : 'none'
			});
			this.totalUnreadedBlock.hide();
		}
		return true;
	},

	activate : function (target) {
		switch (target) {
			case "roster":
				this.roster.show(true, true);
				this.messages.show(false, true);
				this.searchShown = true;
				this.chatOpened = true;
				break;
			case "messages":
				this.roster.show(false, true);
				this.messages.show(true, true);
				this.searchShown = false;
				this.chatOpened = true;
				break;
			case "collapse":
				if (this.chatOpened) {
					this.messages.show(false);
					this.roster.show(false);
					this.openButton.removeClass('m-opened');
					this.chatOpened = false;
				} else {
					this.chatOpened = true;
					this.openButton.addClass('m-opened');
					if (this.searchShown) {
						this.roster.show(true);
					} else {
						this.messages.show(true);
					}
				}
				break;
		}
		if (this.conf.useCache) this.saveState();
	},

	setReadedQuite : function (lastid) {
		$.ajax({
			url      : this.conf.dialogs.loadDialogsUrl,
			data     : {
				action : "readed",
				user   : lastid
			},
			type     : "post"
		});
	},

	bindEvents : function () {
		var self = this;
		//chat events
		this.chatBar.find('div.e-search').on('click', function (ev) {
			// console.log("bindEvents: chatBar");
			ev.preventDefault();
			ev.stopPropagation();

			self.activate('roster');
		});
		this.openButton.on('click', function (ev) {
			ev.preventDefault();
			ev.stopPropagation();
			// console.log("bindEvents: openButton");

			if ($(this).hasClass('m-opened') && self.lastActive) {
				self.setReadedQuite(self.lastActive);
			}

			self.activate('collapse');
		});

		$(document).on('click', 'a', function() {
			if (self.openButton.hasClass('m-opened') && self.lastActive) {
				self.setReadedQuite(self.lastActive);
			}
		});

		// jabber events
		$(document).on('connected.' + this.conf.pref, function () {
			self.onConnect.apply(self, arguments);
		});

		$(document).on('disconnected.' + this.conf.pref, function () {
			self.onDisconnect.apply(self, arguments);
		});

		$(document).on('rosterlist.' + this.conf.pref, function () {
			self.onRosterList.apply(self, arguments);
		});

		$(document).on('presenceinfo.' + this.conf.pref, function () {
			if (self.loadingContacts) {
				self.queues.presence.push(arguments);
			} else {
				self.onPresence.apply(self, arguments);
			}
		});

		$(document).on('rosterdel.' + this.conf.pref, function () {
			self.onRosterDel.apply(self, arguments);
		});

		$(document).on('message.' + this.conf.pref, function () {
			if (self.loadingContacts) {
				self.queues.message.push(arguments);
			} else {
				self.onMessage.apply(self, arguments);
			}
		});

//		$(document).on('history.' + this.conf.pref, function () {
//			self.onHistory.apply(self, arguments);
//		});

		$(document).on('update.' + this.conf.pref, function () {
			if (self.loadingContacts) {
				self.queues.update.push(arguments);
			} else {
				self.onUpdate.apply(self, arguments);
			}
		});

		$('.b-chat').on('imageLoaded', function (evt, img) {
			var el = $('.e-dialog-window .e-message-list:visible');
			if (el.length === 1) {
				var scrollPos = el.get()[0].scrollHeight,
					imgHeight = $(img).height();

				el.scrollTop(scrollPos + imgHeight);
			}
		});
	},

	chatWith : function (ids, showId) {
		// This function allow to say the chat what to load to active list and what contact open
		// find contacts of friends and ids of not friend
		var our_contacts = {};
		var need_to_load = [];
		var self = this;

		// debugger;

		for (var i = 0; i < ids.length; i++) {
			var contact = this.getContactById(ids[i]);
			if (contact) {
				our_contacts[contact.id] = contact;
			} else {
				need_to_load.push(ids[i]);
			}
		}

		if (need_to_load.length) {
			var data = this.conf.contactList.data ? this.conf.contactList.data : {};

			data.ids = need_to_load;

			$.ajax({
				url  : this.conf.contactList.url,
				data : data,
				type : this.conf.contactList.type
			}).done(function (contacts) {
					// debugger;
					var contacts_list = $.parseJSON(contacts);
					var new_contacts_list = {};
					for (var i = 0; i < contacts_list.length; i++) {
						new_contacts_list[contacts_list[i].id] = contacts_list[i];
					}
					self.loadContacts(contacts_list);
					self.loadAdditionContacts(ids, our_contacts, new_contacts_list, showId);
				});
		} else {
			this.loadAdditionContacts(ids, our_contacts, {}, showId);
		}
	},

	loadAdditionContacts : function (ids, our_contacts, new_contacts, showId) {
		// form correct list to load into active list
		var have_visible = false;
		for (var i = 0; i < ids.length; i++) {
			var ind = ids[i];
			var contact = our_contacts[ind] ? our_contacts[ind] : new_contacts[ind];
			if (!have_visible) have_visible = (showId == ind);
			this.messages.addContact(contact, (showId != ind), false, false, (i === (ids.length - 1)));
		}

		if (have_visible) {
			if (!this.openButton.hasClass('m-opened')) this.openButton.addClass('m-opened');
			this.activate("messages");
		}
	},

	getContactById : function (id) {
		var contact = this.contacts[id];
		return contact;
	},

	loadRosterList : function (jids) {
		/*
		 ajax запрос на сервер для jids,
		 в ответе contacts массив, который надо грузить
		 */
		var self = this;
//        // ДЛЯ ТЕСТА!!!
//        var contacts =  [
//            {
//                id: "10189",
//                jid: "user.10189@tooeezzy.com",
//                name: "Ya",
//                avatar: path_chat+"images/user.11012.png"
//            }
//        ];

		// Так надо =>
		this.loadingContacts = true;
		$.ajax({
			url  : this.conf.contactList.url,
			data : this.conf.contactList.data,
			type : this.conf.contactList.type
		}).done(function (contacts) {
				var friendList = $.parseJSON(contacts);
				self.loadContacts(friendList);
				var contacts = self.contactsFromArray(friendList);
				self.roster.addContacts(contacts);
				self.loadingContacts = false;

				self.runQueue();
				self.runPresenceCircle();
			});
	},

	runQueue : function () {
		if (this.queues.presence.length > 0) {
			for (var i in this.queues.presence) {
				this.onPresence(null, this.queues.presence[i][1]);
				this.queues.presence.splice(i, 1);
			}
		}

		if (this.queues.message.length > 0) {
			for (var i in this.queues.message) {
				this.onMessage(null, this.queues.message[i][1]);
				this.queues.message.splice(i, 1);
			}
		}

		if (this.queues.update.length > 0) {
			for (var i in this.queues.update) {
				this.onUpdate(null, this.queues.update[i][1]);
				this.queues.update.splice(i, 1);
			}
		}
	},

	runPresenceCircle : function () {
		var self = this;

		clearInterval(this.presIntervalID);
		this.presIntervalID = setInterval(function () {
			for (var i in self.roster.contacts) {
				var contact = self.getContactById(self.roster.contacts[i].id);
				self.conf.connector.sendPresenceState(contact.jid, true, self.conf.curPres);
			}
		}, this.conf.updatePresMin * 1000 * 60);
	},

	setPresence : function (show) {
		this.conf.curPres = show;
		this.runPresenceCircle();
	},

	loadContacts : function (data) {
		if (!data.length) return true;
		var contacts = this.contactsFromArray(data);

		Tools.applyIf(this.contacts, contacts);
		return true;
	},

	contactsFromArray : function (data) {
		var contacts = {};
		if (!data.length) return {};

		var defaults = {
			id       : 0,
			name     : "",
			avatar   : "",
			presence : "offline",
			status   : ""
		}

		for (var i = 0; i < data.length; i++) {
			Tools.applyIf(data[i], defaults);
			if (data[i]) {
				data[i].id = data[i].id;
				if (!contacts[data[i].id]) {
					contacts[data[i].id] = data[i];
				}
			}
		}
		return contacts;
	},

	changePresence : function (id, type, status) {
		var types = ["offline", "online", "away"];
		if ($.inArray(type, types) == -1
			|| $.type(this.contacts[id]) == 'undefined') return false;

		this.contacts[id].presence = type;
		this.roster.changePresence(id, type, status);
		this.messages.changePresence(id, type, status);
		return true;
	},

	updateContact : function (id, params) {
		var contact = this.getContactById(id);
		if (contact.node === params.node) {
			Tools.applyIf(contact, params);
		}
	},
	// "user.52b341d6e4b0d71dd9253d42@tooeezzy.com"
	getIdFromJid : function (jid) {
		// var re = new RegExp(this.conf.pref + "\\.(.*)@.*$");
		// var found = jid.match(re);
		// return parseInt(found[1]);
		return jid.replace('user.','').split('@')[0];
	},

	sendMessage : function (id, message) {
		var contact = this.getContactById(id)
		var jid = contact.jid;

		this.conf.connector.sendMessage(jid, message);
	},

	queryHistory : function (id, lastid) {
		var contact = this.getContactById(id)
		var jid = contact.jid;

		this.conf.connector.getHistory(jid, lastid);
	},

	sendActivity : function (id, activity) {
		var contact = this.getContactById(id)
		var jid = contact.jid;

		this.conf.connector.sendState(jid, activity);
	},

	receiveMessage : function (jid, params) {
		var id = this.getIdFromJid(jid);
		var contact = this.getContactById(id);
		var msg_obj = {
			msg      : params.msg,
			time     : params.time,
			activity : params.state,
			thread   : params.thread,
			type     : params.type
		}

		this.messages.contactAction("message", contact, msg_obj);
	},

	receiveActivity : function (jid, params) {
		var id = this.getIdFromJid(jid);
		var contact = this.getContactById(id);

		this.messages.contactAction("activity", contact, params.state);
	},

	saveDialogs : function (contacts, use_cache) {
		if (use_cache) {
			this.cache.save("contacts", nv, 1);
		} else {
			var ids = [];
			for (var i in contacts) {
				ids.push(contacts[i].id);
			}
			$.ajax({
				url  : this.conf.dialogs.saveDialogsUrl,
				data : {
					action : "set",
					ids    : ids
				},
				type : "post"
			});
		}
	},

	loadDialogs : function (use_cache) {
		var self = this;
		if (use_cache) {
			var contacts = this.cache.read("contacts")[0];
			if (contacts !== undefined) this.updateState(contacts);
		} else {
			$.ajax({
				url  : this.conf.dialogs.loadDialogsUrl,
				data : {
					action : "get"
				},
				type : "post"
			}).done(function (data) {
					var dialogs = $.parseJSON(data);
					var contacts = [];
					// load only one to one chats
					for (var d in dialogs) {
						if (dialogs[d].length == 1) contacts.push(dialogs[d][0])
					}
					if (contacts !== undefined) self.updateState(contacts);
				});
		}
	},

	updateState : function (contacts) {
		// update state of the chat according to given contacts
		this.loadContacts(contacts);

		var ids = Tools.array_column(contacts, "id");
		this.loadAdditionContacts(ids, this.contactsFromArray(contacts), {});

		// восстанавливаем окошко сообщений
		for (var i = 0; i < contacts.length; i++) {
			if (contacts[i]) {
				var msgid = this.conf.user.id + "" + contacts[i].id;
				var data = {
					common : this.cache.read(msgid + "c")[0]
				}
				if (data.common) {
					data.common.notReadCounter = contacts[i].notread;
					this.messages.contactAction("loadstate", contacts[i], data);
				}
			}
		}
	},

	saveState : function () {
		var data = {
			chatOpened  : this.chatOpened,
			searchShown : this.searchShown
		}

		this.cache.save('chatopenstate', data, 1);
	},

	loadState : function () {
		this.loadDialogs(false);

		// показываем чат, если надо
		var data = this.cache.read('chatopenstate')[0];

		if (data) {
			this.searchShown = data.searchShown;
			this.chatOpened = !data.chatOpened;
			this.activate("collapse");
		}
	},

	onConnect : function (ev) {
	},

	onDisconnect : function (ev) {
		// Доступ к чату: self = $(document).data('chat-' + ev.namespace);
		//this.messages.cleanAll();
		//this.roster.cleanAll();
	},

	onRosterList : function (ev, d) {
		this.loadRosterList(d.jids);
	},

	onPresence : function (ev, info) {
		var id = this.getIdFromJid(info.jid);
		this.changePresence(id, info.type, info.status);

		if (info.node && $.type(this.contacts[id]) !== 'undefined') {
			var contact = this.getContactById(id);
			contact.node = info.node;
		}
	},

	onRosterDel : function (ev, d) {
		for (var i = 0; i < d.jids.length; i++) {
			var id = this.getIdFromJid(d.jids[i]);
			this.roster.delContact(id);
		}
	},

	onMessage : function (ev, params) {
		if (params.msg) {
			this.receiveMessage(params.jid, params);
		} else {
			this.receiveActivity(params.jid, params);
		}
	},

	onHistory : function (ev, history) {
		var self = this;
		var hmsgs = [];
		var lastcol = "";
		var last = "";
		$.ajax({
			url      : self.conf.dialogs.loadHistoryUrl,
			data     : {
				action : "history",
				user   : ev.conf.contact.id,
				rows   : 40
			},
			type     : "post",
			dataType : "json",
			success  : function (messages) {
				for (var key in messages) {
					if (messages.hasOwnProperty(key)) {
						if (messages[key].my == 1) {
							var id = self.conf.user.id;
						} else {
							var id = ev.conf.contact.id;
						}
						hmsgs.push({
							jid      : self.conf.pref + "." + id,
							full_jid : self.conf.pref + "." + id + "@" + messages[key].server,
							time     : messages[key].timestamp,
							msg      : messages[key].message,
							type     : "history"
						});
						lastcol = messages[key].collection_id;
						last = messages[key]
					}
				}

				var history = {
					jid     : self.conf.pref + "." + ev.conf.contact.id,
					last    : last,
					lastcol : lastcol,
					hmsgs   : hmsgs
				}

				var id = ev.conf.contact.id;
				var contact = self.getContactById(id);
				var history_obj = {
					hmsgs  : history.hmsgs,
					lastid : history.lastcol,
					last   : history.last
				};

				for (var i = 0; i < history_obj.hmsgs.length; ++i) {
					history_obj.hmsgs[i].id = (history_obj.hmsgs[i].jid == history.jid)
						? id
						: self.conf.user.id;
				}



				self.messages.contactAction("history", contact, history_obj);
			}
		});

	},

	onUpdate : function (ev, params) {
		var id = this.getIdFromJid(params.jid);
		if (id == this.conf.user.id) return true;
		this.updateContact(id, params);
	}
}

Roster = function (config) {
	this.initParams(config);
	this.renderRoster();
	this.bindEvents();
}

Roster.prototype = {
	initParams : function (config) {
		this.conf = {
			renderTo         : {},
			listeners        : {},
			filters          : {
				showOnLineOnly : false,
				name           : ""
			},
			backToDialogsMsg : "return to dialogs",
			rosterSearchMsg  : "Search..."
		};
		Tools.apply(this.conf, config);
		this.parent = {};
		this.contacts = {};
		this.visible = false;
		this.mapStatus = {
			online  : 'm-online',
			away    : 'away',
			offline : 'm-offline'
		};
		return true;
	},

	renderRoster : function () {
		var roster =
			$("<div class='e-search-result'><ul></ul></div>" +
				"<div class='e-search-field'>" +
				"<input type='text' placeholder='" + this.conf.rosterSearchMsg + "'>" +
				"<i class='b-icon m-small m-lupa'></i>" +
				"<a href='#' class='e-return-to-dialog-list'>" +
				"<i class='b-icon m-small m-arrow-back-small m-white'></i>" + this.conf.backToDialogsMsg + "</a>" +
				"</div>");

		roster.appendTo(this.conf.renderTo);
		this.rosterSearch = this.conf.renderTo.find('div.e-search-field');
		this.rosterContacts = this.conf.renderTo.find('div.e-search-result ul');
		this.returnToDialogs = this.conf.renderTo.find('a.e-return-to-dialog-list');

		return true;
	},

	addContacts : function (contacts) {
		for (var i in contacts) {
			if (!this.isNewContact(contacts[i])) return true;
			this.contacts[contacts[i].id] = contacts[i];
			this.renderContact(contacts[i]);
		}

		return true;
	},

	delContact : function (id) {
		delete this.contacts[id];
		this.rosterContacts.children().each(function (ind, el) {
			if (id == $(el).data("user")) {
				$(el).remove();
				return false;
			}
		});
		return true;
	},

	cleanAll : function () {
		this.contacts = {};
		this.rosterContacts.children().remove();

		return true;
	},

	isNewContact : function (contact) {
		return ($.type(this.contacts[contact.id]) === "undefined")
	},

	renderContact : function (data) {
		var contact =
			$("<li><a href='#' rel ='1' class='roster-contact'>" +
				"<i class='b-icon m-chat-status m-offline'></i>" +
				"<span class=''> " +
				data.name +
				"</span>" +
				"</a></li>");
		this.rosterContacts.append(contact);

		contact.data("user", data.id);

		return true;
	},

	bindEvents : function () {
		var self = this;
		for (var param in this.conf.listeners) {
			switch (param) {
				case "scope":
					this.parent = this.conf.listeners["scope"];
					break;
				case "clickcontact":
					$(this.rosterContacts).on({
						"click" : function (ev) {
							ev.preventDefault();
							ev.stopPropagation();
							self.conf.listeners["clickcontact"].call(self.parent, $(this).data("user"));
						}
					}, "li");
					break;
				case "backtodialogs":
					this.returnToDialogs.on({
						"click" : function (ev) {
							ev.preventDefault();
							ev.stopPropagation();
							self.conf.listeners["backtodialogs"].call(self.parent);
						}
					});
					break;
			}
		}

		// add search ability
		var search = this.rosterSearch.find('input');
		search.on({
			keyup : function (ev) {
				var escape_chars = [
					9,   // Tab
					20,  // CapsLook
					16,  // Shift
					17,  // Ctrl
					91,  // left S key
					18,  // Alt
					92,  // Right S key
					93,  // Right click key
					45,  // Insert
					36,  // Home
					35,  // End
					33,  // Page up
					34,  // Page down
					122, // F11
					121, // F10
					120, // F9
					119, // F8
					118, // F7
					117, // F6
					115, // F4
					114, // F3
					113, // F2
					112, // F1
					27,  // Escape
					19,  // Scroll Look
					145, // Pause Break
					13,  // Enter
					32   // White Space
				];
				if ($.inArray(ev.which, escape_chars) > -1) return true;
				self.conf.filters.name = $(this).val();
				self.applyFilters();
			}
		})

		return true;
	},

	changePresence : function (id, type, status) {
		var contact = this.getContactById(id);
		var presence = contact.find("i.m-chat-status");
		// use status option too
		presence
			.removeClass(this.mapStatus['online'])
			.removeClass(this.mapStatus['away'])
			.removeClass(this.mapStatus['offline']);

		presence.addClass(this.mapStatus[type]);
		if (this.contacts[id] == undefined) {
			var newcontact = [];
			newcontact[0] = this.parent.contacts[id];
			this.addContacts(newcontact);
		}
		this.contacts[id].presence = type;
		return true;
	},

	getContactById : function (id) {
		var res;
		this.rosterContacts.children().each(function (ind, el) {
			if ($(el).data("user") == id) {
				res = el;
				return false;
			}
		});
		return $(res);
	},

	show   : function (val, fast) {
		// функция должна отображать/скрывать список контактов и поиск
		var self = this;
		if (fast === true) {
			if (val == true) {
				return this.conf.renderTo.show();
			} else {
				return this.conf.renderTo.hide();
			}
		} else {
			if (val == true) {
				return this.conf.renderTo.slideDown(300);

			} else {
				return this.conf.renderTo.slideUp(400);
			}
		}


		return true;
	},
	search : function (name) {
		var search_name = $.trim(name);
		var not_match = [];
		var all = [];
		for (var i in this.contacts) {
			if ((this.conf.filters.showOnLineOnly && (this.contacts[i].presence != "offline"))
				|| !this.conf.filters.showOnLineOnly) {
				all.push(i);
				var re = new RegExp("^.*" + name + ".*$", "i");
				if (!re.test(this.contacts[i].name)) {
					not_match.push(i);
				}
			}
		}

		this.displayContacts(all, true);
		this.displayContacts(not_match, false);
		this.conf.filters.name = search_name;

		return true;
	},

	onlineOnly : function (val) {
		var contacts = [];
		for (var i in this.contacts) {
			if (val && (this.contacts[i].presence == "offline")) {
				contacts.push(i);
			} else if (!val) {
				contacts.push(i);
			}
		}
		this.conf.filters.showOnLineOnly = val;
		this.displayContacts(contacts, !val);

		return true;
	},

	displayContacts : function (ids, show) {
		for (var i in ids) {
			var contact = this.getContactById(ids[i]);
			if (show) {
				contact.css({
					visibility : 'visible',
					position   : 'static'
				});
			} else {
				contact.css({
					visibility : 'hidden',
					position   : 'fixed'
				});
			}
		}
		return true;
	},

	applyFilters : function () {
		this.onlineOnly(this.conf.filters.showOnLineOnly);
		this.search(this.conf.filters.name);
		return true;
	},

	clearFilters : function () {
		this.conf.filters = {
			showOnLineOnly : false,
			name           : ""
		}

		return this.applyFilters();
	}
}

MsgPanel = function (config) {
	this.initParams(config);
	this.renderMsgPanel();
	this.bindEvents();
}

MsgPanel.prototype = {
	initParams : function (config) {
		this.conf = {
			listeners    : {},
			renderTo     : {},
			user         : {},
			skipFirst    : 2,
			writeAdvet   : "Leave message...",
			activityMsg  : {
				active    : "",
				composing : "User is writing...",
				paused    : "...User has stopped...",
				inactive  : ""
			},
			activityMins : {
				paused   : 30,
				inactive : 60 * 2
			},
			historyUrl   : ""
		}

		this.parent = {};
		this.defUser = {
			id      : "0",
			name    : "No name",
			avatar  : "",
			notread : 0,
			pos     : 0
		}
		this.visible = false;
		this.contacts = [];
		this.contactsObj = {};
		this.countAdded = 0;

		this.panelvisible = false;

		Tools.apply(this.conf, config);
		Tools.applyIf(this.conf.user, this.defUser);

		return true;
	},

	renderMsgPanel : function () {
		var panel =
			$("<div class='e-avatar-list'></div>" +
				"<a href='#' class='e-collapsed-dialogs-button' style='display:none'>" +
				"<i class='b-icon m-small m-comment m-white'></i> " +
				"<span class='e-collapsed-dialogs-count'></span>" +
				"</a>" +
				"<div class='e-collapsed-dialogs-list'><ul></ul></div>" +
				"<a href='#' class='e-search-button'>" +
				"<i class='b-icon m-small m-lupa m-white'></i>" +
				"&nbsp;" +
				"<i class='b-icon m-small m-man m-white'></i>" +
				"</a>");

		panel.appendTo(this.conf.renderTo);
		this.msgContacts = this.conf.renderTo;
		this.activeList = this.msgContacts.find('div.e-avatar-list');
		this.inactiveList = this.msgContacts.find('div.e-collapsed-dialogs-list ul');
		this.inactiveListBtn = this.msgContacts.find('a.e-collapsed-dialogs-button');
		this.inactiveInfo = this.msgContacts.find('a.e-collapsed-dialogs-button');
		this.inactiveSum = this.msgContacts.find('span.e-collapsed-dialogs-count');

		return true;
	},

	showRightMsgs : function () {
		var w_size = $(document).width();
		var width = $(this.conf.renderTo).width();
		var left = $(this.conf.renderTo).offset().left;
		var position_right = ((w_size - width - left) > 300);

		for (var i = 0; i < this.contacts.length; i++) {
			this.contactAction("positionright", this.contacts[i], position_right);
		}
	},

	show : function (val, fast) {
		// функция должна отображать/скрывать список контактов и поиск
		var self = this;
		if (fast === true) {
			if (val == true) {
				this.msgContacts.show();
				this.visible = true;
				this.showRightMsgs();
			} else {
				this.msgContacts.hide();
				this.visible = false;
				this.showInactive(false);
			}
		} else {
			if (val == true) {
				this.msgContacts.slideDown({
					duration : 300,
					easing   : "swing",
					done     : function () {
						self.visible = true;
						self.showRightMsgs();
					}
				});
			} else {
				this.msgContacts.slideUp({
					duration : 400,
					easing   : "swing",
					done     : function () {
						self.visible = false;
						self.showInactive(false);
					}
				});
			}
		}
		this.panelVisible = val;
		for (var i = 0; i < this.contacts.length; i++) {
			this.contactAction('panelvisible', this.contacts[i], this.panelVisible);
		}

		return true;
	},

	isContact : function (contact) {
		var ind = -1;
		var searchfor = contact;

		if ($.type(searchfor) == 'object') {
			searchfor = contact.id;
		}
		for (var i in this.contacts) {
			if (this.contacts[i].id == searchfor) {
				ind = i;
				break;
			}
		}
		return ind;
	},

	getContactById : function (id) {
		for (var i in this.contacts) {
			if (this.contacts[i].id == id) {
				return this.contacts[i];
			}
		}
		return {};
	},

	addContact : function (contact, hidden, history, unreaded, last) {
		var ind = this.isContact(contact);
		var hidden = ($.type(hidden) === 'undefined' || !hidden);

		// debugger;

		if (ind < 0) {
			var oldv = Tools.clone(this.contacts);

			Tools.applyIf(contact, this.defUser);
			contact.pos = ++this.countAdded;
			this.contacts.push(contact);

			this.defUser = {
				id      : contact.id,
				name    : contact.name,
				avatar  : contact.avatar,
				notread : contact.notread,
				pos     : contact.pos
			};

			this.updateInactive(contact.id);
			this.updateActive(contact.id, history, unreaded);
			this.updateInactiveSum();
			ind = this.isContact(contact);
		}
		this.notReadCounter = parseInt(contact.unread, 10);
		this.contactAction('panelvisible', contact, this.panelVisible);
		this.showRightMsgs();
		// auto choose last clicked contact
		// console.log(ind >= this.conf.skipFirst);
		if (last && ind >= this.conf.skipFirst) {
			if (ind >= this.conf.skipFirst) this.chooseInactive(contact.id, hidden);
		}
		this.switchContactVisibility(contact.id, hidden);
		return ind;
	},

	delContact : function (id) {
		var oldv = Tools.clone(this.contacts);

		this.contacts = $.grep(this.contacts, function (contact) {
			return contact.id != id;
		});

		var newv = Tools.clone(this.contacts);
		this.conf.renderTo.trigger("change", [newv, oldv]);

		this.removeFromInactive(id);
		this.removeFromActive(id);
		this.updateInactiveVisibility();

		this.updateInactiveSum();
		delete this.contactsObj[id];
		return true;
	},

	chooseInactive : function (id, hidden) {
		var last_active = this.contacts[this.conf.skipFirst - 1];
		var hidden = ($.type(hidden) === 'undefined' || !hidden);

		var oldv = Tools.clone(this.contacts);

		this.contacts = this.reorderContactsAr(id);
		var newv = Tools.clone(this.contacts);
		this.conf.renderTo.trigger("change", [newv, oldv]);
		var last_active_ins_ind = parseInt(this.isContact(last_active.id));
		var chosen_ins_ind = parseInt(this.isContact(id));

		this.removeFromInactive(id);
		this.updateInactive(id);

		this.removeFromInactive(last_active.id);
		this.updateInactive(last_active.id);

		this.parent.setReadedQuite(id);

		// manipulate active list. i.e. del form one place and paste in another
		this.moveActive(id, chosen_ins_ind);
		this.moveActive(last_active.id, last_active_ins_ind);

		this.switchContactVisibility(id, hidden);
	},

	removeFromInactive : function (id) {
		this.inactiveList.children().each(function (ind, el) {
			if ($(el).data("id") == id) {
				$(el).remove();
			}
		});
	},

	reorderContactsAr : function (id) {
		var chosen_ind = this.isContact(id);
		var skip = this.conf.skipFirst;

		if (chosen_ind < skip) return true;

		var last_active = this.contacts[this.conf.skipFirst - 1];

		var first_part = $.grep(this.contacts, function (contact, ind) {
			return (ind < skip - 1);
		});
		first_part.push(this.getContactById(id));

		var last_part = $.grep(this.contacts, function (contact, ind) {
			return ((ind > skip - 1) && contact.id != id);
		});
		last_part.push(last_active);
		last_part.sort(function (c1, c2) {
			return (parseInt(c1.pos) - parseInt(c2.pos));
		});

		var new_contacts = [];
		new_contacts = new_contacts.concat(first_part);
		new_contacts = new_contacts.concat(last_part);

		return new_contacts;
	},

	updateInactive : function (id) {
		var contact = this.getContactById(id);
		this.renderInactive(contact);

		this.updateInactiveVisibility();
	},

	renderInactive : function (contact) {
		var contact_html =
			$("<li>" +
				"<a href='#' class='e-open-chat'></a> " +
				"<a href='#' class='e-close-chat'><i class='b-icon m-mini m-close2 m-white'></i></a>" +
				"</li>");

		var inserted = false;
		var place_ind = this.isContact(contact.id);

		this.inactiveList.children().each(function (ind, el) {
			if (place_ind == ind) {
				inserted = true;
				$(el).before(contact_html);
				return false;
			}
		});
		if (inserted === false) {
			this.inactiveList.prepend(contact_html);
		}

		contact_html.find("a.e-open-chat").text(contact.name);
		contact_html.data("id", contact.id);
	},

	updateInactiveVisibility : function () {
		for (var i in this.contacts) {
			this.setInactiveVisible(this.contacts[i].id, (i >= this.conf.skipFirst));
		}
	},

	setInactiveVisible : function (id, visible) {
		this.inactiveList.children().each(function (ind, el) {
			if ($(el).data("id") == id) {
				$(el).css({
					visibility : visible ? 'visible' : 'hidden',
					position   : visible ? 'static' : 'fixed'
				})
			}
		});
	},

	updateInactiveSum : function () {
		var count = this.contacts.length - this.conf.skipFirst;
		var text = count > 0 ? count : "";

		this.inactiveSum.text(text);
		this.showInactiveBtn(count);
		return true;
	},

	showInactiveBtn : function (show) {
		this.inactiveListBtn.css({
			display : (show > 0) ? '' : 'none'
		})
	},

	showInactive : function (visible) {
		this.inactiveList.parent().css({
			"display" : visible ? "block" : "none"
		});
	},

	updateActive : function (id, history, unreaded) {
		var contact = this.getContactById(id);
		this.renderActive(contact, history, unreaded);
		this.hideActiveInInactive();
	},

	removeFromActive : function (id) {
		this.activeList.children().each(function (ind, el) {
			if ($(el).data("id") == id) {
				var cont = $(el).find('.e-avatar-ramka-wrap');
				cont.trigger('setReaded');
				$(el).remove();
			}
		});
		this.hideActiveInInactive();
	},

	moveActive : function (id, base_ind) {
		var contact = {};
		var base = {};

		this.activeList.children().each(function (ind, el) {
			if ($(el).data("id") == id) {
				contact = $(el);
			}
			if (ind == base_ind) {
				base = $(el);
			}
		});
		base.after(contact);
		this.hideActiveInInactive();
	},

	hideActiveInInactive : function () {
		var self = this;
		this.activeList.children().each(function (ind, el) {
			var id = $(el).data(id);
			var index = self.isContact(id);
			if (ind > self.conf.skipFirst - 1) {
				$(el).removeClass("m-active");
			} else {
				$(el).addClass("m-active");
			}
		});
	},

	/**
	 * Создаёт чаты для контактов
	 * @param object contact Информация о контакте.
	 * @param bool   history
	 */
	renderActive : function (contact, history, unreaded) {
		var contact_html =
			$("<div class='e-avatar m-active'>" +
				"<span class='e-close-chat'><i class='b-icon m-mini m-close2 m-white'></i></span>" +
				"<div class='e-avatar-ramka-wrap'></div>" +
				"</div>");

		this.activeList.append(contact_html);

		var contact_wrap = contact_html.find('div.e-avatar-ramka-wrap');
		contact_html.data("id", contact.id);
		contact_html.data("contact", contact_wrap);
		/**
		 Связь с ContactChat полностью на ивентах, т.е. contact_wrap принимает и файрит события
		 */
		this.contactsObj[contact.id] = new ContactChat({
			user            : this.conf.user,
			contact         : contact,
			renderTo        : contact_wrap,
			writeAdvet      : this.conf.writeAdvet,
			loadMsg         : this.conf.loadMsg,
			activityMsg     : this.conf.activityMsg,
			activityMins    : this.conf.activityMins,
			autoLoadHistory : history,
			historyUrl      : this.conf.historyUrl,
			listeners       : {
				scope        : this,
				sendmessage  : function (id, message) {
					this.sendMessage(id, message);
				},
				queryhistory : function (id, lastid) {
					this.queryHistory(id, localStorage.getItem("lastid"));
				},
				sendactivity : function (id, activity) {
					this.sendActivity(id, activity);
				},
				showmsg      : function (id, visible) {
					this.switchContactVisibility(id, visible);
					this.showInactive(false);
				},
				readmsginfo  : function (id, count) {
					contact.notread = count;
					this.conf.renderTo.trigger("readmsginfo", [id, count]);
				},
				savestate    : function (msgid, data) {
					this.conf.renderTo.trigger("savestate", [msgid, data]);
				}
			}
		});

		if (unreaded) {
			contact.unread = unreaded;
		}

		this.contactsObj[contact.id].notReadCounter = parseInt(contact.unread, 10);
	},

	sendMessage : function (id, message) {
		this.conf.renderTo.trigger("sendmessage", [id, message]);
	},

	queryHistory : function (id, lastid) {
		this.contactAction("lockhistory", this.getContactById(id));
		this.conf.renderTo.trigger("queryhistory", [id, lastid]);
	},

	sendActivity : function (id, activity) {
		this.conf.renderTo.trigger("sendactivity", [id, activity]);
	},

	switchContactVisibility : function (id, visible) {
		this.activeList.children().each(function (ind, el) {
			var same = $(el).data('id') == id;
			if (visible) {
				$(el).data('contact').trigger("showmsg", same);
			} else if (!visible && same) {
				$(el).data('contact').trigger("showmsg", false);
			}
		});
	},

	closeAllContacts : function () {
		this.activeList.children().each(function (ind, el) {
			$(el).data('contact').trigger("showmsg", false);
		});
	},

	changePresence : function (id, type, status) {
		var ind = this.isContact(id);
		if (ind > -1) {
			this.contacts[ind].presence = type;
			this.contacts[ind].status = status;

			var contact = this.getContactById(id);
			this.contactAction("presence", contact, [type, status]);

			return true;
		}
		return false;
	},

	contactAction : function (action, contact, data) {
		/*
		 Ищем открытый контакт... для message открываем его если надо и стаим его активным если надо опять же
		 Для статуса и пресенса работаем только с открытыми контактами
		 */
//		console.log(contact);
		var ind = this.isContact(contact.id);
		var contact_el = null;
		if (ind > -1) contact_el = $(this.activeList.children()[ind]).data('contact');
		switch (action) {
			case "message":
				if (contact_el == null) {
					ind = this.addContact(contact, true, false, 1, true);
					contact_el = $(this.activeList.children()[ind]).data('contact');
				}
				contact_el.trigger("message", [data, contact.id]);
				break;
			case "history":
				if (contact_el != null) {
					contact_el.trigger("history", data);
				}
				break;
			case "presence":
				if (contact_el != null) {
					contact_el.trigger("presence", data);
				}
				break;
			case "activity":
				if (contact_el != null) {
					contact_el.trigger("activity", data);
				}
				break;
			case "loadstate":
				if (contact_el != null) {
					contact_el.trigger("loadstate", data);
				}
				break;
			case "panelvisible":
				if (contact_el != null) {
					contact_el.trigger("panelvisible", data);
				}
				break;
			case "positionright":
				if (contact_el != null) {
					contact_el.trigger("positionright", data);
				}
				break;
			case "lockhistory":
				if (contact_el != null) {
					contact_el.trigger("lockhistory", data);
				}
		}
	},

	cleanAll : function () {
		this.contacts = [];
		this.activeList.children().remove();
		this.inactiveList.children().remove();
		this.contactsObj = {};
	},

	bindEvents : function () {
		var self = this;
		$(window).resize(function () {
			self.showRightMsgs();
		});

		this.inactiveList.on({
			click : function (ev) {
				// console.log("bindEvents: inactiveList");
				var id = $(ev.target).parent('li').data('id');
				self.chooseInactive.call(self, id);
				self.showInactive(false);
			}
		}, 'a.e-open-chat');

		this.inactiveList.on({
			click : function (ev) {
				// console.log("bindEvents: inactiveList");
				var id = $(ev.currentTarget).parent('li').data('id');
				self.delContact.call(self, id);
				if (self.contacts.length <= self.conf.skipFirst) self.showInactive(false);
			}
		}, 'a.e-close-chat');

		this.inactiveInfo.on({
			click : function (ev) {
				// console.log("bindEvents: inactiveInfo");
				var show = (self.inactiveList.parent().css("display") === "block") ? false : true;
				self.closeAllContacts();
				self.showInactive(show && self.contacts.length > self.conf.skipFirst);
			}
		});

		this.activeList.on({
			click : function (ev) {
				// console.log("bindEvents: activeList");
				var id = $(ev.currentTarget).parent('div.e-avatar').data('id');
				self.delContact.call(self, id);
			}
		}, "span.e-close-chat");

		for (var param in this.conf.listeners) {
			switch (param) {
				case "scope":
					this.parent = this.conf.listeners["scope"];
					break;
				case "sendmessage":
					this.conf.renderTo.on({
						"sendmessage" : function (ev, id, msg) {
							ev.preventDefault();
							ev.stopPropagation();

							self.conf.listeners["sendmessage"].call(self.parent, id, msg);
						}
					});
					break;

				case "queryhistory":
					this.conf.renderTo.on({
						"queryhistory" : function (ev, id, lastid) {
							ev.preventDefault();
							ev.stopPropagation();
							self.conf.listeners["queryhistory"].call(self.parent, id, lastid);
						}
					});
					break;

				case "sendactivity":
					this.conf.renderTo.on({
						"sendactivity" : function (ev, id, activity) {
							ev.preventDefault();
							ev.stopPropagation();

							self.conf.listeners["sendactivity"].call(self.parent, id, activity);
						}
					});
					break;
				case "roster":
					this.conf.renderTo.on({
						"click" : function (ev, id, activity) {
							// console.log("bindEvents: roster");
							ev.preventDefault();
							ev.stopPropagation();

							self.conf.listeners["roster"].call(self.parent);
						}
					}, "a.e-search-button");
					break;
				case "readmsginfo":
					this.conf.renderTo.on({
						"readmsginfo" : function (ev, id, count) {
							ev.preventDefault();
							ev.stopPropagation();

							self.conf.listeners["readmsginfo"].call(self.parent, id, count);
						}
					});
					break;
				case "change":
					this.conf.renderTo.on({
						"change" : function (ev, nv, ov) {
							ev.preventDefault();
							ev.stopPropagation();

							self.conf.listeners["change"].call(self.parent, nv, ov);
						}
					});
					break;
				case "savestate":
					this.conf.renderTo.on({
						"savestate" : function (ev, msgid, data) {
							ev.preventDefault();
							ev.stopPropagation();

							self.conf.listeners["savestate"].call(self.parent, msgid, data);
						}
					});
					break;
			}
		}
	}
}

ContactChat = function (config) {
	this.initParams(config);
	this.renderContactChat();
	this.bindEvents();

	this.messagesCounter = 0;

	this.setTitle(this.conf.contact.name);
	if (this.conf.autoLoadHistory) {
		this.queryHistory();
	}

	this.scrollDown();
}

ContactChat.prototype = {
	initParams : function (config) {
		this.conf = {
			user            : {}, // мы
			contact         : {}, // с кем общаемся
			renderTo        : {},
			listeners       : {},
			loadMsg         : "...Loading...",
			activityMsg     : {
				active    : "",
				composing : "User is writing...",
				paused    : "...User has stopped...",
				inactive  : ""
			},
			activityMins    : {
				paused   : 30,
				inactive : 60 * 2
			},
			writeAdvet      : "Leave message...",
			autoLoadHistory : false,
			historyUrl      : ""
		}
		this.parent = {};
		this.currentActivity = "active";
		this.notReadCounter = 0;
		this.msgCounter = 0;
		this.threadId = null;
		this.wOpened = false;

		this.panelVisible = false;

		this.historyFlags = {
			lastMsgId         : null,
			requestingHistory : false,
			isLastHistory     : false,
			firstInHistory    : true,
			shownMsgs         : 0
		};

		this.historyMerger = {
			lastUserId        : null,
			lastDay           : false
		};

		Tools.apply(this.conf, config);
	},

	renderContactChat : function () {
		var contact_chat =
			$("<div class='e-dialog-window'>" +
				"<div class='e-top-panel'>" +
				"<span class='title'></span>" +
				"<span class='presence'></span>" +
				"<div class='e-arrow'></div>" +
				"</div>" +
				"<div class='e-message-list'>" +
				"<div class='e-message-history-info'></div>" +
				"<div class='e-message-activity-info'></div>" +
				"</div>" +
				"<div class='message-area'>" +
				"<textarea class='message font' placeholder='" + this.conf.writeAdvet + "'></textarea>" +
				"</div>" +
				"</div>" +
				"<span class='e-avatar-ramka offline'>" +
				"<a href='#'>" +
				"<img class='e-contact' src='" + this.conf.contact.avatar + "' alt=''>" +
				"</a>" +
				"</span>" +
				"<span class='e-messages-count' style='display:none;'></span>" // Место куда пишутся непрочитанные сообщения
			);

		this.conf.renderTo.append(contact_chat);

		this.msgWindow = this.conf.renderTo.find('.e-dialog-window');
		this.msgTitle = this.conf.renderTo.find('.e-top-panel span.title');
		this.msgPresence = this.conf.renderTo.find('.e-top-panel span.presence');
		this.msgText = this.conf.renderTo.find('.message-area .message');
		this.msgMessages = this.conf.renderTo.find('.e-message-list');
		this.msgHistoryInfo = this.conf.renderTo.find('.e-message-history-info');
		this.activityInfo = this.conf.renderTo.find('.e-message-activity-info');
		this.avatarFrame = this.conf.renderTo.find('span.e-avatar-ramka');
		this.notReadMsgs = this.conf.renderTo.find('span.e-messages-count');
	},

	/**
	 * Отображение окошка с чатиком.
	 * @param visible
	 * @param slow
	 */
	show : function (visible, slow) {
		this.conf.renderTo.trigger("showmsg", [visible, slow, true]);
		if (visible) {
			this.setReaded(this.conf.contact.id, this.notReadCounter);
			this.setReadedQuite(this.parent.parent.lastActive, this.notReadCounter);
			this.notReadCounter = 0;
			this.showNotReadMsg();
			this.scrollDown();
			this.parent.parent.lastActive = this.conf.contact.id;
			this.msgText.focus();
		}
		this.saveState();
	},

	showNotReadMsg : function () {
		if (this.notReadCounter) {
			this.notReadMsgs.css({
				display : ''
			});
			this.notReadMsgs.text(this.notReadCounter);

			this.parent.parent.totalUnreadedCount += 1;
			this.parent.parent.totalUnreadedBlock.text('+' + this.parent.parent.totalUnreadedCount).show();
		} else {
			this.notReadMsgs.css({
				display : 'none'
			});
			this.notReadCounter = 0;
		}
		this.conf.renderTo.trigger('readmsginfo', this.notReadCounter);
	},

	isVisible : function () {
		return (this.msgWindow.css("display") != 'none' && this.panelVisible);
	},

	setTitle : function (title) {
		this.msgTitle.text(title);
		this.onPresence(this.conf.contact.presence, this.conf.contact.status);
	},

	/**
	 * Отправка сообщения.
	 * @param string msg Текст сообщения.
	 */
	sendMessage : function (msg) {
		this.updateConversationId();
		var message = {
			msg    : msg,
			thread : this.threadId,
			time   : (new Date()).getTime()
		}
		var self = this;

		/**
		 * Отправляем сообщение в историю на XMPP-сервер.
		 */
		$.ajax({
			url      : self.conf.historyUrl,
			data     : {
				action : "send",
				user   : self.conf.contact.id,
				msg    : msg
			},
			type     : "post",
			dataType : "json",
			success  : function (data) {
				// console.log(data);
			}
		});

		this.renderMsg(this.conf.user.id, message, false);
		this.conf.renderTo.trigger("sendmessage", message);

		localStorage.setItem("lastid", self.conf.contact.id);

		++this.msgCounter;
		this.saveState(this.conf.user.id, message);
	},

	/**
	 * Запрос истории.
	 * @returns {boolean}
	 */
	queryHistory : function () {
		if (this.historyFlags.requestingHistory) return true;
		if (!this.conf.isHistoryLoaded) {
			this.msgHistoryInfo.html(this.conf.loadMsg);
			this.parent.parent.onHistory(this, true);
			this.conf.isHistoryLoaded = true;
		} else {
			this.notReadCounter = 0;
			this.showNotReadMsg(this.notReadCounter);
			this.scrollDown();
		}
	},

	/**
	 * Отправка текущего состояния набора сообщения.
	 * @param string activity
	 */
	sendActivity : function (activity) {
		var self = this;
		switch (activity) {
			case 'active':
				this.currentActivity = "active";
				this.conf.renderTo.trigger('sendactivity', 'active');
				break;
			case 'composing':
				if (this.currentActivity != "composing") {
					this.conf.renderTo.trigger('sendactivity', 'composing');
					this.currentActivity = "composing";
				}
				setTimeout(function () {
					if (self.currentActivity == "composing") {
						self.currentActivity = "paused"
						self.conf.renderTo.trigger('sendactivity', 'paused');
					}
				}, this.conf.activityMins.paused * 1000);
				break;
			case 'paused':
				setTimeout(function () {
					if (self.currentActivity == "paused") {
						self.currentActivity = "inactive"
						self.conf.renderTo.trigger('sendactivity', 'inactive');
					}
				}, this.conf.activityMins.inactive * 1000);
				break;
		}
	},

	onMessage : function (data, id) {
		if (this.conf.contact.id === id) {
			this.notReadCounter = this.isVisible() ? 0 : ++this.notReadCounter;

			if (this.isVisible()) {
				this.messagesCounter += 1;

				if (this.messagesCounter % 5 === 0) {
					this.setReadedQuite(this.conf.contact.id);
				}
			}

			this.showNotReadMsg();
		}

		if (data.type != 'offline') {
			++this.msgCounter;
			this.renderMsg(this.conf.contact.id, data, false);

			this.updateConversationId(data.thread);
			this.changeActivity(data.activity);
		}

		this.saveState(this.conf.contact.id, data);
	},

	onHistory : function (data) {
		this.msgHistoryInfo.html('');
		// позволяем добавлять историю только для неотрендереных сообщений
		// Для этого ведем учет уже показанных из истории сообщений (offline сообщения в основном)
		if (!this.historyFlags.lastMsgId) {
			this.historyFlags.shownMsgs = this.msgCounter;
		}

		var diff = this.historyFlags.shownMsgs - data.hmsgs.length;
		this.historyFlags.shownMsgs = (diff < 0) ? 0 : diff;

		if (this.historyFlags.shownMsgs == 0) {
			var messages = [];
			if (Math.abs(diff) > data.hmsgs.length) {
				diff = data.hmsgs.length;
			}

			var count = Math.abs(diff) - 1; // number messages we have to display
			for (count; count >= 0; --count) {
				this.renderMsg(data.hmsgs[count].id, data.hmsgs[count], true);
				this.historyFlags.firstInHistory = false;
			}
		}

		this.scrollDown();

		Tools.apply(this.historyFlags, {
			requestingHistory : false,
			lastMsgId         : data.lastid,
			isLastHistory     : data.last,
			firstInHistory    : true
		});
		// load history while here is not a scroll
		this.msgMessages.trigger('scroll');
	},

	updateConversationId : function (value) {
		if ($.type(this.threadId) !== 'null') return true;
		this.threadId = value ? value : Tools.uniqid();
	},

	onPresence : function (type, status) {
		/* type - ["offline", "online", "away"] - одно из значений.
		 * status - человекочитаемый статус
		 */

		this.conf.contact.presence = type;
		this.conf.contact.status = status;

		this.avatarFrame.removeClass('offline online');
		switch (this.conf.contact.presence) {
			case 'online':
				this.avatarFrame.addClass('online');
				break;
			default:
				this.avatarFrame.addClass('offline');
				break;
		}
	},

	changeActivity : function (activity) {
		/* Отображение статуса другого пользователя
		 activity = [
		 "composing" - набирает сообщение,
		 "paused"    - остановился, но не послал сообщение (30 сек остановки)
		 "inactive"  - уже долго не пишет, т.е. сброс показаний активности (как "active" думаю) (2 мин. остановки),
		 "active"    - Прислал сообщение,
		 "gone"      - обойдемся без этого статуса (10 мин. остановки)].
		 ]

		 "composing" - В контакте - это гифка с карандашем и надпись "набирает сообщение"
		 */
		this.activityInfo.html(this.conf.activityMsg[activity]);
		this.scrollDown();
	},

	renderMsg : function (id, data, history) {
		// Проверить, что последнее сообщение от id, если не так, то создать или добавить
		var avatar = (id == this.conf.user.id) ? this.conf.user.avatar : this.conf.contact.avatar;
		var msg_wrap =
			$("<div class='e-message row container split'>" +
				"<div class='sixth'>" +
				"<img src='" + avatar + "' alt=''>" +
				"</div>" +
				"<div class='time'></div>" +
				"</div>");

		var msg_text = $("<div class='fifesixth'></div>");
		var message = new ChatMessage(data.msg);

		message.xss();
		message.nl2br();
		message.urlify();
		message.smiles();
		msg_text.html(message.get());

		msg_text.data('id', id);
		msg_text.data('time', data.time);
		msg_text.data('type', data.type);

		var delta_h = 0;
		if (history) {

			var date = new Date(Date.parse(data.time)),
				day = date.getDate();

			if (this.historyMerger.id === data.id && this.historyMerger.lastDay === day) {
				var lastMsg = this.msgMessages.find('.msg-'+id+'-'+day).last(),
					h_before = lastMsg.outerHeight(),
					h_after;

				lastMsg.append(msg_text);

				h_after = lastMsg.outerHeight();
				delta_h = h_after - h_before;
			} else {
				this.historyMerger.id = data.id;
				this.historyMerger.lastDay = day;

				msg_wrap.append(msg_text);
				msg_wrap.addClass('msg-'+id+'-'+day);

				var msg_time = msg_wrap.find(".time");
				msg_time.text(this.renderTimeMsg(data.time));

				this.msgMessages.find('.e-message-history-info').append(msg_wrap);
				delta_h = msg_wrap.outerHeight();
			}

			var scroll_height = this.msgMessages.scrollTop() + delta_h;
			this.msgMessages.scrollTop(scroll_height);

		} else {
			if (this.msgMessages.find('.e-message-history-info').children().length > 2) {
				var lastmsg = this.msgMessages.find('.e-message-history-info').children().last();
				if (lastmsg.data('id') == id) {
					var msg_time = lastmsg.find(".time");
					msg_time.text(this.renderTimeMsg(data.time));

					lastmsg.append(msg_text);
				} else {
					var msg_time = msg_wrap.find(".time");
					msg_time.text(this.renderTimeMsg(data.time));

					msg_wrap.append(msg_text);
					msg_wrap.data('id', id);
					this.msgMessages.find('.e-message-history-info').append(msg_wrap);
				}
			} else {
				var msg_time = msg_wrap.find(".time");
				msg_time.text(this.renderTimeMsg(data.time));

				msg_wrap.append(msg_text);
				msg_wrap.data('id', id);
				this.msgMessages.find('.e-message-history-info').append(msg_wrap);
			}
			this.scrollDown();
		}

		return true;
	},

	renderTimeMsg : function (datetime) {
		var msg_datetime = parseDate(datetime);
		var cur_datetime = new Date();
		var time = "";
		cur_datetime.setHours(0);
		cur_datetime.setMinutes(0);
		cur_datetime.setMilliseconds(0);

		if (msg_datetime < cur_datetime) {
			var year = msg_datetime.getFullYear().toString().substr(2);
			var month = msg_datetime.getMonth() + 1;
			var day = msg_datetime.getDate();

			if (month < 10) month = "0" + month;
			if (day < 10) day = "0" + day;

			time = day + "." + month + "." + year;
		} else {
			var hours = msg_datetime.getHours();
			var minutes = msg_datetime.getMinutes();
			var sec = msg_datetime.getSeconds();

			if (hours < 10) hours = "0" + hours;
			if (minutes < 10) minutes = "0" + minutes;
			if (sec < 10) hours = "0" + sec;

			// time = hours + ":" + minutes + ":" + sec;
			time = hours + ":" + minutes;
		}
		return time;
	},

	scrollDown : function () {
		var scroll_height = this.msgMessages.get()[0].scrollHeight;
		this.msgMessages.scrollTop(scroll_height);
	},

	saveState : function (id, msg) {
		if (arguments.length > 0) msg.id = id;
		var data = {
			common : {
				opened         : this.wOpened,
				threadId       : this.threadId,
				notReadCounter : this.notReadCounter,
				presence       : this.conf.contact.presence,
				status         : this.conf.contact.status
			}
		}
		var msgId = this.conf.user.id + "" + this.conf.contact.id;
		this.conf.renderTo.trigger("savestate", [msgId, data]);
	},

	/**
	 * Загрузка чата.
	 * @param object data
	 */
	loadState : function (data) {
		this.msgCounter = 0;
		this.notReadCounter = data.common.notReadCounter;

		if (localStorage.getItem("lastid") == this.conf.contact.id) {
			this.show(data.common.opened, false);
			this.queryHistory();
		}
		this.onPresence(data.common.presence, data.common.status);
	},

	changePosition : function (toright) {
		if (toright) {
			if (!this.msgWindow.hasClass('m-left-arrow'))
				this.msgWindow.addClass('m-left-arrow');
		} else {
			if (this.msgWindow.hasClass('m-left-arrow'))
				this.msgWindow.removeClass('m-left-arrow');
		}
	},

	setReaded : function (contact, unread) {
		var url = "/ajax/dialogs",
			unreadBlock = this.parent.parent.totalUnreadedBlock;

		if (unread > 0) {
			$.ajax({
				url      : url,
				data     : {
					action : "readed",
					user   : contact
				},
				type     : "post"
			});

			this.parent.parent.totalUnreadedCount -= unread;
			if (this.parent.parent.totalUnreadedCount > 0) {
				unreadBlock.text('+' + this.parent.parent.totalUnreadedCount);
			} else {
				unreadBlock.text(0).hide();
			}

		}
	},

	setReadedQuite : function (lastid) {
		$.ajax({
			url      : this.conf.historyUrl,
			data     : {
				action : "readed",
				user   : lastid
			},
			type     : "post"
		});
	},

	bindEvents : function () {
		var self = this;
		this.conf.renderTo.on({
			click : function (ev) {
				// console.log("bindEvents: renderTo");
				self.queryHistory();
				var visible = self.msgWindow.css("display") == 'none';
				var slow = true;
				self.show(visible, slow);
			}
		}, '.e-avatar-ramka');

		this.conf.renderTo.on({
			message       : function (ev, data, id) {
				ev.stopPropagation();
				self.onMessage(data, id);
			},
			history       : function (ev, data) {
				ev.stopPropagation();
				self.onHistory(data);
			},
			activity      : function (ev, activity) {
				ev.stopPropagation();
				self.changeActivity(activity);
			},
			presence      : function (ev, type, status) {
				ev.stopPropagation();
				self.onPresence(type, status);
			},
			showmsg       : function (ev, visible, slow) {
				ev.stopPropagation();
				self.wOpened = visible;

				if (self.msgWindow.data("visible") == visible) return true;

				if (slow) {
					if (!visible) {
						self.msgWindow.fadeOut();
					} else {
						self.msgWindow.fadeIn();
					}
				} else {
					self.msgWindow.css({
						"display" : visible ? 'block' : "none"
					});
					if (visible) {
						self.queryHistory();
					}
				}
				self.msgWindow.data("visible", visible);
			},
			scrolltotop   : function (ev) {
				ev.stopPropagation();
				// if (!self.historyFlags.requestingHistory && !self.historyFlags.isLastHistory) {
					// self.queryHistory();
				// }

			},
			loadstate     : function (ev, data) {
				ev.stopPropagation();
				self.loadState(data);
			},
			panelvisible  : function (ev, data) {
				ev.stopPropagation();
				self.panelVisible = data;

				// if (self.isVisible()) self.notReadCounter = 0;
				self.showNotReadMsg();

			},
			positionright : function (ev, toright) {
				ev.stopPropagation();

				self.changePosition(toright);
			},
			lockhistory   : function (ev) {
				ev.stopPropagation();
				self.historyFlags.requestingHistory = true;
			},
			setReaded: function (ev) {
				self.notReadCounter = 0;
				self.showNotReadMsg();
				self.setReadedQuite(self.conf.contact.id);
			}
		});

		this.msgMessages.on('mousewheel DOMMouseScroll', function (ev) {
			ev.preventDefault();
			ev.stopPropagation();

			var dir = (ev.originalEvent.wheelDelta < 0 || ev.originalEvent.detail > 0) ? 1 : -1;
			if (dir > 0) {
				self.msgMessages.scrollTop(self.msgMessages.scrollTop() + 30);
			} else {
				self.msgMessages.scrollTop(self.msgMessages.scrollTop() - 30);
			}

			if (self.msgMessages.scrollTop() == 0) {
				self.conf.renderTo.trigger("scrolltotop");
			}
		});

		this.msgMessages.on('scroll', function (ev) {
			ev.preventDefault();
			ev.stopPropagation();

			if (self.msgMessages.scrollTop() <= 30) {
				self.conf.renderTo.trigger("scrolltotop");
			}
		});

		this.msgText.on({
			keydown : function (ev) {
				ev.stopPropagation();

				var escape_chars = [
					9,   // Tab
					20,  // CapsLook
					17,  // Ctrl
					91,  // left S key
					18,  // Alt
					92,  // Right S key
					93,  // Right click key
					45,  // Insert
					36,  // Home
					35,  // End
					33,  // Page up
					34,  // Page down
					122, // F11
					121, // F10
					120, // F9
					119, // F8
					118, // F7
					117, // F6
					115, // F4
					114, // F3
					113, // F2
					112, // F1
					27,  // Escape
					19,  // Scroll Look
					145, // Pause Break
					32   // White Space
				];
				if ($.inArray(ev.which, escape_chars) > -1) return true;

				var msg = self.msgText.val();
				// msg = msg.trim();
				var is_empty = (msg.replace(/[\r\n\s]/gm, "")).length == 0;

				if (ev.which === 13 && !ev.shiftKey) {
					ev.preventDefault();
					self.msgText.val(null);

					if (!is_empty) {
						self.sendMessage.call(self, msg);
					} else {
						self.sendActivity('active');
					}
				} else {
					if (!is_empty) {
						self.sendActivity('composing');
					} else {
						self.sendActivity('active');
					}
				}
			}
		});

		// special events
		for (var param in this.conf.listeners) {
			switch (param) {
				case "scope":
					this.parent = this.conf.listeners["scope"];
					break;
				case "sendmessage":
					this.conf.renderTo.on({
						"sendmessage" : function (ev, msg) {
							ev.preventDefault();
							ev.stopPropagation();

							self.conf.listeners["sendmessage"].call(self.parent, self.conf.contact.id, msg);
						}
					});
					break;
				case "queryhistory":
					this.conf.renderTo.on({
						"queryhistory" : function (ev) {
							ev.preventDefault();
							ev.stopPropagation();

							self.conf.listeners["queryhistory"]
								.call(self.parent, self.conf.contact.id, self.historyFlags.lastMsgId);
						}
					});
					break;
				case "sendactivity":
					this.conf.renderTo.on({
						"sendactivity" : function (ev, activity) {
							ev.preventDefault();
							ev.stopPropagation();
							self.conf.listeners["sendactivity"].call(self.parent, self.conf.contact.id, activity);
						}
					});
					break;
				case "showmsg":
					this.conf.renderTo.on({
						"showmsg" : function (ev, visible, slow, trigger) {
							ev.preventDefault();
							ev.stopPropagation();

							// prevent loops
							if (!trigger && (self.msgWindow.data("visible") && visible
								|| !self.msgWindow.data("visible") && !visible)) return true;

							self.conf.listeners["showmsg"].call(self.parent, self.conf.contact.id, visible);
						}
					});
					break;
				case "readmsginfo":
					this.conf.renderTo.on({
						"readmsginfo" : function (ev, msgcount) {
							ev.preventDefault();
							ev.stopPropagation();

							self.conf.listeners["readmsginfo"].call(self.parent, self.conf.contact.id, msgcount);
						}
					});
					break;
				case "savestate":
					this.conf.renderTo.on({
						"savestate" : function (ev, msgid, data) {
							ev.preventDefault();
							ev.stopPropagation();

							self.conf.listeners["savestate"].call(self.parent, msgid, data);
						}
					});
			}
		}
	}
}

// Для удобства применения форматтеров. Здесь могут быть картинки и т.п.

ChatMessage = function (msg) {
	this.msg = msg + '';
}

ChatMessage.prototype = {
	get : function () {
		return this.msg;
	},

	nl2br : function () {
		this.msg = (this.msg).replace(/([^>\r\n]?)(\r\n|\n\r|\r|\n)/g, '$1<br />$2');
	},

	/**
	 * Create links or embed images
	 * @return {undefined}
	 */
	urlify: function (id) {
	    var urlRegex = /(https?:\/\/[^\s]+)/g;
	    this.msg = this.msg.replace(urlRegex, function(url) {
			var type = [],
				length = url.length,
				fixBr = '';

			url = url.replace('<br', '');

			type = url.split('.');
			type = type[type.length-1];

			if (url.length < length) {
				fixBr = '<br';
			}

			if (type === "png" || type === "jpg" || type === "gif") {
				if (!url.match(/dropbox/g)) {
					return '<a href="' + url + '" target="_blank" class="e-message-image"><img width="100%" src="' + url + '" onload="$(\'.b-big-chat-message-list\').trigger(\'imageLoaded\', [' + id + ', this]);"></a>'+fixBr;
				} else {
					return '<a href="' + url + '" target="_blank">' + url + '</a>'+fixBr;
				}
			} else {
				return '<a href="' + url + '" target="_blank">' + url + '</a>'+fixBr;
			}
	    });
	},

	smiles: function () {
		var map = {
			'angel': ['\\(A\\)', '\\(angel\\)'],
			'angry': ['\\(angry\\)', ':@', ':-@', ':=@', 'x\\(', 'x-\\(', 'X\\(', 'X-\\(', 'x=\\(', 'X=\\('],
			'arrogant': ['\\(arrogant\\)'],
			'beat-up': ['\\(beat-up\\)'],
			'cake': ['\\(\\^\\)', '\\(cake\\)'],
			'clap': ['\\(clap\\)'],
			'coffee': ['\\(coffee\\)'],
			'cute': ['\\(cute\\)'],
			'dance': ['\\\\o\\/', '\\\\:D\\/', '\\\\:d/', '\\(dance\\)'],
			'dazed': ['\\(dazed\\)'],
			'desire': ['\\(desire\\)'],
			'disapointed': ['\\(disapointed\\)'],
			'good': ['\\(y\\)'],
			'in-love': ['\\(inlove\\)'],
			'mobile': ['\\(mobile\\)'],
			'party': ['<O\\)', '<o\\)', '\\(party\\)'],
			'plate': ['\\(plate\\)'],
			'present': ['\\(present\\)'],
			'question': ['\\(question\\)'],
			'rose': ['\\(F\\)', '\\(f\\)', '\\(flower\\)'],
			'sad': [':\\(', ':-\\(', ':=\\(', '\\(sad\\)'],
			'shock': [':O', ':-O', ':=O', ':o', ':-o', ':=o', '\\(surprised\\)'],
			'sick': ['\\(sick\\)'],
			'sleepy': ['\\(sleepy\\)'],
			'smilling': [':\\)', ':-\\)', ':=\\)', '\\(smile\\)', ':D', ':=D', ':d', ':-d', ':=d', '\\(laugh\\)'],
			'tongue': [':P', ':-P', ':=P', ':p', ':-p', ':=p', '\\(tongueout\\)']
		};

		for (var smile in map) {
			if (map.hasOwnProperty(smile)) {
				this.msg = this.msg.replace(new RegExp(map[smile].join('|'), 'ig'), function(match) {
					return '<i class="b-icon m-smile m-'+smile+'"></i>';
				});
			}
		}
	},

	xss: function () {
		this.msg = (this.msg).replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}
}