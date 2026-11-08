// ============================================================
//  설정 파일 — 학교명 등은 여기 한 곳에서만 바꾸면 됩니다.
// ============================================================
export const CONFIG = {
  // 학교 이름 (화면 제목, 무대 현수막 등에 표시)
  schoolName: '갱갱중학교',
  appName: '가상 체육관',
  // 화면에 표시되는 버전 (index.html 의 VERSION 값)
  version: window.GYM_VERSION || 'dev',

  // 체육관 크기 (미터). x = 길이 방향, z = 폭 방향
  gym: {
    length: 34,       // 본 바닥 길이
    width: 22,        // 본 바닥 폭
    height: 8,        // 천장 높이
    stageDepth: 5,    // 무대 깊이 (본 바닥 바깥, -x 쪽)
    stageHeight: 1.0, // 무대 높이
  },

  // 아바타
  player: {
    walkSpeed: 5.0,   // m/s
    jumpSpeed: 6.5,   // m/s
    extraGravity: 10, // 점프가 둥둥 뜨지 않도록 추가 중력
    spawn: { x: 3, y: 0.1, z: 7 },
  },

  // 카메라
  camera: {
    distance: 5.5,
    minDistance: 2.0,
    maxDistance: 12,
    pitch: 0.35,      // 라디안 (위에서 내려다보는 각도)
    minPitch: -0.2,
    maxPitch: 1.2,
  },

  // 용기구 크기: 블록 아바타는 머리가 커서 실제 크기 공이 작아 보이므로 키움.
  // 농구 림도 같은 비율로 키워 슛 감각을 유지한다. (1 = 실제 규격)
  equipment: {
    ballScale: 1.5,
    volleyNetHeight: 2.3, // 배구 네트 높이 (중학교 남자 2.30m, 여자 2.15m)
  },

  // 그래픽 (모바일 성능 우선)
  graphics: {
    maxPixelRatio: 1.5,
  },
};
