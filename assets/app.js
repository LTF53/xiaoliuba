/* 小刘吧 · app.js
   纯原生 JS，无依赖。文字数据保存在 localStorage，照片存放在 IndexedDB。 */
(() => {
  'use strict';

  /* ---------------------------------------------------------------------
     1. 工具函数
     --------------------------------------------------------------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const pad2 = (n) => String(n).padStart(2, '0');
  const esc = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  const uid = () =>
    (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const CN_MONTH = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];

  const isoOf = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const todayISO = () => isoOf(new Date());
  const stamp = (daysAgo = 0) => new Date(Date.now() - daysAgo * 86400000).toISOString();

  function parseISO(value) {
    if (!value) return null;
    const str = String(value);
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const d = new Date(year, month - 1, day);
    if (Number.isNaN(d.getTime())) return null;
    if (d.getFullYear() !== year || d.getMonth() + 1 !== month || d.getDate() !== day) return null;
    return d;
  }
  function safeImageSrc(value) {
    const src = String(value || '');
    if (/^data:image\/(?:png|jpe?g|webp|gif|avif);base64,[a-z0-9+/=]+$/i.test(src)) return src;
    if (/^assets\/demo\/[a-z0-9._-]+\.svg$/i.test(src)) return src;
    if (/^shared\/photos\/[a-z0-9._-]+\.(?:png|jpe?g|webp|gif)$/i.test(src)) return src;
    return '';
  }

  /* 共享只读模式：GitHub Pages 上自动读取发布者上传的 shared/state.json，
     本地开发/编辑模式不受影响；也可以用 ?shared=1 预览。 */
  const PAGE_PARAMS = new URLSearchParams(window.location.search);
  const IS_SHARED = /\.github\.io$/i.test(window.location.hostname) || PAGE_PARAMS.get('shared') === '1';

  /* ---------------------------------------------------------------------
     照片库：照片二进制存放在 IndexedDB，localStorage 只存文字元数据。
     这样相册容量不再受 localStorage 5MB 左右限制，通常可用数百 MB。
     --------------------------------------------------------------------- */
  const MEDIA_DB_NAME = 'xiaoliuba-media';
  const MEDIA_STORE = 'photos';
  const PHOTO_PLACEHOLDER = 'data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 4 3%27%3E%3Crect width=%274%27 height=%273%27 fill=%27%23f4efe5%27/%3E%3C/svg%3E';
  let mediaDBPromise = null;
  let mediaAvailable = true;
  let storageQuota = 0;

  function openMediaDB() {
    if (!('indexedDB' in window)) {
      mediaAvailable = false;
      return Promise.reject(new Error('当前浏览器不支持 IndexedDB'));
    }
    if (!mediaDBPromise) {
      mediaDBPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(MEDIA_DB_NAME, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(MEDIA_STORE)) db.createObjectStore(MEDIA_STORE);
        };
        request.onsuccess = () => { mediaAvailable = true; resolve(request.result); };
        request.onerror = () => { mediaAvailable = false; reject(request.error); };
      });
    }
    return mediaDBPromise;
  }

  function idbPut(id, blob) {
    return openMediaDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(MEDIA_STORE, 'readwrite');
      tx.objectStore(MEDIA_STORE).put(blob, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }));
  }
  function idbGet(id) {
    return openMediaDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(MEDIA_STORE, 'readonly');
      const request = tx.objectStore(MEDIA_STORE).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    }));
  }
  function idbDelete(id) {
    return openMediaDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(MEDIA_STORE, 'readwrite');
      tx.objectStore(MEDIA_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function idbKeys() {
    return openMediaDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(MEDIA_STORE, 'readonly');
      const request = tx.objectStore(MEDIA_STORE).getAllKeys();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    }));
  }

  function dataUrlToBlob(dataUrl) {
    const parts = String(dataUrl || '').split(',');
    if (parts.length < 2) throw new Error('非法图片数据');
    const mimeMatch = /data:([^;]+)/.exec(parts[0]);
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const binary = atob(parts[1]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }
  function formatBytes(bytes) {
    const n = Math.max(0, Number(bytes) || 0);
    if (n < 1024) return `${n} B`;
    if (n < 1048576) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
    if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
    return `${(n / 1073741824).toFixed(2)} GB`;
  }
  function photoSrc(photo) {
    return photo._objectUrl || photo.src || PHOTO_PLACEHOLDER;
  }
  function mediaBytes() {
    return state.photos.reduce((total, photo) => total + (Number(photo.bytes) || 0), 0);
  }
  function serializeState() {
    const photos = state.photos.map((photo) => {
      const copy = { ...photo };
      delete copy._objectUrl;
      if (copy.mediaId) delete copy.src;
      return copy;
    });
    return JSON.stringify({ ...state, photos });
  }

  async function cleanupOrphanMedia() {
    if (!mediaAvailable) return;
    try {
      const keys = await idbKeys();
      const keep = new Set(state.photos.map((photo) => photo.mediaId).filter(Boolean));
      await Promise.all(keys.filter((key) => !keep.has(key)).map((key) => idbDelete(key)));
    } catch (err) {
      console.warn('[小刘吧] 清理照片库失败', err);
    }
  }

  async function hydrateMediaStore(options = {}) {
    const saveAfter = options.saveAfter !== false;
    if (!('indexedDB' in window)) return;
    try {
      await openMediaDB();
    } catch (err) {
      console.warn('[小刘吧] 照片库不可用，继续使用旧存储方式。', err);
      return;
    }
    const migrated = [];
    for (const photo of state.photos) {
      try {
        if (photo.src && photo.src.startsWith('data:image/')) {
          const blob = dataUrlToBlob(photo.src);
          const mediaId = photo.mediaId || photo.id || uid();
          await idbPut(mediaId, blob);
          migrated.push({ photo, src: photo.src, mediaId: photo.mediaId, bytes: photo.bytes });
          photo.mediaId = mediaId;
          photo.bytes = blob.size;
        }
        if (photo.mediaId) {
          const blob = await idbGet(photo.mediaId);
          if (blob) {
            if (photo._objectUrl) URL.revokeObjectURL(photo._objectUrl);
            photo._objectUrl = URL.createObjectURL(blob);
            if (!photo.bytes) photo.bytes = blob.size;
          }
        }
      } catch (err) {
        console.warn('[小刘吧] 照片迁移失败，保留旧数据。', err);
      }
    }
    if (migrated.length) {
      const ok = saveAfter ? save({ quiet: true }) : true;
      if (ok) {
        migrated.forEach(({ photo }) => { delete photo.src; });
      } else {
        migrated.forEach(({ photo, src, mediaId, bytes }) => {
          photo.src = src;
          if (mediaId) photo.mediaId = mediaId; else delete photo.mediaId;
          if (bytes) photo.bytes = bytes; else delete photo.bytes;
        });
      }
    }
    if (options.cleanup !== false) await cleanupOrphanMedia();
  }

  async function createPhotoRecord(item, meta) {
    const photo = {
      id: uid(),
      caption: String(item.caption || '未命名照片').slice(0, 80),
      tag: meta.tag,
      date: meta.date,
      w: item.w,
      h: item.h
    };
    if (item.blob) {
      try {
        await idbPut(photo.id, item.blob);
        photo.mediaId = photo.id;
        photo.bytes = item.blob.size;
        photo._objectUrl = URL.createObjectURL(item.blob);
        return photo;
      } catch (err) {
        console.warn('[小刘吧] 照片库写入失败，退回 dataURL 存储。', err);
      }
    }
    if (!item.dataUrl) throw new Error('照片数据为空');
    photo.src = item.dataUrl;
    return photo;
  }
  function isDateISO(value) { return !!parseISO(value); }
  function utcNum(d) { return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); }
  function dayDiff(a, b) {
    const da = typeof a === 'string' ? parseISO(a) : a;
    const db = typeof b === 'string' ? parseISO(b) : b;
    if (!da || !db) return 0;
    return Math.round((utcNum(db) - utcNum(da)) / 86400000);
  }
  function addDaysISO(iso, days) {
    const d = parseISO(iso);
    if (!d) return iso;
    d.setDate(d.getDate() + days);
    return isoOf(d);
  }
  function safeDate(year, month, day) {
    const last = new Date(year, month, 0).getDate();
    return new Date(year, month - 1, Math.min(day, last));
  }
  function fmtCN(iso) {
    const d = parseISO(iso);
    return d ? `${d.getMonth() + 1} 月 ${d.getDate()} 日` : '';
  }
  function fmtDateFull(iso) {
    const d = parseISO(iso);
    return d ? `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 · ${WEEK[d.getDay()]}` : '';
  }
  function fmtDot(iso) {
    const d = parseISO(iso);
    return d ? `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}` : '';
  }
  function fmtShort(iso) {
    const d = parseISO(iso);
    return d ? `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}` : '—';
  }
  function ageOf(iso) {
    const d = parseISO(iso);
    if (!d) return null;
    const now = new Date();
    let age = now.getFullYear() - d.getFullYear();
    const md = now.getMonth() - d.getMonth();
    if (md < 0 || (md === 0 && now.getDate() < d.getDate())) age -= 1;
    return age >= 0 ? age : null;
  }
  function daysSince(iso) {
    if (!isDateISO(iso)) return 0;
    return Math.max(0, dayDiff(iso, todayISO()));
  }
  function wordCount(text) {
    return String(text || '').replace(/\s+/g, '').length;
  }
  function greeting() {
    const h = new Date().getHours();
    if (h < 5) return '夜深了';
    if (h < 9) return '早上好';
    if (h < 12) return '上午好';
    if (h < 14) return '中午好';
    if (h < 18) return '下午好';
    if (h < 23) return '晚上好';
    return '夜深了';
  }
  const QUOTES = [
    '好好生活，慢慢相遇。',
    '把普通的日子，过得浪漫一点。',
    '记录，是为了记住。',
    '允许一切发生，也允许自己慢慢来。',
    '日子缓缓，生活闪闪。',
    '今天也要认真收集快乐。',
    '生活是个动词。',
    '认真吃饭，好好睡觉，慢慢变好。'
  ];
  function dailyQuote() {
    const days = Math.floor(utcNum(new Date()) / 86400000);
    return QUOTES[((days % QUOTES.length) + QUOTES.length) % QUOTES.length];
  }

  /* ---------------------------------------------------------------------
     2. 常量
     --------------------------------------------------------------------- */
  const STORAGE_KEY = 'xiaoliuba.v1';
  const STORAGE_BUDGET = 4200000;
  const TAGS = ['日常', '旅行', '家人', '纪念'];
  const MOODS = ['开心', '平静', '充实', '疲惫', '期待', '低落'];
  const WEATHERS = ['晴', '多云', '阴', '小雨', '雪', '风'];
  const MOOD_CLASS = {
    '开心': 'mood--happy',
    '平静': 'mood--calm',
    '充实': 'mood--full',
    '疲惫': 'mood--tired',
    '期待': 'mood--hoping',
    '低落': 'mood--low'
  };
  const EVENT_COLORS = [
    ['vermilion', '朱砂', '#c05a3e'],
    ['indigo', '靛蓝', '#4a6795'],
    ['pine', '松绿', '#3a7a63'],
    ['plum', '绛紫', '#8a5a80'],
    ['ochre', '赭金', '#a97a2f']
  ];
  const ACCENTS = [
    ['vermilion', '朱砂', '#b8452c'],
    ['indigo', '靛蓝', '#35538f'],
    ['pine', '松绿', '#2f6b58'],
    ['plum', '绛紫', '#74486e'],
    ['ochre', '赭金', '#96661d']
  ];
  const VIEW_META = {
    dashboard: { name: '仪表盘', title: '仪表盘' },
    gallery: { name: '照片墙', title: '照片墙' },
    countdown: { name: '倒计时', title: '倒计时' },
    diary: { name: '日记', title: '日记' },
    todos: { name: '待办', title: '待办' },
    profile: { name: '我的', title: '我的' }
  };
  const EVENT_TYPES = {
    birthday: '生日',
    anniversary: '纪念日',
    normal: '倒数日'
  };

  /* ---------------------------------------------------------------------
     3. 种子数据
     --------------------------------------------------------------------- */
  function seedState() {
    const today = todayISO();
    const thisYear = new Date().getFullYear();
    return {
      version: 1,
      createdAt: stamp(240),
      settings: { theme: 'light', accent: 'vermilion' },
      profile: {
        name: '小刘',
        tagline: '记录者 / 生活收藏家',
        birthday: '2001-12-18',
        city: '杭州',
        since: '2024-03-01',
        bio: '喜欢傍晚、旧电影和一切慢慢发生的事。这里是我的小角落，收着一些照片、一些日子和没说出口的话。',
        avatar: ''
      },
      photos: [
        { id: 'ph-dusk', src: 'assets/demo/dusk.svg', caption: '傍晚六点的天空，像打翻的橘子汽水', tag: '日常', date: addDaysISO(today, -2), w: 4, h: 5 },
        { id: 'ph-mist', src: 'assets/demo/mist.svg', caption: '山里的雾还没散，像一句没说完的话', tag: '旅行', date: addDaysISO(today, -5), w: 3, h: 2 },
        { id: 'ph-sea', src: 'assets/demo/sea.svg', caption: '海风很咸，但心情很轻', tag: '旅行', date: addDaysISO(today, -9), w: 3, h: 2 },
        { id: 'ph-window', src: 'assets/demo/window.svg', caption: '阳台的光刚好落在绿萝上', tag: '日常', date: addDaysISO(today, -14), w: 4, h: 5 },
        { id: 'ph-moon', src: 'assets/demo/moon.svg', caption: '今晚的月亮很给面子', tag: '日常', date: addDaysISO(today, -21), w: 1, h: 1 },
        { id: 'ph-blossom', src: 'assets/demo/blossom.svg', caption: '楼下花开了，春天真的来了', tag: '日常', date: addDaysISO(today, -34), w: 4, h: 5 },
        { id: 'ph-film', src: 'assets/demo/film.svg', caption: '旧胶片里的夏天', tag: '纪念', date: addDaysISO(today, -55), w: 8, h: 5 },
        { id: 'ph-lantern', src: 'assets/demo/lantern.svg', caption: '去年灯会，人很多，灯很暖', tag: '家人', date: addDaysISO(today, -88), w: 3, h: 2 }
      ],
      events: [
        { id: 'ev-birthday', title: '小刘的生日', date: '2001-12-18', type: 'birthday', repeat: true, note: '又长大一岁，今年想认真办一个小派对。', color: 'vermilion' },
        { id: 'ev-anniversary', title: '和阿岚在一起的第 4 年', date: '2022-11-11', type: 'anniversary', repeat: true, note: '提前订好那家一直想吃的餐厅。', color: 'plum' },
        { id: 'ev-trip', title: '去厦门看海', date: addDaysISO(today, 27), type: 'normal', repeat: false, note: '车票和民宿都订好了，只差一个晴天。', color: 'indigo' },
        { id: 'ev-checkup', title: '年度体检', date: addDaysISO(today, 40), type: 'normal', repeat: false, note: '前一晚记得空腹，早点睡。', color: 'pine' },
        { id: 'ev-spring', title: '春节回家', date: `${thisYear + 1}-02-06`, type: 'normal', repeat: false, note: '该抢票了。', color: 'ochre' },
        { id: 'ev-moved', title: '搬来杭州的第一天', date: addDaysISO(today, -128), type: 'normal', repeat: false, note: '那天拖着两个箱子，在雨里找房子。', color: 'indigo' }
      ],
      diaries: [
        {
          id: 'dr-1', date: addDaysISO(today, -1), title: '把阳台收拾干净了', mood: '充实', weather: '晴',
          content: '把阳台的旧纸箱都搬下楼，绿萝换了个更大的盆。擦玻璃的时候看到楼下有人在遛狗，阳光把它的影子拉得很长。傍晚坐在干净的地板上喝了一杯冰水，觉得生活好像也被整理了一遍。',
          createdAt: stamp(1), updatedAt: stamp(1)
        },
        {
          id: 'dr-2', date: addDaysISO(today, -3), title: '一场很慢的雨', mood: '平静', weather: '小雨',
          content: '雨从中午开始下，一直到天黑都没停。取消了出门的计划，煮了一壶茶，把没看完的书翻完了。雨声落在空调外机上，像很轻的鼓点。这样什么都不做的下午，其实也挺好的。',
          createdAt: stamp(3), updatedAt: stamp(3)
        },
        {
          id: 'dr-3', date: addDaysISO(today, -6), title: '开始学做手冲', mood: '期待', weather: '多云',
          content: '买了手冲壶和滤杯，第一杯冲得有点苦。看了三个视频，记了两页笔记，手忙脚乱地控制水温。第二杯好多了，有淡淡的柑橘味。原来慢慢来，真的会好一点。',
          createdAt: stamp(6), updatedAt: stamp(6)
        },
        {
          id: 'dr-4', date: addDaysISO(today, -10), title: '加班之后的一碗面', mood: '疲惫', weather: '阴',
          content: '加班到九点，楼下的面馆还亮着灯。点了一碗雪菜肉丝面，加了一个荷包蛋。老板问我是不是又没吃饭，我笑着说习惯了。热汤下肚的那一刻，觉得今天也还能过。',
          createdAt: stamp(10), updatedAt: stamp(10)
        },
        {
          id: 'dr-5', date: addDaysISO(today, -16), title: '菜市场的周六', mood: '开心', weather: '晴',
          content: '周六早上去菜市场，买了番茄、小青菜和一把香葱。卖花阿姨送了两枝尤加利，说放在窗边好看。回家路上阳光很好，塑料袋在手里一晃一晃的，很有生活的样子。',
          createdAt: stamp(16), updatedAt: stamp(16)
        },
        {
          id: 'dr-6', date: addDaysISO(today, -24), title: '夜里的桂花香', mood: '平静', weather: '多云',
          content: '下班路上闻到桂花香，才发现小区里的树开了。站在树下闻了很久，想起去年的这个时候，也是这样一个人走回家。时间过得真快，但有些气味会把人留住。',
          createdAt: stamp(24), updatedAt: stamp(24)
        },
        {
          id: 'dr-7', date: addDaysISO(today, -38), title: '给妈妈打了个电话', mood: '开心', weather: '晴',
          content: '给妈妈打了四十分钟电话。她说家里的柿子熟了，问我什么时候回去。我说下个月吧。挂掉电话之后有点想家，但心里也暖暖的。',
          createdAt: stamp(38), updatedAt: stamp(38)
        },
        {
          id: 'dr-8', date: addDaysISO(today, -52), title: '厨房第一次开火', mood: '期待', weather: '晴',
          content: '新家的厨房很小，只能站下两个人。第一次开火煮了泡面，坐在纸箱上吃完。窗外能看到对面楼的灯，一盏一盏亮起来。从今天开始，这里就是家了。',
          createdAt: stamp(52), updatedAt: stamp(52)
        },
        {
          id: 'dr-9', date: addDaysISO(today, -70), title: '一场说走就走的小旅行', mood: '开心', weather: '晴',
          content: '临时起意买了去临安的票，一个人坐大巴进山。下午在山里走了两个小时，溪水很凉，蝉声很大。回程的时候在车上睡着了，醒来看到晚霞，觉得这一趟很值得。',
          createdAt: stamp(70), updatedAt: stamp(70)
        },
        {
          id: 'dr-10', date: addDaysISO(today, -95), title: '梅雨季里的阅读', mood: '平静', weather: '小雨',
          content: '梅雨季，哪里都不想去。在窗边读完了两本书，一本讲植物，一本讲做饭。下午煮了绿豆汤，冰箱里冰了一会儿，喝下去的时候整个人都安静了。',
          createdAt: stamp(95), updatedAt: stamp(95)
        },
        {
          id: 'dr-11', date: addDaysISO(today, -120), title: '春天最后一天', mood: '期待', weather: '风',
          content: '春天最后一天，风很大。把厚被子晒了，阳台上的薄荷冒出新的叶子。晚上出门散步，看到路边有人在卖栀子花，买了一小束，香了一整个房间。',
          createdAt: stamp(120), updatedAt: stamp(120)
        }
      ],
      todos: [
        { id: 'td-1', text: '给阳台的绿萝换盆', done: true, createdAt: stamp(4) },
        { id: 'td-2', text: '整理上个月的照片，挑九张洗出来', done: false, createdAt: stamp(3) },
        { id: 'td-3', text: '读完《山茶文具店》最后两章', done: false, createdAt: stamp(2) },
        { id: 'td-4', text: '预约周末的牙科检查', done: false, createdAt: stamp(2) },
        { id: 'td-5', text: '给妈妈回个视频电话', done: true, createdAt: stamp(5) },
        { id: 'td-6', text: '买牛奶、咖啡豆和一瓶酱油', done: false, createdAt: stamp(1) }
      ],
      meta: { lastExport: null, updatedAt: new Date().toISOString() }
    };
  }

  function emptySharedState() {
    const shared = seedState();
    shared.photos = [];
    shared.events = [];
    shared.diaries = [];
    shared.todos = [];
    shared.meta = { ...shared.meta, sharedLoaded: false };
    return shared;
  }

  /* ---------------------------------------------------------------------
     4. 数据加载 / 保存
     --------------------------------------------------------------------- */
  const asStr = (v, fallback = '') => (typeof v === 'string' ? v : (v == null ? fallback : String(v)));
  const asBool = (v) => v === true || v === 'true';
  const positiveInt = (v, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };

  function normalizePhoto(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const src = safeImageSrc(raw.src);
    const mediaId = asStr(raw.mediaId);
    if (!src && !mediaId) return null;
    const photo = {
      id: asStr(raw.id) || uid(),
      caption: asStr(raw.caption).slice(0, 160),
      tag: TAGS.includes(asStr(raw.tag)) ? raw.tag : (asStr(raw.tag) || '日常'),
      date: isDateISO(raw.date) ? asStr(raw.date) : todayISO(),
      w: positiveInt(raw.w, 4),
      h: positiveInt(raw.h, 3)
    };
    if (src) photo.src = src;
    if (mediaId) {
      photo.mediaId = mediaId;
      photo.bytes = Math.max(0, Number(raw.bytes) || 0);
    }
    return photo;
  }
  function normalizeEvent(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const title = asStr(raw.title).trim();
    if (!title || !isDateISO(raw.date)) return null;
    return {
      id: asStr(raw.id) || uid(),
      title: title.slice(0, 60),
      date: asStr(raw.date).slice(0, 10),
      type: ['birthday', 'anniversary', 'normal'].includes(raw.type) ? raw.type : 'normal',
      repeat: asBool(raw.repeat),
      note: asStr(raw.note).slice(0, 200),
      color: EVENT_COLORS.some(([key]) => key === raw.color) ? raw.color : 'vermilion'
    };
  }
  function normalizeDiary(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const content = asStr(raw.content);
    const title = asStr(raw.title).trim();
    if (!content && !title) return null;
    return {
      id: asStr(raw.id) || uid(),
      date: isDateISO(raw.date) ? asStr(raw.date).slice(0, 10) : todayISO(),
      title: (title || '未命名的一天').slice(0, 60),
      mood: MOODS.includes(raw.mood) ? raw.mood : '平静',
      weather: WEATHERS.includes(raw.weather) ? raw.weather : '晴',
      content: content.slice(0, 20000),
      createdAt: asStr(raw.createdAt) || new Date().toISOString(),
      updatedAt: asStr(raw.updatedAt) || asStr(raw.createdAt) || new Date().toISOString()
    };
  }
  function normalizeTodo(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const text = asStr(raw.text).trim();
    if (!text) return null;
    return {
      id: asStr(raw.id) || uid(),
      text: text.slice(0, 160),
      done: asBool(raw.done),
      createdAt: asStr(raw.createdAt) || new Date().toISOString()
    };
  }

  function normalizeState(data, fallbackSeed) {
    const seed = fallbackSeed || seedState();
    const profileRaw = (data && typeof data.profile === 'object' && data.profile) || {};
    const settingsRaw = (data && typeof data.settings === 'object' && data.settings) || {};
    const result = {
      version: 1,
      createdAt: asStr(data && data.createdAt) || seed.createdAt,
      settings: {
        theme: ['light', 'dark', 'auto'].includes(settingsRaw.theme) ? settingsRaw.theme : 'light',
        accent: ACCENTS.some(([key]) => key === settingsRaw.accent) ? settingsRaw.accent : 'vermilion'
      },
      profile: {
        name: asStr(profileRaw.name, seed.profile.name).slice(0, 20) || seed.profile.name,
        tagline: asStr(profileRaw.tagline, seed.profile.tagline).slice(0, 60),
        birthday: isDateISO(profileRaw.birthday) ? asStr(profileRaw.birthday).slice(0, 10) : '',
        city: asStr(profileRaw.city).slice(0, 30),
        since: isDateISO(profileRaw.since) ? asStr(profileRaw.since).slice(0, 10) : '',
        bio: asStr(profileRaw.bio).slice(0, 500),
        avatar: safeImageSrc(profileRaw.avatar)
      },
      photos: Array.isArray(data && data.photos) ? data.photos.map(normalizePhoto).filter(Boolean) : [],
      events: Array.isArray(data && data.events) ? data.events.map(normalizeEvent).filter(Boolean) : [],
      diaries: Array.isArray(data && data.diaries) ? data.diaries.map(normalizeDiary).filter(Boolean) : [],
      todos: Array.isArray(data && data.todos) ? data.todos.map(normalizeTodo).filter(Boolean) : [],
      meta: {
        lastExport: isDateISO(data && data.meta && data.meta.lastExport) ? asStr(data.meta.lastExport).slice(0, 10) : null,
        updatedAt: asStr(data && data.meta && data.meta.updatedAt) || new Date().toISOString()
      }
    };
    return result;
  }

  let recovery = null;

  function loadState() {
    let raw = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      console.warn('[小刘吧] 无法访问本地存储。', err);
      recovery = { raw: '', backedUp: false, inaccessible: true };
      return seedState();
    }
    if (!raw) return seedState();
    try {
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') throw new Error('本地数据不是有效对象');
      return normalizeState(data);
    } catch (err) {
      console.warn('[小刘吧] 本地数据读取失败，使用示例数据。', err);
      let backedUp = false;
      try {
        localStorage.setItem(STORAGE_KEY + '.broken', raw);
        backedUp = true;
      } catch (backupError) {
        console.warn('[小刘吧] 原始数据备份失败', backupError);
      }
      recovery = { raw, backedUp };
      return seedState();
    }
  }

  async function loadSharedState() {
    try {
      const response = await fetch(`shared/state.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      state = normalizeState(data);
      state.meta = { ...state.meta, sharedLoaded: true };
    } catch (err) {
      console.warn('[小刘吧] 共享数据读取失败。', err);
      state.meta = { ...state.meta, sharedLoaded: false, sharedError: true };
    }
  }

  let state = IS_SHARED ? emptySharedState() : loadState();

  function currentSize() {
    try { return serializeState().length; } catch (err) { return 0; }
  }

  function save(options = {}) {
    if (IS_SHARED) return true; // 只读共享页不写回任何数据
    const quiet = !!options.quiet;
    state.meta.updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(STORAGE_KEY, serializeState());
      updateStorage();
      return true;
    } catch (err) {
      console.error('[小刘吧] 保存失败', err);
      if (!quiet) toast('文字数据保存失败，请导出备份后清理空间。', 'error');
      updateStorage();
      return false;
    }
  }

  /* ---------------------------------------------------------------------
     5. 主题
     --------------------------------------------------------------------- */
  const THEME_LABELS = { light: '浅色', dark: '深色', auto: '跟随系统' };
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
  const urlParams = PAGE_PARAMS;
  let previewTheme = ['light', 'dark', 'auto'].includes(urlParams.get('theme')) ? urlParams.get('theme') : null;
  let previewAccent = ACCENTS.some(([key]) => key === urlParams.get('accent')) ? urlParams.get('accent') : null;

  function clearPreviewParams() {
    try {
      const url = new URL(location.href);
      let changed = false;
      if (url.searchParams.has('theme')) { url.searchParams.delete('theme'); changed = true; }
      if (url.searchParams.has('accent')) { url.searchParams.delete('accent'); changed = true; }
      if (changed) {
        history.replaceState(null, '', url.pathname + (url.search || '') + (url.hash || ''));
      }
    } catch (err) { /* ignore */ }
    previewTheme = null;
    previewAccent = null;
  }

  function resolvedTheme() {
    const mode = previewTheme || state.settings.theme;
    if (mode === 'auto') return prefersDark.matches ? 'dark' : 'light';
    return mode === 'dark' ? 'dark' : 'light';
  }

  function applyTheme() {
    const theme = resolvedTheme();
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.accent = previewAccent || state.settings.accent || 'vermilion';
    const meta = $('#themeColorMeta');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#12100e' : '#f6f2ea');
    const sideBtn = $('#sideThemeBtn');
    if (sideBtn) sideBtn.textContent = `外观 · ${THEME_LABELS[state.settings.theme] || '浅色'}`;
    renderThemeControls();
  }

  function setTheme(value) {
    if (!['light', 'dark', 'auto'].includes(value)) return;
    clearPreviewParams();
    const previous = state.settings.theme;
    state.settings.theme = value;
    if (!save({ quiet: true })) {
      state.settings.theme = previous;
      toast('保存失败：本地存储空间不足，主题未切换。', 'error');
      return;
    }
    applyTheme();
    toast(`外观已切换为${THEME_LABELS[value]}`, 'success');
  }
  function setAccent(value) {
    if (!ACCENTS.some(([key]) => key === value)) return;
    clearPreviewParams();
    const previous = state.settings.accent;
    state.settings.accent = value;
    if (!save({ quiet: true })) {
      state.settings.accent = previous;
      toast('保存失败：本地存储空间不足，主色未切换。', 'error');
      return;
    }
    applyTheme();
    toast('主色已更新', 'success');
  }

  function renderThemeControls() {
      const themeRoot = $('#themeOptions');
    if (themeRoot) {
      themeRoot.innerHTML = ['light', 'dark', 'auto'].map((key) =>
        `<button type="button" role="radio" aria-checked="${state.settings.theme === key}" class="${state.settings.theme === key ? 'is-active' : ''}" data-action="set-theme" data-theme="${key}">${THEME_LABELS[key]}</button>`
      ).join('');
    }
    const accentRoot = $('#accentOptions');
    if (accentRoot) {
      accentRoot.innerHTML = ACCENTS.map(([key, label, color]) =>
        `<button type="button" role="radio" class="swatch ${state.settings.accent === key ? 'is-active' : ''}" style="--sw:${color}" data-action="set-accent" data-accent="${key}" aria-checked="${state.settings.accent === key}" aria-label="${label}" title="${label}"></button>`
      ).join('');
    }
  }

  /* ---------------------------------------------------------------------
     6. 倒数日计算
     --------------------------------------------------------------------- */
  function nextAnnual(targetISO, sourceISO) {
    const src = parseISO(sourceISO || targetISO);
    const target = parseISO(targetISO);
    if (!src || !target) return null;
    const today = parseISO(todayISO());
    const month = src.getMonth() + 1;
    const day = src.getDate();
    let next = safeDate(today.getFullYear(), month, day);
    if (dayDiff(todayISO(), isoOf(next)) < 0) next = safeDate(today.getFullYear() + 1, month, day);
    return isoOf(next);
  }

  function eventInfo(ev) {
    if (!isDateISO(ev.date)) return null;
    const annual = !!ev.repeat;
    const targetISO = annual ? nextAnnual(ev.date, ev.date) : ev.date;
    if (!targetISO) return null;
    const days = dayDiff(todayISO(), targetISO);
    const past = !annual && days < 0;
    let percent = 0;
    if (annual && !past) {
      const target = parseISO(targetISO);
      const src = parseISO(ev.date);
      const prev = safeDate(target.getFullYear() - 1, src.getMonth() + 1, src.getDate());
      const total = Math.max(1, dayDiff(isoOf(prev), targetISO));
      const rawPercent = Math.round(Math.min(1, Math.max(0, (total - Math.max(0, days)) / total)) * 100);
      percent = days === 0 ? 100 : Math.min(99, rawPercent);
    }
    return {
      annual,
      targetISO,
      days,
      daysAbs: Math.abs(days),
      past,
      isToday: days === 0,
      percent
    };
  }

  function sortedEvents() {
    return state.events
      .map((ev) => ({ ev, info: eventInfo(ev) }))
      .filter((item) => item.info)
      .sort((a, b) => {
        if (a.info.past !== b.info.past) return a.info.past ? 1 : -1;
        if (a.info.past) return a.info.daysAbs - b.info.daysAbs;
        return a.info.days - b.info.days;
      });
  }
  const nextUpcomingEvent = () => sortedEvents().find((item) => !item.info.past) || null;

  function eventTypeLabel(ev) {
    const base = EVENT_TYPES[ev.type] || '倒数日';
    return ev.repeat ? `${base} · 每年` : base;
  }

  /* ---------------------------------------------------------------------
     7. 通用渲染
     --------------------------------------------------------------------- */
  const sortedPhotos = (list = state.photos) =>
    list.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  function avatarInner(profile) {
    if (profile.avatar) return `<img src="${esc(profile.avatar)}" alt="">`;
    const ch = (profile.name || '刘').trim().charAt(0) || '刘';
    return esc(ch);
  }

  async function refreshStorageQuota() {
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const estimate = await navigator.storage.estimate();
        storageQuota = Number(estimate.quota) || 0;
        updateStorage();
      }
    } catch (err) { /* ignore */ }
  }

  function updateStorage() {
    const metaSize = currentSize();
    const photoBytes = mediaBytes();
    const total = photoBytes + metaSize;
    const percent = storageQuota
      ? Math.min(100, Math.max(photoBytes > 0 ? 1 : 0, Math.round((photoBytes / storageQuota) * 100)))
      : Math.min(100, Math.max(total > 0 ? 1 : 0, Math.round((total / STORAGE_BUDGET) * 100)));
    const percentEl = $('#storagePercent');
    const barEl = $('#storageBar');
    if (percentEl) percentEl.textContent = formatBytes(total);
    if (barEl) barEl.style.width = `${percent}%`;
    const block = $('#storageBlock');
    if (block) {
      const quotaLabel = storageQuota ? ` / 可用约 ${formatBytes(storageQuota)}` : '';
      block.innerHTML = `
        <div class="storage-head"><span>照片库（IndexedDB）</span><b>${formatBytes(photoBytes)}${quotaLabel}</b></div>
        <div class="storage-track"><i style="width:${percent}%"></i></div>
        <p class="fine-print">照片二进制存放在浏览器 IndexedDB 中，容量通常可达数百 MB 以上；文字数据 ${formatBytes(metaSize)} 存放在 localStorage。换浏览器或清理浏览器数据前，请先导出备份。</p>`;
    }
  }

  function renderChrome() {
    const topAvatar = $('#topAvatar');
    if (topAvatar) topAvatar.innerHTML = avatarInner(state.profile);
    const countEl = $('#notifyCount');
    if (countEl) {
      const count = buildReminders().length;
      countEl.hidden = count === 0;
      countEl.textContent = count > 9 ? '9+' : String(count);
    }
    updateStorage();
    const yearEl = $('#footYear');
    if (yearEl) yearEl.textContent = String(new Date().getFullYear());
    const sideBtn = $('#sideThemeBtn');
    if (sideBtn) sideBtn.textContent = `外观 · ${THEME_LABELS[state.settings.theme] || '浅色'}`;
  }

  function toast(message, tone = '') {
    const root = $('#toasts');
    if (!root) return;
    const el = document.createElement('div');
    el.className = 'toast' + (tone ? ` toast--${tone}` : '');
    el.textContent = message;
    root.appendChild(el);
    while (root.children.length > 3) root.removeChild(root.firstElementChild);
    setTimeout(() => {
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 320);
    }, 2900);
  }

  /* ---------------------------------------------------------------------
     8. 仪表盘
     --------------------------------------------------------------------- */
  function renderDashboard() {
    const today = todayISO();
    const profile = state.profile;
    const next = nextUpcomingEvent();
    const name = profile.name || '小刘';
    const heroEyebrow = $('#heroEyebrow');
    if (heroEyebrow) {
      const parts = [
        fmtDateFull(today),
        profile.city || '',
        `记录第 ${daysSince(profile.since) + 1} 天`
      ].filter(Boolean);
      heroEyebrow.innerHTML = parts.map((part) => `<span class="eyebrow-item">${esc(part)}</span>`).join('');
    }
    const heroTitle = $('#heroTitle');
    if (heroTitle) {
      heroTitle.innerHTML = `<span class="hero-title-main">${esc(greeting())}，${esc(name)}。</span><span class="hero-title-sub">今天也慢慢来。</span>`;
    }
    const heroSub = $('#heroSub');
    if (heroSub) heroSub.textContent = `「${dailyQuote()}」`;
    const heroMeta = $('#heroMeta');
    if (heroMeta) {
      const undone = state.todos.filter((t) => !t.done).length;
      const parts = [
        state.photos.length ? `收藏了 ${state.photos.length} 张照片` : '还没有贴上一张照片',
        state.diaries.length ? `写下 ${state.diaries.length} 篇日记` : '还没有写第一篇日记',
        undone ? `${undone} 件小事待完成` : '清单已经清空'
      ];
      heroMeta.innerHTML = parts.map((t) => `<span>${esc(t)}</span>`).join('');
    }
    renderNextEventCard(next);
    renderProfileMini();
    renderTodoMini();
    renderPhotosMini();
    renderDiaryMini();
  }

  function renderNextEventCard(item) {
    const card = $('#nextEventCard');
    if (!card) return;
    if (!item) {
      card.className = 'card next-event span-5';
      card.innerHTML = `
        <div class="ne-top"><span class="tag">倒数日</span></div>
        <div class="ne-count"><strong class="ne-num">—</strong><span class="ne-unit">天</span></div>
        <p class="ne-name">还没有值得等待的日子</p>
        <p class="ne-note">新建一个倒数日，让某个日子被认真期待。</p>
        <a class="text-link" href="#countdown">去新建 <span>→</span></a>`;
      return;
    }
    const { ev, info } = item;
    const color = ev.color || 'vermilion';
    card.className = `card next-event span-5 evt--${color}`;
    const dateLine = info.annual ? `${fmtCN(info.targetISO)} · 每年` : fmtDateFull(ev.date);
    const num = info.isToday
      ? '<strong class="ne-num ne-num--word">今天</strong>'
      : `<strong class="ne-num">${info.days}</strong><span class="ne-unit">天</span>`;
    card.innerHTML = `
      <div class="ne-top">
        <span class="tag tag--evt">${esc(EVENT_TYPES[ev.type] || '倒数日')}</span>
        <span class="ne-date">${esc(dateLine)}</span>
      </div>
      <div class="ne-count">${num}</div>
      <p class="ne-name">${esc(ev.title)}</p>
      <p class="ne-live" data-live-target="${esc(info.targetISO)}">${liveFallback(info)}</p>
      <p class="ne-note">${esc(ev.note || '这个日子正在来的路上。')}</p>
      ${info.annual ? `<div class="ne-bar"><i style="width:${info.percent}%"></i></div>` : ''}
      <a class="text-link" href="#countdown">查看全部倒数日 <span>→</span></a>`;
  }

  function liveFallback(info) {
    if (info.isToday) return '就是今天';
    if (info.past) return `已过去 ${info.daysAbs} 天`;
    return `还有 ${info.days} 天`;
  }

  function liveText(targetISO) {
    const days = dayDiff(todayISO(), targetISO);
    if (days > 0) return `还有 ${days} 天`;
    if (days === 0) {
      const nowDate = new Date();
      const endOfDay = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() + 1).getTime();
      const diff = Math.max(0, endOfDay - nowDate.getTime());
      const hours = Math.floor(diff / 3600000);
      const minutes = Math.floor((diff % 3600000) / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      return `就是今天 · 还剩 ${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
    }
    return '已经过去';
  }

  function renderProfileMini() {
    const root = $('#profileMini');
    if (!root) return;
    const p = state.profile;
    root.innerHTML = `
      <div class="pm-top">
        <span class="avatar avatar--md">${avatarInner(p)}</span>
        <div>
          <h3 class="pm-name">${esc(p.name || '小刘')}</h3>
          <p class="pm-tag">${esc(p.tagline || '记录生活的人')}</p>
        </div>
      </div>
      <div class="pm-stats">
        <div class="pm-stat"><strong>${state.photos.length}</strong><span>照片</span></div>
        <div class="pm-stat"><strong>${state.diaries.length}</strong><span>日记</span></div>
        <div class="pm-stat"><strong>${state.events.length}</strong><span>倒数日</span></div>
      </div>
      <a class="text-link" href="#profile">打开我的 <span>→</span></a>`;
  }

  function renderTodoMini() {
    const root = $('#todoMini');
    if (!root) return;
    const undone = state.todos.filter((t) => !t.done);
    const total = state.todos.length;
    const done = total - undone.length;
    const percent = total ? Math.round((done / total) * 100) : 0;
    root.innerHTML = `
      <div class="card-head">
        <h3 class="card-title">今天要做的</h3>
        <span class="mini-badge">${done} / ${total}</span>
      </div>
      <ul class="mini-todos">
        ${undone.slice(0, 4).map((t) => `
          <li class="mini-todo">
            <button class="check" type="button" data-action="toggle-todo" data-id="${esc(t.id)}" aria-label="标记完成"></button>
            <span class="mini-todo-text">${esc(t.text)}</span>
          </li>`).join('')}
      </ul>
      ${undone.length === 0 ? `<p class="mini-empty">${total ? '全部完成了，去休息一下吧。' : '还没有待办，慢慢来。'}</p>` : ''}
      <div class="mini-progress"><i style="width:${percent}%"></i></div>
      <a class="text-link" href="#todos">去清单 <span>→</span></a>`;
  }

  function renderPhotosMini() {
    const root = $('#photosMini');
    if (!root) return;
    const photos = sortedPhotos().slice(0, 4);
    root.innerHTML = `
      <div class="card-head">
        <h3 class="card-title">最近的瞬间</h3>
        <a class="text-link" href="#gallery">全部 →</a>
      </div>
      <div class="mini-photos">
        ${photos.map((p) => `
          <a class="mini-photo" href="#gallery" data-action="open-photo" data-id="${esc(p.id)}">
            <img src="${esc(photoSrc(p))}" alt="${esc(p.caption || '照片')}" loading="lazy">
            <span>${esc(p.caption || '未命名照片')}</span>
          </a>`).join('')}
        ${photos.length === 0 ? '<div class="mini-photos-empty">还没有照片。<br>上传第一张吧。</div>' : ''}
      </div>`;
  }

  function renderDiaryMini() {
    const root = $('#diaryMini');
    if (!root) return;
    const latest = state.diaries
      .slice()
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
    if (!latest) {
      root.innerHTML = `
        <div class="card-head"><h3 class="card-title">最近的手记</h3><a class="text-link" href="#diary">去写 →</a></div>
        <p class="mini-empty">还没有日记。<br>今天的心情，也值得被记下来。</p>
        <a class="text-link" href="#diary">写下第一篇 <span>→</span></a>`;
      return;
    }
    root.innerHTML = `
      <div class="card-head">
        <h3 class="card-title">最近的手记</h3>
        <a class="text-link" href="#diary">全部 →</a>
      </div>
      <div class="mini-diary">
        <p class="mini-diary-date">${esc(fmtDateFull(latest.date))} · ${esc(latest.mood || '')}</p>
        <h4 class="mini-diary-title">${esc(latest.title || '未命名的一天')}</h4>
        <p class="mini-diary-text">${esc(latest.content)}</p>
        <button class="text-link" type="button" data-action="read-diary" data-id="${esc(latest.id)}">继续读 <span>→</span></button>
      </div>`;
  }

  /* ---------------------------------------------------------------------
     9. 照片墙
     --------------------------------------------------------------------- */
  let activeTag = '全部';

  function filteredPhotos() {
    const list = sortedPhotos();
    return activeTag === '全部' ? list : list.filter((p) => (p.tag || '日常') === activeTag);
  }

  function galleryTags() {
    const counts = new Map();
    state.photos.forEach((p) => {
      const tag = p.tag || '日常';
      counts.set(tag, (counts.get(tag) || 0) + 1);
    });
    const extra = Array.from(counts.keys()).filter((tag) => !TAGS.includes(tag));
    return ['全部', ...TAGS.filter((tag) => counts.has(tag)), ...extra].map((tag) => ({
      tag,
      count: tag === '全部' ? state.photos.length : counts.get(tag) || 0
    }));
  }

  function renderGallery() {
    const count = state.photos.length;
    const sub = $('#gallerySub');
    if (sub) {
      if (IS_SHARED) {
        sub.textContent = count
          ? `共 ${count} 张照片 · 来自共享快照，只读展示。`
          : '共享快照里还没有照片。';
      } else {
        sub.textContent = count
          ? `共 ${count} 张照片。照片保存在本机浏览器的照片库里（IndexedDB），可以随时删掉。`
          : '把喜欢的瞬间贴在这里。';
      }
    }
    const tags = galleryTags();
    if (activeTag !== '全部' && !tags.some((item) => item.tag === activeTag)) activeTag = '全部';
    const chips = $('#tagFilters');
    if (chips) {
      chips.innerHTML = tags.map(({ tag, count: tagCount }) =>
        `<button type="button" role="tab" aria-selected="${activeTag === tag}" class="chip ${activeTag === tag ? 'is-active' : ''}" data-action="filter-gallery" data-tag="${esc(tag)}">${esc(tag)}<span class="chip-count">${tagCount}</span></button>`
      ).join('');
    }

    const grid = $('#galleryGrid');
    const empty = $('#galleryEmpty');
    if (!grid || !empty) return;

    if (!count) {
      grid.innerHTML = '';
      empty.hidden = false;
      empty.innerHTML = `
        <h2>照片墙还是空的</h2>
        <p>上传第一张照片，让这里慢慢热闹起来。<br>照片不会离开这台设备。</p>
        <button class="btn btn--solid" type="button" data-action="upload-photo">上传照片</button>`;
      return;
    }
    const photos = filteredPhotos();
    if (!photos.length) {
      grid.innerHTML = '';
      empty.hidden = false;
      empty.innerHTML = `
        <h2>「${esc(activeTag)}」下还没有照片</h2>
        <p>换个分类看看，或者上传一张新的。</p>
        <button class="btn btn--ghost" type="button" data-action="filter-gallery" data-tag="全部">查看全部</button>`;
      return;
    }
    empty.hidden = true;
    grid.innerHTML = `
      <button class="shot shot--add" type="button" data-action="upload-photo" aria-label="上传照片">
        <span class="shot-add-plus">＋</span>
        <span class="shot-add-label">添加照片</span>
      </button>
      ${photos.map((p) => `
        <figure class="shot" data-id="${esc(p.id)}">
          <button class="shot-open" type="button" data-action="open-photo" data-id="${esc(p.id)}" aria-label="查看照片：${esc(p.caption || '未命名照片')}">
            <img src="${esc(photoSrc(p))}" alt="${esc(p.caption || '照片')}" loading="lazy" style="aspect-ratio:${p.w || 4}/${p.h || 3}">
          </button>
          <div class="shot-actions">
            <button class="shot-btn" type="button" data-action="edit-photo" data-id="${esc(p.id)}">说明</button>
            <button class="shot-btn" type="button" data-action="delete-photo" data-id="${esc(p.id)}">删除</button>
          </div>
          <figcaption>
            <span class="shot-cap">${esc(p.caption || '未命名照片')}</span>
            <span class="shot-meta">${esc(fmtDot(p.date))}</span>
          </figcaption>
        </figure>`).join('')}`;
  }

  /* ---------------------------------------------------------------------
     10. 倒计时
     --------------------------------------------------------------------- */
  function renderCountdown() {
    const items = sortedEvents();
    const sub = $('#countdownSub');
    if (sub) {
      const upcoming = items.filter((i) => !i.info.past).length;
      const past = items.length - upcoming;
      sub.textContent = items.length
        ? `正在等待 ${upcoming} 个日子${past ? `，另有 ${past} 个已经走过。` : '。'}`
        : '把重要的日子放在这里，让等待有形状。';
    }
    const grid = $('#eventGrid');
    const empty = $('#eventEmpty');
    if (!grid || !empty) return;
    if (!items.length) {
      grid.innerHTML = '';
      empty.hidden = false;
      empty.innerHTML = `
        <h2>还没有倒数日</h2>
        <p>生日、纪念日、旅行……<br>给期待的某一天一个位置。</p>
        <button class="btn btn--solid" type="button" data-action="new-event">新建倒数日</button>`;
      return;
    }
    empty.hidden = true;
    grid.innerHTML = items.map((item, index) => {
      const { ev, info } = item;
      const isNext = !info.past && index === 0;
      const cls = `event-card evt--${ev.color || 'vermilion'}${isNext ? ' is-next' : ''}${info.past ? ' is-past' : ''}`;
      const numHtml = info.isToday
        ? '<span class="ev-num ev-num--word">今天</span>'
        : `<span class="ev-num">${info.past ? info.daysAbs : info.days}</span><span class="ev-unit">${info.past ? '天前' : '天'}</span>`;
      let dateHtml;
      if (info.past) {
        dateHtml = `${fmtDateFull(ev.date)} · 已经走过`;
      } else if (info.annual) {
        const target = parseISO(info.targetISO);
        dateHtml = `${fmtCN(info.targetISO)} · 每年 · ${WEEK[target.getDay()]}`;
      } else {
        dateHtml = fmtDateFull(ev.date);
      }
      return `<article class="${cls}" data-id="${esc(ev.id)}">
        <div class="ev-top">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span class="tag tag--evt">${esc(EVENT_TYPES[ev.type] || '倒数日')}</span>
            ${isNext ? '<span class="ev-next-mark">最近</span>' : ''}
          </div>
          <div class="ev-actions">
            <button class="text-btn" type="button" data-action="edit-event" data-id="${esc(ev.id)}">编辑</button>
            <button class="text-btn" type="button" data-action="delete-event" data-id="${esc(ev.id)}">删除</button>
          </div>
        </div>
        <div class="ev-days">${numHtml}</div>
        <h3 class="ev-name">${esc(ev.title)}</h3>
        <p class="ev-date">${esc(dateHtml)}</p>
        ${info.past ? '' : `<p class="ev-live" data-live-target="${esc(info.targetISO)}">${liveFallback(info)}</p>`}
        ${info.annual && !info.past ? `<div class="ev-bar"><i style="width:${info.percent}%"></i></div>` : ''}
        ${ev.note ? `<p class="ev-note">${esc(ev.note)}</p>` : ''}
      </article>`;
    }).join('');
  }

  /* ---------------------------------------------------------------------
     11. 日记
     --------------------------------------------------------------------- */
  let diaryQuery = '';
  let expandedDiaryId = null;

  const sortedDiaries = () => state.diaries.slice().sort((a, b) =>
    String(b.date || '').localeCompare(String(a.date || '')) ||
    String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

  function visibleDiaries() {
    const q = diaryQuery.trim().toLowerCase();
    const list = sortedDiaries();
    if (!q) return list;
    return list.filter((d) => `${d.title}\n${d.content}`.toLowerCase().includes(q));
  }

  function renderDiary() {
    const sub = $('#diarySub');
    if (sub) {
      const lastUpdated = state.diaries
        .map((d) => d.updatedAt || d.createdAt)
        .filter((value) => value && !Number.isNaN(new Date(value).getTime()))
        .sort()
        .pop();
      const latestLabel = lastUpdated
        ? fmtShort(isoOf(new Date(lastUpdated)))
        : (sortedDiaries()[0] ? fmtShort(sortedDiaries()[0].date) : '—');
      sub.textContent = state.diaries.length
        ? `一共 ${state.diaries.length} 篇，最近更新于 ${latestLabel}。`
        : '写下今天，留给以后的自己。';
    }
    renderDiaryList();
  }

  function renderDiaryList() {
    const input = $('#diarySearch');
    if (input && input.value !== diaryQuery) input.value = diaryQuery;
    const list = visibleDiaries();
    const countEl = $('#diaryCount');
    if (countEl) countEl.textContent = diaryQuery.trim() ? `找到 ${list.length} 篇` : (list.length ? `${list.length} 篇` : '');
    const root = $('#diaryList');
    const empty = $('#diaryEmpty');
    if (!root || !empty) return;

    if (!state.diaries.length) {
      root.innerHTML = '';
      empty.hidden = false;
      empty.innerHTML = `
        <h2>还没有日记</h2>
        <p>不用写成文章，三句话也可以。<br>今天发生了什么？</p>
        <button class="btn btn--solid" type="button" data-action="new-diary">写第一篇日记</button>`;
      return;
    }
    if (!list.length) {
      root.innerHTML = '';
      empty.hidden = false;
      empty.innerHTML = `
        <h2>没有找到相关的日记</h2>
        <p>换个关键词试试，或者清空搜索。</p>
        <button class="btn btn--ghost" type="button" data-action="clear-diary-search">清空搜索</button>`;
      return;
    }
    empty.hidden = true;
    const groups = new Map();
    list.forEach((d) => {
      const key = String(d.date || '').slice(0, 7) || '未知';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(d);
    });
    root.innerHTML = Array.from(groups.entries()).map(([key, items]) => {
      const [year, month] = key.split('-');
      return `<section class="diary-group">
        <h3 class="month-label">${esc(year)} 年 ${esc(String(Number(month) || month))} 月<span>${items.length} 篇</span></h3>
        <div class="diary-entries">${items.map(entryHTML).join('')}</div>
      </section>`;
    }).join('');
  }

  function entryHTML(d) {
    const dt = parseISO(d.date) || new Date();
    const open = expandedDiaryId === d.id;
    const moodClass = MOOD_CLASS[d.mood] || '';
    return `<article class="diary-entry" data-id="${esc(d.id)}">
      <div class="entry-date">
        <span class="entry-day">${pad2(dt.getDate())}</span>
        <span class="entry-week">${WEEK[dt.getDay()]} · ${pad2(dt.getMonth() + 1)} 月</span>
      </div>
      <div class="entry-body">
        <div class="entry-head">
          <h4 class="entry-title">${esc(d.title || '未命名的一天')}</h4>
          <span class="mood ${moodClass}">${esc(d.mood || '平静')}</span>
          <span class="weather">${esc(d.weather || '')}</span>
        </div>
        <p class="entry-text ${open ? '' : 'is-clamped'}">${esc(d.content)}</p>
        <div class="entry-foot">
          <span class="entry-word">${wordCount(d.content)} 字</span>
          <button class="text-btn" type="button" data-action="toggle-diary" data-id="${esc(d.id)}">${open ? '收起' : '展开'}</button>
          <button class="text-btn" type="button" data-action="edit-diary" data-id="${esc(d.id)}">编辑</button>
          <button class="text-btn" type="button" data-action="delete-diary" data-id="${esc(d.id)}">删除</button>
        </div>
      </div>
    </article>`;
  }

  /* ---------------------------------------------------------------------
     12. 待办
     --------------------------------------------------------------------- */
  let todoFilter = 'all';

  function filteredTodos() {
    if (todoFilter === 'active') return state.todos.filter((t) => !t.done);
    if (todoFilter === 'done') return state.todos.filter((t) => t.done);
    return state.todos;
  }

  function ringHTML(percent) {
    const r = 26;
    const c = 2 * Math.PI * r;
    const offset = c * (1 - percent / 100);
    return `<svg viewBox="0 0 64 64" aria-hidden="true">
      <circle class="ring-track" cx="32" cy="32" r="${r}"></circle>
      <circle class="ring-fill" cx="32" cy="32" r="${r}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"></circle>
    </svg><span class="ring-label">${percent}%</span>`;
  }

  function renderTodos() {
    const all = state.todos;
    const done = all.filter((t) => t.done).length;
    const percent = all.length ? Math.round((done / all.length) * 100) : 0;
    const sub = $('#todoSub');
    if (sub) {
      sub.textContent = all.length
        ? `共 ${all.length} 件事，已完成 ${done} 件。`
        : '清单空空的，正好可以发一会儿呆。';
    }
    const progressText = $('#todoProgressText');
    if (progressText) {
      progressText.textContent = all.length
        ? `已完成 ${done} / ${all.length}。${done === all.length ? '今天的你辛苦了。' : '慢慢来。'}`
        : '还没有待办。';
    }
    const ring = $('#todoRing');
    if (ring) ring.innerHTML = ringHTML(percent);
    const footNote = $('#todoFootNote');
    if (footNote) {
      footNote.textContent = all.length ? `剩余 ${all.length - done} 件未完成` : '把想做的事写下来，会轻松一点。';
    }
    const filters = $('#todoFilters');
    if (filters) {
      filters.innerHTML = [
        ['all', '全部', all.length],
        ['active', '待完成', all.filter((t) => !t.done).length],
        ['done', '已完成', done]
      ].map(([key, label, count]) =>
        `<button type="button" role="tab" aria-selected="${todoFilter === key}" class="chip ${todoFilter === key ? 'is-active' : ''}" data-action="filter-todos" data-filter="${key}">${label}<span class="chip-count">${count}</span></button>`
      ).join('');
    }
    const list = $('#todoList');
    if (list) {
      const items = filteredTodos();
      list.innerHTML = items.length
        ? items.map(todoHTML).join('')
        : `<li class="mini-empty">${todoFilter === 'done' ? '还没有完成的事项。' : todoFilter === 'active' ? '没有待完成的事了，去休息吧。' : '清单是空的，写点什么吧。'}</li>`;
    }
    const quote = $('#todoQuote');
    if (quote) quote.textContent = dailyQuote();
  }

  function todoHTML(t) {
    const created = parseISO(t.createdAt) ? isoOf(new Date(t.createdAt)) : '';
    return `<li class="todo-item ${t.done ? 'is-done' : ''}" data-id="${esc(t.id)}">
      <button class="check" type="button" data-action="toggle-todo" data-id="${esc(t.id)}" aria-label="${t.done ? '标记为未完成' : '标记为完成'}" aria-pressed="${t.done}"></button>
      <span class="todo-text">${esc(t.text)}</span>
      <span class="todo-time">${t.done ? '已完成' : (created ? fmtShort(created) : '')}</span>
      <button class="todo-del" type="button" data-action="delete-todo" data-id="${esc(t.id)}" aria-label="删除">×</button>
    </li>`;
  }

  /* ---------------------------------------------------------------------
     13. 我的
     --------------------------------------------------------------------- */
  function renderProfile() {
    updateStorage();
    const p = state.profile;
    const card = $('#profileCard');
    if (card) {
      const age = ageOf(p.birthday);
      card.innerHTML = `
        <div class="profile-top">
          <span class="avatar avatar--xl">${avatarInner(p)}</span>
          <div class="profile-id">
            <h2 class="profile-name">${esc(p.name || '小刘')}</h2>
            <p class="profile-tagline">${esc(p.tagline || '')}</p>
          </div>
          <button class="btn btn--ghost btn--sm" type="button" data-action="edit-profile">编辑资料</button>
        </div>
        <dl class="profile-facts">
          <div><dt>生日</dt><dd>${p.birthday ? `${fmtShort(p.birthday)}${age !== null ? ` · ${age} 岁` : ''}` : '未设置'}</dd></div>
          <div><dt>城市</dt><dd>${esc(p.city || '未设置')}</dd></div>
          <div><dt>记录开始</dt><dd>${p.since ? `${fmtShort(p.since)} · 第 ${daysSince(p.since) + 1} 天` : '未设置'}</dd></div>
        </dl>
        ${p.bio ? `<p class="profile-bio">${esc(p.bio)}</p>` : ''}
        <div class="profile-stats">
          <div class="ps-item"><div class="ps-value">${state.photos.length}</div><div class="ps-label">照片</div></div>
          <div class="ps-item"><div class="ps-value">${state.diaries.length}</div><div class="ps-label">日记</div></div>
          <div class="ps-item"><div class="ps-value">${state.todos.filter((t) => t.done).length}</div><div class="ps-label">完成待办</div></div>
          <div class="ps-item"><div class="ps-value">${state.events.length}</div><div class="ps-label">倒数日</div></div>
        </div>`;
    }
    const since = $('#dataSince');
    if (since) since.textContent = p.since ? `记录开始于 ${fmtDateFull(p.since)}` : '';
    renderProfileStats();
    renderActivityChart();
    updateStorage();
    renderThemeControls();
    const fine = $('#finePrint');
    if (fine) fine.textContent = `照片存于 IndexedDB，文字存于 localStorage（${location.host || '本机'}）· 导出的备份包含照片，请妥善保存`;
  }

  function renderProfileStats() {
    const root = $('#profileStats');
    if (!root) return;
    const totalTodos = state.todos.length;
    const doneTodos = state.todos.filter((t) => t.done).length;
    const rate = totalTodos ? Math.round((doneTodos / totalTodos) * 100) : 0;
    const items = [
      [state.photos.length, '照片', '张'],
      [state.diaries.length, '日记', '篇'],
      [rate, '待办完成率', '%'],
      [daysSince(state.profile.since) + 1, '记录天数', '天']
    ];
    root.innerHTML = items.map(([value, label, unit]) =>
      `<div class="stat"><div class="stat-value">${value}<small>${unit}</small></div><div class="stat-label">${label}</div></div>`
    ).join('');
  }

  function renderActivityChart() {
    const root = $('#activityChart');
    if (!root) return;
    const base = new Date();
    base.setDate(1);
    const months = [];
    for (let i = 5; i >= 0; i -= 1) {
      const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
      months.push({ key: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`, label: `${d.getMonth() + 1} 月`, diaries: 0, photos: 0 });
    }
    const index = new Map(months.map((m, i) => [m.key, i]));
    state.diaries.forEach((d) => {
      const key = String(d.date || '').slice(0, 7);
      if (index.has(key)) months[index.get(key)].diaries += 1;
    });
    state.photos.forEach((p) => {
      const key = String(p.date || '').slice(0, 7);
      if (index.has(key)) months[index.get(key)].photos += 1;
    });
    const max = Math.max(1, ...months.map((m) => Math.max(m.diaries, m.photos)));
    const W = 560;
    const H = 176;
    const left = 32;
    const right = 8;
    const top = 14;
    const bottom = 30;
    const chartH = H - top - bottom;
    const chartW = W - left - right;
    const band = chartW / months.length;
    const barW = Math.min(15, band / 3.2);
    let tickValues;
    if (max <= 3) tickValues = Array.from({ length: max + 1 }, (_, i) => i);
    else tickValues = [0, Math.round(max / 2), max];
    tickValues = Array.from(new Set(tickValues)).sort((a, b) => a - b);
    let grid = '';
    tickValues.forEach((val) => {
      const y = top + chartH - (val / max) * chartH;
      grid += `<line class="chart-grid" x1="${left}" y1="${y}" x2="${W - right}" y2="${y}"></line>`;
      grid += `<text class="chart-label" x="${left - 8}" y="${y + 3}" text-anchor="end">${val}</text>`;
    });
    const bars = months.map((m, i) => {
      const cx = left + band * i + band / 2;
      const h1 = (m.diaries / max) * (chartH - 8);
      const h2 = (m.photos / max) * (chartH - 8);
      const x1 = cx - barW - 1;
      const x2 = cx + 1;
      return `<rect class="chart-bar" x="${x1.toFixed(1)}" y="${(top + chartH - h1).toFixed(1)}" width="${barW}" height="${Math.max(0, h1).toFixed(1)}" rx="2"><title>${m.label} · 日记 ${m.diaries} 篇</title></rect>
        <rect class="chart-bar chart-bar--soft" x="${x2.toFixed(1)}" y="${(top + chartH - h2).toFixed(1)}" width="${barW}" height="${Math.max(0, h2).toFixed(1)}" rx="2"><title>${m.label} · 照片 ${m.photos} 张</title></rect>`;
    }).join('');
    const labels = months.map((m, i) =>
      `<text class="chart-label" x="${(left + band * i + band / 2).toFixed(1)}" y="${H - 10}" text-anchor="middle">${m.label}</text>`
    ).join('');
    const diaryTotal = months.reduce((n, m) => n + m.diaries, 0);
    const photoTotal = months.reduce((n, m) => n + m.photos, 0);
    root.innerHTML = `
      <div class="chart-head">
        <span class="chart-title">近六个月 · 记录节奏</span>
        <span class="chart-legend">
          <span><i class="legend-dot"></i>日记 ${diaryTotal}</span>
          <span><i class="legend-dot legend-dot--2"></i>照片 ${photoTotal}</span>
        </span>
      </div>
      <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="近六个月日记与照片数量柱状图">
        ${grid}${bars}${labels}
      </svg>`;
  }

  /* ---------------------------------------------------------------------
     14. 路由与总渲染
     --------------------------------------------------------------------- */
  let currentView = 'dashboard';
  let tickDay = todayISO();

  function viewFromHash() {
    const raw = String(location.hash || '').replace(/^#\/?/, '').split('?')[0];
    return VIEW_META[raw] ? raw : 'dashboard';
  }

  function route() {
    const view = viewFromHash();
    currentView = view;
    document.title = view === 'dashboard'
      ? '小刘吧 · 把日子过成喜欢的样子'
      : `${VIEW_META[view].name} · 小刘吧`;
    $$('.view').forEach((section) => {
      section.hidden = section.dataset.view !== view;
    });
    $$('[data-nav]').forEach((link) => {
      const active = link.dataset.nav === view;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    const crumb = $('#crumbView');
    if (crumb) crumb.textContent = VIEW_META[view].name;
    if (!location.hash) {
      try { history.replaceState(null, '', '#dashboard'); } catch (err) { /* ignore */ }
    }
    renderChrome();
    renderView(view);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function renderView(view) {
    switch (view) {
      case 'gallery': renderGallery(); break;
      case 'countdown': renderCountdown(); break;
      case 'diary': renderDiary(); break;
      case 'todos': renderTodos(); break;
      case 'profile': renderProfile(); break;
      case 'dashboard':
      default: renderDashboard(); break;
    }
  }

  function renderAll() {
    renderChrome();
    renderView(currentView);
  }

  function tick() {
    const clock = $('#clock');
    if (clock) {
      const d = new Date();
      clock.textContent = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    }
    const day = todayISO();
    if (day !== tickDay) {
      tickDay = day;
      renderChrome();
      renderView(currentView);
      document.title = currentView === 'dashboard'
        ? '小刘吧 · 把日子过成喜欢的样子'
        : `${VIEW_META[currentView].name} · 小刘吧`;
    }
    $$('[data-live-target]').forEach((el) => {
      const d = parseISO(el.dataset.liveTarget);
      if (!d) return;
      el.textContent = liveText(el.dataset.liveTarget);
    });
  }

  /* ---------------------------------------------------------------------
     15. 通用弹窗
     --------------------------------------------------------------------- */
  const modal = $('#modal');
  let modalToken = 0;
  let pendingSync = null;

  async function applyIncomingState(raw) {
    try {
      state = normalizeState(JSON.parse(raw));
      await hydrateMediaStore({ cleanup: false });
      applyTheme();
      renderAll();
      toast('另一个标签页更新了内容，已同步。', 'success');
    } catch (err) {
      console.warn('[小刘吧] 同步其他标签页数据失败', err);
    }
  }

  function flushPendingSync() {
    if (!pendingSync) return;
    const raw = pendingSync;
    pendingSync = null;
    applyIncomingState(raw);
  }

  function openModal(html, onMount) {
    if (!modal) return;
    modalToken += 1;
    if (modal.open) modal.close();
    const panel = $('#modalPanel');
    if (!panel) return;
    panel.innerHTML = html;
    if (typeof onMount === 'function') onMount(panel);
    if (!modal.open) modal.showModal();
    document.body.classList.add('modal-open');
  }

  function closeModal() {
    if (modal && modal.open) modal.close();
  }

  if (modal) {
    modal.addEventListener('close', () => {
      if (modal.open) return;
      document.body.classList.remove('modal-open');
      const panel = $('#modalPanel');
      if (panel) panel.innerHTML = '';
      const notifyBtn = $('#notifyBtn');
      if (notifyBtn) notifyBtn.setAttribute('aria-expanded', 'false');
      flushPendingSync();
    });
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeModal();
    });
  }

  function confirmDialog({ title = '确认操作', message = '', html = '', okText = '确认', danger = false } = {}) {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
        closeModal();
      };
      openModal(`
        <button class="modal-close" type="button" data-close aria-label="关闭">×</button>
        <h3 class="modal-title">${esc(title)}</h3>
        <p class="confirm-text">${html || esc(message)}</p>
        <div class="form-actions">
          <button class="btn btn--ghost" type="button" data-close>取消</button>
          <button class="btn ${danger ? 'btn--danger' : 'btn--solid'}" type="button" id="confirmOk">${esc(okText)}</button>
        </div>`,
        (panel) => {
          panel.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', () => settle(false)));
          const ok = panel.querySelector('#confirmOk');
          if (ok) ok.addEventListener('click', () => settle(true));
          const onClose = () => {
            modal.removeEventListener('close', onClose);
            if (!settled) {
              settled = true;
              resolve(false);
            }
          };
          modal.addEventListener('close', onClose);
        }
      );
    });
  }

  /* ---------------------------------------------------------------------
     16. 日记编辑器 / 阅读
     --------------------------------------------------------------------- */
  function openDiaryEditor(entry = null) {
    const editing = !!entry;
    const d = entry || { date: todayISO(), title: '', mood: '平静', weather: '晴', content: '' };
    openModal(`
      <button class="modal-close" type="button" data-close aria-label="关闭">×</button>
      <h3 class="modal-title">${editing ? '编辑这一篇' : '写一篇日记'}</h3>
      <p class="modal-sub">${esc(fmtDateFull(d.date))}</p>
      <form class="modal-form" id="diaryForm">
        <div class="field-row">
          <div class="field">
            <label for="df-date">日期</label>
            <input id="df-date" name="date" type="date" value="${esc(d.date)}" required>
          </div>
          <div class="field">
            <label for="df-title">标题</label>
            <input id="df-title" name="title" type="text" maxlength="60" value="${esc(d.title || '')}" placeholder="给今天起个名字">
          </div>
        </div>
        <div class="field">
          <span class="field-label">心情</span>
          <div class="choice-row">
            ${MOODS.map((m) => `<label class="choice"><input type="radio" name="mood" value="${m}" ${(d.mood || '平静') === m ? 'checked' : ''}><span>${m}</span></label>`).join('')}
          </div>
        </div>
        <div class="field">
          <span class="field-label">天气</span>
          <div class="choice-row">
            ${WEATHERS.map((w) => `<label class="choice"><input type="radio" name="weather" value="${w}" ${(d.weather || '晴') === w ? 'checked' : ''}><span>${w}</span></label>`).join('')}
          </div>
        </div>
        <div class="field">
          <label for="df-content">正文</label>
          <textarea id="df-content" name="content" maxlength="20000" placeholder="今天发生了什么？不用写得很好，记下来就好。">${esc(d.content || '')}</textarea>
          <div class="inline-count" id="df-count"></div>
        </div>
        <div class="form-actions">
          <button class="btn btn--ghost" type="button" data-close>取消</button>
          <button class="btn btn--solid" type="submit">${editing ? '保存修改' : '收进日记'}</button>
        </div>
      </form>`,
      (panel) => {
        const form = panel.querySelector('#diaryForm');
        const content = panel.querySelector('#df-content');
        const count = panel.querySelector('#df-count');
        const updateCount = () => { if (count) count.textContent = `${wordCount(content.value)} 字`; };
        if (content) {
          content.addEventListener('input', updateCount);
          updateCount();
        }
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          const data = new FormData(form);
          const date = String(data.get('date') || '').trim();
          const contentValue = String(data.get('content') || '').trim();
          const titleValue = String(data.get('title') || '').trim();
          if (!date || !contentValue) {
            toast('写点什么再保存吧。', 'error');
            return;
          }
          if (editing) {
            const previousEntry = {
              date: entry.date,
              title: entry.title,
              mood: entry.mood,
              weather: entry.weather,
              content: entry.content,
              updatedAt: entry.updatedAt
            };
            entry.date = date;
            entry.title = titleValue || '未命名的一天';
            entry.mood = String(data.get('mood') || '平静');
            entry.weather = String(data.get('weather') || '晴');
            entry.content = contentValue;
            entry.updatedAt = new Date().toISOString();
            if (!save({ quiet: true })) {
              Object.assign(entry, previousEntry);
              toast('保存失败：本地存储空间不足，日记未更新。', 'error');
              return;
            }
            expandedDiaryId = entry.id;
          } else {
            const created = {
              id: uid(),
              date,
              title: titleValue || '未命名的一天',
              mood: String(data.get('mood') || '平静'),
              weather: String(data.get('weather') || '晴'),
              content: contentValue,
              createdAt: new Date().toISOString()
            };
            state.diaries.push(created);
            if (!save({ quiet: true })) {
              state.diaries = state.diaries.filter((d) => d.id !== created.id);
              toast('保存失败：本地存储空间不足，日记未保存。', 'error');
              return;
            }
            expandedDiaryId = created.id;
          }
          closeModal();
          renderAll();
          toast(editing ? '日记已更新' : '已收进日记', 'success');
        });
        panel.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', closeModal));
      }
    );
  }

  function openDiaryReader(diary) {
    openModal(`
      <button class="modal-close" type="button" data-close aria-label="关闭">×</button>
      <h3 class="reader-title">${esc(diary.title || '未命名的一天')}</h3>
      <div class="reader-meta">
        <span>${esc(fmtDateFull(diary.date))}</span>
        <span class="mood ${MOOD_CLASS[diary.mood] || ''}">${esc(diary.mood || '平静')}</span>
        <span>${esc(diary.weather || '')}</span>
        <span>${wordCount(diary.content)} 字</span>
      </div>
      <div class="reader-body">${esc(diary.content)}</div>
      <div class="reader-actions">
        <button class="btn btn--danger" type="button" data-action="delete-diary" data-id="${esc(diary.id)}">删除</button>
        <button class="btn btn--ghost" type="button" data-close>合上</button>
        <button class="btn btn--solid" type="button" data-action="edit-diary" data-id="${esc(diary.id)}">编辑</button>
      </div>`,
      (panel) => {
        panel.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', closeModal));
      }
    );
  }

  /* ---------------------------------------------------------------------
     17. 倒数日编辑器
     --------------------------------------------------------------------- */
  function openEventEditor(event = null) {
    const editing = !!event;
    const ev = event || {
      title: '', date: todayISO(), type: 'normal', repeat: false, note: '', color: 'vermilion'
    };
    openModal(`
      <button class="modal-close" type="button" data-close aria-label="关闭">×</button>
      <h3 class="modal-title">${editing ? '编辑倒数日' : '新建倒数日'}</h3>
      <p class="modal-sub">给某一个日子，留一个位置。</p>
      <form class="modal-form" id="eventForm">
        <div class="field">
          <label for="ef-title">名称</label>
          <input id="ef-title" name="title" type="text" maxlength="40" value="${esc(ev.title)}" placeholder="比如：小刘的生日" required>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="ef-date">日期</label>
            <input id="ef-date" name="date" type="date" value="${esc(ev.date)}" required>
          </div>
          <div class="field">
            <span class="field-label">类型</span>
            <div class="choice-row">
              ${Object.entries(EVENT_TYPES).map(([key, label]) =>
                `<label class="choice"><input type="radio" name="type" value="${key}" ${(ev.type || 'normal') === key ? 'checked' : ''}><span>${label}</span></label>`
              ).join('')}
            </div>
          </div>
        </div>
        <div class="field">
          <span class="field-label">重复</span>
          <div class="choice-row">
            <label class="choice"><input type="radio" name="repeat" value="no" ${!ev.repeat ? 'checked' : ''}><span>仅这一次</span></label>
            <label class="choice"><input type="radio" name="repeat" value="yes" ${ev.repeat ? 'checked' : ''}><span>每年重复</span></label>
          </div>
          <span class="field-note">生日、纪念日可以选择「每年重复」，会自动计算下一个日期。</span>
        </div>
        <div class="field">
          <span class="field-label">颜色</span>
          <div class="color-row">
            ${EVENT_COLORS.map(([key, label, color]) =>
              `<label class="color-choice"><input type="radio" name="color" value="${key}" ${(ev.color || 'vermilion') === key ? 'checked' : ''}><span style="--sw:${color}" title="${label}"></span></label>`
            ).join('')}
          </div>
        </div>
        <div class="field">
          <label for="ef-note">备注</label>
          <textarea id="ef-note" name="note" maxlength="200" placeholder="想对这一天说点什么？">${esc(ev.note || '')}</textarea>
        </div>
        <div class="form-actions">
          <button class="btn btn--ghost" type="button" data-close>取消</button>
          <button class="btn btn--solid" type="submit">${editing ? '保存修改' : '开始倒数'}</button>
        </div>
      </form>`,
      (panel) => {
        const form = panel.querySelector('#eventForm');
        const typeRadios = panel.querySelectorAll('input[name="type"]');
        typeRadios.forEach((radio) => {
          radio.addEventListener('change', () => {
            if (radio.checked && (radio.value === 'birthday' || radio.value === 'anniversary')) {
              const yes = panel.querySelector('input[name="repeat"][value="yes"]');
              if (yes) yes.checked = true;
            }
          });
        });
        form.addEventListener('submit', (submitEvent) => {
          submitEvent.preventDefault();
          const data = new FormData(form);
          const titleValue = String(data.get('title') || '').trim();
          const dateValue = String(data.get('date') || '').trim();
          if (!titleValue || !isDateISO(dateValue)) {
            toast('名称和日期都要填好。', 'error');
            return;
          }
          const payload = {
            title: titleValue,
            date: dateValue,
            type: String(data.get('type') || 'normal'),
            repeat: String(data.get('repeat') || 'no') === 'yes',
            color: String(data.get('color') || 'vermilion'),
            note: String(data.get('note') || '').trim()
          };
          if (editing) {
            const previousEvent = {
              title: event.title,
              date: event.date,
              type: event.type,
              repeat: event.repeat,
              color: event.color,
              note: event.note
            };
            Object.assign(event, payload);
            if (!save({ quiet: true })) {
              Object.assign(event, previousEvent);
              toast('保存失败：本地存储空间不足，倒数日未更新。', 'error');
              return;
            }
          } else {
            const created = { id: uid(), ...payload };
            state.events.push(created);
            if (!save({ quiet: true })) {
              state.events = state.events.filter((item) => item.id !== created.id);
              toast('保存失败：本地存储空间不足，倒数日未创建。', 'error');
              return;
            }
          }
          closeModal();
          renderAll();
          toast(editing ? '倒数日已更新' : '已开始倒数', 'success');
        });
        panel.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', closeModal));
      }
    );
  }

  /* ---------------------------------------------------------------------
     18. 照片：上传 / 说明 / 灯箱
     --------------------------------------------------------------------- */
  function compressImage(file, maxSide = 1280, quality = 0.8) {
    return new Promise((resolve, reject) => {
      if (!file || !String(file.type).startsWith('image/')) {
        reject(new Error('不是图片'));
        return;
      }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const naturalW = img.naturalWidth || img.width;
          const naturalH = img.naturalHeight || img.height;
          const scale = Math.min(1, maxSide / Math.max(naturalW, naturalH));
          const w = Math.max(1, Math.round(naturalW * scale));
          const h = Math.max(1, Math.round(naturalH * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fffdf8';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          canvas.toBlob((blob) => {
            URL.revokeObjectURL(url);
            if (!blob) {
              reject(new Error('图片编码失败'));
              return;
            }
            let dataUrl = '';
            try { dataUrl = canvas.toDataURL('image/jpeg', quality); } catch (err) { dataUrl = ''; }
            resolve({ dataUrl, blob, w, h });
          }, 'image/jpeg', quality);
        } catch (err) {
          URL.revokeObjectURL(url);
          reject(err);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('图片读取失败'));
      };
      img.src = url;
    });
  }

  function openPhotoUpload() {
    openModal(`
      <button class="modal-close" type="button" data-close aria-label="关闭">×</button>
      <h3 class="modal-title">上传照片</h3>
      <p class="modal-sub">照片会压缩后保存在本机浏览器的照片库里（IndexedDB），不会上传到任何服务器。</p>
      <form class="modal-form" id="photoForm">
        <label class="photo-drop" id="photoDrop">
          <strong>选择照片</strong>
          <span>JPG / PNG / WebP，可一次选择多张，单张自动压缩到 1280px</span>
          <input type="file" id="photoFiles" accept="image/jpeg,image/png,image/webp,image/gif" multiple>
        </label>
        <div class="preview-grid" id="photoPreviews"></div>
        <div class="field-row" style="margin-top:16px">
          <div class="field">
            <label for="pf-tag">分类</label>
            <select id="pf-tag" name="tag">${TAGS.map((tag) => `<option value="${tag}">${tag}</option>`).join('')}</select>
          </div>
          <div class="field">
            <label for="pf-date">日期</label>
            <input id="pf-date" name="date" type="date" value="${todayISO()}">
          </div>
        </div>
        <div class="field-note" id="photoNote">还没有选择照片。</div>
        <div class="form-actions">
          <button class="btn btn--ghost" type="button" data-close>取消</button>
          <button class="btn btn--solid" type="submit">保存照片</button>
        </div>
      </form>`,
      (panel) => {
        const form = panel.querySelector('#photoForm');
        const input = panel.querySelector('#photoFiles');
        const previews = panel.querySelector('#photoPreviews');
        const note = panel.querySelector('#photoNote');
        let pending = [];

        const renderPreviews = () => {
          if (!previews) return;
          previews.innerHTML = pending.map((item, index) => `
            <div class="preview-item" data-index="${index}">
              <img src="${esc(item.dataUrl)}" alt="">
              <div class="preview-meta">
                <input type="text" data-caption="${index}" maxlength="80" value="${esc(item.caption)}" aria-label="照片说明">
                <span>${item.w} × ${item.h}</span>
              </div>
              <button class="preview-del" type="button" data-remove="${index}" aria-label="移除">×</button>
            </div>`).join('');
          if (note) note.textContent = pending.length ? `已选择 ${pending.length} 张，保存后会压缩存储。` : '还没有选择照片。';
        };

        if (input) {
          input.addEventListener('change', async () => {
            const picked = Array.from(input.files || []);
            if (!picked.length) return;
            const files = picked.slice(0, 8);
            if (picked.length > 8) {
              toast(`一次最多选择 8 张，已忽略 ${picked.length - 8} 张。`, 'error');
            }
            if (note) note.textContent = '正在处理照片…';
            for (const file of files) {
              try {
                const result = await compressImage(file);
                pending.push({
                  dataUrl: result.dataUrl,
                  blob: result.blob,
                  w: result.w,
                  h: result.h,
                  caption: String(file.name || '').replace(/\.[^.]+$/, '').slice(0, 60) || '未命名照片'
                });
              } catch (err) {
                console.warn('[小刘吧] 图片处理失败', err);
                toast(`「${file.name}」无法读取，已跳过。`, 'error');
              }
            }
            input.value = '';
            renderPreviews();
          });
        }

        previews.addEventListener('input', (event) => {
          const target = event.target;
          if (target && target.dataset && target.dataset.caption != null) {
            const index = Number(target.dataset.caption);
            if (pending[index]) pending[index].caption = target.value;
          }
        });
        previews.addEventListener('click', (event) => {
          const target = event.target.closest('[data-remove]');
          if (!target) return;
          pending.splice(Number(target.dataset.remove), 1);
          renderPreviews();
        });

        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          if (!pending.length) {
            toast('先选择至少一张照片。', 'error');
            return;
          }
          const tag = panel.querySelector('#pf-tag')?.value || '日常';
          const dateValue = isDateISO(panel.querySelector('#pf-date')?.value) ? panel.querySelector('#pf-date').value : todayISO();
          const added = [];
          let failed = 0;
          for (const item of pending) {
            try {
              const photo = await createPhotoRecord(item, { tag, date: dateValue });
              state.photos.push(photo);
              added.push(photo);
            } catch (err) {
              failed += 1;
              console.warn('[小刘吧] 照片保存失败', err);
            }
          }
          if (!added.length) {
            toast('照片保存失败：本地照片库不可用。', 'error');
            return;
          }
          if (!save({ quiet: true })) {
            added.forEach((photo) => {
              state.photos = state.photos.filter((p) => p.id !== photo.id);
              if (photo.mediaId) idbDelete(photo.mediaId).catch(() => {});
              if (photo._objectUrl) URL.revokeObjectURL(photo._objectUrl);
            });
            renderAll();
            toast('保存失败：浏览器本地空间不足，照片没有加入。', 'error');
            return;
          }
          closeModal();
          renderAll();
          toast(`已添加 ${added.length} 张照片${failed ? `（${failed} 张失败）` : ''}`, 'success');
          refreshStorageQuota();
        });
        panel.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', closeModal));
      }
    );
  }

  function openBatchImport() {
    openModal(`
      <button class="modal-close" type="button" data-close aria-label="关闭">×</button>
      <h3 class="modal-title">批量导入照片</h3>
      <p class="modal-sub">适合一次导入很多照片（例如从微信保存到电脑的照片）。照片会存进浏览器本地照片库（IndexedDB），容量比原来大很多，单张自动压缩到 1600px。</p>
      <form class="modal-form" id="batchForm">
        <label class="photo-drop">
          <strong>选择照片</strong>
          <span>可一次选择多张（最多 80 张），JPG / PNG / WebP / GIF</span>
          <input type="file" id="batchFiles" accept="image/*" multiple>
        </label>
        <div class="preview-grid" id="batchPreview"></div>
        <div class="field-row" style="margin-top:16px">
          <div class="field">
            <label for="bf-since">只导入修改时间晚于（可选）</label>
            <input type="datetime-local" id="bf-since">
          </div>
          <div class="field">
            <label for="bf-date">照片日期</label>
            <input type="date" id="bf-date" value="${todayISO()}">
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="bf-tag">分类</label>
            <select id="bf-tag">${TAGS.map((tag) => `<option value="${tag}">${tag}</option>`).join('')}</select>
          </div>
          <div class="field">
            <label for="bf-caption">说明（可选，作为统一前缀）</label>
            <input id="bf-caption" type="text" maxlength="40" placeholder="留空则用文件名">
          </div>
        </div>
        <p class="field-note" id="batchNote">还没有选择照片。</p>
        <div class="form-actions">
          <button class="btn btn--ghost" type="button" data-close>取消</button>
          <button class="btn btn--solid" type="submit" id="batchSubmit">开始导入</button>
        </div>
      </form>`,
      (panel) => {
        const form = panel.querySelector('#batchForm');
        const input = panel.querySelector('#batchFiles');
        const sinceInput = panel.querySelector('#bf-since');
        const preview = panel.querySelector('#batchPreview');
        const note = panel.querySelector('#batchNote');
        let previewUrls = [];

        const pickedFiles = () => Array.from(input.files || []).filter((file) => /^image\//i.test(file.type));

        const filteredFiles = () => {
          const files = pickedFiles();
          if (!sinceInput.value) return files;
          const since = new Date(sinceInput.value).getTime();
          if (Number.isNaN(since)) return files;
          return files.filter((file) => file.lastModified > since);
        };

        const updateNote = () => {
          const all = pickedFiles();
          const list = filteredFiles();
          previewUrls.forEach((url) => URL.revokeObjectURL(url));
          previewUrls = [];
          if (!all.length) {
            if (note) note.textContent = '还没有选择照片。';
            if (preview) preview.innerHTML = '';
            return;
          }
          if (note) {
            note.textContent = sinceInput.value && list.length !== all.length
              ? `已选择 ${all.length} 张，按时间筛选后 ${list.length} 张将导入。`
              : `已选择 ${all.length} 张，将导入 ${list.length} 张。`;
          }
          if (preview) {
            preview.innerHTML = list.slice(0, 6).map((file) => {
              const url = URL.createObjectURL(file);
              previewUrls.push(url);
              return `
                <div class="preview-item">
                  <img src="${esc(url)}" alt="">
                  <div class="preview-meta">
                    <input type="text" value="${esc(file.name)}" readonly aria-label="文件名">
                    <span>${(file.size / 1024).toFixed(0)} KB</span>
                  </div>
                </div>`;
            }).join('');
          }
        };

        if (input) input.addEventListener('change', () => {
          const all = pickedFiles();
          if (all.length > 80) toast(`一次最多导入 80 张，当前已选 ${all.length} 张，超出部分不会导入。`, 'error');
          updateNote();
        });
        if (sinceInput) sinceInput.addEventListener('change', updateNote);

        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const all = pickedFiles();
          if (!all.length) {
            toast('先选择至少一张照片。', 'error');
            return;
          }
          const files = filteredFiles().slice(0, 80);
          if (!files.length) {
            toast('按这个时间筛选后没有照片，可以清空时间再试。', 'error');
            return;
          }
          const tag = panel.querySelector('#bf-tag')?.value || '日常';
          const dateValue = isDateISO(panel.querySelector('#bf-date')?.value) ? panel.querySelector('#bf-date').value : todayISO();
          const prefix = String(panel.querySelector('#bf-caption')?.value || '').trim();
          const submitBtn = panel.querySelector('#batchSubmit');
          if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = '导入中…';
          }
          const added = [];
          let failed = 0;
          for (let index = 0; index < files.length; index += 1) {
            const file = files[index];
            if (note) note.textContent = `正在导入第 ${index + 1} / ${files.length} 张…`;
            try {
              const result = await compressImage(file, 1600, 0.82);
              const baseName = String(file.name || '').replace(/\.[^.]+$/, '').slice(0, 40);
              const photo = await createPhotoRecord({
                dataUrl: result.dataUrl,
                blob: result.blob,
                w: result.w,
                h: result.h,
                caption: prefix ? `${prefix} ${index + 1}` : (baseName || '未命名照片')
              }, { tag, date: dateValue });
              state.photos.push(photo);
              added.push(photo);
            } catch (err) {
              failed += 1;
              console.warn('[小刘吧] 批量导入失败', file.name, err);
            }
          }
          if (!added.length) {
            if (submitBtn) {
              submitBtn.disabled = false;
              submitBtn.textContent = '开始导入';
            }
            toast('批量导入失败：没有照片成功写入本地照片库。', 'error');
            return;
          }
          if (!save({ quiet: true })) {
            added.forEach((photo) => {
              state.photos = state.photos.filter((p) => p.id !== photo.id);
              if (photo.mediaId) idbDelete(photo.mediaId).catch(() => {});
              if (photo._objectUrl) URL.revokeObjectURL(photo._objectUrl);
            });
            if (submitBtn) {
              submitBtn.disabled = false;
              submitBtn.textContent = '开始导入';
            }
            renderAll();
            toast('保存失败：浏览器本地空间不足，照片没有加入。', 'error');
            return;
          }
          closeModal();
          renderAll();
          refreshStorageQuota();
          toast(`已批量导入 ${added.length} 张照片${failed ? `（${failed} 张失败）` : ''}`, 'success');
        });
        panel.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', closeModal));
      }
    );
  }

  function openPhotoCaption(photo) {
    openModal(`
      <button class="modal-close" type="button" data-close aria-label="关闭">×</button>
      <h3 class="modal-title">照片说明</h3>
      <p class="modal-sub">一句话，给这张照片留个注脚。</p>
      <form class="modal-form" id="captionForm">
        <div class="field">
          <label for="cf-caption">说明</label>
          <input id="cf-caption" name="caption" type="text" maxlength="80" value="${esc(photo.caption || '')}" placeholder="比如：傍晚六点的天空">
        </div>
        <div class="field-row">
          <div class="field">
            <label for="cf-tag">分类</label>
            <select id="cf-tag" name="tag">${TAGS.map((tag) => `<option value="${tag}" ${tag === photo.tag ? 'selected' : ''}>${tag}</option>`).join('')}</select>
          </div>
          <div class="field">
            <label for="cf-date">日期</label>
            <input id="cf-date" name="date" type="date" value="${esc(photo.date || todayISO())}">
          </div>
        </div>
        <div class="form-actions">
          <button class="btn btn--ghost" type="button" data-close>取消</button>
          <button class="btn btn--solid" type="submit">保存</button>
        </div>
      </form>`,
      (panel) => {
        const form = panel.querySelector('#captionForm');
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          const data = new FormData(form);
          const previousFields = { caption: photo.caption, tag: photo.tag, date: photo.date };
          photo.caption = String(data.get('caption') || '').trim().slice(0, 80);
          photo.tag = String(data.get('tag') || '日常');
          const date = String(data.get('date') || '');
          if (isDateISO(date)) photo.date = date;
          if (!save({ quiet: true })) {
            Object.assign(photo, previousFields);
            toast('保存失败：本地存储空间不足，说明未更新。', 'error');
            return;
          }
          closeModal();
          renderAll();
          toast('照片说明已保存', 'success');
        });
        panel.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', closeModal));
      }
    );
  }

  async function deletePhoto(id) {
    const photo = state.photos.find((p) => p.id === id);
    if (!photo) return false;
    const ok = await confirmDialog({
      title: '删除这张照片？',
      html: `确定要删除「<b>${esc(photo.caption || '未命名照片')}</b>」吗？<br>删除后无法恢复，建议先导出备份。`,
      danger: true,
      okText: '删除'
    });
    if (!ok) return false;
    const removed = photo;
    const previousPhotos = state.photos.slice();
    state.photos = state.photos.filter((p) => p.id !== id);
    if (!save({ quiet: true })) {
      state.photos = previousPhotos;
      renderAll();
      toast('删除失败：本地存储异常，照片已保留。', 'error');
      return false;
    }
    if (removed._objectUrl) URL.revokeObjectURL(removed._objectUrl);
    if (removed.mediaId) idbDelete(removed.mediaId).catch(() => {});
    renderAll();
    toast('照片已删除', 'success');
    refreshStorageQuota();
    return true;
  }

  const lightbox = $('#lightbox');
  let lbIds = [];
  let lbIndex = 0;

  function lightboxPhotoList() {
    if (currentView === 'gallery') {
      const list = filteredPhotos();
      if (list.length) return list.map((p) => p.id);
    }
    return sortedPhotos().map((p) => p.id);
  }

  function showLightboxPhoto() {
    const id = lbIds[lbIndex];
    const photo = state.photos.find((p) => p.id === id);
    if (!photo) return;
    const img = $('#lbImg');
    const caption = $('#lbCaption');
    const meta = $('#lbMeta');
    if (img) {
      img.src = photoSrc(photo);
      img.alt = photo.caption || '照片';
    }
    if (caption) caption.textContent = photo.caption || '未命名照片';
    if (meta) meta.textContent = `${fmtDot(photo.date)} · ${photo.tag || '日常'}`;
    const prev = $('#lbPrev');
    const next = $('#lbNext');
    if (prev) prev.disabled = lbIndex <= 0;
    if (next) next.disabled = lbIndex >= lbIds.length - 1;
    const edit = $('#lbEdit');
    const del = $('#lbDelete');
    if (edit) edit.dataset.id = photo.id;
    if (del) del.dataset.id = photo.id;
  }

  function openLightbox(id) {
    if (!lightbox) return;
    const list = lightboxPhotoList();
    lbIds = list.length ? list : sortedPhotos().map((p) => p.id);
    const found = lbIds.indexOf(id);
    lbIndex = found >= 0 ? found : 0;
    showLightboxPhoto();
    if (!lightbox.open) lightbox.showModal();
    document.body.classList.add('modal-open');
  }

  function closeLightbox() {
    if (lightbox && lightbox.open) lightbox.close();
    document.body.classList.remove('modal-open');
  }

  function stepLightbox(delta) {
    if (!lbIds.length) return;
    const next = lbIndex + delta;
    if (next < 0 || next >= lbIds.length) return;
    lbIndex = next;
    showLightboxPhoto();
  }

  if (lightbox) {
    lightbox.addEventListener('close', () => {
      document.body.classList.remove('modal-open');
      flushPendingSync();
    });
    lightbox.addEventListener('click', (event) => {
      if (event.target === lightbox) closeLightbox();
    });
    let touchStartX = null;
    lightbox.addEventListener('touchstart', (event) => {
      if (event.changedTouches && event.changedTouches.length) {
        touchStartX = event.changedTouches[0].clientX;
      }
    }, { passive: true });
    lightbox.addEventListener('touchend', (event) => {
      if (touchStartX === null || !event.changedTouches || !event.changedTouches.length) return;
      const deltaX = event.changedTouches[0].clientX - touchStartX;
      if (Math.abs(deltaX) > 42) stepLightbox(deltaX > 0 ? -1 : 1);
      touchStartX = null;
    }, { passive: true });
    const closeBtn = $('#lbClose');
    const prevBtn = $('#lbPrev');
    const nextBtn = $('#lbNext');
    if (closeBtn) closeBtn.addEventListener('click', closeLightbox);
    if (prevBtn) prevBtn.addEventListener('click', () => stepLightbox(-1));
    if (nextBtn) nextBtn.addEventListener('click', () => stepLightbox(1));
  }

  /* ---------------------------------------------------------------------
     19. 个人资料
     --------------------------------------------------------------------- */
  function openProfileEditor() {
    const p = state.profile;
    let avatar = p.avatar || '';
    openModal(`
      <button class="modal-close" type="button" data-close aria-label="关闭">×</button>
      <h3 class="modal-title">编辑资料</h3>
      <p class="modal-sub">这些信息只保存在本机浏览器里。</p>
      <form class="modal-form" id="profileForm">
        <div class="field">
          <span class="field-label">头像</span>
          <div class="avatar-edit">
            <span class="avatar avatar--lg" id="profileAvatarPreview">${avatar ? `<img src="${esc(avatar)}" alt="">` : esc((p.name || '刘').charAt(0))}</span>
            <div class="avatar-edit-actions">
              <label class="btn btn--ghost btn--sm file-btn">更换头像<input type="file" id="profileAvatarFile" accept="image/*"></label>
              <button class="btn btn--ghost btn--sm" type="button" id="profileAvatarClear">移除</button>
            </div>
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="pf-name">名字</label>
            <input id="pf-name" name="name" type="text" maxlength="20" value="${esc(p.name || '')}">
          </div>
          <div class="field">
            <label for="pf-city">城市</label>
            <input id="pf-city" name="city" type="text" maxlength="30" value="${esc(p.city || '')}">
          </div>
        </div>
        <div class="field">
          <label for="pf-tagline">一句话介绍</label>
          <input id="pf-tagline" name="tagline" type="text" maxlength="60" value="${esc(p.tagline || '')}" placeholder="比如：记录者 / 生活收藏家">
        </div>
        <div class="field-row">
          <div class="field">
            <label for="pf-birthday">生日</label>
            <input id="pf-birthday" name="birthday" type="date" value="${esc(p.birthday || '')}">
          </div>
          <div class="field">
            <label for="pf-since">记录开始于</label>
            <input id="pf-since" name="since" type="date" value="${esc(p.since || '')}">
          </div>
        </div>
        <div class="field">
          <label for="pf-bio">关于我</label>
          <textarea id="pf-bio" name="bio" maxlength="500" style="min-height:110px">${esc(p.bio || '')}</textarea>
        </div>
        <div class="form-actions">
          <button class="btn btn--ghost" type="button" data-close>取消</button>
          <button class="btn btn--solid" type="submit">保存资料</button>
        </div>
      </form>`,
      (panel) => {
        const preview = panel.querySelector('#profileAvatarPreview');
        const fileInput = panel.querySelector('#profileAvatarFile');
        const clearBtn = panel.querySelector('#profileAvatarClear');
        const nameInput = panel.querySelector('#pf-name');
        const refreshPreview = () => {
          if (!preview) return;
          if (avatar) preview.innerHTML = `<img src="${esc(avatar)}" alt="">`;
          else preview.textContent = (nameInput?.value || '刘').trim().charAt(0) || '刘';
        };
        if (fileInput) {
          fileInput.addEventListener('change', async () => {
            const file = fileInput.files && fileInput.files[0];
            if (!file) return;
            try {
              const result = await compressImage(file, 320, 0.82);
              avatar = result.dataUrl;
              refreshPreview();
            } catch (err) {
              toast('头像读取失败，换一张试试。', 'error');
            }
          });
        }
        if (clearBtn) {
          clearBtn.addEventListener('click', () => {
            avatar = '';
            refreshPreview();
          });
        }
        if (nameInput) nameInput.addEventListener('input', refreshPreview);
        const form = panel.querySelector('#profileForm');
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          const data = new FormData(form);
          const previousProfile = { ...state.profile };
          state.profile = {
            ...state.profile,
            name: String(data.get('name') || '').trim().slice(0, 20) || '小刘',
            tagline: String(data.get('tagline') || '').trim().slice(0, 60),
            city: String(data.get('city') || '').trim().slice(0, 30),
            bio: String(data.get('bio') || '').trim().slice(0, 500),
            birthday: isDateISO(data.get('birthday')) ? String(data.get('birthday')).slice(0, 10) : '',
            since: isDateISO(data.get('since')) ? String(data.get('since')).slice(0, 10) : '',
            avatar
          };
          if (!save({ quiet: true })) {
            state.profile = previousProfile;
            toast('保存失败：本地存储空间不足，资料未更新。', 'error');
            return;
          }
          closeModal();
          renderAll();
          toast('资料已保存', 'success');
        });
        panel.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', closeModal));
      }
    );
  }

  /* ---------------------------------------------------------------------
     20. 提醒 / 备份 / 导入 / 重置
     --------------------------------------------------------------------- */
  function buildReminders() {
    const items = [];
    sortedEvents()
      .filter((item) => !item.info.past && item.info.days <= 45)
      .slice(0, 4)
      .forEach(({ ev, info }) => {
        items.push({
          kind: 'event',
          title: `「${ev.title}」${info.isToday ? '就是今天' : `还有 ${info.days} 天`}`,
          meta: info.annual ? `每年 ${fmtCN(info.targetISO)}` : fmtDateFull(ev.date),
          action: '#countdown',
          actionLabel: '查看'
        });
      });
    const undone = state.todos.filter((t) => !t.done).length;
    if (undone) {
      items.push({
        kind: 'todo',
        title: `还有 ${undone} 件小事等你完成`,
        meta: '去清单里挑一件开始',
        action: '#todos',
        actionLabel: '去清单'
      });
    }
    const wroteToday = state.diaries.some((d) => d.date === todayISO());
    items.push({
      kind: 'diary',
      title: wroteToday ? '今天已经写过了，很好。' : '今天还没有写日记',
      meta: wroteToday ? '留住今天的心情' : '花三分钟，记下今天',
      action: '#diary',
      actionLabel: wroteToday ? '去看看' : '去写日记'
    });
    const monthKey = todayISO().slice(0, 7);
    if (!state.photos.some((p) => String(p.date || '').startsWith(monthKey))) {
      items.push({
        kind: 'photo',
        title: '这个月还没有贴新照片',
        meta: '照片墙有点想念你',
        action: '#gallery',
        actionLabel: '去照片墙'
      });
    }
    const last = state.meta.lastExport;
    if (!last || daysSince(last) > 30) {
      items.push({
        kind: 'backup',
        title: '该导出一次备份了',
        meta: last ? `上次导出：${fmtDot(last)}` : '还没有导出过备份',
        action: 'export',
        actionLabel: '导出'
      });
    }
    return items;
  }

  function openNotifications() {
    const items = buildReminders();
    const notifyBtn = $('#notifyBtn');
    if (notifyBtn) notifyBtn.setAttribute('aria-expanded', 'true');
    openModal(`
      <button class="modal-close" type="button" data-close aria-label="关闭">×</button>
      <h3 class="modal-title">提醒</h3>
      <p class="modal-sub">${items.length ? '这些小事，替你先记着。' : '暂时没有需要提醒的事。'}</p>
      <div class="notify-list">
        ${items.map((item) => `
          <div class="notify-item">
            <div>
              <p class="notify-title">${esc(item.title)}</p>
              <p class="notify-meta">${esc(item.meta)}</p>
            </div>
            <button class="text-btn notify-act" type="button" data-action="reminder-action" data-target="${esc(item.action)}" ${item.action === 'export' ? 'data-export="1"' : ''}>${esc(item.actionLabel)}</button>
          </div>`).join('')}
      </div>`,
      (panel) => {
        panel.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', closeModal));
      }
    );
  }

  async function exportData() {
    toast('正在打包备份…');
    const exportedPhotos = [];
    let skipped = 0;
    for (const photo of state.photos) {
      const copy = { ...photo };
      delete copy._objectUrl;
      if (photo.mediaId) {
        try {
          const blob = await idbGet(photo.mediaId);
          if (!blob) { skipped += 1; continue; }
          copy.src = await blobToDataUrl(blob);
          copy.bytes = blob.size;
        } catch (err) {
          console.warn('[小刘吧] 导出照片失败', err);
          skipped += 1;
          continue;
        }
      }
      exportedPhotos.push(copy);
    }
    state.meta.lastExport = todayISO();
    save();
    const payload = JSON.stringify({ ...state, photos: exportedPhotos }, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `xiaoliuba-backup-${todayISO()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    renderChrome();
    if (currentView === 'profile') renderProfile();
    toast(skipped ? `备份已导出（${skipped} 张照片读取失败）` : '备份已导出', 'success');
  }

  async function exportSharedSnapshot() {
    toast('正在生成共享快照…');
    const exportedPhotos = [];
    let skipped = 0;
    for (const photo of state.photos) {
      const copy = { ...photo };
      delete copy._objectUrl;
      delete copy.bytes;
      if (photo.mediaId) {
        try {
          const blob = await idbGet(photo.mediaId);
          if (!blob) { skipped += 1; continue; }
          copy.src = await blobToDataUrl(blob);
        } catch (err) {
          console.warn('[小刘吧] 共享快照读取照片失败', err);
          skipped += 1;
          continue;
        }
      }
      if (!copy.src && !copy.mediaId) { skipped += 1; continue; }
      delete copy.mediaId;
      exportedPhotos.push(copy);
    }
    const now = new Date();
    const timeStamp = `${todayISO()}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    const snapshot = {
      ...state,
      photos: exportedPhotos,
      meta: {
        ...state.meta,
        sharedExport: true,
        sharedExportedAt: new Date().toISOString(),
        lastExport: todayISO()
      }
    };
    state.meta.lastExport = todayISO();
    save();
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `xiaoliuba-shared-${timeStamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast(
      skipped
        ? `共享快照已导出（${skipped} 张照片读取失败），双击「发布共享数据.bat」发布`
        : '共享快照已导出，双击「发布共享数据.bat」发布到 GitHub Pages',
      'success'
    );
  }

  async function importData(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data || typeof data !== 'object' ||
        !Array.isArray(data.photos) || !Array.isArray(data.diaries) ||
        !Array.isArray(data.events) || !Array.isArray(data.todos)) {
        throw new Error('备份格式不正确');
      }
      const ok = await confirmDialog({
        title: '导入这份备份？',
        html: `导入会覆盖当前所有内容，建议先导出现有数据。<br>备份包含 <b>${data.photos.length}</b> 张照片、<b>${data.diaries.length}</b> 篇日记。`,
        okText: '导入并覆盖'
      });
      if (!ok) return;
      const previousState = state;
      const nextState = normalizeState(data);
      state = nextState;
      await hydrateMediaStore({ cleanup: false });
      if (!save({ quiet: true })) {
        state = previousState;
        renderAll();
        toast('导入失败：本地存储空间不足，原数据未受影响。', 'error');
        return;
      }
      await cleanupOrphanMedia();
      activeTag = '全部';
      diaryQuery = '';
      expandedDiaryId = null;
      applyTheme();
      renderAll();
      refreshStorageQuota();
      toast('备份已导入', 'success');
    } catch (err) {
      console.error('[小刘吧] 导入失败', err);
      toast('备份文件读取失败，请确认文件格式。', 'error');
    }
  }

  async function resetData() {
    const ok = await confirmDialog({
      title: '恢复示例数据？',
      message: '当前的照片、日记、待办和倒数日都会被清空，替换为示例内容。此操作无法撤销，建议先导出备份。',
      danger: true,
      okText: '恢复示例'
    });
    if (!ok) return;
    const previousState = state;
    state = seedState();
    if (!save({ quiet: true })) {
      state = previousState;
      renderAll();
      toast('恢复失败：本地存储空间不足，原数据未受影响。', 'error');
      return;
    }
    await cleanupOrphanMedia();
    activeTag = '全部';
    diaryQuery = '';
    expandedDiaryId = null;
    applyTheme();
    renderAll();
    refreshStorageQuota();
    toast('已恢复示例数据', 'success');
  }

  /* ---------------------------------------------------------------------
     21. 删除操作
     --------------------------------------------------------------------- */
  async function deleteEvent(id) {
    const ev = state.events.find((e) => e.id === id);
    if (!ev) return;
    const ok = await confirmDialog({
      title: '删除这个倒数日？',
      html: `确定要删除「<b>${esc(ev.title)}</b>」吗？`,
      danger: true,
      okText: '删除'
    });
    if (!ok) return;
    const previousEvents = state.events.slice();
    state.events = state.events.filter((e) => e.id !== id);
    if (!save({ quiet: true })) {
      state.events = previousEvents;
      renderAll();
      toast('删除失败：本地存储空间不足。', 'error');
      return;
    }
    renderAll();
    toast('倒数日已删除', 'success');
  }

  async function deleteDiary(id) {
    const diary = state.diaries.find((d) => d.id === id);
    if (!diary) return;
    const ok = await confirmDialog({
      title: '删除这篇日记？',
      html: `「<b>${esc(diary.title || '未命名的一天')}</b>」将会被删除，且无法恢复。`,
      danger: true,
      okText: '删除'
    });
    if (!ok) return;
    const previousDiaries = state.diaries.slice();
    state.diaries = state.diaries.filter((d) => d.id !== id);
    if (!save({ quiet: true })) {
      state.diaries = previousDiaries;
      renderAll();
      toast('删除失败：本地存储空间不足。', 'error');
      return;
    }
    if (expandedDiaryId === id) expandedDiaryId = null;
    closeModal();
    renderAll();
    toast('日记已删除', 'success');
  }

  /* ---------------------------------------------------------------------
     22. 全局交互
     --------------------------------------------------------------------- */
  function findPhoto(id) { return state.photos.find((p) => p.id === id); }
  function findDiary(id) { return state.diaries.find((d) => d.id === id); }
  function findEvent(id) { return state.events.find((e) => e.id === id); }

  document.addEventListener('click', async (event) => {
    const closeTrigger = event.target.closest('[data-close]');
    if (closeTrigger) {
      closeModal();
      return;
    }
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    const id = actionEl.dataset.id;
    if (action === 'open-photo' || action === 'toggle-diary' || action === 'filter-gallery') event.preventDefault();

    switch (action) {
      case 'new-diary': openDiaryEditor(); break;
      case 'new-event': openEventEditor(); break;
      case 'edit-profile': openProfileEditor(); break;
      case 'upload-photo': openPhotoUpload(); break;
      case 'batch-import': openBatchImport(); break;
      case 'filter-gallery':
        activeTag = actionEl.dataset.tag || '全部';
        renderGallery();
        break;
      case 'open-photo': {
        const photo = findPhoto(id);
        closeModal();
        if (photo) openLightbox(photo.id);
        break;
      }
      case 'edit-photo': {
        const photo = findPhoto(id);
        if (!photo) break;
        closeLightbox();
        openPhotoCaption(photo);
        break;
      }
      case 'delete-photo': {
        closeLightbox();
        deletePhoto(id);
        break;
      }
      case 'lb-edit': {
        const photo = findPhoto(id);
        if (!photo) break;
        closeLightbox();
        openPhotoCaption(photo);
        break;
      }
      case 'lb-delete': {
        const photoId = id;
        closeLightbox();
        const deleted = await deletePhoto(photoId);
        if (!deleted) openLightbox(photoId);
        break;
      }
      case 'edit-event': {
        const ev = findEvent(id);
        if (ev) { closeModal(); openEventEditor(ev); }
        break;
      }
      case 'delete-event': deleteEvent(id); break;
      case 'filter-todos':
        todoFilter = actionEl.dataset.filter || 'all';
        renderTodos();
        break;
      case 'toggle-todo': {
        const todo = state.todos.find((t) => t.id === id);
        if (!todo) break;
        const previousDone = todo.done;
        todo.done = !todo.done;
        if (!save({ quiet: true })) {
          todo.done = previousDone;
          renderAll();
          toast('保存失败：本地存储空间不足。', 'error');
          break;
        }
        renderChrome();
        renderView(currentView);
        toast(todo.done ? '完成一件，辛苦啦。' : '已放回待完成', todo.done ? 'success' : '');
        break;
      }
      case 'delete-todo': {
        const previousTodos = state.todos.slice();
        state.todos = state.todos.filter((t) => t.id !== id);
        if (!save({ quiet: true })) {
          state.todos = previousTodos;
          renderAll();
          toast('删除失败：本地存储空间不足。', 'error');
          break;
        }
        renderChrome();
        renderView(currentView);
        toast('已删除', 'success');
        break;
      }
      case 'toggle-diary':
        expandedDiaryId = expandedDiaryId === id ? null : id;
        renderDiaryList();
        break;
      case 'read-diary': {
        const diary = findDiary(id);
        closeModal();
        if (diary) openDiaryReader(diary);
        break;
      }
      case 'edit-diary': {
        const diary = findDiary(id);
        if (diary) { closeModal(); openDiaryEditor(diary); }
        break;
      }
      case 'delete-diary': deleteDiary(id); break;
      case 'clear-diary-search':
        diaryQuery = '';
        renderDiaryList();
        break;
      case 'set-theme': setTheme(actionEl.dataset.theme || 'light'); break;
      case 'set-accent': setAccent(actionEl.dataset.accent || 'vermilion'); break;
      case 'export-data': exportData(); break;
      case 'export-shared': exportSharedSnapshot(); break;
      case 'import-data': {
        const fileInput = $('#importFile');
        if (fileInput) fileInput.click();
        break;
      }
      case 'reset-data': resetData(); break;
      case 'reminder-action': {
        if (actionEl.dataset.export) { closeModal(); exportData(); break; }
        const target = String(actionEl.dataset.target || '');
        closeModal();
        if (target) {
          const clean = target.replace(/^#/, '');
          if (VIEW_META[clean]) {
            if (location.hash === `#${clean}`) route();
            else location.hash = clean;
          }
        }
        break;
      }
      default: break;
    }
  });

  document.addEventListener('keydown', (event) => {
    if (!lightbox || !lightbox.open) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); stepLightbox(-1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); stepLightbox(1); }
  });

  /* ---------------------------------------------------------------------
     23. 静态事件绑定
     --------------------------------------------------------------------- */
  function bindStaticEvents() {
    const diarySearch = $('#diarySearch');
    if (diarySearch) {
      diarySearch.addEventListener('input', () => {
        diaryQuery = diarySearch.value || '';
        renderDiaryList();
      });
    }
    const todoForm = $('#todoForm');
    if (todoForm) {
      todoForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const input = $('#todoInput');
        const text = String(input?.value || '').trim();
        if (!text) return;
        const task = { id: uid(), text: text.slice(0, 160), done: false, createdAt: new Date().toISOString() };
        state.todos.unshift(task);
        if (!save({ quiet: true })) {
          state.todos = state.todos.filter((t) => t.id !== task.id);
          renderAll();
          toast('保存失败：本地存储空间不足，待办没有加入。', 'error');
          if (input) { input.value = text; input.focus(); }
          return;
        }
        if (input) input.value = '';
        renderChrome();
        renderView(currentView);
        toast('已加入清单', 'success');
        if (input) input.focus();
      });
    }
    const clearDone = $('#clearDone');
    if (clearDone) {
      clearDone.addEventListener('click', async () => {
        const done = state.todos.filter((t) => t.done).length;
        if (!done) { toast('还没有已完成的事项'); return; }
        const ok = await confirmDialog({
          title: '清理已完成？',
          message: `将删除 ${done} 件已完成的小事，未完成的不受影响。`,
          danger: true,
          okText: '清理'
        });
        if (!ok) return;
        const previousTodos = state.todos.slice();
        state.todos = state.todos.filter((t) => !t.done);
        if (!save({ quiet: true })) {
          state.todos = previousTodos;
          renderAll();
          toast('清理失败：本地存储空间不足，未删除任何事项。', 'error');
          return;
        }
        renderChrome();
        renderView(currentView);
        toast(`已清理 ${done} 件`, 'success');
      });
    }
    const notifyBtn = $('#notifyBtn');
    if (notifyBtn) notifyBtn.addEventListener('click', openNotifications);
    const sideThemeBtn = $('#sideThemeBtn');
    if (sideThemeBtn) {
      sideThemeBtn.addEventListener('click', () => {
        const order = ['light', 'dark', 'auto'];
        const current = state.settings.theme;
        const index = order.indexOf(current);
        setTheme(order[(index + 1) % order.length]);
      });
    }
    const importFile = $('#importFile');
    if (importFile) {
      importFile.addEventListener('change', () => {
        const file = importFile.files && importFile.files[0];
        importFile.value = '';
        importData(file);
      });
    }
    document.addEventListener('focusin', (event) => {
      const shot = event.target.closest('.shot');
      if (shot) shot.classList.add('is-focus');
      const todoItem = event.target.closest('.todo-item');
      if (todoItem) todoItem.classList.add('is-focus');
    });
    document.addEventListener('focusout', (event) => {
      const shot = event.target.closest('.shot');
      if (shot && !shot.contains(event.relatedTarget)) shot.classList.remove('is-focus');
      const todoItem = event.target.closest('.todo-item');
      if (todoItem && !todoItem.contains(event.relatedTarget)) todoItem.classList.remove('is-focus');
    });
    window.addEventListener('hashchange', route);
    let syncTimer = null;
    window.addEventListener('storage', (event) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => {
        if ((modal && modal.open) || (lightbox && lightbox.open)) {
          pendingSync = event.newValue;
          toast('另一个标签页有更新，关闭当前弹窗后会同步。', 'error');
          return;
        }
        applyIncomingState(event.newValue);
      }, 150);
    });
    [['#themeOptions'], ['#accentOptions']].forEach(([selector]) => {
      const group = $(selector);
      if (!group) return;
      group.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        const buttons = Array.from(group.querySelectorAll('button'));
        const index = buttons.indexOf(document.activeElement);
        if (!buttons.length || index < 0) return;
        event.preventDefault();
        const nextIndex = (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[nextIndex].focus();
        buttons[nextIndex].click();
        setTimeout(() => {
          const refreshed = group.querySelectorAll('button');
          if (refreshed[nextIndex]) refreshed[nextIndex].focus();
        }, 0);
      });
    });
    prefersDark.addEventListener('change', () => {
      if (state.settings.theme === 'auto') applyTheme();
    });
  }

  /* ---------------------------------------------------------------------
     24. 启动
     --------------------------------------------------------------------- */
  function downloadTextFile(filename, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function downloadBrokenData() {
    if (!recovery || !recovery.raw) {
      toast('没有可下载的原始数据。', 'error');
      return;
    }
    downloadTextFile(`xiaoliuba-broken-${todayISO()}.txt`, recovery.raw);
    toast('原始数据已下载', 'success');
  }

  function showRecoveryBanner() {
    if (!recovery) return;
    const content = $('.content');
    if (!content) return;
    const banner = document.createElement('div');
    banner.className = 'recovery-banner';
    const message = recovery.inaccessible
      ? '浏览器不允许访问本地存储（可能处于隐私模式）。当前以示例数据运行，修改可能无法保存。'
      : recovery.backedUp
        ? '原始内容已另存为浏览器本地备份（xiaoliuba.v1.broken），当前以示例数据运行。建议先下载原始数据留底。'
        : '读取本地数据失败，且浏览器空间不足，未能另存原始内容。当前以示例数据运行。';
    banner.innerHTML = `
      <div>
        <strong>本地数据没有读出来</strong>
        <p>${esc(message)}</p>
      </div>
      <div class="recovery-actions">
        <button class="btn btn--ghost btn--sm" type="button" data-recovery-download ${recovery.raw ? '' : 'disabled'}>下载原始数据</button>
        <button class="btn btn--solid btn--sm" type="button" data-recovery-dismiss>使用示例数据继续</button>
      </div>`;
    content.insertBefore(banner, content.firstChild);
    const downloadBtn = banner.querySelector('[data-recovery-download]');
    const dismissBtn = banner.querySelector('[data-recovery-dismiss]');
    if (downloadBtn) downloadBtn.addEventListener('click', downloadBrokenData);
    if (dismissBtn) {
      dismissBtn.addEventListener('click', () => {
        if (!save({ quiet: true })) {
          toast('保存示例数据失败：本地存储空间不足。', 'error');
          return;
        }
        recovery = null;
        banner.remove();
        renderChrome();
        toast('已使用示例数据继续', 'success');
      });
    }
  }

  function showSharedChrome() {
    document.body.classList.add('is-shared');
    const tools = $('.topbar-tools');
    if (tools && !$('.shared-badge')) {
      tools.insertAdjacentHTML('afterbegin', '<span class="shared-badge">只读共享</span>');
    }
    const foot = $('.site-foot p');
    if (foot) foot.textContent = '小刘吧 · 共享只读页 · 内容由小刘发布';
    if (state.meta.sharedLoaded) return;
    const content = $('.content');
    if (!content) return;
    const banner = document.createElement('div');
    banner.className = 'recovery-banner shared-empty-banner';
    banner.innerHTML = `
      <div>
        <strong>共享数据还没有发布</strong>
        <p>这个页面是只读共享模式，但仓库里还没有 <code>shared/state.json</code>。请从本地小刘吧导出一份共享快照，再运行“发布共享数据.bat”。</p>
      </div>`;
    content.insertBefore(banner, content.firstChild);
  }

  async function init() {
    applyTheme();
    bindStaticEvents();
    if (IS_SHARED) {
      await loadSharedState();
      applyTheme();
      showSharedChrome();
    } else {
      try {
        if (!recovery) {
          await hydrateMediaStore();
          if (!save({ quiet: true })) toast('本地数据保存失败，请检查浏览器存储空间。', 'error');
        } else {
          await hydrateMediaStore({ cleanup: false });
        }
      } catch (err) {
        console.warn('[小刘吧] 初始化照片库失败', err);
      }
    }
    if (!location.hash) {
      try { history.replaceState(null, '', '#dashboard'); } catch (err) { /* ignore */ }
    }
    route();
    tick();
    setInterval(tick, 1000);
    if (!IS_SHARED) refreshStorageQuota();
    showRecoveryBanner();
    if (recovery && !IS_SHARED) toast('本地数据读取失败，已保留原始内容（如有可能）。', 'error');
    if (IS_SHARED && state.meta.sharedLoaded) toast('共享只读模式：内容由小刘发布。', '');
    if (!IS_SHARED && PAGE_PARAMS.get('export') === 'shared') {
      setTimeout(() => {
        exportSharedSnapshot();
        try {
          const clean = new URL(location.href);
          clean.searchParams.delete('export');
          history.replaceState(null, '', clean.pathname + (clean.search || '') + (clean.hash || ''));
        } catch (err) { /* ignore */ }
      }, 900);
    }
  }

  init();
})();
