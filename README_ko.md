<h1 align="center">Rasen — loops that ascend</h1>

<p align="center"><strong>「순환이 아니라, 나선」</strong></p>

<p align="center">
  <a href="https://github.com/DumoeDss/rasen/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/DumoeDss/rasen/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="./LICENSE"><img alt="라이선스: MIT" src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square" /></a>
  <a href="https://rasen.io/ko/docs/"><img alt="문서" src="https://img.shields.io/badge/docs-rasen.io-4AF626?style=flat-square&labelColor=050505" /></a>
</p>

<p align="center">
  <a href="./README.md"><img alt="English" src="https://img.shields.io/badge/English-9A9A98?style=flat-square" /></a>
  <a href="./README_zh.md"><img alt="简体中文" src="https://img.shields.io/badge/%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-9A9A98?style=flat-square" /></a>
  <a href="./README_ja.md"><img alt="日本語" src="https://img.shields.io/badge/%E6%97%A5%E6%9C%AC%E8%AA%9E-9A9A98?style=flat-square" /></a>
  <a href="./README_ko.md"><img alt="한국어" src="https://img.shields.io/badge/%ED%95%9C%EA%B5%AD%EC%96%B4-4AF626?style=flat-square&labelColor=050505" /></a>
</p>

**Rasen**은 스펙 주도(spec-driven) 개발 워크플로 위에 자율 오케스트레이션 하니스를 얹은 도구입니다 — 당신이 스펙을 쓰면, 하니스가 change를 propose → apply → archive로 이끌며 작업이 끝날 때까지 스스로 반복합니다.

## 원이 아니라, 나선

출발점으로 되돌아오는 루프는 그저 원일 뿐입니다. Rasen(螺旋, "나선")은 위로 올라가는 루프의 형태입니다. 그것이 이 도구의 전부이며, 실제 동작 방식과 그대로 맞물립니다:

- **스펙이 원점입니다.** 모든 change는 코드를 쓰기 전에 `rasen/` 워크스페이스에 기록된 의도 — 제안, 요구사항, 설계, 작업 목록 — 에서 시작합니다. `/rasen-propose → apply → archive`.
- **루프가 형태입니다.** 작업은 한 번의 워터폴 통과가 아니라 주기로 진행됩니다. `rasen` 파이프라인 패밀리 — `small-feature`, `bug-fix`, `full-feature`, `auto-decompose` — 가 작업을 propose, implement, review, ship의 루프로 빚어냅니다.
- **한 바퀴마다 상승합니다.** 하니스는 단순 반복이 아니라 전진합니다. `/rasen-auto`는 LEAD를 세워 역할이 분리된 서브에이전트, 스스로의 실수를 잡아내는 리뷰 사이클, 세션을 넘어 컨텍스트를 이어주는 handoff/릴레이를 오케스트레이션합니다 — 매 바퀴가 시작보다 높은 곳에서 끝나도록.
- **돌파할 때까지.** `/rasen-goal`은 문서가 아니라 조건으로 나선을 닫습니다: 지표를 목표치까지 끌어올리고, 모듈을 루브릭 통과 수준으로 다듬고, 브리프에 답이 나올 때까지 리서치합니다 — gate가 충족될 때까지 modify → judge를 반복합니다.

스펙은 출발점이고, 나선은 도달하는 방식입니다.

## 계보(Lineage)

