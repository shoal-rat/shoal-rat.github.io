/* Chinese / English strings. Chinese is the primary language of this tool;
   English follows the browser or the setting. */

const STRINGS = {
  zh: {
    appName: '旅行照片轨迹',
    appSub: 'Trip Memory Map',
    addPhotos: '添加照片',
    choosePhotos: '选择照片',
    chooseFolder: '选择文件夹',
    tryDemo: '看看示例行程',
    emptyTitle: '把旅行照片放在地图上',
    emptyLede: '拖入一次旅行的照片（或整个文件夹）。照片里的 GPS 和拍摄时间会连成路线，推断你是步行、坐车、坐火车还是飞行，然后把那几天从头播放一遍。',
    dropHint: '拖到这里，或',
    privacyTitle: '照片不会离开你的设备',
    privacyBody: '读取、缩略图和路线都在这个页面里完成，不上传任何照片。地图底图来自 OpenFreeMap；只有你开启「道路路线」或「地名」时，相邻照片的坐标才会发送到公共路线/地名服务。',
    step1: '读取 GPS 与时间',
    step2: '合并成停留点，推断交通方式',
    step3: '按时间回放整段旅程',
    formats: '支持 JPEG、HEIC（iPhone）、PNG、WebP；需要带定位信息的原图。',
    importing: '正在读取照片',
    importingN: '{done} / {total}',
    convertingHeic: '正在转换 HEIC',
    imported: '已导入 {n} 张',
    skipped: '跳过 {n} 张',
    viewDetails: '查看明细',
    hideDetails: '收起',
    skipNoGps: '没有 GPS 定位',
    skipNoTime: '没有拍摄时间',
    skipUnreadable: '无法读取',
    skipDuplicate: '已在行程中',
    skipNotImage: '不是图片',
    nothingImported: '这些照片都没有可用的定位和时间。请使用手机相册导出的原图（「保留位置信息」），截图和社交软件保存的图片通常不含 GPS。',
    photos: '照片',
    stops: '停留',
    distance: '里程',
    duration: '历时',
    days: '天',
    daysN: '{n} 天',
    dayN: '第 {n} 天',
    allDays: '全部',
    untitledTrip: '我的旅行',
    renameHint: '点击修改名称',
    stopN: '停留点 {n}',
    stayFor: '停留 {d}',
    photoCount: '{n} 张',
    minutes: '{n} 分钟',
    hours: '{n} 小时',
    hoursMinutes: '{h} 小时 {m} 分',
    daysHours: '{d} 天 {h} 小时',
    km: '{n} km',
    m: '{n} m',
    kmh: '{n} km/h',
    overnight: '隔夜',
    longGap: '间隔较长，途中可能有停留',
    lowConfidence: '推断把握不大，可点选修改',
    userSet: '已手动指定',
    resetMode: '恢复自动',
    auto: '自动',
    modeWalk: '步行', modeBike: '骑行', modeBus: '公交', modeCar: '驾车', modeRail: '火车 / 地铁',
    modeFlight: '飞行', modeBoat: '乘船', modeUnknown: '未知',
    routeStraight: '直线', routeRoad: '道路', routeArc: '航线', routeRail: '铁路（直线）',
    play: '播放', pause: '暂停', replay: '回放旅程',
    speed: '速度',
    fitAll: '显示全部',
    mapPaper: '纸', mapInk: '夜',
    mapStyle: '地图样式',
    menu: '更多',
    exportGpx: '导出 GPX 轨迹',
    exportArchive: '保存旅行存档 (.json)',
    importArchive: '打开旅行存档',
    poster: '生成分享海报',
    settings: '设置',
    newTrip: '新建旅行',
    clearConfirm: '清空当前行程？照片原图不受影响，但本页保存的缩略图和修改会被删除。',
    settingsTitle: '设置',
    routeMode: '路线',
    routePrivate: '隐私直线',
    routePrivateHint: '只在本地画直线或航线，不发送任何坐标。',
    routeNetwork: '道路路线',
    routeNetworkHint: '把相邻停留点的坐标发送到 OpenStreetMap 公共路线服务（FOSSGIS），画出真实的步行 / 骑行 / 驾车道路。',
    placeNames: '地名',
    placeNamesHint: '用 OpenStreetMap Nominatim 查询停留点附近的地名（会发送坐标，约每秒一次）。',
    placeNamesOn: '显示地名',
    mergeRadius: '合并半径',
    mergeRadiusHint: '距离在这个范围内、时间相邻的照片会合并成一个停留点。',
    language: '语言',
    storage: '本地存储',
    storageHint: '行程和缩略图保存在这个浏览器里，刷新后自动恢复。',
    clearData: '清空本地数据',
    close: '关闭',
    done: '完成',
    restored: '已恢复上次的旅行',
    demoFailed: '示例照片没有加载成功，请检查网络后重试。',
    demoNote: '示例行程 · 照片为 AI 插画，定位与时间写在 EXIF 里，和真实照片走同一条读取流程。',
    routing: '正在规划道路路线 {done}/{total}',
    routingFailed: '部分路段无法获取道路路线，已用直线代替。',
    geocoding: '正在查询地名 {done}/{total}',
    posterTitle: '分享海报',
    posterMaking: '正在生成海报…',
    download: '下载',
    photoOf: '{i} / {n}',
    showOnMap: '在地图上看',
    camera: '相机',
    coords: '坐标',
    exportedGpx: '已导出 GPX',
    archiveSaved: '已保存旅行存档',
    archiveBad: '这个文件不是有效的旅行存档。',
    dropToAdd: '松开以添加照片',
    tripSpan: '{start} – {end}',
    dateFmt: 'M月D日',
    weekdays: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
    keyboard: '空格 播放/暂停 · ← → 上一站/下一站',
    legend: '交通方式',
    noSegments: '只有一个停留点，再加几张不同地点的照片就能连成路线。',
    about: '关于',
    aboutBody: '一个把照片 GPS 变成旅行回放的小工具，属于 Shoal/Rat Econ-CS Lab。开源依赖：MapLibre GL、exifr、heic2any；地图数据 © OpenStreetMap 贡献者。',
    backHome: '返回主页',
    posterFooter: '旅行照片轨迹 · weikezhang.cn/trip-memory-map',
    tzApprox: '时区按经度估计',
  },
  en: {
    appName: 'Trip Memory Map',
    appSub: '旅行照片轨迹',
    addPhotos: 'Add photos',
    choosePhotos: 'Choose photos',
    chooseFolder: 'Choose a folder',
    tryDemo: 'Try the demo trip',
    emptyTitle: 'Put your trip photos on a map',
    emptyLede: 'Drop the photos from one trip (or a whole folder). Their GPS and capture times become a route, the tool guesses whether you walked, drove, took a train or flew, and then replays those days from the start.',
    dropHint: 'Drop them here, or',
    privacyTitle: 'Your photos never leave this device',
    privacyBody: 'Reading, thumbnails and routes all happen in this page — nothing is uploaded. Base maps come from OpenFreeMap; only if you turn on road routes or place names are neighbouring stop coordinates sent to public routing / geocoding services.',
    step1: 'Read GPS and time',
    step2: 'Merge into stops, infer transport',
    step3: 'Replay the whole trip in order',
    formats: 'JPEG, HEIC (iPhone), PNG and WebP; originals with location data.',
    importing: 'Reading photos',
    importingN: '{done} / {total}',
    convertingHeic: 'Converting HEIC',
    imported: '{n} imported',
    skipped: '{n} skipped',
    viewDetails: 'Details',
    hideDetails: 'Hide',
    skipNoGps: 'No GPS location',
    skipNoTime: 'No capture time',
    skipUnreadable: 'Unreadable',
    skipDuplicate: 'Already in the trip',
    skipNotImage: 'Not an image',
    nothingImported: 'None of these photos carry both location and time. Use original exports from your phone’s library (with location kept) — screenshots and messenger copies usually have no GPS.',
    photos: 'Photos',
    stops: 'Stops',
    distance: 'Distance',
    duration: 'Duration',
    days: 'days',
    daysN: '{n} days',
    dayOne: '1 day',
    dayN: 'Day {n}',
    allDays: 'All',
    untitledTrip: 'My trip',
    renameHint: 'Click to rename',
    stopN: 'Stop {n}',
    stayFor: '{d} here',
    photoCount: '{n} photos',
    minutes: '{n} min',
    hours: '{n} h',
    hoursMinutes: '{h} h {m} min',
    daysHours: '{d} d {h} h',
    km: '{n} km',
    m: '{n} m',
    kmh: '{n} km/h',
    overnight: 'overnight',
    longGap: 'Long gap — you probably stopped on the way',
    lowConfidence: 'Low-confidence guess — tap to change',
    userSet: 'Set by you',
    resetMode: 'Back to auto',
    auto: 'Auto',
    modeWalk: 'Walk', modeBike: 'Bike', modeBus: 'Bus', modeCar: 'Car', modeRail: 'Train',
    modeFlight: 'Flight', modeBoat: 'Boat', modeUnknown: 'Unknown',
    routeStraight: 'straight', routeRoad: 'road', routeArc: 'flight arc', routeRail: 'rail (straight)',
    play: 'Play', pause: 'Pause', replay: 'Replay the trip',
    speed: 'Speed',
    fitAll: 'Show everything',
    mapPaper: 'Day', mapInk: 'Night',
    mapStyle: 'Map style',
    menu: 'More',
    exportGpx: 'Export GPX track',
    exportArchive: 'Save trip archive (.json)',
    importArchive: 'Open a trip archive',
    poster: 'Make a share poster',
    settings: 'Settings',
    newTrip: 'New trip',
    clearConfirm: 'Clear this trip? Your original photos are untouched, but the thumbnails and edits saved in this page will be deleted.',
    settingsTitle: 'Settings',
    routeMode: 'Routes',
    routePrivate: 'Private lines',
    routePrivateHint: 'Draw straight lines and flight arcs locally. No coordinates are sent anywhere.',
    routeNetwork: 'Road routes',
    routeNetworkHint: 'Send neighbouring stop coordinates to the public OpenStreetMap routing service (FOSSGIS) to draw real walking, cycling and driving routes.',
    placeNames: 'Place names',
    placeNamesHint: 'Look up names near each stop with OpenStreetMap Nominatim (sends coordinates, about one per second).',
    placeNamesOn: 'Show place names',
    mergeRadius: 'Merge radius',
    mergeRadiusHint: 'Photos this close together and next to each other in time become one stop.',
    language: 'Language',
    storage: 'Stored locally',
    storageHint: 'The trip and thumbnails are kept in this browser and come back after a reload.',
    clearData: 'Clear local data',
    close: 'Close',
    done: 'Done',
    restored: 'Your last trip is back',
    demoFailed: 'The demo photos didn’t load — check your connection and try again.',
    demoNote: 'Demo trip · the photos are AI illustrations with location and time written into EXIF, read by the same pipeline as real photos.',
    routing: 'Routing roads {done}/{total}',
    routingFailed: 'Some legs had no road route — drawn as straight lines instead.',
    geocoding: 'Looking up places {done}/{total}',
    posterTitle: 'Share poster',
    posterMaking: 'Making the poster…',
    download: 'Download',
    photoOf: '{i} of {n}',
    showOnMap: 'Show on map',
    camera: 'Camera',
    coords: 'Coordinates',
    exportedGpx: 'GPX exported',
    archiveSaved: 'Trip archive saved',
    archiveBad: 'That file isn’t a valid trip archive.',
    dropToAdd: 'Drop to add photos',
    tripSpan: '{start} – {end}',
    dateFmt: 'MMM D',
    weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    keyboard: 'Space play/pause · ← → previous/next stop',
    legend: 'Transport',
    noSegments: 'Only one stop so far — add photos from other places to draw a route.',
    about: 'About',
    aboutBody: 'A small tool that turns photo GPS into a replay of your trip, part of the Shoal/Rat Econ-CS Lab. Open-source pieces: MapLibre GL, exifr, heic2any; map data © OpenStreetMap contributors.',
    backHome: 'Back to the lab',
    posterFooter: 'Trip Memory Map · weikezhang.cn/trip-memory-map',
    tzApprox: 'time zone estimated from longitude',
  },
};

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function detect() {
  try {
    const saved = localStorage.getItem('tripmap.lang');
    if (saved === 'zh' || saved === 'en') return saved;
  } catch (_) { /* private mode */ }
  return (navigator.language || 'zh').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export let lang = detect();

export function setLang(next) {
  lang = next === 'en' ? 'en' : 'zh';
  try { localStorage.setItem('tripmap.lang', lang); } catch (_) { /* ignore */ }
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
}

export function t(key, vars) {
  let s = STRINGS[lang][key] ?? STRINGS.zh[key] ?? key;
  if (vars && typeof s === 'string') s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
  return s;
}

/** Local wall-clock parts for a UTC time at a fixed offset (minutes). */
export function localParts(utcMs, offsetMin) {
  const d = new Date(utcMs + offsetMin * 60000);
  return {
    y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(),
    h: d.getUTCHours(), mi: d.getUTCMinutes(), wd: d.getUTCDay(),
  };
}

export function fmtDate(utcMs, offsetMin, withWeekday = false) {
  const p = localParts(utcMs, offsetMin);
  const wd = withWeekday ? ` ${STRINGS[lang].weekdays[p.wd]}` : '';
  if (lang === 'zh') return `${p.mo + 1}月${p.d}日${wd}`;
  return `${withWeekday ? STRINGS.en.weekdays[p.wd] + ', ' : ''}${MONTHS_EN[p.mo]} ${p.d}`;
}

export function fmtTime(utcMs, offsetMin) {
  const p = localParts(utcMs, offsetMin);
  return `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`;
}

export function fmtOffset(offsetMin) {
  const sign = offsetMin >= 0 ? '+' : '−';
  const a = Math.abs(offsetMin);
  return `UTC${sign}${Math.floor(a / 60)}${a % 60 ? ':' + String(a % 60).padStart(2, '0') : ''}`;
}

export function fmtDays(n) {
  return n === 1 && lang === 'en' ? t('dayOne') : t('daysN', { n });
}

export function fmtDuration(ms) {
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins < 60) return t('minutes', { n: mins });
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return m ? t('hoursMinutes', { h, m }) : t('hours', { n: h });
  return t('daysHours', { d: Math.floor(h / 24), h: h % 24 });
}

export function fmtDistance(km) {
  if (km < 1) return t('m', { n: Math.round(km * 1000) });
  if (km < 10) return t('km', { n: km.toFixed(1) });
  return t('km', { n: Math.round(km).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US') });
}
