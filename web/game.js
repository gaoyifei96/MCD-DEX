/**
 * 麦麦 1024：滑动合成游戏
 *
 * 设计约束（很重要，别改坏）：
 *  1. 进化链只从「常驻 + 非套餐」的餐品里取，按真实售价升序排列
 *     —— 限定与周边不进游戏，稀缺性留给真实消费路径
 *  2. 第 k 级的分值就是 2^k，第 10 级 = 1024，正好扣程序员节主题
 *  3. 合成出的新等级会写入 McdexStore，从而点亮图鉴的「已收录」标记
 */
(function () {
  'use strict';

  // 棋盘取 5×5 而不是经典 4×4：目标是合到 2^10=1024，
  // 4×4 空间不足时通关率不到 2%，玩家合不出 1024 就不会产生成就感，也不会想去分享。
  var SIZE = 5;
  var MAX_LEVEL = 10;
  var KEY_BEST = 'mcdex.best';

  /* ---------------- 进化链 ---------------- */

  function buildChain() {
    var cat = window.__MCD_CATALOG__;
    if (!cat || !cat.items) return [];

    var pool = cat.items
      .filter(function (i) {
        if (i.tier !== 'regular' || i.isCombo || !(i.price > 0)) return false;
        // 调味蘸酱是配料而不是一道餐品，放进进化链会让"合成"失去意义
        if (/风味酱|蘸酱|酱$/.test(i.name)) return false;
        if (i.tags.indexOf('蘸酱') !== -1) return false;
        return true;
      })
      .sort(function (a, b) {
        return a.price - b.price;
      });

    if (pool.length < MAX_LEVEL) return [];

    // 在价格轴上等距取样，让每一级的"进化感"尽量均匀
    var chain = [];
    var seen = {};
    var step = (pool.length - 1) / (MAX_LEVEL - 1);
    for (var i = 0; i < MAX_LEVEL; i++) {
      var item = pool[Math.round(i * step)];
      if (!seen[item.code]) {
        seen[item.code] = 1;
        chain.push(item);
      }
    }
    // 去重后可能不足 MAX_LEVEL，从池子里补齐
    for (var j = 0; chain.length < MAX_LEVEL && j < pool.length; j++) {
      if (!seen[pool[j].code]) {
        seen[pool[j].code] = 1;
        chain.push(pool[j]);
      }
    }
    return chain.sort(function (a, b) {
      return a.price - b.price;
    });
  }

  /* ---------------- 棋盘 ---------------- */

  function emptyGrid() {
    var g = [];
    for (var r = 0; r < SIZE; r++) {
      // 必须按 SIZE 生成列，写死列数会让初始棋盘缺一列（改棋盘尺寸时最容易漏这里）
      g.push(new Array(SIZE).fill(0));
    }
    return g;
  }

  function spawn(g) {
    var free = [];
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        if (!g[r][c]) free.push([r, c]);
      }
    }
    if (!free.length) return false;
    var pos = free[Math.floor(Math.random() * free.length)];
    g[pos[0]][pos[1]] = Math.random() < 0.82 ? 1 : 2;
    return true;
  }

  /** 把一行向左压缩合并，返回 { line, gained } */
  function squash(line) {
    var arr = line.filter(function (v) {
      return v !== 0;
    });
    var out = [];
    var gained = 0;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] === arr[i + 1] && arr[i] < MAX_LEVEL) {
        out.push(arr[i] + 1);
        gained += Math.pow(2, arr[i] + 1);
        i++;
      } else {
        out.push(arr[i]);
      }
    }
    while (out.length < SIZE) out.push(0);
    return { line: out, gained: gained };
  }

  function move(g, dir) {
    var moved = false;
    var gained = 0;

    for (var k = 0; k < SIZE; k++) {
      var raw = [];
      for (var i = 0; i < SIZE; i++) {
        var r, c;
        if (dir === 'left') { r = k; c = i; }
        else if (dir === 'right') { r = k; c = SIZE - 1 - i; }
        else if (dir === 'up') { r = i; c = k; }
        else { r = SIZE - 1 - i; c = k; }
        raw.push(g[r][c]);
      }

      var res = squash(raw);
      gained += res.gained;

      for (var j = 0; j < SIZE; j++) {
        var rr, cc;
        if (dir === 'left') { rr = k; cc = j; }
        else if (dir === 'right') { rr = k; cc = SIZE - 1 - j; }
        else if (dir === 'up') { rr = j; cc = k; }
        else { rr = SIZE - 1 - j; cc = k; }
        if (g[rr][cc] !== res.line[j]) moved = true;
        g[rr][cc] = res.line[j];
      }
    }
    return { moved: moved, gained: gained };
  }

  function maxTile(g) {
    var m = 0;
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) m = Math.max(m, g[r][c]);
    }
    return m;
  }

  function canMove(g) {
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        if (!g[r][c]) return true;
        if (r + 1 < SIZE && g[r][c] === g[r + 1][c] && g[r][c] < MAX_LEVEL) return true;
        if (c + 1 < SIZE && g[r][c] === g[r][c + 1] && g[r][c] < MAX_LEVEL) return true;
      }
    }
    return false;
  }

  /* ---------------- 颜色：按等级给一条暖色渐变 ---------------- */

  function tileStyle(level) {
    if (!level) return null;
    // 从琥珀到赤红的暖色带，等级越高越饱和
    var t = (Math.min(level, MAX_LEVEL) - 1) / (MAX_LEVEL - 1);
    var bg = 'rgb(' + Math.round(74 + t * 90) + ',' + Math.round(47 - t * 12) + ',' + Math.round(30 + t * 20) + ')';
    var fg = 'rgb(255,' + Math.round(215 - t * 80) + ',' + Math.round(120 - t * 70) + ')';
    if (level === MAX_LEVEL) { bg = '#5c3d06'; fg = '#ffd54a'; }
    return { bg: bg, fg: fg };
  }

  /* ---------------- 对外 API ---------------- */

  var Game = {
    chain: [],
    grid: null,
    best: 0,
    moves: 0,
    won: false,
    over: false,

    init: function () {
      this.chain = buildChain();
      if (!this.chain.length) return false;
      this.best = Number(localStorage.getItem(KEY_BEST) || 0);
      this.reset();
      return true;
    },

    reset: function () {
      this.grid = emptyGrid();
      this.moves = 0;
      this.won = false;
      this.over = false;
      spawn(this.grid);
      spawn(this.grid);
    },

    step: function (dir) {
      if (this.over) return null;
      var res = move(this.grid, dir);
      if (!res.moved) return null;

      this.moves++;
      // 偶尔连续生成两个方块，避免棋盘过于宽松让随机乱滑也能通关
      spawn(this.grid);
      if (Math.random() < 0.42) spawn(this.grid);

      var top = maxTile(this.grid);
      if (top > this.best) {
        this.best = top;
        localStorage.setItem(KEY_BEST, String(top));
      }

      // 本次滑动中出现过的所有等级都算已收录
      for (var r = 0; r < SIZE; r++) {
        for (var c = 0; c < SIZE; c++) {
          var lv = this.grid[r][c];
          if (lv > 0 && this.chain[lv - 1]) {
            window.McdexStore.collect(this.chain[lv - 1].code);
          }
        }
      }

      if (top >= MAX_LEVEL) this.won = true;
      if (!canMove(this.grid)) this.over = true;

      return { won: this.won, over: this.over, top: top };
    },

    itemOf: function (level) {
      return this.chain[level - 1] || null;
    },

    // 内部方法，暴露出来给 src/test-game.mjs 做策略验证
    _move: move,
    _maxTile: maxTile,
    _canMove: canMove,

    tileStyle: tileStyle
  };

  window.McdexGame = Game;
})();