Rasen은 Fission-AI의 [OpenSpec](https://github.com/Fission-AI/OpenSpec)(MIT)에서 포크되었으며, [Sayo](https://github.com/DumoeDss)가 독립적으로 유지보수합니다. **Fission-AI와는 무관합니다**. 워크플로 시맨틱은 업스트림 **OpenSpec v1.5.0**과 정렬되어 있고 — `propose → apply → archive`의 spec/change 모델은 동일합니다 — 다만 rasen은 **독립된 네임스페이스**에서 동작합니다: `rasen` 바이너리, `/rasen-*` 슬래시 명령, `rasen-*` 스킬, 그리고 `rasen/` 워크스페이스. rasen은 그 위에 자율 오케스트레이션을 얹으며, 업스트림 `openspec/` 설치는 절대 건드리지 않습니다.

## 설치

**Node.js `>=20.19.0`**이 필요합니다.

```bash
npm i -g @atelierai/rasen
```

그다음 프로젝트에서 초기화합니다:

```bash
cd your-project
rasen init
```

`rasen init`은 `rasen/` 워크스페이스(specs와 changes)를 만들고, 당신의 AI 코딩 도구에 `/rasen-*` 슬래시 명령을 설치합니다.

업그레이드 후 AI 가이드를 갱신하고 최신 슬래시 명령을 받으려면:

```bash
rasen update
```

## OpenSpec과의 공존

Rasen은 업스트림 OpenSpec과 충돌 없이 **나란히** 살도록 설계되었습니다. 모든 인터페이스가 별도의 네임스페이스이므로, 같은 프로젝트에 둘을 동시에 설치할 수 있습니다:

| 인터페이스 | OpenSpec | Rasen |
| --- | --- | --- |
| 바이너리 | `openspec` | `rasen` |
| 슬래시 명령 | `/opsx:*` | `/rasen-*` |
| 스킬 | `openspec-*` | `rasen-*` |
| 워크스페이스 | `openspec/` | `rasen/` |

네임스페이스가 겹치지 않기 때문에, rasen 설치가 기존 OpenSpec 구성을 방해하는 일은 없습니다 — 먼저 제거해야 할 것도 없습니다.

기존 `openspec/` 워크스페이스를 rasen으로 가져오고 싶다면:

```bash
rasen migrate
```

`rasen migrate`는 **복사 전용(copy-only)**입니다: `openspec/{specs,changes,config.yaml}`을 `rasen/`으로 복사하고, 이미 존재하는 대상은 건너뜁니다. 원래의 `openspec/` 디렉터리는 **절대 수정되거나 삭제되지 않습니다** — OpenSpec으로 계속 그대로 사용할 수 있습니다.

### chrome-use 사전 요구사항

`chrome-use` 전문가는 Chrome DevTools Protocol을 통해 당신이 평소 쓰는 Chrome을 조작합니다. 사용하려면 다음이 필요합니다:

- **Google Chrome** 설치.
- **Node.js 22 이상**(CDP 프록시 툴체인 요구사항).
- 원격 디버깅을 켠 채 Chrome 실행 — `chrome://inspect/#remote-debugging`을 열거나 `--remote-debugging-port`로 Chrome을 시작.
- **첫 CDP 연결** 시 Chrome이 **"Allow"** 권한 팝업을 띄웁니다 — 승인하여 도구 연결을 허용하세요.

## 무엇을 얻게 되나

- **스펙 주도 워크플로** — 모든 change는 제안, specs, 설계, 작업 목록이 담긴 하나의 폴더입니다. 코드를 쓰기 전에 무엇을 만들지 합의합니다: `/rasen-propose → /rasen-apply-change → /rasen-archive-change`.
- **`rasen` 파이프라인 패밀리** — `small-feature` / `bug-fix` / `full-feature` / `auto-decompose`가 데이터(YAML)로 제공됩니다; `rasen pipeline show|list|classify|resume`으로 확인하세요. 작업 유형 추가는 파일 하나 추가, 코드는 제로.
- **`/rasen-auto` 오토파일럿** — 명령 하나로 에이전트가 **LEAD**가 되어 역할이 분리된 서브에이전트(planner / implementer / reviewer / fixer / shipper)를 파이프라인 전체에 걸쳐 오케스트레이션하고, gate에서만 멈춥니다.
- **`/rasen-goal` 목표 주도 반복** — `/rasen-auto`의 자매 명령으로, "완료"가 문서가 아니라 조건인 작업을 위한 것입니다(Lighthouse를 90까지 올리기, 모듈을 루브릭 통과 수준으로 다듬기, 리서치해서 브리프 쓰기). LEAD가 작업을 measure / evaluate / research 백엔드로 분류하고, gate가 충족되거나 라운드 상한에 도달할 때까지 modify → judge를 반복합니다.
- **Auto-decompose** — 리뷰 가능한 diff 하나에 담기엔 너무 큰 작업을, 의존성 DAG와 보수적인 직렬/병렬 정책과 함께 독립적으로 배포 가능한 자식 change들로 분할합니다.
- **chrome-use** — CDP로 실제 Chrome을 조작하는 전문가: 탐색, 클릭, 네트워크 캡처, JS 주입, cookie와 `localStorage` 읽기, 요청 대기 — 로그인이 필요한 페이지, SPA, 단순 fetch로는 닿지 않는 모든 것을 위해.
- **컨텍스트 감지와 handoff** — `rasen agent context`가 실제 점유율을 측정하고; `/rasen-handoff`가 증류된 체크포인트를 기록하며; worker는 소프트 예산에서 스스로 교대하고, compact 복구 훅이 auto-compact 후 세션을 증류물에 다시 고정합니다 — 긴 작업이 컨텍스트 한계를 버텨내도록.

## 실제 동작 예시

```text
You: /rasen-explore
AI:  무엇을 탐색하시겠어요?
You: 다크 모드를 넣고 싶은데 깔끔한 방법을 모르겠어.
AI:  스타일링 구성을 살펴볼게요...
     가장 깔끔한 경로: CSS 변수 + 작은 테마 context,
     시스템 설정 감지 포함. 새 의존성 없음. 범위를 정할까요?
You: 좋아, 그렇게 하자.

You: /rasen-propose add-dark-mode
AI:  rasen/changes/add-dark-mode/ 생성됨
     ✓ proposal.md — 왜 하는지, 무엇이 바뀌는지
     ✓ specs/       — 요구사항과 시나리오
     ✓ design.md    — 기술적 접근
     ✓ tasks.md     — 구현 체크리스트
     구현 준비 완료!

You: /rasen-apply-change
AI:  작업 실행 중...
     ✓ 1.1 테마 context 프로바이더 추가
     ✓ 1.2 토글 컴포넌트 생성
     ✓ 2.1 CSS 변수 추가
     ✓ 2.2 localStorage 연결
     모든 작업 완료!

You: /rasen-archive-change
AI:  rasen/changes/archive/2026-01-23-add-dark-mode/ 에 아카이브됨
     스펙 갱신 완료. 다음 기능을 맞이할 준비가 됐습니다.
```

## 텔레메트리와 프라이버시

Rasen은 어떤 명령이 사용되는지 파악하기 위해 익명 사용 텔레메트리를 수집합니다. 전송되는 것은 **명령 이름, rasen 버전, 익명 UUID, OS와 Node 버전뿐**이며 — **경로, 인자, 프로젝트 데이터는 절대 전송되지 않습니다**.

옵트아웃하려면 다음 중 하나를 설정하세요:

```bash
export RASEN_TELEMETRY=0
# 또는 도구 공통 표준:
export DO_NOT_TRACK=1
```

CI 환경에서는 텔레메트리가 **자동으로 비활성화**됩니다.

## 라이선스

MIT — Copyright (c) 2024 OpenSpec Contributors 및 Copyright (c) 2026 Sayo. [LICENSE](./LICENSE) 참조.

이슈와 피드백: [github.com/DumoeDss/rasen](https://github.com/DumoeDss/rasen).
