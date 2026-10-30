/* =============================================================
 * 08b-society.js —— 国家资料：政体 / 经济 / 信仰 / 人口 / 领导人 / 头像
 *
 * 全部由 seed 派生，不联网、不读图片：头像是当场拼出来的 SVG。
 * 一条设计约束：**政体必须跟着国名后缀走** —— 叫「XX 王国」的国家
 * 不能配一个共和制总统，否则点开卡片一眼假。所以 08-names.js 的
 * country() 会把后缀的政体 key 一起返回，这里只做映射。
 * ============================================================= */
;(function (root) {
  'use strict';
  var AO = root.AO || (root.AO = {});

  /* ---------------- 政体 ---------------- */
  /* econ: 该政体下常见的经济体制；titles: 按性别取头衔；house: 是否挂王朝名 */
  var GOV = {
    kingdom:    { cn: '君主制',   econ: ['封建庄园经济', '封建采邑制'], titles: ['国王', '女王'],     house: true },
    empire:     { cn: '帝国制',   econ: ['封建采邑制', '国家垄断经济'], titles: ['皇帝', '女皇'],     house: true },
    grandduchy: { cn: '大公国制', econ: ['封建采邑制'],                titles: ['大公', '女大公'],   house: true },
    duchy:      { cn: '公国制',   econ: ['封建采邑制', '重商主义'],     titles: ['大公', '女大公'],   house: true },
    khanate:    { cn: '部落联盟', econ: ['部落共有制', '畜牧经济'],     titles: ['可汗', '可敦'],     house: true },
    republic:   { cn: '共和制',   econ: ['资本主义', '混合经济'],       titles: ['总统'],             house: false },
    federation: { cn: '联邦制',   econ: ['资本主义', '自由市场'],       titles: ['联邦总统'],         house: false },
    league:     { cn: '城邦联盟', econ: ['重商主义', '商业寡头制'],     titles: ['执政官'],           house: false }
  };
  AO.GOV = GOV;

  /* ---------------- 信仰 ----------------
   * bias 是"地形倾向"：沙海里出太阳神教、冰原上出万灵萨满，比纯随机可信。
   * sym 是画在图例上的小图标（SVG 片段，24×24），不用 emoji，免得字体不一致。 */
  var FAITHS = [
    {
      key: 'sun', cn: '日曜教', en: 'Solar Creed', hue: 45, s: 0.52, l: 0.66,
      tenet: '以日为神，重契约与秩序', bias: { desert: 3.2, plains: 2.6, grassland: 2.2, hills: 1.9, coast: 1.7 },
      sym: '<circle cx="12" cy="12" r="4.2"/><g stroke="currentColor" stroke-width="1.7" stroke-linecap="round">' +
           '<path d="M12 2.6v3M12 18.4v3M2.6 12h3M18.4 12h3M5.4 5.4l2.1 2.1M16.5 16.5l2.1 2.1M18.6 5.4l-2.1 2.1M7.5 16.5l-2.1 2.1"/></g>'
    },
    {
      key: 'moon', cn: '月影信仰', en: 'Lunar Veil', hue: 252, s: 0.36, l: 0.54,
      tenet: '月相轮回，生死同源', bias: { swamp: 2.2, forest: 1.9, coast: 1.6, hills: 1.5 },
      sym: '<path d="M15.4 3.2a9 9 0 1 0 0 17.6 7.2 7.2 0 0 1 0-17.6Z"/>'
    },
    {
      key: 'star', cn: '星辰之道', en: 'Astral Way', hue: 184, s: 0.44, l: 0.64,
      tenet: '观星定命，重历法与推演', bias: { mountains: 2.4, hills: 2.2, desert: 1.5, coast: 1.3 },
      sym: '<path d="M12 2.8l2.7 6.1 6.6.6-5 4.4 1.5 6.5-5.8-3.5-5.8 3.5 1.5-6.5-5-4.4 6.6-.6z"/>'
    },
    {
      key: 'flame', cn: '圣火崇拜', en: 'Pyre Cult', hue: 10, s: 0.50, l: 0.55,
      tenet: '火净万物，勇武为德', bias: { desert: 2.6, mountains: 1.9, hills: 1.6, grassland: 1.3 },
      sym: '<path d="M12 2.6c3.2 4 5.4 5.6 5.4 9.2A5.4 5.4 0 0 1 12 21.4a5.4 5.4 0 0 1-5.4-5.6c0-2.2 1.3-3.6 2.3-5 .3 1.6 1 2.4 1.8 2.7-.6-3.4.7-6.2 1.3-10.9Z"/>'
    },
    {
      key: 'earth', cn: '大地母神', en: 'Earth Mother', hue: 108, s: 0.38, l: 0.62,
      tenet: '丰产与守土，敬农耕', bias: { plains: 2.8, grassland: 2.2, forest: 1.7, swamp: 1.3 },
      sym: '<circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
           '<circle cx="12" cy="12" r="3.4"/>'
    },
    {
      key: 'spirit', cn: '万灵萨满', en: 'Spirit Shamanism', hue: 150, s: 0.34, l: 0.50,
      tenet: '山川皆有灵，祭祖通神', bias: { tundra: 2.6, forest: 1.9, mountains: 1.6, swamp: 1.3 },
      sym: '<circle cx="12" cy="6.4" r="2.4"/><circle cx="6.6" cy="16.4" r="2.4"/><circle cx="17.4" cy="16.4" r="2.4"/>'
    },
    {
      key: 'abyss', cn: '深渊教团', en: 'Abyssal Order', hue: 292, s: 0.38, l: 0.58,
      tenet: '深渊低语，秘密结社', bias: { swamp: 2.8, coast: 1.6, mountains: 1.4 },
      sym: '<path d="M12 2.8 21 12l-9 9.2L3 12z" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
           '<circle cx="12" cy="12" r="2.2"/>'
    },
    {
      key: 'ancestor', cn: '先祖崇拜', en: 'Ancestor Rites', hue: 76, s: 0.30, l: 0.52,
      tenet: '敬祖立宗，家族为本', bias: { plains: 2.2, grassland: 2.0, hills: 1.7, coast: 1.4 },
      sym: '<path d="M6.4 9.4h11.2l-1.6 3H8z"/><path d="M9.6 12.4h4.8V20H9.6z"/>' +
           '<path d="M6.6 20.4h10.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'
    },
    {
      key: 'twin', cn: '双生神教', en: 'Twin Deities', hue: 330, s: 0.40, l: 0.66,
      tenet: '阴阳双神，讲求平衡', bias: { hills: 1.9, forest: 1.8, coast: 1.6, plains: 1.5 },
      sym: '<circle cx="8.6" cy="12" r="5" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
           '<circle cx="15.4" cy="12" r="5" fill="none" stroke="currentColor" stroke-width="1.8"/>'
    },
    {
      key: 'silence', cn: '静默修会', en: 'Silent Order', hue: 220, s: 0.20, l: 0.60,
      tenet: '禁语苦修，以静观世', bias: { tundra: 2.4, mountains: 2.2, desert: 1.5, hills: 1.3 },
      sym: '<circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="3.2"/>'
    }
  ];
  AO.FAITHS = FAITHS;

  /* 表里只写"语义色相"，颜色在这里统一生成（与国旗同一套 HSL 规则）：
   * 10 个色相彼此 ≥30°（日金 / 火红 / 先祖橄榄 / 大地绿 / 万灵青绿 /
   * 星辰青 / 静默灰蓝 / 月影靛 / 深渊紫 / 双生玫），饱和度和明度错开，
   * 所以宗教视图里任意两块不同信仰的地块都不会混成一片。 */
  (function () {
    var pal = AO.buildDataPalette(FAITHS, { sMax: 0.55 });
    for (var fi = 0; fi < FAITHS.length; fi++) FAITHS[fi].color = pal[fi];
  })();

  /* 无神论 / 世俗主义：不进加权抽取池（否则会抽出一个「无神论国教」），
   * 但它会作为构成里的一个分量出现在每个国家，共和/联邦国家里还常常是最大的一块。 */
  var IRRELIGION = {
    key: 'none', cn: '无神论', en: 'Irreligion', color: AO.hslToHex(215, 0.08, 0.62),
    tenet: '不设国教，信仰自由，以世俗法与理性为纲',
    sym: '<g fill="none" stroke="currentColor" stroke-width="1.5">' +
         '<ellipse cx="12" cy="12" rx="9" ry="3.8" transform="rotate(-30 12 12)"/>' +
         '<ellipse cx="12" cy="12" rx="9" ry="3.8" transform="rotate(30 12 12)"/></g>' +
         '<circle cx="12" cy="12" r="1.9"/>'
  };
  AO.IRRELIGION = IRRELIGION;

  /* 地形 → 人口密度（人 / km²）。
   * coast 这一项现在是"滨海平原"（低地沿海），所以密度最高合理 ——
   * 沿海的山地/丘陵走 mountains / hills 自己的低密度，不再一刀切加成都给。 */
  var DENSITY = {
    plains: 46, grassland: 26, forest: 22, coast: 52, hills: 18,
    mountains: 7, desert: 3.2, tundra: 1.8, swamp: 6, islands: 24
  };

  /* 地形配色（构成条 / 图例用）。
   * 这 10 个是**语义色**，不能像国旗那样在色相环上均分 —— 森林必须绿、
   * 沙漠必须沙黄、苔原必须冷灰蓝，否则读图要重新学一遍。所以只统一
   * "模型"：一样走 HSL、一样把饱和度压在 0.45 以下（比国旗更灰更土），
   * 这样和地图上的国家色放在一起不会打架。 */
  var TERRAIN_HSL = {
    plains:    [58, 0.34, 0.72],
    grassland: [78, 0.38, 0.64],
    forest:    [108, 0.28, 0.50],
    hills:     [38, 0.26, 0.60],
    mountains: [25, 0.12, 0.52],
    desert:    [45, 0.42, 0.78],
    tundra:    [200, 0.10, 0.82],
    swamp:     [158, 0.20, 0.50],
    coast:     [202, 0.30, 0.68],
    islands:   [192, 0.26, 0.74]
  };
  var TERRAIN_TINT = {};
  for (var tk in TERRAIN_HSL) {
    TERRAIN_TINT[tk] = AO.hslToHex(TERRAIN_HSL[tk][0], TERRAIN_HSL[tk][1], TERRAIN_HSL[tk][2]);
  }
  AO.TERRAIN_TINT = TERRAIN_TINT;
  AO.TERRAIN_TINT_HSL = TERRAIN_HSL;

  function pickWeighted(list, weightOf, rng) {
    var total = 0, i;
    for (i = 0; i < list.length; i++) total += weightOf(list[i]);
    var r = rng.next() * total;
    for (i = 0; i < list.length; i++) {
      r -= weightOf(list[i]);
      if (r <= 0) return list[i];
    }
    return list[list.length - 1];
  }

  /* ---------------- 头像 ----------------
   * 纯几何：底色 → 肩 → 颈 → 头 → 发 → 五官 → 头饰。
   * 用扁平色块，不描边，96×96 缩到 76px 仍然清楚。 */
  var SKIN = ['#f2cfae', '#e8b891', '#d6a077', '#bd8256', '#9c6039', '#7a4526'];
  var HAIR = ['#2a2a33', '#3f3026', '#5b3d28', '#8a6224', '#c9bfae', '#7d7d88', '#a8402f'];
  var CLOTH = ['#3f4a5a', '#5a4636', '#4a5b48', '#6b3f45', '#3d4f63', '#574a6b'];

  var portraitSeq = 0;

  AO.makePortrait = function (seed, opt) {
    opt = opt || {};
    var r = new AO.RNG(seed >>> 0);
    var skin = SKIN[r.int(SKIN.length)];
    var hair = HAIR[r.int(HAIR.length)];
    var cloth = opt.cloth || CLOTH[r.int(CLOTH.length)];
    var bg = opt.color || '#b0492f';
    var female = opt.gender === 'f';
    /* 发型按性别分池：女版不出光头 / 后移发际线，男版不出长发 / 齐肩。
     * 之前不分性别，结果「女王」顶着络腮胡出场。 */
    var style = female
      ? [1, 3, 4, 6][r.int(4)]            // 长发 / 发髻 / 马尾 / 齐肩
      : [0, 0, 2, 5, 4][r.int(5)];        // 短发 / 光头 / 后移 / 马尾
    var beard = !female && r.next() < 0.34;
    var glasses = r.next() < 0.16;
    var hat = opt.hat || (r.next() < 0.5 ? 'crown' : 'none');
    var uid = 'pt' + (++portraitSeq);

    function shade(hex, k) {           // 简单压暗，做颈部阴影
      var h = hex.replace('#', '');
      var n = parseInt(h, 16);
      var rr = Math.max(0, Math.round(((n >> 16) & 255) * k));
      var gg = Math.max(0, Math.round(((n >> 8) & 255) * k));
      var bb = Math.max(0, Math.round((n & 255) * k));
      return 'rgb(' + rr + ',' + gg + ',' + bb + ')';
    }
    var skinDark = shade(skin, 0.84);

    var s = [];
    s.push('<svg viewBox="0 0 96 96" width="100%" height="100%" preserveAspectRatio="xMidYMid slice">');
    s.push('<defs><clipPath id="' + uid + '"><rect x="0" y="0" width="96" height="96" rx="12"/></clipPath></defs>');
    // 整体放大 14%：头像缩到 76px 时脸只有 30px，放大后五官才看得清
    s.push('<g clip-path="url(#' + uid + ')" transform="translate(-6.72,-7.56) scale(1.14)">');
    // 背景：国家色淡底 + 一道斜带
    s.push('<rect width="96" height="96" fill="#f4f0e8"/>');
    s.push('<circle cx="48" cy="52" r="52" fill="' + bg + '" opacity=".17"/>');
    s.push('<path d="M-10 96 L40 -10 L58 -10 L8 96 Z" fill="' + bg + '" opacity=".10"/>');

    // 肩
    s.push('<path d="M6 96 C10 73 28 64 48 64 C68 64 86 73 90 96 Z" fill="' + cloth + '"/>');
    // 领口
    s.push('<path d="M40 65 L48 78 L56 65 L52 64 L48 71 L44 64 Z" fill="#f4f0e8" opacity=".92"/>');
    // 颈（女版略细一点）
    s.push(female
      ? '<path d="M41.8 52 h12.4 v10 a6.2 6.2 0 0 1 -12.4 0 Z" fill="' + skinDark + '"/>'
      : '<path d="M41 52 h14 v10 a7 7 0 0 1 -14 0 Z" fill="' + skinDark + '"/>');
    // 头
    s.push('<ellipse cx="48" cy="41" rx="16.2" ry="18.6" fill="' + skin + '"/>');
    s.push('<ellipse cx="31.4" cy="43" rx="2.8" ry="4.2" fill="' + skin + '"/>');
    s.push('<ellipse cx="64.6" cy="43" rx="2.8" ry="4.2" fill="' + skin + '"/>');

    // 发
    if (style === 0) {          // 短发
      s.push('<path d="M31.8 39 C31.2 24 37 19.6 48 19.6 C59 19.6 64.8 24 64.2 39 C63.6 30.6 58 27.6 48 27.6 C38 27.6 32.4 30.6 31.8 39 Z" fill="' + hair + '"/>');
    } else if (style === 1) {   // 长发
      s.push('<path d="M30.4 38 C30 23 37 19 48 19 C59 19 66 23 65.6 38 L66 62 C64 66 62.4 66 61.6 61 L61 40 C58 33 56 30 48 30 C40 30 38 33 35 40 L34.4 61 C33.6 66 32 66 30 62 Z" fill="' + hair + '"/>');
    } else if (style === 2) {   // 光头
      s.push('<ellipse cx="43" cy="27.6" rx="7" ry="3.2" fill="#ffffff" opacity=".18"/>');
    } else if (style === 3) {   // 发髻
      s.push('<path d="M31.8 38 C31.4 24 37 20 48 20 C59 20 64.6 24 64.2 38 C63.4 30 58 27.4 48 27.4 C38 27.4 32.6 30 31.8 38 Z" fill="' + hair + '"/>');
      s.push('<circle cx="48" cy="17.4" r="5.4" fill="' + hair + '"/>');
    } else if (style === 4) {   // 马尾
      s.push('<path d="M31.8 38 C31.4 24 37 20 48 20 C59 20 64.6 24 64.2 38 C63.4 30 58 27.4 48 27.4 C38 27.4 32.6 30 31.8 38 Z" fill="' + hair + '"/>');
      s.push('<path d="M63 32 C72 34 74 46 70 58 C68 62 64 61 65 56 C68 47 67 39 62 36 Z" fill="' + hair + '"/>');
    } else if (style === 6) {   // 齐肩（两侧垂到下颌）
      s.push('<path d="M30.8 39 C30.2 23.6 37 19.4 48 19.4 C59 19.4 65.8 23.6 65.2 39 C65.6 48 66.2 54.6 64.6 58 C63.2 60.4 61 59.8 61.2 55 C61.4 47 59.6 34.4 48 34.4 C36.4 34.4 34.6 47 34.8 55 C35 59.8 32.8 60.4 31.4 58 C29.8 54.6 30.4 48 30.8 39 Z" fill="' + hair + '"/>');
    } else {                    // 后移发际线
      s.push('<path d="M31.8 36 C33 28 36.4 24.6 40 24 L40 30 C37 31.4 35 33.6 34 37 Z" fill="' + hair + '"/>');
      s.push('<path d="M64.2 36 C63 28 59.6 24.6 56 24 L56 30 C59 31.4 61 33.6 62 37 Z" fill="' + hair + '"/>');
    }

    // 眉（女版细一点、带一点弧）
    var browPath = female ? 'M38.2 36.8 q4 -3 7.8 -0.7' : 'M38 36.4 q4.4 -2.2 8 0';
    var browW = female ? 1.35 : 1.7;
    s.push('<path d="' + browPath + '" stroke="' + hair + '" stroke-width="' + browW + '" fill="none" stroke-linecap="round"/>');
    s.push('<path d="' + (female ? 'M50 36.1 q3.8 -2.3 7.8 0.7' : 'M50 36.4 q4.4 -2.2 8 0') +
      '" stroke="' + hair + '" stroke-width="' + browW + '" fill="none" stroke-linecap="round"/>');
    // 眼
    s.push('<ellipse cx="41.6" cy="42" rx="2.5" ry="2.2" fill="#fbf7f0"/>');
    s.push('<ellipse cx="54.4" cy="42" rx="2.5" ry="2.2" fill="#fbf7f0"/>');
    s.push('<circle cx="41.8" cy="42" r="1.35" fill="#2b3037"/>');
    s.push('<circle cx="54.6" cy="42" r="1.35" fill="#2b3037"/>');
    if (glasses) {
      s.push('<g fill="none" stroke="#3a4046" stroke-width="1.1" opacity=".85">' +
        '<circle cx="41.6" cy="42" r="4.2"/><circle cx="54.4" cy="42" r="4.2"/>' +
        '<path d="M45.8 42h4.4M37.4 41.4l-4 1M58.6 41.4l4 1"/></g>');
    }
    // 鼻 / 嘴
    s.push('<path d="M48.2 43.6 v5.2 q0 1.5 -1.8 1.8" stroke="' + skinDark + '" stroke-width="1.3" fill="none" stroke-linecap="round"/>');
    if (beard) {
      s.push('<path d="M33.4 44 C33.4 60 39.4 66.6 48 66.6 C56.6 66.6 62.6 60 62.6 44 C60 54 55 57 48 57 C41 57 36 54 33.4 44 Z" fill="' + hair + '" opacity=".94"/>');
      s.push('<path d="M43.6 52.6 q4.4 2.4 8.8 0" stroke="#8d4b41" stroke-width="1.7" fill="none" stroke-linecap="round"/>');
      s.push('<path d="M43.4 50.4 q4.6 -1.6 9.2 0" stroke="' + hair + '" stroke-width="1.6" fill="none" stroke-linecap="round" opacity=".9"/>');
    } else if (female) {
      // 女版：嘴唇画成有厚度的形，不用一根线
      s.push('<path d="M43.4 53.2 q4.6 -1.8 9.2 0 q-4.6 4.2 -9.2 0 Z" fill="#bd6660"/>');
      s.push('<path d="M43.4 53.2 q4.6 -1.8 9.2 0" stroke="#9c514c" stroke-width=".9" fill="none" stroke-linecap="round"/>');
    } else {
      s.push('<path d="M43.8 53.4 q4.2 2.6 8.4 0" stroke="#a4605a" stroke-width="1.8" fill="none" stroke-linecap="round"/>');
    }

    /* 女版的首饰：耳坠 + 领口项链。画在头发和衣服之上，才不会被长发盖掉。 */
    if (female) {
      s.push('<circle cx="31.4" cy="47.8" r="1.7" fill="#e6bd52" stroke="#b8892c" stroke-width=".6"/>');
      s.push('<circle cx="64.6" cy="47.8" r="1.7" fill="#e6bd52" stroke="#b8892c" stroke-width=".6"/>');
      s.push('<path d="M41 66.4 q7 6 14 0" stroke="#e6bd52" stroke-width="1.2" fill="none" stroke-linecap="round"/>');
      s.push('<circle cx="48" cy="70.6" r="1.9" fill="#b0492f" stroke="#8d3a26" stroke-width=".6"/>');
    }

    // 头饰
    if (hat === 'crown') {
      s.push('<path d="M33 26.6 L36.4 15.8 L42 21.6 L48 12.6 L54 21.6 L59.6 15.8 L63 26.6 Z" fill="#e6bd52" stroke="#b8892c" stroke-width="1.1" stroke-linejoin="round"/>');
      s.push('<circle cx="48" cy="21.4" r="1.9" fill="#b0492f"/>');
      s.push('<circle cx="37.6" cy="23.4" r="1.4" fill="#b0492f"/><circle cx="58.4" cy="23.4" r="1.4" fill="#b0492f"/>');
    } else if (hat === 'laurel') {
      /* 桂冠：两条细弧 + 沿弧排的小椭圆叶。之前用圆点当叶子，
       * 缩到 76px 就是额头上几颗绿痣。 */
      s.push('<g fill="none" stroke="#6f8c46" stroke-width="2.2" stroke-linecap="round">' +
        '<path d="M30.8 34.4 C29.4 26.6 34.4 21.2 40.4 19.8"/>' +
        '<path d="M65.2 34.4 C66.6 26.6 61.6 21.2 55.6 19.8"/></g>');
      var leaves = [
        [31.4, 30.4, -58], [33.2, 25.6, -42], [36.4, 21.8, -24], [40.2, 19.9, -8],
        [64.6, 30.4, 58], [62.8, 25.6, 42], [59.6, 21.8, 24], [55.8, 19.9, 8]
      ];
      var lg = '<g fill="#8fae55">';
      for (var li = 0; li < leaves.length; li++) {
        lg += '<ellipse cx="' + leaves[li][0] + '" cy="' + leaves[li][1] +
          '" rx="2.9" ry="1.5" transform="rotate(' + leaves[li][2] + ' ' + leaves[li][0] + ' ' + leaves[li][1] + ')"/>';
      }
      s.push(lg + '</g>');
    } else if (hat === 'turban') {
      s.push('<path d="M30 32.6 C30 18.6 66 18.6 66 32.6 C66 35.6 30 35.6 30 32.6 Z" fill="#f0ece2" stroke="#d6cfc0" stroke-width="1"/>');
      s.push('<path d="M30.6 30.6 C38 27 58 27 65.4 30.6" stroke="#d6cfc0" stroke-width="1" fill="none"/>');
      s.push('<circle cx="48" cy="30.8" r="2.6" fill="#b0492f" stroke="#8d3a26" stroke-width=".8"/>');
    }

    s.push('</g></svg>');
    return s.join('');
  };

  /* =============================================================
   * 国家派生量的聚合（生成期 & 改归属后共用）
   *
   * 地形构成 / 信仰构成 / 人口与面积这三块，本质上都是"成员省的纯函数"——
   * 所以把一省划给别国之后可以直接重算（见文件末尾的 AO.recomputeCountry）。
   *
   * 唯一的坑：信仰构成里有**两个随机数**（无神论份额 irrPct、国教判定 stateRoll）。
   * 复算时不能重新摇骰子 —— 那会出现"同一块地划过去，信仰比例却变了"。
   * 所以生成时把这两个数存到国家上（c.irrPct / c.faithRoll），复算时沿用。
   * 下面两个函数都不碰 rng，调用方把随机数当参数传进来。
   * ============================================================= */

  /* 地形构成：按成员省面积聚合，pct 降序。返回 { list, totalArea } */
  function terrainCompOf(ids, provinces) {
    var byTerrain = {}, totalArea = 0, i;
    for (i = 0; i < ids.length; i++) {
      var pv = provinces[ids[i] - 1];
      if (!pv) continue;
      var t = pv.terrain || 'plains';
      byTerrain[t] = (byTerrain[t] || 0) + pv.area;
      totalArea += pv.area;
    }
    var list = [];
    for (var key in byTerrain) {
      if (!byTerrain.hasOwnProperty(key)) continue;
      list.push({
        key: key,
        cn: AO.TERRAIN_CN[key] || key,
        area: byTerrain[key],
        pct: totalArea > 0 ? byTerrain[key] / totalArea : 0,
        color: TERRAIN_TINT[key] || '#b9c977'
      });
    }
    list.sort(function (a, b) { return b.area - a.area; });
    return { list: list, totalArea: totalArea };
  }

  /* 信仰构成：成员省按 faithIdx 的面积聚合 + 无神论份额。
   * 返回 { parts, faith, diversity, secular }（形状与 c.faiths / c.faith 对齐） */
  function faithsOf(ids, provinces, irrPct, stateRoll) {
    var byFaith = {}, faithSum = 0, i;
    for (i = 0; i < ids.length; i++) {
      var pv = provinces[ids[i] - 1];
      if (!pv) continue;
      var fidx = pv.faithIdx;
      if (fidx === undefined || fidx < 0) continue;
      byFaith[fidx] = (byFaith[fidx] || 0) + pv.area;
      faithSum += pv.area;
    }

    var fkeys = [];
    for (var fk in byFaith) if (byFaith.hasOwnProperty(fk)) fkeys.push(+fk);
    fkeys.sort(function (a, b) { return byFaith[b] - byFaith[a]; });

    var parts = [], kept = 0;
    for (var ki = 0; ki < fkeys.length; ki++) {
      var share = faithSum > 0 ? byFaith[fkeys[ki]] / faithSum : 0;
      if (share < 0.02 && fkeys.length > 2) continue;      // 1% 的碎信仰不显示
      parts.push({ f: FAITHS[fkeys[ki]], pct: share * (1 - irrPct) });
      kept += share;
    }
    // 丢掉碎块后，剩下的份额按 kept 重新归一到 (1 - irrPct)
    if (kept > 0) {
      for (var pi3 = 0; pi3 < parts.length; pi3++) parts[pi3].pct /= kept;
    }
    parts.push({ f: IRRELIGION, pct: irrPct });
    parts.sort(function (a, b) { return b.pct - a.pct; });

    // 国教：主信仰要过半，而且得明显压过第二名 ——
    // 否则会出现「国教 49% + 无神论 43%」这种自相矛盾的国家
    var second = parts[1] ? parts[1].pct : 0;
    var isState = parts[0].f !== IRRELIGION &&
                  parts[0].pct >= 0.50 &&
                  (parts[0].pct - second) >= 0.12 &&
                  stateRoll < 0.85;
    var out = parts.map(function (x) {
      return {
        key: x.f.key, cn: x.f.cn, en: x.f.en, color: x.f.color,
        tenet: x.f.tenet, sym: x.f.sym,
        pct: x.pct,
        state: isState && x.f === parts[0].f
      };
    });
    return { parts: out, faith: out[0], diversity: out.length, secular: out[0].key === 'none' };
  }

  /* ---------------- 主入口 ----------------
   * @param o { countries, provinces, rng, seedInt, width, meta } */
  AO.buildSociety = function (o) {
    var countries = o.countries;
    var provinces = o.provinces;
    var rng = o.rng;
    var kmPerPx = 6000 / (o.width || 2400);      // 世界宽度固定视作 6000 km
    var km2PerPx = kmPerPx * kmPerPx;
    var ng = new AO.NameGen(rng.fork('persons'));

    /* =========================================================
     * 信仰场：先把信仰铺成一片连着的"文化区"，再按省取值
     *
     * 为什么不能每个国家独立抽一次：那样 64 个国家会抽出 64 种互不相干的
     * 信仰，邻国之间毫无关系，一眼就假。现实里信仰是**连片**的 ——
     * 一个文化区里十几个国家信同一个教，只有边境地带才混杂。
     *
     * 做法：每个信仰有一个"发源地"，分数 = 地形亲和 × 离发源地的衰减 ×
     * 一张只属于它自己的低频噪声。逐省取分数最高的信仰，自然长出
     * 连片的宗教区，而且边界是毛的、不是几何分割线。
     * ========================================================= */
    var bbox = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    var pi0, p0;
    for (pi0 = 0; pi0 < provinces.length; pi0++) {
      p0 = provinces[pi0];
      if (!p0 || !p0.centroid) continue;
      if (p0.centroid[0] < bbox.x0) bbox.x0 = p0.centroid[0];
      if (p0.centroid[0] > bbox.x1) bbox.x1 = p0.centroid[0];
      if (p0.centroid[1] < bbox.y0) bbox.y0 = p0.centroid[1];
      if (p0.centroid[1] > bbox.y1) bbox.y1 = p0.centroid[1];
    }
    if (!isFinite(bbox.x0)) { bbox = { x0: 0, y0: 0, x1: 1000, y1: 1000 }; }
    var spanX = Math.max(1, bbox.x1 - bbox.x0);
    var spanY = Math.max(1, bbox.y1 - bbox.y0);
    var spanMax = Math.max(spanX, spanY);

    var anchors = [];
    /* 发源地用"最远点采样"撒在**陆地省份的质心**上：
     * 纯随机撒会让两个教派挤在一起，宗教区碎成一团。最远点保证
     * 10 个发源地互相拉开，各自长出一片大区。 */
    var cand = [];
    for (pi0 = 0; pi0 < provinces.length; pi0++) {
      p0 = provinces[pi0];
      if (p0 && p0.centroid) cand.push(p0.centroid);
    }
    for (var af = 0; af < FAITHS.length; af++) {
      var bestPt = null, bestD = -1;
      for (var tr = 0; tr < 80; tr++) {
        var candPt = cand[rng.int(cand.length)];
        var minD = Infinity;
        for (var aj = 0; aj < anchors.length; aj++) {
          var ddx = candPt[0] - anchors[aj].x, ddy = candPt[1] - anchors[aj].y;
          var d2 = ddx * ddx + ddy * ddy;
          if (d2 < minD) minD = d2;
        }
        if (minD > bestD) { bestD = minD; bestPt = candPt; }
      }
      anchors.push({
        f: FAITHS[af],
        x: bestPt[0], y: bestPt[1],
        nz: AO.makeNoise((o.seedInt ^ AO.hashString('faith:' + FAITHS[af].key)) >>> 0)
      });
    }
    var SIG2 = 2 * Math.pow(0.20 * spanMax, 2);   // 发源地影响半径
    var NF = 1 / (0.36 * spanMax);                // 噪声波长 ≈ 1/3 图宽

    // 逐省定信仰
    var provFaith = new Int8Array(provinces.length);
    for (var pi1 = 0; pi1 < provinces.length; pi1++) {
      var p1 = provinces[pi1];
      if (!p1 || !p1.centroid) { provFaith[pi1] = -1; continue; }
      var cx1 = p1.centroid[0], cy1 = p1.centroid[1];
      var tKey = p1.terrain || 'plains';
      var bestFi = 0, bestSc = -1;
      for (var fi = 0; fi < anchors.length; fi++) {
        var a = anchors[fi];
        var dx = cx1 - a.x, dy = cy1 - a.y;
        var blob = Math.exp(-(dx * dx + dy * dy) / SIG2);
        var tb = a.f.bias[tKey] || 1;
        var nz = 0.5 + 0.5 * a.nz.fbm(cx1 * NF + 7.3, cy1 * NF - 2.1, 2);
        var sc = (0.74 + 0.32 * tb) * (0.30 + 0.80 * blob) * (0.86 + 0.14 * nz);
        if (sc > bestSc) { bestSc = sc; bestFi = fi; }
      }
      provFaith[pi1] = bestFi;
    }

    /* 邻域多数平滑：把被包围的"孤岛省"并回周围。
     * 单靠打分总会留下一些零星的反色小块，在信仰地图上像噪点；
     * 两轮"邻居 60% 以上同教就跟着改"就能清掉，而且不改变大区形状。 */
    for (var pass = 0; pass < 2; pass++) {
      var changed = 0;
      for (var pi4 = 0; pi4 < provinces.length; pi4++) {
        var p4 = provinces[pi4];
        if (!p4 || !p4.neighbors || p4.neighbors.length < 3) continue;
        var cnt = {}, tot2 = 0, ni;
        for (ni = 0; ni < p4.neighbors.length; ni++) {
          var q4 = provinces[p4.neighbors[ni] - 1];
          if (!q4 || provFaith[p4.neighbors[ni] - 1] < 0) continue;
          var fq = provFaith[p4.neighbors[ni] - 1];
          cnt[fq] = (cnt[fq] || 0) + 1;
          tot2++;
        }
        var bestK = -1, bestC = 0;
        for (var ck in cnt) if (cnt[ck] > bestC) { bestC = cnt[ck]; bestK = +ck; }
        if (bestK >= 0 && bestK !== provFaith[pi4] && bestC >= tot2 * 0.6) {
          provFaith[pi4] = bestK;
          changed++;
        }
      }
      if (!changed) break;
    }

    // 落到省份对象上（渲染宗教视图 / 卡片统计都要用）
    for (var pi5 = 0; pi5 < provinces.length; pi5++) {
      var p5 = provinces[pi5];
      if (!p5) continue;
      var idx5 = provFaith[pi5];
      p5.faithIdx = idx5;
      p5.faithKey = idx5 >= 0 ? FAITHS[idx5].key : '';
      p5.faithName = idx5 >= 0 ? FAITHS[idx5].cn : '';
      p5.faithColor = idx5 >= 0 ? FAITHS[idx5].color : '#cccccc';
    }

    for (var ci = 0; ci < countries.length; ci++) {
      var c = countries[ci];
      var gov = GOV[c.gov] || GOV.kingdom;

      /* --- 地形构成：按省份面积聚合 --- */
      var tcx = terrainCompOf(c.provinces, provinces);
      var comp = tcx.list, totalArea = tcx.totalArea;

      /* --- 人口：面积 × 地形密度 × 政体修正 --- */
      var pop = 0;
      for (var k2 = 0; k2 < comp.length; k2++) {
        pop += comp[k2].area * km2PerPx * (DENSITY[comp[k2].key] || 20);
      }
      var econBias = /资本主义|自由市场|重商/.test(gov.econ[0]) ? 1.22 : /部落|畜牧/.test(gov.econ[0]) ? 0.72 : 0.92;
      pop = pop * econBias * (0.88 + rng.next() * 0.26);
      pop = Math.max(12000, Math.round(pop / 1000) * 1000);

      /* --- 信仰构成：按省份所属信仰的面积聚合 + 无神论 ---
       * 主信仰不是"抽"出来的，而是它在这个国家占的省份最多 —— 于是邻国
       * 天然共享同一个主信仰，只有跨在宗教区边界上的国家才会出现明显的混合。
       *
       * 两个随机数在**这里**摇（顺序和以前完全一样，世界指纹不动），
       * 然后连同"聚合"一起交给 faithsOf —— 它自己不碰 rng，
       * 所以改归属之后可以拿存下来的这两个数复算出一模一样的构成。 */
      var secularGov = /共和|联邦|联盟/.test(gov.cn);
      // 无神论份额：共和/联邦明显更高，高到能压过主信仰时就是世俗国家
      var irrPct = secularGov ? 0.12 + rng.next() * 0.44 : 0.02 + rng.next() * 0.16;
      var stateRoll = rng.next();
      var fsx = faithsOf(c.provinces, provinces, irrPct, stateRoll);
      c.faiths = fsx.parts;
      c.faith = fsx.faith;            // 最大的一块，卡片主行 / 导出用
      c.faithDiversity = fsx.diversity;
      c.secular = fsx.secular;
      /* 存下这两个随机数：改归属后复算信仰构成要用（见 AO.recomputeCountry） */
      c.irrPct = irrPct;
      c.faithRoll = stateRoll;

      /* --- 领导人 --- */
      var person = ng.person();
      var titleIdx = person.gender === 'f' ? 1 : 0;
      var title = gov.titles[Math.min(titleIdx, gov.titles.length - 1)];
      var leaderAge = 28 + rng.int(44);
      // 在位年数不能长过"懂事以后"的岁数，否则 28 岁在位 26 年很出戏
      var reign = 1 + rng.int(Math.max(1, Math.min(28, leaderAge - 18)));

      /* --- 头像：政体决定头饰 --- */
      var hat = 'none';
      if (/kingdom|empire|grandduchy|duchy/.test(c.gov)) hat = rng.next() < 0.78 ? 'crown' : 'none';
      else if (/khanate/.test(c.gov)) hat = 'turban';
      else if (/republic|federation|league/.test(c.gov)) hat = rng.next() < 0.35 ? 'laurel' : 'none';

      c.govKey = c.gov;
      c.govCn = gov.cn;
      c.economy = gov.econ[rng.int(gov.econ.length)];
      c.house = gov.house ? ng.house() : '';
      c.leader = {
        name: person.name,
        name_en: person.name_en,
        gender: person.gender,
        title: title,
        age: leaderAge,
        reign: reign
      };
      c.portraitHat = hat;
      c.portrait = AO.makePortrait((o.seedInt ^ (c.id * 2654435761)) >>> 0, {
        color: c.color, hat: hat, gender: person.gender
      });
      c.population = pop;
      /* 省人口：按"面积 × 地形密度"把国人口摊到各省 —— 各省之和 = 国人口。
       * 密度用的是同一张 DENSITY 表，所以草原省天然比山地省人多。 */
      var pws = [], psum = 0, pi5;
      for (pi5 = 0; pi5 < c.provinces.length; pi5++) {
        var pv5 = provinces[c.provinces[pi5] - 1];
        var w5 = pv5 ? pv5.area * (DENSITY[pv5.terrain || 'plains'] || 20) : 0;
        pws.push(w5);
        psum += w5;
      }
      var givenPop = 0, lastPopIdx = -1;
      for (pi5 = 0; pi5 < c.provinces.length; pi5++) {
        var pv6 = provinces[c.provinces[pi5] - 1];
        if (!pv6) continue;
        var v6 = psum > 0 ? Math.round(pop * pws[pi5] / psum / 100) * 100 : 0;
        pv6.population = Math.max(100, v6);
        givenPop += pv6.population;
        lastPopIdx = pi5;
      }
      /* 四舍五入的零头塞给最后一个省，保证各省之和正好等于国人口。
       *
       * 不能简单写 Math.max(100, last + delta)：delta 是**负数**时
       * （前面几省各自向上取整，攒多了）如果最后一个省本来就贴着 100 的下限，
       * clamp 会把这笔负零头整个吃掉 —— 于是"各省之和 = 国人口"这条不变量破掉，
       * 而自检只允许 0.5% 的误差。负零头要从**人口最多的省**往回扣，扣到 100 为止。 */
      if (lastPopIdx >= 0) {
        var pvLast = provinces[c.provinces[lastPopIdx] - 1];
        if (pvLast) {
          var delta6 = pop - givenPop;
          if (delta6 >= 0) {
            pvLast.population += delta6;
          } else {
            var order6 = [], oi;
            for (pi5 = 0; pi5 < c.provinces.length; pi5++) {
              var px6 = provinces[c.provinces[pi5] - 1];
              if (px6) order6.push(px6);
            }
            order6.sort(function (a, b) { return b.population - a.population; });
            var need6 = -delta6;
            for (oi = 0; oi < order6.length && need6 > 0; oi++) {
              var room6 = order6[oi].population - 100;
              if (room6 <= 0) continue;
              var take6 = Math.min(room6, need6);
              order6[oi].population -= take6;
              need6 -= take6;
            }
            /* 极端情况：所有省都贴着 100 还扣不动（100 × 省数 > 国人口）。
             * 这时按比例整体缩到 pop —— 100 只是"别出现无人区"的软下限，
             * 总和才是硬约束。实际世界里不会走到这里（国人口下限 12000）。 */
            if (need6 > 0) {
              var tot6 = 0;
              for (oi = 0; oi < order6.length; oi++) tot6 += order6[oi].population;
              var ratio6 = tot6 > 0 ? (tot6 - need6) / tot6 : 1;
              var acc6 = 0;
              for (oi = 0; oi < order6.length; oi++) {
                order6[oi].population = Math.max(1, Math.floor(order6[oi].population * ratio6));
                acc6 += order6[oi].population;
              }
              if (order6.length) order6[0].population += (pop - acc6);
            }
          }
        }
      }
      c.terrainComp = comp;
      c.kmPerPx = kmPerPx;
      c.areaKm2 = Math.round(totalArea * km2PerPx);
      c.density = Math.round(pop / Math.max(1, c.areaKm2));
    }
    return countries;
  };

  /* 人口格式化：中文习惯的 万 / 亿 */
  AO.formatPop = function (n) {
    if (n >= 1e8) return (n / 1e8).toFixed(2) + ' 亿';
    if (n >= 1e4) return (n / 1e4).toFixed(n >= 1e6 ? 0 : 1) + ' 万';
    return String(n);
  };

  /* =============================================================
   * 改归属之后重算一个国家的派生量
   *
   * 涂色（10-render 的 paint）原来只搬了省份 id 就 rebuild 了 —— 于是
   * 国家卡上的人口 / 面积 / 地形构成 / 信仰构成 / 邻国**全部停在改之前**，
   * 自检里"各省人口之和 = 国人口"当场破掉（test/interact.js 就是这么红的）。
   *
   * 这里只重算**成员省的纯函数**：人口、面积、密度、地形、信仰、邻国、首都、资源汇总。
   * 不动名字 / 政体 / 领导人 / 颜色这些"身份"字段 —— 那些跟领土无关。
   *
   * 为什么人口取"各省之和"而不是再按面积×密度算一遍：改归属只是**搬运**，
   * 总人口不该因为一条边界挪了一格就凭空多出几万人。所以这里是搬运后的守恒：
   * 国人口 = 它现在真正管着的那些省的人口之和。
   * ============================================================= */
  AO.recomputeCountry = function (world, c) {
    if (!world || !c) return c;
    var provinces = world.provinces;
    var ids = c.provinces || [];
    var i, p;

    /* --- 人口 / 面积 / 密度 --- */
    var pop = 0, area = 0;
    for (i = 0; i < ids.length; i++) {
      p = provinces[ids[i] - 1];
      if (!p) continue;
      pop += p.population || 0;
      area += p.area || 0;
    }
    var kmPerPx = c.kmPerPx || (6000 / ((world.meta && world.meta.width) || 2400));
    c.kmPerPx = kmPerPx;
    c.population = pop;
    c.areaKm2 = Math.round(area * kmPerPx * kmPerPx);
    c.density = Math.round(pop / Math.max(1, c.areaKm2));

    /* --- 地形构成 --- */
    c.terrainComp = terrainCompOf(ids, provinces).list;

    /* --- 信仰构成：沿用生成时摇到的那两个随机数 ---
     * 老世界对象（或者手搓的 world）没有这两个字段时给个温和的兜底：
     * 无神论 10%、国教判定当作没中 —— 不会崩，只是构成偏"世俗"。 */
    var fs = faithsOf(ids, provinces,
      typeof c.irrPct === 'number' ? c.irrPct : 0.1,
      typeof c.faithRoll === 'number' ? c.faithRoll : 0.99);
    c.faiths = fs.parts;
    c.faith = fs.faith;
    c.faithDiversity = fs.diversity;
    c.secular = fs.secular;

    /* --- 邻国：本国任意一省和别国某省相邻，两个国家就算相邻 --- */
    var set = Object.create(null);
    for (i = 0; i < ids.length; i++) {
      p = provinces[ids[i] - 1];
      if (!p || !p.neighbors) continue;
      for (var k = 0; k < p.neighbors.length; k++) {
        var q = provinces[p.neighbors[k] - 1];
        if (q && q.owner !== c.id) set[q.owner] = 1;
      }
    }
    c.neighbors = Object.keys(set).map(Number).sort(function (a, b) { return a - b; });

    /* --- 首都：丢掉了就换人口最多的那一省 --- */
    var capOk = false;
    for (i = 0; i < ids.length; i++) if (ids[i] === c.capital) { capOk = true; break; }
    if (!capOk) {
      var best = 0, bestPop = -1;
      for (i = 0; i < ids.length; i++) {
        p = provinces[ids[i] - 1];
        if (!p) continue;
        if ((p.population || 0) > bestPop) { bestPop = p.population || 0; best = p.id; }
      }
      c.capital = best;
    }

    return c;
  };

})(typeof window !== 'undefined' ? window : globalThis);
