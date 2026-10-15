/*
 * 城池帝国 · API 模拟服务（用于本地测试联机功能）
 *
 * 在真实服务器不可用时，提供模拟的玩家数据接口
 */
(function() {
  'use strict';

  // 默认关闭。模拟接口返回的是不存在的假玩家（player_001…），
  // 一旦本地真实服务端可用，这些假玩家会导致私聊、参观等联机功能必然失败。
  // 需要离线演示时，在页面地址后加 ?mock=1，或设置 window.GAME_CONFIG.useMockApi = true。
  const enabled = (window.GAME_CONFIG && window.GAME_CONFIG.useMockApi === true) ||
    (typeof location !== 'undefined' && /[?&]mock=1\b/.test(location.search));
  if (!enabled) {
    console.log('[MockAPI] 未启用（默认关闭），联机数据走真实服务端接口');
    return;
  }

  console.log('[MockAPI] 开始初始化...');

  // 模拟的在线玩家数据
  const mockPlayers = [
    {
      userId: 'player_001',
      nickname: '赵云龙',
      cityName: '龙城',
      online: true,
      mapPosition: { lat: 35.8, lng: 112.3 },
      city: {
        name: '龙城',
        level: 8,
        population: 15600,
        armyPower: 3200,
        regionName: '北境',
        buildings: {
          townHall: { level: 8 },
          farm: { level: 6 },
          quarry: { level: 5 },
          barracks: { level: 7 },
          stable: { level: 4 }
        }
      }
    },
    {
      userId: 'player_002',
      nickname: '李明月',
      cityName: '明月城',
      online: true,
      mapPosition: { lat: 33.2, lng: 113.8 },
      city: {
        name: '明月城',
        level: 6,
        population: 8900,
        armyPower: 1800,
        regionName: '江北',
        buildings: {
          townHall: { level: 6 },
          farm: { level: 5 },
          lumberMill: { level: 4 },
          barracks: { level: 5 }
        }
      }
    },
    {
      userId: 'player_003',
      nickname: '王铁柱',
      cityName: '铁壁堡',
      online: false,
      mapPosition: { lat: 34.8, lng: 111.2 },
      city: {
        name: '铁壁堡',
        level: 10,
        population: 22000,
        armyPower: 5500,
        regionName: '西岭',
        buildings: {
          townHall: { level: 10 },
          farm: { level: 8 },
          quarry: { level: 9 },
          barracks: { level: 8 },
          stable: { level: 6 },
          archeryRange: { level: 5 }
        }
      }
    },
    {
      userId: 'player_004',
      nickname: '张小凤',
      cityName: '凤翔城',
      online: true,
      mapPosition: { lat: 32.5, lng: 114.2 },
      city: {
        name: '凤翔城',
        level: 7,
        population: 12000,
        armyPower: 2400,
        regionName: '江南',
        buildings: {
          townHall: { level: 7 },
          farm: { level: 7 },
          goldMine: { level: 5 },
          barracks: { level: 6 },
          warehouse: { level: 5 }
        }
      }
    },
    {
      userId: 'player_005',
      nickname: '刘海峰',
      cityName: '海峰港',
      online: true,
      mapPosition: { lat: 33.0, lng: 115.1 },
      city: {
        name: '海峰港',
        level: 9,
        population: 18500,
        armyPower: 4100,
        regionName: '东海',
        buildings: {
          townHall: { level: 9 },
          farm: { level: 6 },
          goldMine: { level: 7 },
          barracks: { level: 7 },
          stable: { level: 5 },
          warehouse: { level: 6 }
        }
      }
    },
    {
      userId: 'player_006',
      nickname: '周雪梅',
      cityName: '雪梅镇',
      online: false,
      mapPosition: { lat: 36.5, lng: 113.2 },
      city: {
        name: '雪梅镇',
        level: 5,
        population: 6800,
        armyPower: 1200,
        regionName: '北境',
        buildings: {
          townHall: { level: 5 },
          farm: { level: 4 },
          lumberMill: { level: 3 },
          barracks: { level: 4 }
        }
      }
    }
  ];

  // 保存原始 fetch
  const originalFetch = window.fetch;

  // 覆盖 fetch 方法
  window.fetch = function(url, options) {
    const urlStr = typeof url === 'string' ? url : url.toString();

    console.log('[MockAPI] 拦截请求:', urlStr);

    // 拦截 /api/config 请求
    if (urlStr.includes('/api/config')) {
      console.log('[MockAPI] 返回配置数据');
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: () => Promise.resolve({
          serverTime: Date.now(),
          maintenance: false,
          version: '1.0.0'
        })
      });
    }

    // 拦截 /api/players/map 请求
    if (urlStr.includes('/api/players/map')) {
      console.log('[MockAPI] 返回玩家地图数据，玩家数量:', mockPlayers.length);
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: () => Promise.resolve({ players: mockPlayers })
      });
    }

    // 拦截 /api/players/{userId}/city 请求
    const playerCityMatch = urlStr.match(/\/api\/players\/([^\/]+)\/city$/);
    if (playerCityMatch) {
      const userId = playerCityMatch[1];
      console.log('[MockAPI] 返回玩家城池数据:', userId);
      const player = mockPlayers.find(p => p.userId === userId);
      if (player) {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({ 'Content-Type': 'application/json' }),
          json: () => Promise.resolve({ city: player.city })
        });
      }
    }

    // 拦截 /api/players/{userId}/city/full 请求
    const playerCityFullMatch = urlStr.match(/\/api\/players\/([^\/]+)\/city\/full$/);
    if (playerCityFullMatch) {
      const userId = playerCityFullMatch[1];
      console.log('[MockAPI] 返回完整城池数据:', userId);
      const player = mockPlayers.find(p => p.userId === userId);
      if (player) {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({ 'Content-Type': 'application/json' }),
          json: () => Promise.resolve({
            city: {
              ...player.city,
              resources: {
                grain: 5000,
                stone: 3000,
                wood: 4000,
                gold: 2000
              },
              army: {
                infantry: Math.floor(player.city.armyPower * 0.4),
                cavalry: Math.floor(player.city.armyPower * 0.3),
                archer: Math.floor(player.city.armyPower * 0.3)
              }
            }
          })
        });
      }
    }

    // 其他请求使用原始 fetch
    return originalFetch.apply(this, arguments);
  };

  console.log('[MockAPI] API 模拟服务已启动，将拦截 /api/players 相关请求');
})();
