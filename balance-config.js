/*
 * 城池帝国 · 玩法数值参数表（单一事实源）
 *
 * 所有玩法数字都集中在这里，便于后续平衡调整；改这一处即可影响：
 * 人口初始值与上限、兵力占人口比例、税率档位与增速/税收曲线、
 * 两类时效秘籍道具的增益数值、大型城池拍卖行的开放条件与经济参数。
 *
 * 注意：server/server.js 顶部有一份内容一致的 BAL 常量（服务端用于权威校验），
 * 修改本文件时必须同步修改服务端那份，否则两端行为会漂移。
 */
(function () {
  'use strict';

  const GameBalance = {
    /* ---------------- 人口 ---------------- */
    population: {
      initial: 1000,   // 每座城池的初始基础人口（固定值）
      cap: 10000       // 人口上限
    },

    /* ---------------- 兵力 ---------------- */
    troop: {
      maxRatio: 0.10   // 军队总量 ≤ 当前总人口 × 该比例（硬上限，不可突破）
    },

    /* ---------------- 地图 ---------------- */
    map: {
      // 建城位置占用判定的最小间距（经纬度，单位为“度”）：与就近吸附阈值保持一致，
      // 落点若距其他玩家已建城池小于该值即视为已占用，直接拦截建城。
      cityMinDistanceDeg: 0.16
    },

    /* ---------------- 税率（双向制衡） ----------------
     * 税率越高 → 人口自然增长越慢；税率越低 → 可获取的征兵资源（金币）越少。
     * growthPerHour 以「千分比」为单位：1000 表示每小时增长人口的 100%（即 1 倍）。
     */
    tax: {
      levels: [0, 10, 20, 30, 40, 50],
      growthPerHour: { 0: 260, 10: 210, 20: 160, 30: 110, 40: 65, 50: 25 },
      goldPerPopPerHour: { 0: 0.002, 10: 0.008, 20: 0.018, 30: 0.034, 40: 0.056, 50: 0.085 }
    },

    /* ---------------- 秘籍道具（时效增益） ----------------
     * kind='production'：作用于资源产出（target 指定资源键，乘 mul）
     * kind='power'：作用于军队战力（攻/防结算乘 mul，影响真实 PvP）
     */
    buffs: {
      farm_manual: { name: '农业发展秘籍', kind: 'production', target: 'grain', mul: 1.35, hours: 24 },
      war_manual: { name: '战斗力提升秘籍', kind: 'power', mul: 1.30, hours: 24 }
    },

    /* ---------------- 大型城池拍卖行 ---------------- */
    auction: {
      largeCityTypes: ['都城', '府城', '郡城'],   // 可上架的大型城池类型（按建城地点类型判定）
      radiusKm: 500,                             // 允许参与竞拍的“周边”范围
      durationHours: 24,                         // 挂单时长
      minPrice: 20,                              // 最低起拍价
      bidStep: 0.08,                             // 每次出价的最小加价比例（相对当前价）
      feeRate: 0.08,                             // 成交手续费比例（卖家承担）
      tradeable: ['farm_manual', 'war_manual'],   // 允许交易的道具白名单
      seedPrices: { farm_manual: 500, war_manual: 800 } // 系统寄售价（冷启动货源）
    },

    /* ---------------- 大型城市拍卖会活动 ----------------
     * 独立于上面的「拍卖行」：固定开放日 + 限时场次 + 实名门槛 + 拍品审核 + 竞价存证 + 成交订单。
     * openWeekdays 采用 JS Date.getDay() 取值（0=周日 … 6=周六），默认周三/周六。
     */
    fair: {
      openWeekdays: [3, 6],             // 拍卖开放日：周三、周六
      sessionStartHour: 20,             // 当日开场时刻（本地时区，整点）
      sessionDurationHours: 4,          // 单场固定时长（小时）
      sessionsPerDay: 1,                // 每个开放日的场次数（当前实现为 1 场）
      hostCityTypes: ['都城', '府城', '郡城'], // 可举办拍卖会的城池类型（对应现实「洛阳」这类大城）
      hostCityNames: [],                // 可选：限定具体城名白名单（空 = 不限制）
      requireRealName: true,            // 出价 / 提交拍品是否必须已完成实名认证
      reviewMode: 'auto',               // auto = 系统自动过审；manual = 人工审核
      minPrice: 50,                     // 最低起拍价（金币）
      bidStep: 0.08,                    // 最小加价比例（相对当前价）
      feeRate: 0.08,                    // 成交手续费比例（卖家承担）
      tradeable: ['farm_manual', 'war_manual'], // 可上拍拍品的道具白名单
      reservationLeadHours: 48,         // 提前预约窗口（小时）
      delivery: {
        confirmHours: 24,               // 成交后确认交割时限（小时）
        breachPenaltyRate: 0.15,        // 违约罚金比例（相对成交价）
        creditBreach: -10,              // 违约信用分变化
        offlineMeetupCityTypes: ['都城', '府城', '郡城'], // 可选「当面交割」的城池类型
        offlineFeeDiscount: 0.3,        // 当面交割手续费折扣（0.3 = 打七折）
        offlineCreditBonus: 2           // 当面交割完成的信用分加成
      }
    },

    /* ---------------- 辅助函数（供前端与校验复用） ---------------- */
    helpers: {
      /** 归一化税率到最近的合法档位 */
      normalizeTax(rate) {
        const levels = GameBalance.tax.levels;
        const n = Number(rate);
        if (!Number.isFinite(n)) return levels[0];
        return levels.reduce((best, lv) => Math.abs(lv - n) < Math.abs(best - n) ? lv : best, levels[0]);
      },
      /** 人口每小时自然增长量（人/小时） */
      populationGrowthPerHour(population, taxRate) {
        const lv = GameBalance.helpers.normalizeTax(taxRate);
        const perThousand = GameBalance.tax.growthPerHour[lv] || 0;
        return Math.floor((Number(population) || 0) * perThousand / 1000);
      },
      /** 税收每小时产出的金币 */
      taxGoldPerHour(population, taxRate) {
        const lv = GameBalance.helpers.normalizeTax(taxRate);
        const perPop = GameBalance.tax.goldPerPopPerHour[lv] || 0;
        return (Number(population) || 0) * perPop;
      },
      /** 战力倍率上限（服务端据此钳制客户端上报值） */
      maxPowerMult() {
        return Object.values(GameBalance.buffs)
          .filter(b => b.kind === 'power')
          .reduce((max, b) => Math.max(max, b.mul || 1), 1);
      },
      /** 某类型是否属于大型城池（可上架拍卖） */
      isLargeCityType(type) {
        return GameBalance.auction.largeCityTypes.includes(String(type || ''));
      },
      /** 本地时区 YYYY-MM-DD 日期键 */
      fairDateKey(ts) {
        const d = new Date(Number(ts) || Date.now());
        const p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      },
      /** 该时刻所在日期是否为拍卖会开放日 */
      isFairOpenDay(ts) {
        const d = new Date(Number(ts) || Date.now());
        return GameBalance.fair.openWeekdays.includes(d.getDay());
      },
      /** 该时刻所在开放日的场次窗口（本地时区）；非开放日返回 null */
      fairSessionWindow(ts) {
        const d = new Date(Number(ts) || Date.now());
        if (!GameBalance.fair.openWeekdays.includes(d.getDay())) return null;
        const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), GameBalance.fair.sessionStartHour, 0, 0, 0);
        const startsAt = start.getTime();
        return {
          openDate: GameBalance.helpers.fairDateKey(startsAt),
          startsAt,
          endsAt: startsAt + GameBalance.fair.sessionDurationHours * 3600e3
        };
      },
      /** 从某时刻起下一个尚未结束的开放日场次（最多向后查找 14 天） */
      nextFairSession(ts) {
        const from = Number(ts) || Date.now();
        for (let i = 0; i < 14; i++) {
          const win = GameBalance.helpers.fairSessionWindow(from + i * 864e5);
          if (win && win.endsAt > from) return win;
        }
        return null;
      },
      /** 该城池类型是否可以举办拍卖会 */
      isFairHostCityType(type) {
        return GameBalance.fair.hostCityTypes.includes(String(type || ''));
      },
      /** 综合判定：城池类型在 hostCityTypes 内（若配置了 hostCityNames 则城名也需命中） */
      isFairHostCity(type, name) {
        if (!GameBalance.helpers.isFairHostCityType(type)) return false;
        const names = GameBalance.fair.hostCityNames;
        return !names.length || names.includes(String(name || ''));
      }
    }
  };

  window.GameBalance = GameBalance;
})();
