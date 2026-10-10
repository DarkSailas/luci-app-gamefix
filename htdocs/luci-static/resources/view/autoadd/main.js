'use strict';
'require view';
'require rpc';
'require poll';
'require ui';
'require dom';

var callStatus = rpc.declare({ object: 'autoadd', method: 'status', params: [ 'all', 'all_added' ], expect: { '': {} } });
var callAdd = rpc.declare({ object: 'autoadd', method: 'add', params: [ 'ip', 'note', 'domain' ], expect: { '': {} } });
var callDel = rpc.declare({ object: 'autoadd', method: 'del', params: [ 'ip' ], expect: { '': {} } });
var callIgnore = rpc.declare({ object: 'autoadd', method: 'ignore', params: [ 'ip' ], expect: { '': {} } });
var callUnignore = rpc.declare({ object: 'autoadd', method: 'unignore', params: [ 'ip' ], expect: { '': {} } });
var callDevices = rpc.declare({ object: 'autoadd', method: 'devices', expect: { '': {} } });
var callSetDevice = rpc.declare({ object: 'autoadd', method: 'set_device', params: [ 'mac', 'ip', 'name', 'static', 'watch' ], expect: { '': {} } });
var callSetAuto = rpc.declare({ object: 'autoadd', method: 'set_auto', params: [ 'auto' ], expect: { '': {} } });
var callCheckUpdate = rpc.declare({ object: 'autoadd', method: 'check_update', expect: { '': {} } });
var callUpdate = rpc.declare({ object: 'autoadd', method: 'update', expect: { '': {} } });
var callSetAutoupdate = rpc.declare({ object: 'autoadd', method: 'set_autoupdate', params: [ 'auto' ], expect: { '': {} } });

// must match VERSION in /usr/sbin/autoaddd: a mismatch means the browser runs a cached copy of this file
var VIEW_VERSION = '3.0.9';
var RELOAD_KEY = 'autoadd.reload';

// short label and colour of a candidate status; the full text goes below it
var STATUS_PILL = {
	'new': [ 'ждёт проверки', '' ],
	'udp': [ 'наблюдение', 'warn' ],
	'p2p': [ 'похоже на торрент', '' ],
	'udp_bad': [ 'прокси не помог', 'bad' ],
	'udp_wait': [ 'проба не подтверждена', '' ],
	'maybe': [ 'через прокси отвечает', 'warn' ],
	'suspect': [ 'спорный', 'warn' ],
	'dead': [ 'не отвечает', '' ],
	'direct_ok': [ 'доступен напрямую', 'ok' ],
	'blocked': [ 'заблокирован', 'bad' ]
};

var STATUS = {
	'new': 'ждёт проверки',
	'udp': 'наблюдение: добавится сам, если запросы без ответа продолжатся',
	'p2p': 'устройство обменивается с адресами из десятков разных сетей сразу, похоже на торрент — сам не добавляется',
	'udp_bad': 'пробовали: через прокси сервер тоже не отвечает',
	'udp_wait': 'пробовали: устройство перестало обращаться к серверу, повторная проба не раньше чем через час',
	'maybe': 'напрямую нет, через прокси отвечает (не TLS)',
	'suspect': 'TCP напрямую открывается, проверка TLS с роутера не проходит — решите сами',
	'dead': 'не отвечает ни напрямую, ни через прокси',
	'direct_ok': 'напрямую доступен',
	'blocked': 'заблокирован, но автодобавление выключено или достигнут предел'
};

var KIND = {
	'syn': 'нет ответа на SYN',
	'stall': 'соединение зависло',
	'cut': 'передача оборвалась',
	'udp': 'сервер игры или голосовой связи не отвечает (UDP)'
};

var OPEN_KEY = 'autoadd.sections';
var OPEN_DEFAULT = { 'added': true, 'cands': true, 'log': true };
// 100% on the page is the theme size times ZOOM_BASE; the key was renamed when the base changed
var ZOOM_KEY = 'autoadd.scale';
var ZOOM_BASE = 1.25;
var ZOOM_MIN = 70, ZOOM_MAX = 150, ZOOM_STEP = 10;

var CHEVRON = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">' +
	'<path d="M3.5 6l4.5 4.5L12.5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

