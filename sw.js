// 서비스 워커: 홈 화면 앱을 빠르게 열고, 인터넷이 약해도 열리게 한다.
// - 화면(HTML)은 항상 인터넷에서 먼저 받아 최신 버전을 확인 (안 되면 저장본)
// - js/css 는 주소에 ?v=버전 이 붙어 있어 저장본을 그대로 씀 → 새 버전이면 주소가 바뀌어 새로 받음
// - 캐시 이름은 모두 'gym-metaverse-' 로 시작하고, 다른 이름의 캐시는 절대 지우지 않음
//   (같은 주소(github.io)의 다른 앱 저장본 보호)
const PREFIX = 'gym-metaverse-';
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = PREFIX + VERSION;
const CORE = [
  './',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/favicon-32.png',
  './js/vendor/three.module.min.js',
  './js/vendor/cannon-es.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(CORE.map((u) => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;

  const isPage = req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('.html');
  if (isPage || url.pathname.endsWith('.webmanifest')) {
    // 인터넷 먼저 → 실패하면 저장본
    // cache:'no-cache' = 브라우저 임시 저장본(최대 10분)도 건너뛰고 서버에 새 버전이 있는지 꼭 확인
    event.respondWith(
      fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./')))
    );
    return;
  }

  // 저장본 먼저 → 없으면 인터넷에서 받아 저장
  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }))
  );
});
