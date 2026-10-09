/**
 * 麦麦图鉴主控制器
 *
 * 双轨模型是这个项目的核心，别把它简化掉：
 *   tasted    —— 只能来自真实历史订单，金边，代表真实生活痕迹
 *   collected —— 可以来自游戏合成，灰边，代表趣味收录
 * 两者分别汇总为「品鉴度」和「收集度」，稀缺性由此成立。
 */
(function () {
  'use strict';

  var KEY = 'mcdex.unlocks';

  /* ---------------- 状态仓库 ---------------- */

  var Store = {
    unlocks: {},
    load: function () {
      try {
        this.unlocks = JSON.parse(localStorage.getItem(KEY) || '{}');
      } catch (e) {
        this.unlocks = {};
      }
    },
    save: function () {
      try {
        localStorage.setItem(KEY, JSON.stringify(this.unlocks));
      } catch (e) { /* 无痕模式下写不了，忽略 */ }
    },
    collect: function (code, src) {
      if (!code) return false;
      if (this.unlocks[code]) return false;
      this.unlocks[code] = src || 'game';
      this.save();
      return true;
    },
    source: function (code) {
      return this.unlocks[code] || null;
    }
  };
  window.McdexStore = Store;

  /* ---------------- 工具 ---------------- */

  var $ = function (s) { return document.querySelector(s); };
  var cats = null;

  function itemState(item) {
    var tasted = Boolean(item.state && item.state.tasted);
    var virtual = Store.source(item.code);
    return {
      tasted: tasted,
      source: tasted ? 'order' : virtual,
      unlocked: tasted || Boolean(virtual)
    };
  }

  function pct(n, total) {
    return total ? Math.round((n / total) * 1000) / 10 : 0;
  }

  var RANKS = [
    [0, 'Hello World · 麦门见习'],
    [10, '能跑就行 · 实习工程师'],
    [25, 'P5 · 麦门熟练工'],
    [45, 'P7 · 资深收藏家'],
    [65, 'P8 · 高级图鉴师'],
    [82, 'P9 · 架构级玩家'],
    [95, 'P10 · 首席汉堡官'],
    [100, 'P11 · 麦门合伙人']
  ];

  function rankOf(p) {
    var name = RANKS[0][1];
    for (var i = 0; i < RANKS.length; i++) {
      if (p >= RANKS[i][0]) name = RANKS[i][1];
    }
    return name;
  }

  /* ---------------- 图鉴渲染 ---------------- */

  var TIERS = [
    { key: 'merch', title: '品牌周边', note: '传说级 · 游戏不可达' },
    { key: 'limited', title: '限定区', note: '游戏不可达 · 稀缺性在此' },
    { key: 'regular', title: '常驻区', note: '游戏可合成' }
  ];

  var filterMode = 'all';
  var keyword = '';

  function renderDex() {
    var body = $('#dexBody');
    body.innerHTML = '';

    var html = '';
    for (var t = 0; t < TIERS.length; t++) {
      var conf = TIERS[t];
      var group = cats.items.filter(function (i) { return i.tier === conf.key; });
      if (!group.length) continue;

      var matched = group.filter(function (i) {
        var st = itemState(i);
        if (keyword && i.name.indexOf(keyword) === -1) return false;
        if (filterMode === 'unlocked' && !st.unlocked) return false;
        if (filterMode === 'locked' && st.unlocked) return false;
        return true;
      });

      var got = group.filter(function (i) { return itemState(i).unlocked; }).length;

      html += '<div class="tier-block">';
      html += '<div class="tier-head"><span class="tier-name">' + conf.title + '</span>';
      html += '<span class="tier-count">' + got + ' / ' + group.length + '</span>';
      html += '<span class="tier-note">' + conf.note + '</span></div>';

      if (!matched.length) {
        html += '<div class="empty">没有符合条件的餐品</div>';
      } else {
        html += '<div class="grid">';
        for (var m = 0; m < matched.length; m++) {
          var it = matched[m];
          var st = itemState(it);
          var cls = 'cell' + (st.tasted ? ' tasted' : (st.unlocked ? ' collected' : ' locked'));
          html += '<div class="' + cls + '" title="' + it.tierReason + '">';
          if (st.unlocked) {
            html += '<span class="badge' + (st.tasted ? '' : ' virt') + '">' +
              (st.tasted ? '已 品 尝' : '已收录') + '</span>';
          }
          html += '<span class="cell-name">' + (st.unlocked ? it.name : '？') + '</span>';
          html += '<span class="cell-price">' + (it.price ? '¥' + it.price : '') + '</span>';
          html += '</div>';
        }
        html += '</div>';
      }
      html += '</div>';
    }
    body.innerHTML = html;
  }

  function renderStats() {
    var items = cats.items;
    var total = items.length;
    var tasted = items.filter(function (i) { return itemState(i).tasted; }).length;
    var collected = items.filter(function (i) { return itemState(i).unlocked; }).length;

    $('#statCollected').textContent = pct(collected, total) + '%';
    $('#statTasted').textContent = pct(tasted, total) + '%';
    $('#statCount').textContent = collected;
    $('#statTotal').textContent = '/ ' + total;

    window.__MCD_RANK__ = rankOf(pct(collected, total));
  }

  function refresh() {
    renderStats();
    renderDex();
  }

  /* ---------------- 游戏渲染 ---------------- */

  function renderChain() {
    var G = window.McdexGame;
    var host = $('#chainList');
    var html = '';
    for (var i = 0; i < G.chain.length; i++) {
      var lv = i + 1;
      var it = G.chain[i];
      var s = G.tileStyle(lv);
      html += '<div class="chain-item"><span class="chain-pow">2^' + lv + '</span>';
      html += '<span class="chain-bar" style="background:' + s.bg + ';color:' + s.fg + '">' +
        Math.pow(2, lv) + ' · ' + it.name + '</span></div>';
    }
    host.innerHTML = html;
  }

  function renderBoard(popAt) {
    var G = window.McdexGame;
    var board = $('#board');
    var html = '';
    for (var r = 0; r < G.grid.length; r++) {
      for (var c = 0; c < G.grid[r].length; c++) {
        var lv = G.grid[r][c];
        if (!lv) {
          html += '<div class="tile empty"></div>';
          continue;
        }
        var item = G.itemOf(lv);
        var s = G.tileStyle(lv);
        var cls = 'tile' + (popAt === lv ? ' pop' : '');
        html += '<div class="' + cls + '" style="background:' + s.bg + ';color:' + s.fg + '">';
        html += '<span class="tile-name">' + (item ? item.name : '?') + '</span>';
        html += '<span class="tile-pow">' + Math.pow(2, lv) + '</span>';
        html += '</div>';
      }
    }
    board.innerHTML = html;

    var top = 0;
    G.grid.forEach(function (row) {
      row.forEach(function (v) { if (v > top) top = v; });
    });
    $('#score').textContent = top ? Math.pow(2, top) : 0;
    $('#moveCount').textContent = G.moves;
    $('#bestScore').textContent = G.best ? Math.pow(2, G.best) : 0;
  }

  function handleMove(dir) {
    var G = window.McdexGame;
    var res = G.step(dir);
    if (!res) return;

    renderBoard();
    refresh();

    if (res.won || res.over) {
      var ov = $('#overlay');
      if (res.won) {
        $('#ovTitle').textContent = '1024 达成';
        $('#ovDesc').textContent = '你合出了最高级餐品\n本局步数 ' + G.moves + '\n段位：' + (window.__MCD_RANK__ || '-');
      } else {
        $('#ovTitle').textContent = '本局结束';
        $('#ovDesc').textContent = '最高合成 ' + Math.pow(2, res.top) + '\n共 ' + G.moves + ' 步\n段位：' + (window.__MCD_RANK__ || '-');
      }
      ov.classList.add('show');
    }
  }

  /* ---------------- 战绩卡 ---------------- */

  function drawCard() {
    var G = window.McdexGame;
    var cv = $('#cardCanvas');
    var g = cv.getContext('2d');
    var W = cv.width, H = cv.height;

    g.fillStyle = '#14110f';
    g.fillRect(0, 0, W, H);

    // 顶部色带
    g.fillStyle = '#da291c';
    g.fillRect(0, 0, W, 14);

    g.textAlign = 'center';
    g.fillStyle = '#ffc72c';
    g.font = '600 46px "PingFang SC","Microsoft YaHei",sans-serif';
    g.fillText('麦麦图鉴 · 1024', W / 2, 132);

    g.fillStyle = '#a2958c';
    g.font = '26px "PingFang SC","Microsoft YaHei",sans-serif';
    g.fillText(cats.meta.storeName || '麦当劳', W / 2, 186);

    // 主数值
    var top = Math.max.apply(null, G.grid.map(function (row) {
      return Math.max.apply(null, row);
    }));
    g.fillStyle = '#f3ece6';
    g.font = '600 180px "PingFang SC","Microsoft YaHei",sans-serif';
    g.fillText(String(top ? Math.pow(2, top) : 0), W / 2, 400);

    g.fillStyle = '#6d625c';
    g.font = '24px "PingFang SC","Microsoft YaHei",sans-serif';
    g.fillText('最高合成', W / 2, 444);

    // 三宫格
    var boxes = [
      ['收集度', $('#statCollected').textContent],
      ['品鉴度', $('#statTasted').textContent],
      ['段位', window.__MCD_RANK__ || '-']
    ];
    var bw = 300, gap = 24, startX = (W - (bw * 3 + gap * 2)) / 2;
    for (var i = 0; i < 3; i++) {
      var x = startX + i * (bw + gap);
      g.fillStyle = '#1e1917';
      g.fillRect(x, 520, bw, 170);
      g.fillStyle = '#a2958c';
      g.font = '24px "PingFang SC","Microsoft YaHei",sans-serif';
      g.fillText(boxes[i][0], x + bw / 2, 570);
      g.fillStyle = i === 2 ? '#ffc72c' : '#f3ece6';
      g.font = '600 ' + (i === 2 ? '30px' : '52px') + ' "PingFang SC","Microsoft YaHei",sans-serif';
      g.fillText(boxes[i][1], x + bw / 2, 645);
    }

    // 本局解锁
    var unlocked = G.chain.filter(function (it) { return Store.source(it.code); }).slice(0, 6);
    g.textAlign = 'left';
    g.fillStyle = '#a2958c';
    g.font = '24px "PingFang SC","Microsoft YaHei",sans-serif';
    g.fillText('已收录餐品', 90, 750);

    g.fillStyle = '#f3ece6';
    g.font = '28px "PingFang SC","Microsoft YaHei",sans-serif';
    for (var j = 0; j < unlocked.length; j++) {
      g.fillText('· ' + unlocked[j].name, 90, 800 + j * 46);
    }

    g.fillStyle = '#6d625c';
    g.font = '22px "PingFang SC","Microsoft YaHei",sans-serif';
    g.fillText('数据来自麦当劳中国官方 MCP Server', 90, H - 96);
    g.fillText('本项目为参赛作品，非麦当劳官方产品', 90, H - 62);

    var a = document.createElement('a');
    a.download = 'mcd-dex-1024.png';
    a.href = cv.toDataURL('image/png');
    a.click();
  }

  /* ---------------- 启动 ---------------- */

  function bindSwipe(el) {
    var sx = 0, sy = 0, active = false;
    el.addEventListener('touchstart', function (e) {
      active = true;
      sx = e.touches[0].clientX;
      sy = e.touches[0].clientY;
    }, { passive: true });
    el.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });
    el.addEventListener('touchend', function (e) {
      if (!active) return;
      active = false;
      var dx = e.changedTouches[0].clientX - sx;
      var dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
      if (Math.abs(dx) > Math.abs(dy)) handleMove(dx > 0 ? 'right' : 'left');
      else handleMove(dy > 0 ? 'down' : 'up');
    });
  }

  function boot() {
    cats = window.__MCD_CATALOG__;
    if (!cats || !cats.items) {
      $('#storeName').textContent = '未找到 data/catalog.js，请先运行 src/collector.mjs';
      return;
    }

    Store.load();
    $('#storeName').textContent = cats.meta.storeName + ' · 共 ' + cats.meta.itemCount + ' 件图鉴';

    document.querySelectorAll('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
        document.querySelectorAll('.panel').forEach(function (p) { p.classList.remove('active'); });
        tab.classList.add('active');
        $('#panel-' + tab.dataset.tab).classList.add('active');
      });
    });

    $('#searchBox').addEventListener('input', function (e) {
      keyword = e.target.value.trim();
      renderDex();
    });
    document.querySelectorAll('.chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        document.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('active'); });
        chip.classList.add('active');
        filterMode = chip.dataset.filter;
        renderDex();
      });
    });

    if (window.McdexGame.init()) {
      renderChain();
      renderBoard();
      $('#btnRestart').addEventListener('click', function () {
        window.McdexGame.reset();
        $('#overlay').classList.remove('show');
        renderBoard();
      });
      $('#btnAgain').addEventListener('click', function () {
        window.McdexGame.reset();
        $('#overlay').classList.remove('show');
        renderBoard();
      });
      $('#btnCard').addEventListener('click', drawCard);
      bindSwipe($('#board'));
      document.addEventListener('keydown', function (e) {
        var map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
        if (map[e.key]) { e.preventDefault(); handleMove(map[e.key]); }
      });
    } else {
      $('#board').innerHTML = '<div class="empty" style="padding:40px">未能构建进化链，请检查 catalog 数据</div>';
    }

    refresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
