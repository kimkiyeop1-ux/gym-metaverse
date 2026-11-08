// localStorage 도우미.
// 규칙: 이 앱의 키는 모두 "gym_"으로 시작한다.
//       다른 키는 절대 읽거나 지우지 않는다 (localStorage.clear() 사용 금지).
const PREFIX = 'gym_';

const fullKey = (key) => PREFIX + key;

export const storage = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(fullKey(key));
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(fullKey(key), JSON.stringify(value));
    } catch {
      /* 저장 불가(사생활 보호 모드 등) — 무시 */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(fullKey(key));
    } catch {
      /* 무시 */
    }
  },
};
