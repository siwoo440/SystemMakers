import assert from "node:assert/strict"; // 동작 결과 확인
import test from "node:test"; // 기본 검사 도구
import { bindBackdropDismiss } from "../frontend/dialog-dismiss.mjs"; // 공통 바깥 클릭 처리

test("대화상자 바깥 클릭만 닫고 처리 중에는 유지", () => // 실제 닫기 조건 검사
{
    let clickHandler; // 등록된 클릭 처리
    let busy = false; // 요청 진행 상태
    let closeCount = 0; // 실제 닫기 횟수
    const dialog = { addEventListener: (_name, handler) => clickHandler = handler, getBoundingClientRect: () => ({ left: 20, right: 120, top: 20, bottom: 120 }), close: () => closeCount++ }; // 화면 경계
    bindBackdropDismiss(dialog, () => !busy); // 대화상자 연결
    clickHandler({ target: {}, clientX: 10, clientY: 10 }); // 내부 자식 선택
    clickHandler({ target: dialog, clientX: 50, clientY: 50 }); // 창 안쪽 빈 영역
    assert.equal(closeCount, 0); // 내부 클릭 유지
    busy = true; // 요청 진행 시작
    clickHandler({ target: dialog, clientX: 10, clientY: 10 }); // 진행 중 바깥 선택
    assert.equal(closeCount, 0); // 진행 중 창 유지
    busy = false; // 요청 종료
    clickHandler({ target: dialog, clientX: 10, clientY: 10 }); // 바깥 영역 선택
    assert.equal(closeCount, 1); // 바깥 클릭 닫기
}); // 바깥 닫기 검사 끝
