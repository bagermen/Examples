/**
 * Created with JetBrains PhpStorm.
 * User: roma
 * Date: 01.06.13
 * Time: 2:26
 */
// Note: нужен файл Tools.js (с вспомогательными функциями)
WebCache = function(config) {
    this._initParams(config);
    this._init();
}

WebCache.prototype = {
    pieces: undefined,
    _initParams: function(config) {
        this.conf = {
            num: 1,
            storage: 'auto',
            name: 'cache'
        }
        Tools.apply(this.conf, config);

        this.storage.self = this;
        var storages = ["local", "session", "coockie", "auto"];
        if (storages.indexOf(this.conf.storage) == -1) {
            this.conf.storage == "auto";
        }

        if (this.conf.storage === "auto") {
            if (Tools.isLocalStorageAvailable()) {
                this.conf.storage = "session";
            } else {
                this.conf.storage = "cookie";
            }
        }
    },

    _init: function() {
        var cache = this.storage.getItem(this.conf.name);
        if (!cache) {
            this.storage.setItem(this.conf.name, this._encode([]));
            this.pieces = [];
        } else {
            this.pieces = this._decode(cache);
        }
    },
    save: function(id, data, num) {
        if (num === undefined || isNaN(num) || num == 0) num = this.conf.num;
        if (!data) return false;

        var piece = this._fiendPiece(id);
        try {
            if (piece.length == 0) {
                piece = this._createPiece(id);
            }
            var itemId = Tools.uniqid(id);
            if (this._saveData(itemId, data)) {
                piece.batch.unshift(itemId);
            }
            this._updateWebCache();
            this._deleteOldData(piece, num);
        } catch (e) {
            return false;
        }
        return true;
    },

    read: function(id, num) {
        var piece = this._fiendPiece(id);
        if (piece.length == 0) return [];
        var ret = [];
        if (num === undefined || isNaN(num) || num === "all") num = piece.batch.length;
        for (var i = 0; i < num; i++) {
            var itemId = piece.batch[i];
            var raw_data = this.storage.getItem(itemId);
            ret.push(this._decode(raw_data));
        }
        return ret;
    },

    clean: function(id) {
        if (arguments.length > 0) {
            var piece = this._fiendPiece(id);
            if (piece)
                return this._deletePiece(piece);
        } else {
            var ret = false;
            while (this.pieces.length > 0) {
                ret = this._deletePiece(this.pieces[0]);
                if (ret == false) break;
            }
            return ret;
        }
    },

    _deletePiece: function(piece) {
        try {
            for (var i = 0; i < piece.batch.length; i++) {
                this.storage.removeItem(piece.batch[i]);
            }
            var ind = this.pieces.indexOf(piece);
            this.pieces.splice(ind, 1);
            this._updateWebCache();
        } catch(e) {
            return false;
        }
        return true;
    },

    _fiendPiece: function(id) {
        var found_piece = [];

        for (var i = 0; i < this.pieces.length; i++) {
            if (this.pieces[i].id === id) {
                found_piece = this.pieces[i];
                break;
            }
        }
        return found_piece;
    },

    _createPiece: function(id) {
        var piece = {
            id: id,
            batch: []
        }
        this.pieces.push(piece);
        return piece;
    },

    _updateWebCache: function() {
        this.storage.setItem(this.conf.name, this._encode(this.pieces));
    },

    _saveData: function(itemId, data) {
        var encoded = this._encode(data);
        try {
            this.storage.setItem(itemId, encoded);
        } catch (e) {
            return false;
        }
        return true;
    },

    _deleteOldData: function(piece, num) {
        if (num >= piece.batch.length) return true;

        for (var i = num; i < piece.batch.length; i++) {
            this.storage.removeItem(piece.batch[i]);
        }

        var to_remove = piece.batch.length - num;
        piece.batch.splice(num, to_remove);

        this._updateWebCache();
    },

    _encode: function(val) {
        return encodeURI(JSON.stringify(val));
    },

    _decode: function(val) {
        return val ? JSON.parse(decodeURI(val)) : undefined;
    },

    storage: {
        self: undefined,

        setItem: function(val, data) {
            return this[this.self.conf.storage + "SetItem"](val, data);
        },

        getItem: function(val) {
            return this[this.self.conf.storage + "GetItem"](val);
        },

        removeItem: function(val) {
            return this[this.self.conf.storage + "RemoveItem"](val);
        },

        localSetItem: function(val, data) {
            return localStorage.setItem(encodeURI(val), this.self._encode(data));
        },
        sessionSetItem: function(val, data) {
            return sessionStorage.setItem(encodeURI(val), this.self._encode(data));
        },
        coockieSetItem: function(val, data) {
            if(!val) { return; }
            var exp_date = (new Date());
            exp_date.setYear(exp_date.getYear() + 30);
            document.cookie = encodeURI(val) + "=" + this.self._encode(data) +
                "; expires="+ exp_date.toUTCString() + "; path=/";
        },
        localGetItem: function(val) {
            return this.self._decode(localStorage.getItem(encodeURI(val)));
        },
        sessionGetItem: function(val) {
            return this.self._decode(sessionStorage.getItem(encodeURI(val)));
        },
        coockieGetItem: function(val) {
            var re = new RegExp("(?:^|(?:;\\s))" + encodeURI(val) + "\\=(.*?)(?:$|(?:;\\s))");
            var cookie = document.cookie;
            var found = (re.exec(cookie));

            return found ? this.self._decode(found[1]) : "";
        },
        localRemoveItem: function(val) {
            return localStorage.removeItem(encodeURI(val));
        },
        sessionRemoveItem: function(val) {
            return sessionStorage.removeItem(encodeURI(val));
        },
        coockieRemoveItem: function(val) {
            if(!val) { return; }
            var v = encodeURI(val) + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
            document.cookie = v;
        }
    }
}