var CSS = [
	'.aa-page { font-size:14px; line-height:1.45; }',
	'.aa-page h2 { font-size:18px; margin:0 0 .3em; }',
	'.aa-page .aa-top { display:flex; align-items:center; justify-content:space-between; gap:.6em; flex-wrap:wrap; margin:0 0 .3em; }',
	'.aa-page .aa-top h2 { margin:0; }',
	'.aa-zoom { display:inline-flex; align-items:center; gap:.5em; font-size:12px; }',
	'.aa-zoom-box { display:inline-flex; border:1px solid rgba(128,128,128,.45); border-radius:6px; background:rgba(128,128,128,.10); overflow:hidden; }',
	'.aa-page .aa-zoom-box button { all:unset; box-sizing:border-box; min-width:2.2em; height:26px; padding:0 .6em; font-size:12px; line-height:26px;',
	'  text-align:center; cursor:pointer; color:inherit; }',
	'.aa-page .aa-zoom-box button + button { border-left:1px solid rgba(128,128,128,.45); }',
	'.aa-page .aa-zoom-box button.aa-zoom-cur { min-width:3.8em; font-variant-numeric:tabular-nums; }',
	'.aa-page .aa-zoom-box button:hover:not(:disabled), .aa-page .aa-zoom-box button:focus-visible { color:#8ef5b5; background:rgba(142,245,181,.10); }',
	'.aa-page .aa-zoom-box button:disabled { opacity:.35; cursor:default; }',
	'.aa-sum { margin:0 0 .7em; border:1px solid rgba(128,128,128,.28); border-radius:10px; background:rgba(128,128,128,.05); }',
	'.aa-sum-top { display:flex; flex-wrap:wrap; align-items:center; gap:.6em 1.8em; padding:.7em .9em; }',
	'.aa-state { display:flex; align-items:center; gap:.7em; margin-right:auto; }',
	'.aa-dot { flex:0 0 auto; width:.6em; height:.6em; border-radius:50%; background:#8ef5b5; box-shadow:0 0 0 3px rgba(142,245,181,.18); }',
	'.aa-state-off .aa-dot { background:#f0b45a; box-shadow:0 0 0 3px rgba(240,180,90,.18); }',
	'.aa-state-t { font-size:14px; font-weight:600; white-space:nowrap; }',
	'.aa-state-off .aa-state-t { color:#f0b45a; }',
	'.aa-figs { display:flex; flex-wrap:wrap; gap:.3em 1.8em; }',
	'.aa-fig { display:flex; align-items:baseline; gap:.45em; white-space:nowrap; }',
	'.aa-fig b { font-size:18px; font-weight:600; font-variant-numeric:tabular-nums; }',
	'.aa-fig span { font-size:12px; opacity:.65; }',
	'.aa-sum-foot { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:baseline; gap:.3em 1.8em;',
	'  padding:.5em .9em; border-top:1px solid rgba(128,128,128,.2); font-size:12px; }',
	'.aa-sum-foot > div { min-width:0; overflow-wrap:anywhere; }',
	'.aa-k { margin-right:.7em; font-size:11px; letter-spacing:.04em; text-transform:uppercase; opacity:.6; white-space:nowrap; }',
	'.aa-sum-foot .aa-sub { margin-left:.5em; }',
	'.aa-pill { display:inline-block; padding:.05em .6em; margin:0 .3em .15em 0; border-radius:999px; font-size:11px; line-height:1.5; white-space:nowrap;',
	'  border:1px solid rgba(128,128,128,.4); background:rgba(128,128,128,.10); }',
	'.aa-pill-ok { border-color:rgba(142,245,181,.5); background:rgba(142,245,181,.10); color:#8ef5b5; }',
	'.aa-pill-addr { border-color:rgba(120,180,240,.5); background:rgba(120,180,240,.10); color:#8ec5f5; }',
	'.aa-pill-warn { border-color:rgba(240,180,90,.5); background:rgba(240,180,90,.10); color:#f0b45a; }',
	'.aa-pill-bad { border-color:rgba(240,120,120,.5); background:rgba(240,120,120,.10); color:#f08a8a; }',
	'.aa-pills { display:inline-flex; flex-wrap:wrap; gap:4px; align-items:center; }',
	'.aa-pills .aa-pill { margin:0; }',
	'.aa-count { display:inline-block; min-width:1.6em; padding:0 .5em; margin-left:.4em; border-radius:999px; font-size:12px; font-weight:600; text-align:center;',
	'  background:rgba(142,245,181,.14); color:#8ef5b5; }',
	'.aa-main { font-weight:600; color:inherit; }',
	'.aa-sub { font-size:11px; opacity:.65; }',
	'.aa-num { font-variant-numeric:tabular-nums; }',
	'.aa-page .table .tr:hover .td { background:rgba(142,245,181,.05); }',
	'.aa-page .cbi-map-descr { font-size:12px; opacity:.7; margin:0 0 .8em; }',
	'.aa-page .aa-sec { margin:0 0 .6em; padding:.5em .8em; }',
	'.aa-head { display:flex; align-items:center; gap:.5em; cursor:pointer; user-select:none; }',
	'.aa-page .aa-head h3 { margin:0; padding:0; border:0; flex:1 1 auto; min-width:0; font-size:14px; line-height:1.4; font-weight:600; }',
	'.aa-chev { display:inline-flex; align-items:center; justify-content:center; flex:0 0 auto; width:20px; height:20px;',
	'  border-radius:50%; border:1px solid rgba(128,128,128,.35); opacity:.75;',
	'  transition:transform .18s ease, color .18s ease, border-color .18s ease, opacity .18s ease; }',
	'.aa-head:hover .aa-chev, .aa-head:focus-visible .aa-chev { color:#8ef5b5; border-color:#8ef5b5; opacity:1; }',
	'.aa-sec.aa-closed .aa-chev { transform:rotate(-90deg); }',
	'.aa-sec.aa-closed .aa-body { display:none; }',
	'.aa-body { margin-top:.5em; }',
	'.aa-body > :last-child { margin-bottom:0; }',
	'.aa-note { opacity:.6; font-size:12px; font-weight:normal; }',
	'.aa-page p { margin:0 0 .5em; }',
	'.aa-hint { font-size:12px; opacity:.7; }',
	'.aa-bar { display:flex; flex-wrap:wrap; align-items:center; gap:.4em .6em; margin:0 0 .5em; }',
	'.aa-upd { border:1px solid rgba(128,128,128,.35); border-radius:6px; padding:.6em .8em; margin:0 0 .8em; }',
	'.aa-upd-new { border-color:#8ef5b5; }',
	'.aa-upd > :last-child { margin-bottom:0; }',
	'.aa-upd-auto { margin-left:auto; padding:.15em .7em; border-radius:999px; border:1px solid rgba(128,128,128,.45); background:rgba(128,128,128,.10); font-size:12px; }',
	'.aa-upd-auto::before { content:""; display:inline-block; width:.55em; height:.55em; margin-right:.45em; border-radius:50%; background:rgba(128,128,128,.7); }',
	'.aa-upd-auto-on { border-color:rgba(142,245,181,.5); background:rgba(142,245,181,.10); }',
	'.aa-upd-auto-on::before { background:#8ef5b5; }',
	'.aa-scroll { overflow-x:auto; }',
	'.aa-page .table { margin:0; width:100%; max-width:100%; }',
	'.aa-page .table .th, .aa-page .table .td { padding:.3em .5em; font-size:12px; line-height:1.35; vertical-align:middle; }',
	'.aa-page .table .th { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }',
	'.aa-page .table .td { overflow-wrap:anywhere; }',
	'.aa-page .btn { box-sizing:border-box; display:inline-flex; align-items:center; justify-content:center; height:26px !important; min-height:0 !important;',
	'  margin:0 !important; padding:0 .8em !important; font-size:12px !important; font-weight:500 !important; line-height:1 !important; white-space:nowrap;',
	'  text-transform:none !important; text-shadow:none !important; box-shadow:none !important; background-image:none !important;',
	'  border:1px solid rgba(128,128,128,.45) !important; border-radius:6px !important; background:rgba(128,128,128,.10) !important; color:inherit !important;',
	'  cursor:pointer; transition:color .15s ease, border-color .15s ease, background-color .15s ease; }',
	'.aa-page .btn:hover:not(:disabled), .aa-page .btn:focus-visible { border-color:#8ef5b5 !important; color:#8ef5b5 !important; background:rgba(142,245,181,.10) !important; }',
	'.aa-page .btn.cbi-button-action, .aa-page .btn.cbi-button-apply, .aa-page .btn.cbi-button-add {',
	'  border-color:rgba(142,245,181,.5) !important; background:rgba(142,245,181,.12) !important; color:#8ef5b5 !important; }',
	'.aa-page .btn.cbi-button-action:hover:not(:disabled), .aa-page .btn.cbi-button-apply:hover:not(:disabled), .aa-page .btn.cbi-button-add:hover:not(:disabled) {',
	'  border-color:#8ef5b5 !important; background:rgba(142,245,181,.22) !important; }',
	'.aa-page .btn.cbi-button-remove { border-color:rgba(240,120,120,.5) !important; background:rgba(240,120,120,.10) !important; color:#f08a8a !important; }',
	'.aa-page .btn.cbi-button-remove:hover:not(:disabled) { border-color:#f08a8a !important; background:rgba(240,120,120,.20) !important; color:#f08a8a !important; }',
	'.aa-page .btn:disabled, .aa-page .btn.spinning { opacity:.5; cursor:default; }',
	'.aa-acts { display:flex; flex-wrap:nowrap; gap:4px; align-items:center; justify-content:flex-end; }',
	'.aa-acts .btn { height:24px !important; min-height:0 !important; padding:0 .55em !important; font-size:11px !important; }',
	'.aa-page input[type="text"], .aa-page textarea { box-sizing:border-box; margin:0 !important; font-size:12px !important; box-shadow:none !important;',
	'  border:1px solid rgba(128,128,128,.45) !important; border-radius:6px !important; background:rgba(128,128,128,.10) !important; color:inherit !important;',
	'  outline:none; transition:border-color .15s ease, background-color .15s ease; }',
	'.aa-page input[type="text"] { height:26px !important; min-height:0 !important; padding:0 .6em !important; line-height:24px !important; }',
	'.aa-page textarea { width:100%; padding:.5em .6em !important; line-height:1.4; font-family:monospace; }',
	'.aa-page input[type="text"]:focus, .aa-page textarea:focus { border-color:#8ef5b5 !important; background:rgba(142,245,181,.06) !important; }',
	'.aa-page input[type="text"]::placeholder { color:inherit; opacity:.45; }',
	'.aa-page input[type="checkbox"] { -webkit-appearance:none !important; appearance:none !important; position:relative; display:inline-block; flex:0 0 auto;',
	'  box-sizing:border-box; width:34px !important; height:18px !important; min-width:0 !important; min-height:0 !important; margin:0 !important; padding:0 !important;',
	'  border:1px solid rgba(128,128,128,.45) !important; border-radius:999px !important; background:rgba(128,128,128,.10) !important; box-shadow:none !important; outline:none;',
	'  vertical-align:middle; cursor:pointer; transition:border-color .15s ease, background-color .15s ease; }',
	'.aa-page input[type="checkbox"]::before { content:"" !important; position:absolute !important; top:2px !important; left:2px !important; right:auto !important;',
	'  width:12px !important; height:12px !important; margin:0 !important; border:0 !important; border-radius:50% !important; opacity:1 !important;',
	'  background:rgba(160,160,160,.9) !important; box-shadow:none !important; transform:none !important; transition:left .15s ease, background-color .15s ease; }',
	'.aa-page input[type="checkbox"]::after { content:none !important; display:none !important; }',
	'.aa-page input[type="checkbox"]:checked { border-color:rgba(142,245,181,.6) !important; background:rgba(142,245,181,.18) !important; }',
	'.aa-page input[type="checkbox"]:checked::before { left:18px !important; background:#8ef5b5 !important; }',
	'.aa-page input[type="checkbox"]:focus-visible { border-color:#8ef5b5 !important; }',
	'.aa-page input[type="checkbox"]:disabled { opacity:.45; cursor:default; }'
].join('\n');

