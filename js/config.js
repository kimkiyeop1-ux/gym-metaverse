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

  // 여러 명 접속 (Firebase 실시간 데이터베이스). null 이면 혼자 하기만 가능.
  // Firebase 콘솔 → 프로젝트 설정 → 내 앱(웹)의 firebaseConfig 값을 그대로 붙여 넣기
  // ★ 사본(Fork)을 만들었다면: 아래 firebase 값을 '내 Firebase' 값으로 바꾸고,
  //   firebaseSite 를 '내 사이트 주소'(예: 'myid.github.io')로 바꾸세요. (README '내 학교용으로 만들기')
  //   firebaseSite 와 다른 주소에서 열리면 여러 명 접속은 꺼지고 혼자 하기만 됩니다.
  firebaseSite: 'kimkiyeop1-ux.github.io',
  firebase: {
    apiKey: 'AIzaSyCuLf8rMtfLNR8rjgRMTO6_o9dAsbO8_GE',
    authDomain: 'gym-metaverse.firebaseapp.com',
    databaseURL: 'https://gym-metaverse-default-rtdb.asia-southeast1.firebasedatabase.app',
    projectId: 'gym-metaverse',
    storageBucket: 'gym-metaverse.firebasestorage.app',
    messagingSenderId: '96668790958',
    appId: '1:96668790958:web:56f4aff5109b93b3777d3f',
  },

  // 그래픽 (모바일 성능 우선)
  graphics: {
    maxPixelRatio: 1.5,
  },
};
