/* =============================================================
 * 08-names.js —— 自建词根表 + 后缀表的命名器
 * 同一个 seed → 同一批名字；每条名字同时给出中文名与拉丁转写名。
 * 词根以「辅音+元音」为骨架，拼出来像地名而不是随机汉字。
 * ============================================================= */
;(function (root) {
  'use strict';
  var AO = root.AO || (root.AO = {});

  /* 词根：[中文, 拉丁] */
  var SYL = [
    ['卡', 'Ka'], ['洛', 'Lo'], ['兰', 'Lan'], ['德', 'De'], ['维', 'Vi'], ['图', 'Tu'], ['尔', 'Er'],
    ['阿', 'A'], ['米', 'Mi'], ['加', 'Ga'], ['尼', 'Ni'], ['布', 'Bu'], ['拉', 'Ra'], ['塔', 'Ta'],
    ['乌', 'U'], ['赞', 'Zan'], ['安', 'An'], ['莫', 'Mo'], ['里', 'Ri'], ['塞', 'Se'], ['科', 'Ko'],
    ['伊', 'I'], ['沙', 'Sa'], ['瓦', 'Va'], ['雷', 'Re'], ['诺', 'No'], ['达', 'Da'], ['佩', 'Pe'],
    ['泰', 'Tai'], ['赫', 'He'], ['贝', 'Be'], ['卢', 'Lu'], ['格', 'Ge'], ['哈', 'Ha'], ['奇', 'Ki'],
    ['纳', 'Na'], ['罗', 'Ro'], ['西', 'Si'], ['奥', 'O'], ['门', 'Men'], ['杜', 'Du'], ['巴', 'Ba'],
    ['坎', 'Kan'], ['黎', 'Li'], ['松', 'Son'], ['斯', 'Sti'], ['亚', 'Ya'], ['内', 'Ne'], ['托', 'To'],
    ['波', 'Bo'], ['库', 'Ku'], ['辛', 'Sin'], ['蒂', 'Ti'], ['沃', 'Vo'], ['基', 'Ki'], ['耶', 'Ye'],
    ['桑', 'San'], ['贡', 'Gon'], ['扎', 'Za'], ['厄', 'E'], ['蒙', 'Mon'], ['丘', 'Chu'], ['瑞', 'Ru'],
    ['居', 'Ju'], ['科', 'Kor'], ['瓦', 'War'], ['德', 'Dov'], ['加', 'Gal'], ['斯', 'Ska']
  ];

  /* 国家后缀（王国最常见）。第 4 项是政体 key，08b-society.js 直接拿它定政体，
   * 保证「XX 王国」不会配出个共和制总统。 */
  var C_SUFFIX = [
    ['王国', 'Kingdom', 5, 'kingdom'],
    ['帝国', 'Empire', 2, 'empire'],
    ['共和国', 'Republic', 2, 'republic'],
    ['联邦', 'Federation', 2, 'federation'],
    ['公国', 'Duchy', 1, 'duchy'],
    ['汗国', 'Khanate', 1, 'khanate'],
    ['大公国', 'Grand Duchy', 1, 'grandduchy'],
    ['城邦联盟', 'League', 1, 'league']
  ];

  /* 省份后缀：按地形挑 */
  var P_SUFFIX = {
    plains: [['平原', 'Plain'], ['谷地', 'Vale'], ['旷野', 'Fields'], ['沃原', 'Lowlands']],
    grassland: [['草原', 'Steppe'], ['旷野', 'Fields'], ['牧野', 'Grazing']],
    forest: [['林地', 'Woods'], ['密林', 'Forest'], ['绿野', 'Greenwood']],
    hills: [['丘陵', 'Hills'], ['高地', 'Heights'], ['坡地', 'Slopes']],
    mountains: [['山地', 'Mounts'], ['高地', 'Heights'], ['隘口', 'Pass'], ['峰岭', 'Peaks']],
    desert: [['荒原', 'Wastes'], ['沙海', 'Sands'], ['旱谷', 'Drylands']],
    tundra: [['冰原', 'Tundra'], ['冻土', 'Frostlands'], ['极野', 'Frostmark']],
    swamp: [['沼泽', 'Marsh'], ['湿地', 'Wetlands'], ['泥沼', 'Bogs']],
    coast: [['海岸', 'Coast'], ['港区', 'Harbor'], ['海湾', 'Bay']],
    islands: [['群岛', 'Isles'], ['列岛', 'Archipelago'], ['礁屿', 'Reefs']]
  };

  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  /* 拉丁转写：首音节首字母大写，其余小写（否则会出现 LoSti 这种怪东西） */
  function latin(sy) {
    var out = '';
    for (var i = 0; i < sy.length; i++) out += i === 0 ? cap(sy[i][1]) : sy[i][1].toLowerCase();
    return out;
  }

  function NameGen(rng) {
    this.rng = rng;
    this.usedCountry = new Set();
    this.usedProvince = new Set();
  }

  NameGen.prototype._pickSyl = function (n) {
    var out = [];
    for (var i = 0; i < n; i++) out.push(SYL[this.rng.int(SYL.length)]);
    return out;
  };

  NameGen.prototype._pickSuffix = function (table) {
    var total = 0, i;
    for (i = 0; i < table.length; i++) total += (table[i][2] || 1);
    var r = this.rng.next() * total;
    for (i = 0; i < table.length; i++) {
      r -= (table[i][2] || 1);
      if (r <= 0) return table[i];
    }
    return table[table.length - 1];
  };

  /* 国家名：1~2 音节 + 政体后缀 */
  NameGen.prototype.country = function () {
    for (var attempt = 0; attempt < 60; attempt++) {
      var n = attempt < 40 ? (this.rng.next() < 0.45 ? 1 : 2) : 3;
      var sy = this._pickSyl(n);
      if (n === 1 && sy[0][1].length < 3) sy = this._pickSyl(2);   // 避免 "A Kingdom" 这种
      var suf = this._pickSuffix(C_SUFFIX);
      var cn = sy.map(function (s) { return s[0]; }).join('') + suf[0];
      if (this.usedCountry.has(cn)) continue;
      this.usedCountry.add(cn);
      return { name: cn, name_en: latin(sy) + ' ' + suf[1], gov: suf[3] };
    }
    var fb = this._pickSyl(3);
    return {
      name: fb.map(function (s) { return s[0]; }).join('') + '王国',
      name_en: latin(fb) + ' Kingdom',
      gov: 'kingdom'
    };
  };

  /* 人名：音节 + 中点，像音译过来的外国人名。gender 决定头衔（国王/女王） */
  NameGen.prototype.person = function () {
    var gender = this.rng.next() < 0.5 ? 'm' : 'f';
    var n = this.rng.next() < 0.62 ? 2 : 3;
    var sy = this._pickSyl(n);
    var cn = sy.map(function (s) { return s[0]; }).join('·');
    return { name: cn, name_en: latin(sy), gender: gender };
  };

  /* 王室 / 家族名：给君主制国家加一个「XX 王朝」 */
  NameGen.prototype.house = function () {
    var sy = this._pickSyl(2);
    return sy.map(function (s) { return s[0]; }).join('') + '王朝';
  };

  /* 省份名：1~2 音节 + 地形后缀。
   *
   * 第二个参数 coastal 只管**名字**，不管地形：临海的地方叫"XX 海岸 / 港区 / 海湾"
   * 是现实里就有的（滨海、临海、洋山港区…），所以沿海的山地/丘陵也可以带海味后缀。
   * 但地形仍然是山地/丘陵 —— 名字和地貌分类是两件事，别互相污染。
   * 实现上只改候选表长度、不多掷一次骰子，名字之外的随机流一位都不动。 */
  NameGen.prototype.province = function (terrain, coastal) {
    var table = P_SUFFIX[terrain] || P_SUFFIX.plains;
    var extra = (coastal && terrain !== 'coast') ? 2 : 0;
    for (var attempt = 0; attempt < 60; attempt++) {
      var n = attempt < 45 ? (this.rng.next() < 0.45 ? 1 : 2) : 3;
      var sy = this._pickSyl(n);
      if (n === 1 && sy[0][1].length < 3) sy = this._pickSyl(2);
      var idx = this.rng.int(table.length + extra);
      var suf = idx < table.length ? table[idx] : P_SUFFIX.coast[idx - table.length];
      var cn = sy.map(function (s) { return s[0]; }).join('') + suf[0];
      if (this.usedProvince.has(cn)) continue;
      this.usedProvince.add(cn);
      return { name: cn, name_en: latin(sy) + ' ' + suf[1] };
    }
    var fb = this._pickSyl(3);
    return { name: fb.map(function (s) { return s[0]; }).join('') + '地', name_en: latin(fb) + ' Land' };
  };

  AO.NameGen = NameGen;

  /* 地形分类：高程用"省份间排名"而不是绝对值（绝对值分布随 seed 漂移，
   * 会让整张图全是山地或全是平原），湿度决定植被，高纬才出冻原。
   * enRank: 0..1 高程排名；moisture: 0..1；cold: 是否高纬；coastal: 是否沿海
   *
   * 关于 'coast'：**"沿海"不是地貌，是海陆位置**（现实里的地形图也从不把
   * 一个地方的地形标成"沿海"）。所以这里只在"低地 + 临海"时才给这个值，
   * 名字取真实地貌名"滨海平原"（华北滨海平原、苏北滨海平原都这么叫）；
   * 沿海的山地 / 丘陵仍然是山地 / 丘陵 —— "临不临海、几面临海、陡岸还是缓岸"
   * 由岸线画像（coastDirs / coastSteep / riverMouth）单独回答，别混进地形里。 */
  AO.classifyTerrain = function (enRank, moisture, cold, coastal) {
    var m = moisture + (coastal ? 0.08 : -0.04);
    if (cold) return m > 0.45 ? 'tundra' : 'tundra';
    if (enRank > 0.87) return 'mountains';
    if (enRank > 0.63) return 'hills';
    if (m < 0.33) return enRank > 0.45 ? 'desert' : 'plains';
    if (m > 0.72) return coastal ? 'swamp' : 'forest';
    if (m > 0.55) return 'forest';
    if (coastal && enRank <= 0.42) return 'coast';   // 低地 + 临海 = 滨海平原
    if (m > 0.45) return 'grassland';
    return 'plains';
  };

  AO.TERRAIN_CN = {
    plains: '平原', grassland: '草原', forest: '森林', hills: '丘陵',
    mountains: '山地', desert: '荒漠', tundra: '冻原', swamp: '沼泽',
    coast: '滨海平原', islands: '群岛'
  };

})(typeof window !== 'undefined' ? window : globalThis);
