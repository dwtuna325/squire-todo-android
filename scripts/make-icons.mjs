/* make-icons.mjs — Squire 앱 아이콘 원본(PNG) 생성.
 *
 * 방패(Squire 🛡️) + 체크마크(할 일) 엠블럼을 벡터로 그려 1024×1024 PNG 3종을 만든다.
 * 이 PNG들을 `@capacitor/assets` 가 안드로이드 밀도별 아이콘·어댑티브 아이콘으로 확장한다.
 *   - assets/icon-background.png : 어댑티브 배경(다크)
 *   - assets/icon-foreground.png : 어댑티브 전경(방패, 원형 마스크 안전영역 안)
 *   - assets/icon.png           : 레거시 정사각 아이콘(다크배경+방패)
 *
 * 브랜드색: accent #4f8cff, dark #0f1115. 로컬 1회 실행(`node scripts/make-icons.mjs`) 후 PNG는 커밋.
 */
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const SIZE = 1024;
const C = 512; // 중심

// 방패 경로(윗변 살짝 볼록 → 곧은 옆면 → 아래 뾰족). 베이스는 캔버스를 크게 채움.
const SHIELD =
  'M512 152 C640 152 760 176 840 208 C852 213 858 224 858 238 L858 496 ' +
  'C858 690 720 820 512 876 C304 820 166 690 166 496 L166 238 ' +
  'C166 224 172 213 184 208 C264 176 384 152 512 152 Z';
// 체크마크(방패 중앙 상단). 흰색 스트로크.
const CHECK = 'M372 486 L470 588 L676 372';

// 엠블럼(방패+체크)을 중심 기준 scale 배율로 축소해 그린다.
function emblem(scale) {
  return (
    '<g transform="translate(' + C + ' ' + C + ') scale(' + scale + ') translate(-' + C + ' -' + C + ')">' +
      '<path d="' + SHIELD + '" fill="url(#g)" stroke="#2f62d0" stroke-width="6"/>' +
      // 윗부분 은은한 하이라이트
      '<path d="' + SHIELD + '" fill="url(#hl)"/>' +
      '<path d="' + CHECK + '" fill="none" stroke="#ffffff" stroke-width="66" ' +
        'stroke-linecap="round" stroke-linejoin="round"/>' +
    '</g>'
  );
}

const DEFS =
  '<defs>' +
    '<linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#5c97ff"/>' +
      '<stop offset="1" stop-color="#3f79ef"/>' +
    '</linearGradient>' +
    '<linearGradient id="hl" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#ffffff" stop-opacity="0.18"/>' +
      '<stop offset="0.5" stop-color="#ffffff" stop-opacity="0"/>' +
    '</linearGradient>' +
    '<radialGradient id="bg" cx="0.5" cy="0.42" r="0.75">' +
      '<stop offset="0" stop-color="#1a2233"/>' +
      '<stop offset="1" stop-color="#0f1115"/>' +
    '</radialGradient>' +
  '</defs>';

function svg(inner) {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + SIZE + '" height="' + SIZE + '" ' +
    'viewBox="0 0 ' + SIZE + ' ' + SIZE + '">' + DEFS + inner + '</svg>';
}

// 1) 어댑티브 배경(다크 방사형)
const bgSvg = svg('<rect width="' + SIZE + '" height="' + SIZE + '" fill="url(#bg)"/>');
// 2) 어댑티브 전경(투명 + 방패, 원형 안전영역 안이 되도록 0.66 축소)
const fgSvg = svg(emblem(0.66));
// 3) 레거시 정사각(다크배경 + 방패 0.74)
const iconSvg = svg('<rect width="' + SIZE + '" height="' + SIZE + '" fill="url(#bg)"/>' + emblem(0.74));

mkdirSync('assets', { recursive: true });
await sharp(Buffer.from(bgSvg)).png().toFile('assets/icon-background.png');
await sharp(Buffer.from(fgSvg)).png().toFile('assets/icon-foreground.png');
await sharp(Buffer.from(iconSvg)).png().toFile('assets/icon.png');
console.log('✓ assets/icon.png · icon-foreground.png · icon-background.png (1024²) 생성 완료');