function fmtTime(t) {
	if (!t)
		return '-';
	var d = new Date(t * 1000);
	var p = function(n) { return (n < 10 ? '0' : '') + n; };
	return p(d.getDate()) + '.' + p(d.getMonth() + 1) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

// "сегодня 15:07", "вчера 23:24", "04.10 20:06"; the full time is in the tooltip
function fmtShort(t) {
	if (!t)
		return '—';
	var d = new Date(t * 1000), n = new Date();
	var p = function(x) { return (x < 10 ? '0' : '') + x; };
	var day = function(x) { return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };
	var ago = Math.round((day(n) - day(d)) / 86400000);
	var hm = p(d.getHours()) + ':' + p(d.getMinutes());
	return E('span', { 'class': 'aa-num', 'title': fmtTime(t) },
		(ago == 0 ? 'сегодня ' : ago == 1 ? 'вчера ' : p(d.getDate()) + '.' + p(d.getMonth() + 1) + ' ') + hm);
}

function pill(text, tone, title) {
	return E('span', { 'class': 'aa-pill' + (tone ? ' aa-pill-' + tone : ''), 'title': title || '' }, text);
}

// first clause of the reason as the headline, the rest below it; curl code stays in the tooltip
function fmtWhy(why) {
	if (!why)
		return '';
	var s = why.replace(/\s*\(rc=\d+\)/g, '');
	var i = s.search(/[,;]\s/);
	var head = i < 0 ? s : s.substring(0, i);
	var tail = i < 0 ? '' : s.substring(i + 1).trim();
	return E('div', { 'title': why }, [
		E('div', {}, head.charAt(0).toUpperCase() + head.substring(1)),
		tail ? E('div', { 'class': 'aa-sub' }, tail) : ''
	]);
}

function act(promise) {
	return promise.then(function(r) {
		if (!r || r.ok !== true)
			ui.addNotification(null, E('p', (r && r.error) ? r.error : 'Служба autoadd не ответила'), 'error');
		return !!r && r.ok === true;
	}).catch(function(e) {
		ui.addNotification(null, E('p', 'Ошибка: ' + e.message), 'error');
	});
}

function btn(title, cls, fn) {
	return E('button', { 'class': 'btn cbi-button ' + cls, 'click': ui.createHandlerFn(null, fn) }, title);
}

function fmtName(n) {
	if (!n)
		return E('em', { 'style': 'opacity:.5' }, 'неизвестен');
	if (n.indexOf('ptr:') == 0)
		return E('span', { 'style': 'opacity:.7', 'title': 'Обратная запись DNS (PTR): имя узла у владельца адреса, не домен сервиса' }, n.substring(4) + ' (PTR)');
	return E('span', { 'title': 'Имя из DNS-ответа, по которому устройство в сети получило этот адрес' }, n);
}

function table(head, rows, empty, widths) {
	var t = E('table', { 'class': 'table', 'style': 'table-layout:fixed; width:100%' }, [
		E('tr', { 'class': 'tr table-titles' }, head.map(function(h, i) {
			return E('th', { 'class': 'th', 'style': 'width:' + widths[i], 'title': h }, h);
		}))
	]);
	if (!rows.length)
		t.appendChild(E('tr', { 'class': 'tr placeholder' }, E('td', { 'class': 'td', 'colspan': head.length }, E('em', empty))));
	rows.forEach(function(r) {
		t.appendChild(E('tr', { 'class': 'tr' }, r.map(function(c) {
			return E('td', { 'class': 'td' }, c);
		})));
	});
	return E('div', { 'class': 'aa-scroll' }, t);
}

return view.extend({
	showAll: false,
	showAllAdded: false,
	lastKey: null,
	open: null,

	isOpen: function(key) {
		if (!this.open) {
			this.open = Object.assign({}, OPEN_DEFAULT);
			try {
				var s = JSON.parse(window.localStorage.getItem(OPEN_KEY));
				if (s && typeof s == 'object')
					Object.assign(this.open, s);
			} catch (e) {}
		}
		return !!this.open[key];
	},

	setOpen: function(key, on) {
		this.isOpen(key);
		this.open[key] = on;
		try {
			window.localStorage.setItem(OPEN_KEY, JSON.stringify(this.open));
		} catch (e) {}
	},

	getZoom: function() {
		var z = 100;
		try {
			z = parseInt(window.localStorage.getItem(ZOOM_KEY), 10);
		} catch (e) {}
		if (!(z >= ZOOM_MIN && z <= ZOOM_MAX))
			z = 100;
		return z;
	},

	// page scale, kept in the browser; limited to ZOOM_MIN..ZOOM_MAX percent
	zoomBar: function(page) {
		var self = this;
		// plain handler: ui.createHandlerFn re-enables the button and would undo the limits
		var zbtn = function(title, fn) {
			return E('button', { 'type': 'button', 'click': fn }, title);
		};
		var cur = zbtn('', function() { set(100); });
		var less = zbtn('\u2212', function() { set(self.getZoom() - ZOOM_STEP); });
		var more = zbtn('+', function() { set(self.getZoom() + ZOOM_STEP); });
		var show = function(z) {
			page.style.zoom = String(Math.round(z * ZOOM_BASE) / 100);
			cur.textContent = z + '%';
			less.disabled = z <= ZOOM_MIN;
			more.disabled = z >= ZOOM_MAX;
		};
		var set = function(z) {
			z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
			try {
				window.localStorage.setItem(ZOOM_KEY, String(z));
			} catch (e) {}
			show(z);
		};
		cur.title = 'Вернуть 100%';
		less.title = 'Мельче';
		more.title = 'Крупнее';
		cur.className = 'aa-zoom-cur';
		show(this.getZoom());
		return E('div', { 'class': 'aa-zoom' }, [
			E('span', {}, 'Масштаб'),
			E('div', { 'class': 'aa-zoom-box' }, [ less, cur, more ])
		]);
	},

	// after an update the browser may keep the old copy of this file: fetch it past the cache and reload once
	staleReload: function(st) {
		if (!st || !st.version || st.version == VIEW_VERSION)
			return false;
		try {
			if (window.sessionStorage.getItem(RELOAD_KEY) == st.version)
				return false;
			window.sessionStorage.setItem(RELOAD_KEY, st.version);
		} catch (e) {
			return false;
		}
		var url = L.env.base_url + '/view/autoadd/main.js' + (L.env.resource_version ? '?v=' + L.env.resource_version : '');
		window.fetch(url, { cache: 'reload' }).catch(function() {}).then(function() {
			window.location.reload();
		});
		return true;
	},

	// collapsible section; the state survives re-rendering and page reloads
	section: function(key, title, content, note, count) {
		var self = this;
		var chev = E('span', { 'class': 'aa-chev' });
		chev.innerHTML = CHEVRON;
		var sec = E('div', { 'class': 'cbi-section aa-sec' + (self.isOpen(key) ? '' : ' aa-closed') });
		var toggle = function() {
			var on = !self.isOpen(key);
			self.setOpen(key, on);
			sec.classList.toggle('aa-closed', !on);
			head.setAttribute('aria-expanded', on ? 'true' : 'false');
		};
		var head = E('div', {
			'class': 'aa-head', 'role': 'button', 'tabindex': '0',
			'aria-expanded': self.isOpen(key) ? 'true' : 'false',
			'title': 'Свернуть или развернуть',
			'click': toggle,
			'keydown': function(ev) {
				if (ev.key == 'Enter' || ev.key == ' ') {
					ev.preventDefault();
					toggle();
				}
			}
		}, [ chev, E('h3', {}, [
			title,
			count != null ? E('span', { 'class': 'aa-count' }, String(count)) : '',
			note ? ' ' : '',
			note ? E('span', { 'class': 'aa-note' }, note) : ''
		]) ]);
		sec.appendChild(head);
		sec.appendChild(E('div', { 'class': 'aa-body' }, content));
		return sec;
	},

	load: function() {
		return Promise.all([
			callStatus(this.showAll, this.showAllAdded).catch(function() { return null; }),
			callDevices().catch(function() { return null; })
		]);
	},

	// quiet: background refresh, skipped while the user has unsaved edits or types in the list
	refreshDevices: function(quiet) {
		var self = this;
		return callDevices().catch(function() { return null; }).then(function(dv) {
			var root = document.getElementById('autoadd-dev');
			if (!root)
				return;
			var key = JSON.stringify(dv);
			if (quiet && (!dv || self.devDirty || key === self.devKey || root.contains(document.activeElement)))
				return;
			self.devKey = key;
			self.devDirty = false;
			dom.content(root, self.devices(dv));
		});
	},

	devices: function(dv) {
		var self = this;

		if (!dv || dv.ok !== true)
			return E('em', 'Список устройств недоступен');

		var row = function(d) {
			var name = E('input', { 'class': 'cbi-input-text', 'type': 'text', 'style': 'width:100%', 'value': d.name || '', 'placeholder': 'без имени' });
			var ip = E('input', { 'class': 'cbi-input-text', 'type': 'text', 'style': 'width:100%', 'value': d.ip });
			var st = E('input', { 'type': 'checkbox' });
			var watch = E('input', { 'type': 'checkbox' });
			st.checked = d.static;
			watch.checked = d.watch;
			if (!d.mac)
				name.disabled = ip.disabled = st.disabled = true;
			watch.addEventListener('change', function() { if (watch.checked) st.checked = true; });
			st.addEventListener('change', function() { if (!st.checked) watch.checked = false; });

			// the switches do not apply by themselves: say so next to the button, errors go there too
			var msg = E('div', { 'class': 'aa-hint' });
			var say = function(text, bad) {
				msg.textContent = text;
				msg.style.color = bad ? '#e5534b' : '';
			};
			var dirty = function() {
				self.devDirty = true;
				say('не сохранено', false);
			};
			[ name, ip ].forEach(function(el) { el.addEventListener('input', dirty); });
			[ st, watch ].forEach(function(el) { el.addEventListener('change', dirty); });

			var note = [];
			if (!d.mac)
				note.push('устройство неизвестно, можно только снять отслеживание');
			else if (d.static && d.lease_ip && d.lease_ip != d.static_ip)
				note.push('сейчас у устройства ' + d.lease_ip + ', новый адрес оно получит после переподключения');
			else if (!d.lease_ip)
				note.push('не в сети');

			return [
				name,
				d.mac || '-',
				E('div', {}, [ ip, note.length ? E('div', { 'class': 'aa-hint' }, note.join('; ')) : '' ]),
				st,
				watch,
				E('div', {}, [
					btn('Сохранить', 'cbi-button-apply', function() {
						return callSetDevice(d.mac || '', ip.value.trim(), name.value.trim(), st.checked, watch.checked).then(function(r) {
							if (!r || r.ok !== true) {
								say((r && r.error) ? r.error : 'служба autoadd не ответила', true);
								return;
							}
							return self.refreshDevices().then(function() { self.lastKey = null; return self.refresh(); });
						}).catch(function(e) {
							say('ошибка: ' + e.message, true);
						});
					}),
					msg
				])
			];
		};

		var all = dv.devices || [];
		var head = [ 'Имя', 'MAC', 'Адрес', 'Закрепить', 'Отслеживать', '' ];
		var widths = [ '22%', '17%', '25%', '11%', '13%', '12%' ];
		var watched = all.filter(function(d) { return d.watch; });
		var rest = all.filter(function(d) { return !d.watch; });
		var restBox = E('div', { 'style': self.devOpen ? '' : 'display:none' },
			table(head, rest.map(row), 'Других устройств нет', widths));
		var toggle = E('button', { 'class': 'btn cbi-button cbi-button-neutral', 'click': function(ev) {
			self.devOpen = !self.devOpen;
			restBox.style.display = self.devOpen ? '' : 'none';
			ev.currentTarget.textContent = (self.devOpen ? 'Скрыть' : 'Показать') + ' остальные устройства (' + rest.length + ')';
			ev.currentTarget.blur();
		} }, (self.devOpen ? 'Скрыть' : 'Показать') + ' остальные устройства (' + rest.length + ')');

		return [
			E('p', { 'class': 'aa-hint' },
				'«Закрепить» — роутер всегда выдаёт устройству этот адрес (сеть ' + (dv.lan || '?') + '). «Отслеживать» — неудачные подключения устройства попадают в кандидаты; для этого адрес закрепляется. При изменении закрепления перезапускается DHCP/DNS роутера (доля секунды).'),
			table(head, watched.map(row), 'Отслеживаемых устройств нет — откройте список ниже и отметьте нужные', widths),
			E('div', { 'class': 'aa-bar', 'style': 'margin-top:.5em' }, [
				toggle,
				btn('Обновить список', 'cbi-button-neutral', function() { return self.refreshDevices(); })
			]),
			restBox
		];
	},

	refresh: function() {
		var self = this;
		return callStatus(this.showAll, this.showAllAdded).catch(function() { return null; }).then(function(st) {
			var key = self.stateKey(st);
			if (key === self.lastKey)
				return;
			self.lastKey = key;
			var root = document.getElementById('autoadd-root');
			if (root)
				dom.content(root, self.body(st));
			var upd = document.getElementById('autoadd-upd');
			if (upd)
				dom.content(upd, self.updateBar(st));
		});
	},

	// version and update controls, always visible at the top of the page
	updateBar: function(st) {
		var self = this;
		if (!st)
			return '';

		var up = st.update || {};
		var busy = up.state == 'checking' || up.state == 'installing';
		var upText = up.state == 'installing' ? 'идёт установка, служба перезапустится'
			: up.state == 'checking' ? 'проверяю GitHub…'
			: up.available ? 'на GitHub вышла ' + up.latest
			: up.latest ? 'установлена последняя'
			: 'обновления ещё не проверялись';

		return E('div', { 'class': 'aa-upd' + (up.available ? ' aa-upd-new' : '') }, [
			E('div', { 'class': 'aa-bar' }, [
				E('span', {}, [
					'Версия ', E('strong', st.version || '?'), ' — ', upText,
					up.checked ? ' (проверено ' + fmtTime(up.checked) + ')' : ''
				]),
				busy ? '' : btn('Проверить обновление', 'cbi-button-neutral', function() {
					return act(callCheckUpdate()).then(function() { return self.refresh(); });
				}),
				(up.available && !busy) ? btn('Обновить до ' + up.latest, 'cbi-button-apply', function() {
					return act(callUpdate()).then(function() { return self.refresh(); });
				}) : '',
				E('span', { 'class': 'aa-upd-auto' + (up.auto ? ' aa-upd-auto-on' : '') }, [ 'Автообновление: ', E('strong', up.auto ? 'включено' : 'выключено') ]),
				btn(up.auto ? 'Выключить' : 'Включить', up.auto ? 'cbi-button-neutral' : 'cbi-button-action', function() {
					return act(callSetAutoupdate(!up.auto)).then(function() { return self.refresh(); });
				})
			]),
			up.error ? E('p', { 'class': 'aa-hint' }, 'Ошибка обновления: ' + up.error) : '',
			E('p', { 'class': 'aa-hint' },
				'Версия на GitHub сверяется раз в сутки. Кнопка «Обновить» появляется, когда там версия новее установленной; с автообновлением она ставится сама. Настройки, устройства и добавленные записи сохраняются.')
		]);
	},

	stateKey: function(st) {
		if (!st)
			return 'down';
		var c = Object.assign({}, st);
		delete c.now;
		delete c.probing;
		delete c.names_total;
		return (this.showAll ? 'a' : 'f') + (this.showAllAdded ? 'a' : 'f') + JSON.stringify(c);
	},

	body: function(st) {
		var self = this;

		if (!st || !st.started)
			return E('div', { 'class': 'alert-message warning' },
				'Служба autoadd не запущена: /etc/init.d/autoadd start');

		// the service must have watched for a day before silence means anything
		var watched = st.now - st.started >= 86400;
		var added = (st.added || []).map(function(e) {
			var port = e.port ? ':' + e.port : '';
			var idle = watched && e.how != 'auto' && st.now - (e.use || e.ts || 0) > 7 * 86400;
			return [
				e.dom ? [
					E('div', { 'class': 'aa-main' }, e.id),
					e.ip ? E('div', { 'class': 'aa-sub aa-num', 'title': 'Адрес, на котором замечена неполадка' }, e.ip + port) : ''
				] : [
					E('div', { 'class': 'aa-main aa-num' }, e.id + port),
					E('div', { 'class': 'aa-sub' }, fmtName(e.name))
				],
				E('div', { 'class': 'aa-pills' }, [
					pill(e.dom ? 'домен' : 'адрес', e.dom ? 'ok' : 'addr', e.dom ? 'Через прокси идёт весь домен с поддоменами' : 'Через прокси идёт только этот адрес'),
					pill((e.proto || 'tcp').toUpperCase(), e.proto == 'udp' ? 'warn' : '', 'Протокол передачи'),
					pill(e.how == 'auto' ? 'авто' : 'вручную', '', e.how == 'auto' ? 'Добавлено службой' : 'Добавлено вами, перепроверяется на доступность'),
					idle ? pill('не используется', 'warn', (e.use ? 'Последнее обращение устройств: ' + fmtTime(e.use) : 'Обращений устройств служба не видела') + '. Запись добавлена вами и сама по сроку не удалится') : ''
				]),
				fmtWhy(e.why),
				fmtShort(e.ts),
				e.trial ? pill('на пробе', 'warn', 'Ждём ответа сервера через прокси; без ответа адрес уберётся')
					: fmtShort(e.chk),
				btn('Удалить', 'cbi-button-remove', function() {
					return act(callDel(e.id)).then(function() { return self.refresh(); });
				})
			];
		});

		var cands = (st.cands || []).map(function(c) {
			var sp = STATUS_PILL[c.status] || [ c.status, '' ];
			return [
				[
					E('div', { 'class': 'aa-main aa-num' }, c.ip + ':' + c.port),
					E('div', { 'class': 'aa-sub' }, fmtName(c.name))
				],
				pill(c.proto.toUpperCase(), c.proto == 'udp' ? 'warn' : ''),
				[
					E('div', {}, KIND[c.kind] || c.kind),
					E('div', { 'class': 'aa-sub' }, [ String(c.hits), ' раз, последний ', fmtShort(c.last) ])
				],
				[
					pill(sp[0], sp[1]),
					(STATUS[c.status] && STATUS[c.status] != sp[0]) ? E('div', { 'class': 'aa-sub', 'title': c.res || '' }, STATUS[c.status]) : ''
				],
				E('div', { 'class': 'aa-acts' }, [
					btn('Добавить', 'cbi-button-add', function() {
						return act(callAdd(c.ip, 'из кандидатов, ' + c.proto + ':' + c.port, true)).then(function() { return self.refresh(); });
					}),
					btn('Скрыть', 'cbi-button-neutral', function() {
						return act(callIgnore(c.ip)).then(function() { return self.refresh(); });
					})
				])
			];
		});

		var ignored = (st.ignore || []).map(function(ip) {
			return [
				ip,
				btn('Вернуть', 'cbi-button-neutral', function() {
					return act(callUnignore(ip)).then(function() { return self.refresh(); });
				})
			];
		});

		var log = (st.log || []).slice().reverse().map(function(l) {
			return fmtTime(l.t) + '  ' + l.m;
		}).join('\n');

		var addedTotal = st.added_total || 0;
		var candsTotal = st.cands_shown || 0;
		var addedMore = addedTotal > added.length || self.showAllAdded;
		var last = st.last;

		// the page script stays in the browser cache after an update
		if (st.version && st.version != VIEW_VERSION && !self.staleReload(st) && !self.reloadShown) {
			self.reloadShown = true;
			ui.addNotification(null, E('p', 'Служба версии ' + st.version + ', страница — ' + VIEW_VERSION + '. Обновите страницу через Ctrl+F5.'), 'info');
		}

		var pcs = st.pcs || [];
		var nodes = [
			E('div', { 'class': 'aa-sum' }, [
				E('div', { 'class': 'aa-sum-top' }, [
					E('div', { 'class': 'aa-state' + (st.auto ? '' : ' aa-state-off') }, [
						E('span', { 'class': 'aa-dot' }),
						E('span', { 'class': 'aa-state-t' }, 'Автодобавление ' + (st.auto ? 'включено' : 'выключено')),
						btn(st.auto ? 'Выключить' : 'Включить', st.auto ? 'cbi-button-neutral' : 'cbi-button-action', function() {
							return act(callSetAuto(!st.auto)).then(function() { return self.refresh(); });
						}),
						pcs.length ? '' : pill('ни одно устройство не отслеживается', 'warn', 'Отметьте устройства в разделе «Устройства»')
					]),
					E('div', { 'class': 'aa-figs' }, [
						E('div', { 'class': 'aa-fig', 'title': 'Домены и адреса, которые идут через podkop' }, [ E('b', {}, String(addedTotal)), E('span', {}, 'через прокси') ]),
						E('div', { 'class': 'aa-fig', 'title': 'Всего замечено адресов: ' + (st.cands_total || 0) }, [ E('b', {}, String(candsTotal)), E('span', {}, 'кандидатов') ])
					])
				]),
				E('div', { 'class': 'aa-sum-foot' }, [
					E('div', {}, [
						E('span', { 'class': 'aa-k' }, 'Добавлено последним'),
						last ? E('strong', {}, last.id || last.ip) : 'ещё ничего',
						last ? E('span', { 'class': 'aa-sub' }, [ last.how == 'auto' ? 'авто, ' : 'вручную, ', fmtShort(last.ts), last.active ? '' : ' (уже удалён)' ]) : ''
					]),
					E('div', {}, [
						E('span', { 'class': 'aa-k' }, 'Служба'),
						'работает с ', fmtShort(st.started),
						E('span', { 'class': 'aa-sub' }, 'имён DNS в памяти: ' + (st.names_total || 0))
					])
				])
			]),

			self.section('added', 'Через прокси', [
				E('div', { 'class': 'aa-bar' }, [
					E('span', { 'class': 'aa-hint', 'style': 'flex:1 1 20em' },
						'Домены и адреса, которые направляются через podkop. Все записи (включая добавленные вручную) перепроверяются каждые 6 часов и удаляются, если снова доступны напрямую. Серверы UDP (игры/голос) добавляются на пробу: без ответа удаляются через 3 минуты. Запись, добавленная службой, удаляется, если ею 7 дней никто не пользовался: к адресу не было соединений, имена домена не запрашивались. Записи, добавленные вручную, по сроку не удаляются, у неиспользуемых появляется пометка. Адрес самого прокси-сервера podkop не добавляется.'),
					addedMore ? btn(self.showAllAdded ? 'Только последние' : 'Показать все', 'cbi-button-neutral', function() {
						self.showAllAdded = !self.showAllAdded;
						return self.refresh();
					}) : ''
				]),
				table([ 'Что добавлено', 'Правило', 'Причина', 'Добавлен', 'Проверен', '' ], added, 'Пока ничего не добавлено',
					[ '22%', '19%', '26%', '11%', '11%', '11%' ])
			], addedTotal > added.length ? 'показаны последние ' + added.length : null, addedTotal),

			self.section('cands', 'Кандидаты', [
				E('div', { 'class': 'aa-bar' }, [
					E('span', { 'class': 'aa-hint', 'style': 'flex:1 1 20em' },
						'Адреса, с которыми у устройств не получилось соединение или оборвалась передача. Автоматически добавляются только те, что напрямую не открываются, а через прокси открываются. Строки с типом UDP — серверы игр и голосовой связи: их проверить с роутера нельзя, поэтому адрес добавляется на пробу сам, когда запросы без ответа повторяются. Доступные напрямую и не отвечающие даже через прокси скрыты.'),
					btn(self.showAll ? 'Скрыть лишние' : 'Показать все', 'cbi-button-neutral', function() {
						self.showAll = !self.showAll;
						return self.refresh();
					})
				]),
				table([ 'Адрес', 'Тип', 'Что замечено', 'Проверка', '' ], cands, 'Нет кандидатов',
					[ '28%', '8%', '25%', '23%', '16%' ])
			], candsTotal > cands.length ? 'показаны последние ' + cands.length : null, candsTotal),

			self.section('ignored', 'Скрытые', [
				table([ 'Адрес', '' ], ignored, 'Скрытых адресов нет', [ '30%', '70%' ])
			], 'не попадают в кандидаты', ignored.length),

			self.section('log', 'Журнал', [
				E('textarea', { 'class': 'cbi-input-textarea', 'rows': 8, 'readonly': 'readonly', 'wrap': 'off' }, log)
			], 'хранится в памяти, очищается раз в сутки', (st.log || []).length)
		];

		return nodes;
	},

	render: function(data) {
		var self = this;
		var st = data[0];
		var input = E('input', { 'class': 'cbi-input-text', 'type': 'text', 'placeholder': 'example.com или 203.0.113.10', 'style': 'max-width:20em' });

		self.devKey = JSON.stringify(data[1]);
		poll.add(function() {
			self.devTick = (self.devTick || 0) + 1;
			return self.refresh().then(function() {
				// devices come and go: reread the list every third poll
				if (self.devTick % 3 == 0)
					return self.refreshDevices(true);
			});
		}, 5);

		this.staleReload(st);

		var page = E('div', { 'class': 'aa-page' });

		dom.content(page, [
			E('style', {}, CSS),
			E('div', { 'class': 'aa-top' }, [
				E('h2', 'Podkop AutoAdd'),
				this.zoomBar(page)
			]),
			E('div', { 'class': 'cbi-map-descr' },
				'Точечно отправляет через podkop сайты и адреса, которые у выбранных устройств не открываются напрямую или обрываются на загрузке. Остальной трафик идёт как обычно.'),
			E('div', { 'id': 'autoadd-upd' }, this.updateBar(st)),
			self.section('manual', 'Добавить вручную', [
				E('div', { 'class': 'aa-bar' }, [
					E('label', {}, 'Домен или адрес:'),
					input,
					btn('Добавить', 'cbi-button-add', function() {
						var ip = input.value.trim();
						if (!ip)
							return;
						return act(callAdd(ip, '', false)).then(function() {
							input.value = '';
							return self.refresh();
						});
					})
				])
			]),
			self.section('devices', 'Устройства', [
				E('div', { 'id': 'autoadd-dev' }, this.devices(data[1]))
			]),
			E('div', { 'id': 'autoadd-root' }, this.body(st))
		]);

		return page;
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
