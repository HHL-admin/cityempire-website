/*
 * 城池帝国：真实地图与三维城池层
 *
 * 地图使用 Leaflet 相机与交互层，羊皮纸图集作为底图；城市名称与建城点
 * 是游戏自己的数据。城池使用 Three.js 几何模型生成，资源和升级状态仍由 Game 管理。
 */
(function () {
  'use strict';

  const cityPlaces = [
    { name: '云京', region: '帝畿', type: '都城', lat: 35.20, lng: 112.90, desc: '王朝中枢，官道在此交汇，适合发展综合型城池。' },
    { name: '洛川', region: '帝畿', type: '府城', lat: 34.62, lng: 112.45, desc: '依河而建的古老府城，粮运与商贸十分兴盛。' },
    { name: '临川', region: '江北', type: '郡城', lat: 34.06, lng: 113.18, desc: '水网密集，木材和粮食产出稳定，适合经营。' },
    { name: '望海', region: '东海', type: '港城', lat: 33.55, lng: 114.05, desc: '东行商旅的起点，金币与稀有货物流通频繁。' },
    { name: '青崖', region: '西岭', type: '关城', lat: 35.02, lng: 111.48, desc: '山口要塞，石料丰富，城墙防御天然坚固。' },
    { name: '赤松', region: '西岭', type: '县城', lat: 34.30, lng: 110.95, desc: '群山环抱的县城，伐木场和矿脉遍布山间。' },
    { name: '雁门', region: '北境', type: '关城', lat: 36.18, lng: 112.10, desc: '北境军镇，骑兵出入频繁，战略位置险要。' },
    { name: '白河', region: '北境', type: '县城', lat: 35.82, lng: 113.40, desc: '白河穿城而过，拥有连通南北的驿站网络。' },
    { name: '南屏', region: '江南', type: '郡城', lat: 32.82, lng: 112.42, desc: '南方屏障，农田沃土绵延，是粮食重镇。' },
    { name: '锦州', region: '江南', type: '府城', lat: 32.22, lng: 113.60, desc: '商旅云集的水陆枢纽，适合建设金库与市场。' },
    { name: '芦洲', region: '东海', type: '县城', lat: 32.98, lng: 114.62, desc: '芦苇荡与湿地相连，水军和渔业资源丰富。' },
    { name: '落雁村', region: '西岭', type: '村落', lat: 33.82, lng: 111.20, desc: '依山而居的小村落，附近有可开发的木材资源。' },
    { name: '柳渡村', region: '江北', type: '村落', lat: 34.78, lng: 113.90, desc: '河渡旁的村落，常有行商在此补给。' },
    { name: '松风驿', region: '帝畿', type: '驿站', lat: 35.72, lng: 111.72, desc: '连接西岭与帝畿的驿站，行军和贸易都很便利。' }
  ];

  // A stylised, fictional atlas layer. Coordinates are deliberately game-world
  // coordinates rather than real geography so the map can stay rich without
  // implying a real-world location.
  const fantasyRegions = [
    { name: '帝畿', fill: '#dcb878', coords: [[36.98,112.02],[36.60,113.68],[35.72,114.25],[34.76,113.78],[34.48,112.82],[35.02,111.80],[36.10,111.50]] },
    { name: '北境荒原', fill: '#cda666', coords: [[37.62,109.85],[37.60,113.95],[36.98,115.02],[36.12,114.34],[35.70,113.66],[36.08,111.48],[36.72,110.30]] },
    { name: '西岭山国', fill: '#c9a064', coords: [[35.55,109.74],[35.10,111.16],[34.40,111.48],[33.58,111.10],[32.92,110.20],[33.26,109.42],[34.52,109.40]] },
    { name: '江北诸郡', fill: '#e0be82', coords: [[34.54,112.84],[34.06,113.84],[33.20,114.18],[32.82,113.42],[33.28,112.12],[34.08,111.56]] },
    { name: '江南水乡', fill: '#d8b074', coords: [[33.28,112.12],[32.80,113.36],[31.92,114.24],[31.72,115.16],[32.64,115.48],[33.52,114.58],[33.82,113.58]] },
    { name: '东海诸岛', fill: '#caa467', coords: [[34.42,114.42],[33.98,115.26],[32.98,115.62],[31.92,115.58],[31.72,114.82],[32.58,114.28],[33.56,114.04]] }
  ];

  const fantasySeas = [
    { name: '苍梧海', lat: 36.18, lng: 110.15 },
    { name: '东溟海', lat: 35.15, lng: 115.08 },
    { name: '落星海', lat: 31.95, lng: 112.35 },
    { name: '南溟海', lat: 31.02, lng: 114.48 }
  ];

  const fantasyMountains = [
    [36.76,111.04],[36.30,111.56],[36.88,112.72],[35.94,110.56],[35.42,111.30],
    [34.92,110.14],[34.46,110.66],[33.74,110.26],[33.26,111.46],[32.46,111.12],
    [35.56,113.88],[34.92,114.42],[34.08,114.78],[33.00,115.12],[32.18,114.88]
  ];

  const iconForType = type => ({ 都城:'♛', 府城:'◆', 郡城:'●', 港城:'⚓', 关城:'▣', 县城:'●', 村落:'▪', 驿站:'◇' }[type] || '●');

  // 已建成城池：都城/府城/郡城/港城/关城（云京、洛川、临川、望海、青崖、雁门、南屏、锦州）
  // 在地图上以城池图标显示，可点击进入参观三维城池
  const BUILT_TYPES = ['都城', '府城', '郡城', '港城', '关城'];
  const isBuiltCity = place => !!place && BUILT_TYPES.includes(place.type);
  const fortIconHtml =
    '<svg viewBox="0 0 34 30" width="30" height="26" aria-hidden="true">' +
    '<path d="M4 27 L4 14 L8 14 L8 10.5 L11.4 10.5 L11.4 14 L22.6 14 L22.6 10.5 L26 10.5 L26 14 L30 14 L30 27 Z" fill="#8a5a2d" stroke="#4a2c14" stroke-width="1.6" stroke-linejoin="round"/>' +
    '<path d="M13.4 27 L13.4 19.4 Q17 16.8 20.6 19.4 L20.6 27 Z" fill="#3c2414"/>' +
    '<path d="M9.4 14 L17 7.2 L24.6 14 Z" fill="#a43527" stroke="#4a2c14" stroke-width="1.4" stroke-linejoin="round"/>' +
    '<path d="M17 7.2 L17 2 L22 3.5 L17 5.1 Z" fill="#c8452c" stroke="#4a2c14" stroke-width="1"/>' +
    '</svg>';

  const WorldMap = {
    map: null,
    markers: [],
    selected: null,
    ownMarker: null,
    siteMarker: null,
    fantasyLayer: null,
    imageLayer: null,
    initialized: false,

    init() {
      if (this.initialized || !window.L) return;
      const el = document.getElementById('worldMap');
      if (!el) return;
      this.initialized = true;
      
      // 地图边界：羊皮纸图集覆盖范围
      const bounds = [[30.72, 108.86], [37.78, 116.92]];
      
      // 初始化地图：minZoom 设置为 7 确保地图始终铺满容器，maxBounds 限制平移范围
      this.map = L.map(el, {
        zoomControl: false,
        minZoom: 7,           // 最小缩放级别（禁止缩得更小露出空白）
        maxZoom: 15,
        zoomSnap: 0.5,
        attributionControl: true,
        maxBounds: bounds,     // 限制平移范围不超出地图边界
        maxBoundsViscosity: 0.8  // 边界弹性：0.8 让平移到边缘时有轻微阻力
      }).setView([34.5, 112.7], 7);
      
      this.fantasyLayer = L.layerGroup().addTo(this.map);
      this.drawFantasyMap();
      this.drawPlaces();
      this.bindMapEvents();
      this.bindControls();
      this.renderOwnCity();
      this.setNetworkFallback();
    },

    drawFantasyMap() {
      // The supplied parchment atlas is the visual source of truth. Leaflet
      // still provides the camera, hit-testing and interaction layer above it.
      this.imageLayer = L.imageOverlay('assets/world-map-reference.png', [[30.72,108.86],[37.78,116.92]], {
        opacity: 1, interactive: false, className: 'map-reference-image'
      }).addTo(this.map);
      fantasySeas.forEach(sea => {
        L.marker([sea.lat, sea.lng], {
          icon: L.divIcon({ className: 'map-sea-name', html: sea.name, iconSize: [120, 26] }),
          interactive: false
        }).addTo(this.fantasyLayer);
      });
    },

    drawPlaces() {
      cityPlaces.forEach(place => {
        const isBig = isBuiltCity(place);
        const marker = L.marker([place.lat, place.lng], {
          icon: isBig
            ? L.divIcon({ className: 'map-city-fort', html: fortIconHtml, iconSize: [30, 26] })
            : L.divIcon({ className: 'map-city-dot', html: '', iconSize: [8,8] }),
          keyboard: true, title: place.name
        }).addTo(this.map);
        marker.bindTooltip(`<b>${iconForType(place.type)} ${place.name}</b><br><small>${place.type} · ${place.region}${isBig ? ' · 点击可进入' : ''}</small>`, { direction: 'top', offset: [0, isBig ? -22 : -5], opacity: 0.96 });
        const label = L.marker([place.lat, place.lng], {
          icon: L.divIcon({ className: `map-city-name ${isBig ? 'major' : ''}`, html: `${place.name}`, iconSize: [isBig ? 80 : 60, 22] }),
          interactive: false
        }).addTo(this.map);
        marker.on('click', () => this.selectPlace(place));
        this.markers.push({ marker, label, place });
      });
    },

    bindMapEvents() {
      this.map.on('click', event => {
        this.selectSite(event.latlng.lat, event.latlng.lng);
      });
      this.map.on('mousemove', event => {
        const coords = document.getElementById('mapCoordinates');
        if (coords) coords.textContent = `坐标 ${event.latlng.lat.toFixed(3)}°N · ${event.latlng.lng.toFixed(3)}°E`;
      });
      this.map.on('zoomend', () => this.updateDetailVisibility());
    },

    bindControls() {
      const form = document.getElementById('mapSearchForm');
      const input = document.getElementById('mapSearchInput');
      form?.addEventListener('submit', event => {
        event.preventDefault();
        this.search(input.value);
      });
      document.querySelectorAll('[data-map-city]').forEach(button => button.addEventListener('click', () => {
        input.value = button.dataset.mapCity;
        this.search(button.dataset.mapCity);
      }));
      document.getElementById('mapZoomIn')?.addEventListener('click', () => this.map.zoomIn());
      document.getElementById('mapZoomOut')?.addEventListener('click', () => this.map.zoomOut());
      document.getElementById('mapLocateCity')?.addEventListener('click', () => this.locateOwnCity());
      document.getElementById('mapSiteClose')?.addEventListener('click', () => this.closeSite());
      document.getElementById('mapEnterCity')?.addEventListener('click', () => this.enterSelectedCity());
      document.getElementById('mapBuildHere')?.addEventListener('click', () => this.openBuildDialog());
      
      // 地图控制按钮：居中、放大、缩小
      document.getElementById('mapRecenterBtn')?.addEventListener('click', () => {
        if (this.ownMarker) {
          this.map.flyTo(this.ownMarker.getLatLng(), 10, { duration: 0.8 });
        }
      });
      document.getElementById('mapZoomInBtn')?.addEventListener('click', () => {
        this.map.zoomIn();
      });
      document.getElementById('mapZoomOutBtn')?.addEventListener('click', () => {
        // 缩小按钮：检查当前缩放级别，若已达最小值则不执行
        const currentZoom = this.map.getZoom();
        const minZoom = this.map.getMinZoom();
        if (currentZoom > minZoom) {
          this.map.zoomOut();
        }
      });
      
      // 显示筛选复选框：与图例联动，按类型显隐地图标记
      document.getElementById('mapShowMyCityCheck')?.addEventListener('change', (e) => {
        if (this.ownMarker) {
          if (e.target.checked) {
            this.ownMarker.addTo(this.map);
          } else {
            this.map.removeLayer(this.ownMarker);
          }
        }
        this.syncLegendState();
      });
      document.getElementById('mapShowCapitalsCheck')?.addEventListener('change', () => { this.applyLegendFilters(); this.syncLegendState(); });
      document.getElementById('mapShowTownsCheck')?.addEventListener('change', () => { this.applyLegendFilters(); this.syncLegendState(); });
      document.getElementById('mapShowPlayersCheck')?.addEventListener('change', (e) => {
        if (window.OnlineMap) window.OnlineMap.setVisible(e.target.checked);
        this.syncLegendState();
      });

      // 左侧图例条目：点击即切换对应的显隐筛选，与右侧复选框双向联动
      const legendMap = { mycity: 'mapShowMyCityCheck', capitals: 'mapShowCapitalsCheck', towns: 'mapShowTownsCheck', players: 'mapShowPlayersCheck' };
      document.querySelectorAll('.map-legend-item[data-legend]').forEach(btn => {
        btn.addEventListener('click', () => {
          const box = document.getElementById(legendMap[btn.dataset.legend]);
          if (!box) return;
          box.checked = !box.checked;
          box.dispatchEvent(new Event('change'));
        });
      });
      this.syncLegendState();
    },

    /** 图例条目显隐状态与筛选复选框保持同步 */
    syncLegendState() {
      const legendMap = { mycity: 'mapShowMyCityCheck', capitals: 'mapShowCapitalsCheck', towns: 'mapShowTownsCheck', players: 'mapShowPlayersCheck' };
      Object.entries(legendMap).forEach(([key, id]) => {
        const box = document.getElementById(id);
        const item = document.querySelector(`.map-legend-item[data-legend="${key}"]`);
        if (box && item) item.setAttribute('aria-pressed', String(!!box.checked));
      });
    },

    /** 图例筛选：州府名城 / 县镇村落 显隐（我的城池与其他玩家分别由各自复选框控制） */
    applyLegendFilters() {
      if (!this.map) return;
      const showCap = document.getElementById('mapShowCapitalsCheck')?.checked !== false;
      const showTown = document.getElementById('mapShowTownsCheck')?.checked !== false;
      this.markers.forEach(item => {
        const show = isBuiltCity(item.place) ? showCap : showTown;
        [item.marker, item.label].forEach(layer => {
          if (!layer) return;
          if (show) { if (!this.map.hasLayer(layer)) layer.addTo(this.map); }
          else if (this.map.hasLayer(layer)) this.map.removeLayer(layer);
        });
      });
    },

    search(value) {
      const term = (value || '').trim().toLowerCase();
      const box = document.getElementById('mapSearchResults');
      const matches = term ? cityPlaces.filter(place => `${place.name}${place.region}${place.type}`.toLowerCase().includes(term)) : cityPlaces.slice(0, 6);
      if (!box) return;
      box.innerHTML = matches.length ? matches.map((place, index) => `<button class="map-search-result" type="button" data-result-index="${index}"><span>${iconForType(place.type)} ${place.name}</span><small>${place.type} · ${place.region}</small></button>`).join('') : '<div class="map-search-empty">没有找到这个城镇。可以直接点击地图选择新的建城位置。</div>';
      box.querySelectorAll('[data-result-index]').forEach(button => button.addEventListener('click', () => {
        const place = matches[Number(button.dataset.resultIndex)];
        this.map.flyTo([place.lat, place.lng], Math.max(this.map.getZoom(), 9), { duration: 0.65 });
        this.selectPlace(place);
        box.innerHTML = '';
      }));
    },

    selectPlace(place) {
      this.selected = { lat: place.lat, lng: place.lng, place };
      this.showSitePanel(place.lat, place.lng, place);
      this.map.flyTo([place.lat, place.lng], Math.max(this.map.getZoom(), 9), { duration: 0.65 });
    },

    selectSite(lat, lng) {
      // 如果已经建立了城池，不允许再选择新位置
      if (Game.state.city.mapPosition) {
        Game.showStatus('城池位置已确定，不能更改', 'warn');
        return;
      }

      const nearest = cityPlaces.reduce((best, place) => {
        const distance = Math.hypot(place.lat - lat, place.lng - lng);
        return !best || distance < best.distance ? { place, distance } : best;
      }, null);
      this.selected = { lat, lng, place: nearest.distance < 0.16 ? nearest.place : null };
      if (this.siteMarker) this.map.removeLayer(this.siteMarker);
      this.siteMarker = L.marker([lat, lng], { icon: L.divIcon({ className: 'map-selected-point', html: '', iconSize: [18,18], iconAnchor: [9,9] }) }).addTo(this.map);
      this.showSitePanel(lat, lng, nearest.distance < 0.16 ? nearest.place : null);
    },

    showSitePanel(lat, lng, place) {
      const panel = document.getElementById('mapSitePanel');
      if (!panel) return;
      document.getElementById('mapSiteRegion').textContent = place ? `${place.type} · ${place.region}` : '未命名区域 · 可建城地块';
      document.getElementById('mapSiteName').textContent = place ? place.name : '新的建城位置';
      document.getElementById('mapSiteCoords').textContent = `坐标 ${lat.toFixed(3)}°N · ${lng.toFixed(3)}°E`;
      document.getElementById('mapSiteDescription').textContent = place ? place.desc : '这里尚未建立城池。选择此处可以开辟新的领地，并为城池命名。';
      const enterBtn = document.getElementById('mapEnterCity');
      if (enterBtn) enterBtn.hidden = !isBuiltCity(place);
      panel.hidden = false;
    },

    enterSelectedCity() {
      const place = this.selected?.place;
      if (!isBuiltCity(place)) return;
      this.closeSite();
      if (Game.visitCity) Game.visitCity(place);
    },

    closeSite() {
      document.getElementById('mapSitePanel').hidden = true;
      if (this.siteMarker) { this.map.removeLayer(this.siteMarker); this.siteMarker = null; }
      this.selected = null;
    },

    openBuildDialog() {
      // 如果已经建立了城池，不允许再打开建城对话框
      if (Game.state.city.mapPosition) {
        Game.showStatus('城池位置已确定，不能更改', 'warn');
        return;
      }

      if (!this.selected) return;
      const site = this.selected;
      const defaultName = site.place?.name || '新城';
      Game.Modal.show('在此建城', `<div class="map-build-dialog"><p>位置：${site.place?.name || '未命名区域'}</p><p class="modal-coordinates">坐标：${site.lat.toFixed(3)}°N · ${site.lng.toFixed(3)}°E</p><label class="input-label">城池名称</label><input type="text" id="cityNameInput" value="${defaultName}" maxlength="20"></div>`, [
        { text: '建造', action: () => this.commitSite() },
        { text: '取消', action: () => Game.Modal.close() }
      ]);
    },

    /** 附近是否已有其他玩家城池（本地即时判定 + 服务端权威判定） */
    async checkOccupied(lat, lng) {
      const min = (window.GameBalance && GameBalance.map && GameBalance.map.cityMinDistanceDeg) || 0.16;
      // 本地兜底：已加载的其他玩家快照
      const local = window.OnlineMap && OnlineMap.isOccupied(lat, lng, min);
      if (local) return { occupied: true, cityName: local.cityName, nickname: local.nickname };
      // 服务端权威判定（离线 / 未登录时跳过，不阻断建城）
      if (window.Auth && Auth.session && Auth.session.token) {
        try {
          const r = await Auth.api('GET', `/api/city/occupancy?lat=${lat}&lng=${lng}&min=${min}`, null, Auth.session.token);
          if (r && r.occupied) return { occupied: true, cityName: r.by?.cityName || '未知城', nickname: r.by?.nickname || '其他玩家' };
        } catch (e) { /* 网络异常：以本地判定为准 */ }
      }
      return { occupied: false };
    },

    async commitSite() {
      // 如果已经建立了城池，不允许再改变位置
      if (Game.state.city.mapPosition) {
        Game.Modal.close();
        Game.showStatus('城池位置已确定，不能更改', 'warn');
        return;
      }

      const name = document.getElementById('cityNameInput')?.value.trim();
      if (!name) { Game.showStatus('城池名称不能为空', 'warn'); return; }
      const site = this.selected;
      if (!site) return;
      // 位置占用校验：若附近已有其他玩家城池，直接拦截并给出明确提示
      const hit = await this.checkOccupied(site.lat, site.lng);
      if (hit.occupied) {
        Game.Modal.close();
        Game.showStatus(`此地已被《${hit.cityName}》（${hit.nickname}）占据，请另选位置建城`, 'warn');
        return;
      }
      const place = site.place;
      Game.state.city.name = name;
      Game.state.city.region = place?.region || '未命名区域';
      Game.state.city.mapPosition = { lat: site.lat, lng: site.lng, x: (site.lng - 109.8) / 6.0, y: (37.5 - site.lat) / 6.5,
        region: Game.state.city.region, placeName: place?.name || '', placeType: place?.type || '县城' };
      Game.Modal.close();
      this.closeSite();
      this.renderOwnCity();
      Game.saveState();
      // 建城后立即把城池快照上报，供其他玩家地图红点显示
      if (window.Social && Social.syncPlayerState) Social.syncPlayerState();
      // 建城地点类型可能解锁拍卖行入口，刷新一次指令区可见性
      if (window.Progression && Progression.refresh) Progression.refresh();
      Game.showStatus(`已在${place?.name || '新区域'}建造《${name}》`, 'success');
      setTimeout(() => Game.switchScene('city'), 650);
    },

    renderOwnCity() {
      if (!this.map) return;
      if (this.ownMarker) this.map.removeLayer(this.ownMarker);
      const position = Game.state.city.mapPosition;
      if (!position) return;
      const lat = Number(position.lat) || 34.55;
      const lng = Number(position.lng) || 112.7;
      // 使用 circleMarker：矢量圆形，随地图缩放
      this.ownMarker = L.circleMarker([lat, lng], {
        radius: 5,  // 半径比其他玩家大（会随地图缩放）
        fillColor: '#ff4757',
        fillOpacity: 1,
        color: '#ff4757',
        weight: 2,
        className: 'own-city-circle'
      }).addTo(this.map);
      this.ownMarker.bindTooltip('我的城池', { direction:'top', offset:[0,-8] });
    },

    locateOwnCity() {
      const pos = Game.state.city.mapPosition;
      if (!pos) { Game.showStatus('还没有城池，请先在地图上选择位置', 'warn'); return; }
      this.map.flyTo([Number(pos.lat) || 34.55, Number(pos.lng) || 112.7], 10, { duration: 0.65 });
    },

    updateDetailVisibility() {
      const zoom = this.map?.getZoom() || 7;
      this.markers.forEach(item => {
        if (zoom < 8 && ['县城','村落','驿站'].includes(item.place.type)) item.label.getElement()?.classList.add('leaflet-hidden');
        else item.label.getElement()?.classList.remove('leaflet-hidden');
      });
    },

    setNetworkFallback() {
      let reported = false;
      this.imageLayer.on('error', () => {
        if (reported) return;
        reported = true;
        const status = document.getElementById('mapNetworkStatus');
        if (status) { status.hidden = false; status.textContent = '地图底图暂时无法加载，选点与建城功能仍可继续使用。'; }
      });
    },

    show() {
      this.init();
      const refresh = () => {
        if (!this.map) return;
        this.map.invalidateSize({ pan: false });
        this.map.setView([34.5, 112.7], 8, { animate: false });
        this.updateDetailVisibility();
      };
      requestAnimationFrame(() => {
        requestAnimationFrame(refresh);
        setTimeout(refresh, 80);
      });
      this.renderOwnCity();
      this.updateDetailVisibility();
      // 初始化联机地图（显示其他玩家城池）
      if (window.OnlineMapV2) {
        window.OnlineMapV2.init();
      }
    }
  };

  const CityView = {
    renderer: null,
    scene: null,
    camera: null,
    viewport: null,
    root: null,
    labels: null,
    status: null,
    objects: new Map(),
    yaw: 0.66,
    pitch: 0.82,
    distance: 24,
    target: null,
    dragging: false,
    lastPointer: null,
    autoRotate: false,
    initialized: false,
    raf: 0,
    resizeObserver: null,

    init() {
      if (this.initialized || !window.THREE) return;
      this.viewport = document.getElementById('city3dViewport');
      this.labels = document.getElementById('city3dLabels');
      this.status = document.getElementById('city3dStatus');
      if (!this.viewport) return;
      this.initialized = true;
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0xaeb9a4);
      this.scene.fog = new THREE.Fog(0xaeb9a4, 28, 52);
      this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
      this.target = new THREE.Vector3(0, 0.45, 0);
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.outputColorSpace = THREE.SRGBColorSpace || this.renderer.outputColorSpace;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.viewport.prepend(this.renderer.domElement);
      this.buildScene();
      this.bindControls();
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.viewport);
      this.resize();
      this.status.hidden = true;
      this.animate();
    },

    mat(color, roughness = 0.82) { return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02 }); },

    buildScene() {
      const hemi = new THREE.HemisphereLight(0xf8f0da, 0x304631, 2.2); this.scene.add(hemi);
      const sun = new THREE.DirectionalLight(0xffe8bd, 3.2); sun.position.set(-10, 18, 9); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -22; sun.shadow.camera.right = 22; sun.shadow.camera.top = 22; sun.shadow.camera.bottom = -22; this.scene.add(sun);
      const fill = new THREE.DirectionalLight(0xb7d9d4, 0.8); fill.position.set(12, 8, -10); this.scene.add(fill);
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(58, 58), this.mat(0x758b6c)); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; this.scene.add(ground);
      const water = new THREE.Mesh(new THREE.PlaneGeometry(10, 58), this.mat(0x6e9ca0, 0.42)); water.rotation.x = -Math.PI / 2; water.position.set(-12, 0.012, 0); this.scene.add(water);
      for (let z = -22; z <= 22; z += 2.15) { const bank = new THREE.Mesh(new THREE.BoxGeometry(10.4, 0.025, 0.10), this.mat(0xb4aa7c)); bank.position.set(-12, 0.03, z); bank.receiveShadow = true; this.scene.add(bank); }
      this.makeWall();
      this.makeMainKeep();
      this.makeHouse('farm', '农场', -6.6, 2.4, 2.7, 0x8d9a60);
      this.makeHouse('mine', '矿场', 5.8, 1.1, 1.5, 0x6f7770);
      this.makeHouse('lumber', '伐木场', -4.9, -5.0, 2.1, 0x718d5c);
      this.makeHouse('bank', '金库', 5.3, -4.9, 1.8, 0xb39152);
      this.makeHouse('barracks', '兵营', 1.7, -5.8, 2.8, 0x795f50);
      this.makeHouse('wall', '城墙', -0.2, 5.6, 1.1, 0x7b8580);
      for (let i = 0; i < 15; i++) this.makeTree(-7 + (i * 7) % 17, -7 + (i * 11) % 16, 0.65 + (i % 3) * 0.15);
      this.makeRoad(-8.0, -0.6, 16, 0.32); this.makeRoad(-0.8, -8.0, 0.32, 15);
      this.setCamera();
    },

    makeWall() {
      const wallMat = this.mat(0x80786b);
      const wall = new THREE.Group(); wall.name = 'wall';
      const pieces = [[0,6.8,16,0.62], [0,-6.8,16,0.62], [-8,0,0.62,14], [8,0,0.62,14]];
      pieces.forEach(([x,z,w,d]) => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 1.45, d), wallMat); mesh.position.set(x, 0.72, z); mesh.castShadow = mesh.receiveShadow = true; wall.add(mesh); });
      [[-8,6.8], [8,6.8], [-8,-6.8], [8,-6.8]].forEach(([x,z]) => { const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.72,0.86,2.6,8), this.mat(0x6f6e67)); tower.position.set(x,1.3,z); tower.castShadow = true; wall.add(tower); });
      this.scene.add(wall); this.addObject('wall', '城墙', wall, new THREE.Vector3(0, 1.9, 6.8));
    },

    makeMainKeep() {
      const group = new THREE.Group(); group.name = 'hall';
      const base = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.8, 4.2), this.mat(0x76746d)); base.position.y = 0.4; base.castShadow = base.receiveShadow = true; group.add(base);
      const body = new THREE.Mesh(new THREE.BoxGeometry(4.3, 3.0, 3.0), this.mat(0x8e6046)); body.position.y = 2.0; body.castShadow = body.receiveShadow = true; group.add(body);
      for (const y of [1.1,2.9]) { const roof = new THREE.Mesh(new THREE.ConeGeometry(3.1, 1.05, 4), this.mat(0x313c36)); roof.rotation.y = Math.PI / 4; roof.position.y = y + 0.7; roof.castShadow = true; group.add(roof); }
      const gate = new THREE.Mesh(new THREE.BoxGeometry(1.15, 2.2, 0.5), this.mat(0xc7a361)); gate.position.set(0,1.1,1.57); group.add(gate);
      for (const x of [-1.5,1.5]) { const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.15,0.18,2.9,8), this.mat(0x4f382d)); pillar.position.set(x,1.45,1.58); group.add(pillar); }
      this.scene.add(group); this.addObject('hall','城镇中心',group,new THREE.Vector3(0,4.25,0));
    },

    makeHouse(key, name, x, z, scale, color) {
      const group = new THREE.Group(); group.name = key; group.position.set(x,0,z); group.scale.setScalar(scale / 2.0);
      const base = new THREE.Mesh(new THREE.BoxGeometry(2.4,1.5,1.9), this.mat(color)); base.position.y = 0.75; base.castShadow = base.receiveShadow = true; group.add(base);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1.8,1.15,4), this.mat(0x3d4940)); roof.rotation.y = Math.PI/4; roof.position.y = 1.95; roof.castShadow = true; group.add(roof);
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.36,0.67,0.06), this.mat(0x402e24)); door.position.set(0,0.45,0.98); group.add(door);
      this.scene.add(group); this.addObject(key,name,group,new THREE.Vector3(x,scale*1.7,z));
      if (key === 'farm') for (let i=-1;i<=1;i++) { const crop = new THREE.Mesh(new THREE.BoxGeometry(0.12,0.28,1.45), this.mat(0xc6ae5b)); crop.position.set(x + i*0.42,0.17,z+1.5); crop.rotation.y = 0.12; this.scene.add(crop); }
    },

    makeTree(x,z,scale) { const group = new THREE.Group(); group.position.set(x,0,z); const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.13,0.18,1.2,7),this.mat(0x5e4935)); trunk.position.y=.6; const crown = new THREE.Mesh(new THREE.ConeGeometry(.85,1.7,8),this.mat(0x3f6847)); crown.position.y=1.9; crown.castShadow=true; group.add(trunk,crown); this.scene.add(group); },
    makeRoad(x,z,w,d) { const road = new THREE.Mesh(new THREE.BoxGeometry(w,0.035,d),this.mat(0xa69470)); road.position.set(x,0.06,z); road.receiveShadow=true; this.scene.add(road); },

    addObject(key,name,group,anchor) { this.objects.set(key,{key,name,group,anchor,label:null}); },

    bindControls() {
      const canvas = this.renderer.domElement;
      canvas.addEventListener('pointerdown', event => { this.dragging=true; this.lastPointer={x:event.clientX,y:event.clientY}; canvas.setPointerCapture?.(event.pointerId); });
      canvas.addEventListener('pointermove', event => { if (!this.dragging) return; const dx=event.clientX-this.lastPointer.x; const dy=event.clientY-this.lastPointer.y; this.lastPointer={x:event.clientX,y:event.clientY}; this.yaw -= dx*0.008; this.pitch = Math.max(0.42, Math.min(1.42, this.pitch + dy*0.006)); this.autoRotate=false; this.syncCameraButtons(); });
      const release = event => { this.dragging=false; canvas.releasePointerCapture?.(event.pointerId); };
      canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release);
      canvas.addEventListener('wheel', event => { event.preventDefault(); this.distance = Math.max(15,Math.min(35,this.distance + event.deltaY*0.018)); }, {passive:false});
      document.getElementById('cityRotateBtn')?.addEventListener('click', () => { this.autoRotate=!this.autoRotate; this.syncCameraButtons(); });
      document.getElementById('cityTopBtn')?.addEventListener('click', () => { this.pitch = this.pitch > 1.2 ? 0.82 : 1.36; this.autoRotate=false; this.syncCameraButtons(); });
      document.getElementById('cityResetBtn')?.addEventListener('click', () => { this.yaw=0.66; this.pitch=.82; this.distance=24; this.autoRotate=false; this.syncCameraButtons(); });
    },

    syncCameraButtons() { document.getElementById('cityRotateBtn')?.setAttribute('aria-pressed', String(this.autoRotate)); document.getElementById('cityTopBtn')?.setAttribute('aria-pressed', String(this.pitch > 1.2)); },
    setCamera() { const cp=Math.cos(this.pitch), sp=Math.sin(this.pitch); this.camera.position.set(this.target.x+Math.sin(this.yaw)*cp*this.distance,this.target.y+sp*this.distance,this.target.z+Math.cos(this.yaw)*cp*this.distance); this.camera.lookAt(this.target); },
    resize() { if (!this.renderer || !this.viewport) return; const w=Math.max(1,this.viewport.clientWidth),h=Math.max(1,this.viewport.clientHeight); this.camera.aspect=w/h; this.camera.updateProjectionMatrix(); this.renderer.setSize(w,h,false); },
    selectBuilding(key) { this.objects.forEach(item => item.label?.setAttribute('aria-pressed',String(item.key===key))); const cfg=Game.Config.BUILDINGS[key]; const name=document.getElementById('selectedBuildingName'),level=document.getElementById('selectedBuildingLevel'),benefit=document.getElementById('selectedBuildingBenefit'); const state=Game.state.city.buildings[key]; if(name)name.textContent=cfg?.name||key;if(level)level.textContent=`Lv.${state?.level||1}`;if(benefit)benefit.textContent=cfg?.benefit?.(state?.level||1)||''; },
    syncBuildings() { this.selectBuilding(Game.state.selectedBuilding); },
    show() { this.init(); this.selectBuilding(Game.state.selectedBuilding); requestAnimationFrame(()=>this.resize()); },
    setActive(active) { if (active) this.show(); },
    animate() { this.raf=requestAnimationFrame(()=>this.animate()); if (!this.renderer) return; if (this.autoRotate) this.yaw += 0.0025; this.setCamera(); this.updateLabels(); this.renderer.render(this.scene,this.camera); },
    updateLabels() { if (!this.labels || !this.camera) return; const rect=this.renderer.domElement.getBoundingClientRect(); this.objects.forEach(item=>{ if(!item.label){ item.label=document.createElement('button'); item.label.type='button'; item.label.className='city-building-label'; item.label.textContent=item.name; item.label.addEventListener('click',()=>{Game.state.selectedBuilding=item.key;Game.UI.updateBuildings();}); this.labels.appendChild(item.label); } const p=item.anchor.clone().project(this.camera); const x=(p.x*.5+.5)*rect.width,y=(-p.y*.5+.5)*rect.height; item.label.style.left=`${x}px`;item.label.style.top=`${y}px`;item.label.style.display=p.z>1?'none':'block'; item.label.setAttribute('aria-pressed',String(item.key===Game.state.selectedBuilding)); }); }
  };

  // Game 在 cities.html 里以 const 声明，属于词法绑定、不会自动成为 window 属性；
  // 这里必须发布真实对象，否则其他模块读到的 window.Game 是空壳，会导致静默失效
  window.Game = (typeof Game !== 'undefined') ? Game : (window.Game || {});
  Game.WorldMap = WorldMap;
  window.WorldMap = WorldMap;   // 联机地图等模块按此全局名访问地图实例
  Game.cityPlaces = cityPlaces; // 城池点位（含 type），供拍卖行等模块判定大型城池
  // 三维城池由 city3d.js 提供（Game.CityView）；这里的旧版仅在其缺失时兜底
  if (!Game.CityView) Game.CityView = CityView;
  window.addEventListener('load', () => { WorldMap.init(); if (!window.__deferCityInit) Game.CityView.init(); });
})();
