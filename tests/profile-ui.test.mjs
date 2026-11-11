import assert from "node:assert/strict"; // 화면 결과 검사
import test from "node:test"; // 기본 검사 도구
import { ServerManager } from "../frontend/server-manager.mjs"; // 실제 요청 수명
import { mountProfileUI } from "../frontend/profile-ui.mjs"; // 실제 프로필 화면
const original = { id: "1", username: "first_name", email: "first@example.test", created_at: "2026-10-21T00:00:00Z" }; // 본인 공개 정보
function element() // 브라우저 입출력 경계
{
    const events = new Map(); // 등록한 실제 이벤트
    const item = { value: "", textContent: "", disabled: false, hidden: false, open: false, focus: () => undefined, setAttribute: () => undefined, reportValidity: () => true }; // 최소 요소 상태
    item.append = (option) => { if (!item.value) item.value = option.value; }; // 첫 사용자 선택
    item.addEventListener = (name, handler) => events.set(name, handler); // 이벤트 연결
    item.fire = (name, event = { preventDefault: () => undefined }) => events.get(name)?.(event); // 사용자 조작
    item.getBoundingClientRect = () => ({ left: 10, right: 100, top: 10, bottom: 100 }); // 대화상자 경계
    item.showModal = () => item.open = true; // 대화상자 열기
    item.close = () => // 닫기 수명
    {
        item.open = false; // 표시 종료
        item.fire("close"); // 민감 정보 정리
    }; // 닫기 경계 끝
    return item; // 독립 DOM 요소
}
function setup(request) // 실제 화면과 상태 모듈
{
    const elements = new Map(); // 식별자별 요소
    const byId = (id) => // 같은 요소 조회
    {
        if (!elements.has(id)) // 최초 요소
        {
            elements.set(id, element()); // 독립 요소 생성
        }
        return elements.get(id); // 기존 요소 반환
    }; // DOM 경계 종료
    let user = { ...original }; // 현재 계정
    let ui; // 화면 연결
    let failures = 0; // 오류 전달 횟수
    const applied = []; // 실제 적용한 공개 사용자
    const manager = new ServerManager({ request, getUser: () => user, onChange: () => ui?.render() }); // 기존 요청 보호
    manager.identity = "1"; // 확인한 로그인 계정
    ui = mountProfileUI({ manager, byId, getUser: () => user, isReady: () => Boolean(user), onUser: (next) => // 본인 표시 갱신 경계
    {
        user = next; // 같은 계정 정보 교체
        applied.push(next); // 적용 횟수 관측
    }, onError: async (error) => // 실제 인증 복구 경계
    {
        failures++; // 현재 오류 전달
        return error.code === "CSRF_INVALID" ? "보호 정보를 갱신했습니다. 다시 저장하세요." : error.message; // 사용자 안내
    } }); // 실제 화면 연결 종료
    return { ui, manager, byId, applied, failures: () => failures, user: () => user, change: (next) => user = next }; // 검사 제어
}
test("본인 조회·취소 시 이메일과 입력 폐기·게스트 숨김", async () => // 본인 정보 수명
{
    const calls = []; // 실제 경로 기록
    const testHarness = setup(async (path, body) => // 네트워크 경계
    {
        calls.push({ path, body }); // 공개 요청 관측
        return { user: original }; // 실제 응답 형태
    });
    await testHarness.byId("open-profile").fire("click"); // 내 프로필 열기
    assert.equal(testHarness.byId("profile-email").textContent, original.email); // 본인 이메일 표시
    assert.equal(testHarness.byId("profile-username").value, original.username); // 현재 사용자명
    assert.equal(testHarness.byId("profile-submit").disabled, false); // 확인된 정보만 변경 가능
    await testHarness.byId("profile-close-top").fire("click"); // 취소
    assert.deepEqual(calls, [{ path: "./backend/api/profile.php", body: null }]); // 취소는 변경 없음
    assert.equal(testHarness.byId("profile-email").textContent, ""); // 닫은 이메일 폐기
    assert.equal(testHarness.byId("profile-username").value, ""); // 이전 입력 폐기
    testHarness.change(null); // 로그아웃 상태
    testHarness.ui.render(); // 실제 권한 갱신
    assert.equal(testHarness.byId("open-profile").hidden, true); // 게스트 진입 숨김
});
test("저장은 PATCH 한 번·처리 중 중복 차단·확인된 본인만 적용", async () => // 실제 변경 메서드와 수명
{
    const calls = []; // 변경 요청 기록
    let release; // 지연 저장 응답
    const testHarness = setup(async (path, body, signal, method) => // 실제 공통 요청 경계
    {
        if (!body) // 최초 조회
        {
            return { user: original }; // 확인한 본인
        }
        calls.push({ path, body, method }); // 변경 메서드 관측
        return new Promise((resolve) => release = resolve); // 처리 중 상태
    });
    await testHarness.byId("open-profile").fire("click"); // 프로필 조회
    testHarness.byId("profile-username").value = "Changed_Name"; // 서버 정규화 대상
    const pending = testHarness.byId("profile-form").fire("submit"); // 실제 저장 시작
    assert.equal(testHarness.byId("profile-close-top").disabled, true); // 저장 중 닫기 제한
    await testHarness.byId("profile-form").fire("submit"); // 중복 제출 시도
    release({ user: { ...original, username: "changed_name" } }); // 실제 커밋 응답
    await pending; // 화면 갱신 완료
    assert.deepEqual(calls, [{ path: "./backend/api/profile.php", body: { username: "Changed_Name" }, method: "PATCH" }]); // 허용 필드와 메서드
    assert.equal(testHarness.user().username, "changed_name"); // 확인된 이름 반영
    assert.equal(testHarness.byId("profile-username").value, "changed_name"); // 정규화 결과 표시
    assert.match(testHarness.byId("profile-status").textContent, /저장/); // 성공 응답 후 안내
});
test("중복·형식 오류는 입력 보존과 필드 안내", async () => // 수동 수정 가능 상태
{
    const testHarness = setup(async (path, body) => // 중복 응답 경계
    {
        if (body) // 실제 변경
        {
            throw Object.assign(new Error("중복 사용자명"), { status: 409, code: "USERNAME_TAKEN", fields: { username: "다른 이름 입력" } }); // 공개 필드 오류
        }
        return { user: original }; // 본인 조회
    });
    await testHarness.byId("open-profile").fire("click"); // 현재 정보 확인
    testHarness.byId("profile-username").value = "duplicate"; // 수정할 입력
    await testHarness.byId("profile-form").fire("submit"); // 실제 거절
    assert.equal(testHarness.byId("profile-username").value, "duplicate"); // 입력 보존
    assert.match(testHarness.byId("profile-error").textContent, /다른 이름 입력/); // 구체 필드 안내
    assert.equal(testHarness.user().username, original.username); // 미확정 결과 적용 없음
});
test("조회 실패는 저장 차단·명시적 재조회 후 복구", async () => // 캐시만으로 수정 방지
{
    let calls = 0; // 조회 횟수
    const testHarness = setup(async () => // 최초 연결 실패
    {
        if (++calls === 1) // 최초 요청
        {
            throw new Error("연결 실패"); // 실제 조회 미확인
        }
        return { user: original }; // 수동 재확인 성공
    });
    await testHarness.byId("open-profile").fire("click"); // 실패 화면
    assert.equal(testHarness.byId("profile-submit").disabled, true); // 저장 차단
    await testHarness.byId("profile-reload").fire("click"); // 명시적 복구
    assert.equal(testHarness.byId("profile-submit").disabled, false); // 확인 뒤 저장 허용
});
test("보호 토큰 복구는 자동 저장 없이 입력 유지", async () => // 기존 CSRF 정책
{
    let patches = 0; // 변경 요청 수
    const testHarness = setup(async (path, body) => // 보호 오류 경계
    {
        if (body) // 변경 요청
        {
            patches++; // 요청 한 번
            throw Object.assign(new Error("보호 오류"), { status: 403, code: "CSRF_INVALID" }); // 실제 복구 대상
        }
        return { user: original }; // 본인 조회
    });
    await testHarness.byId("open-profile").fire("click"); // 조회
    testHarness.byId("profile-username").value = "manual_retry"; // 변경 입력
    await testHarness.byId("profile-form").fire("submit"); // 보호 실패
    assert.equal(patches, 1); // 자동 재전송 없음
    assert.equal(testHarness.byId("profile-username").value, "manual_retry"); // 같은 계정 입력 유지
    assert.match(testHarness.byId("profile-error").textContent, /다시 저장/); // 명시적 재제출 안내
});
test("저장 응답 유실은 GET 확인·입력 보존·PATCH 자동 반복 없음", async () => // 불확실한 커밋 복구
{
    let gets = 0; // 실제 상태 조회
    let patches = 0; // 변경 횟수
    const testHarness = setup(async (path, body) => // 커밋 뒤 응답 유실 경계
    {
        if (body) // 저장 요청
        {
            patches++; // 변경 한 번
            throw new Error("응답 유실"); // 성공 여부 불명확
        }
        return { user: { ...original, username: ++gets === 1 ? original.username : "saved_name" } }; // 실제 저장 상태 재조회
    });
    await testHarness.byId("open-profile").fire("click"); // 최초 조회
    testHarness.byId("profile-username").value = "Saved_Name"; // 보존할 입력
    await testHarness.byId("profile-form").fire("submit"); // 불확실한 저장
    assert.equal(patches, 1); // 자동 변경 반복 없음
    assert.equal(gets, 2); // 실제 상태만 재조회
    assert.equal(testHarness.user().username, "saved_name"); // 확인된 DB 이름
    assert.equal(testHarness.byId("profile-username").value, "Saved_Name"); // 입력 보존
    assert.match(testHarness.byId("profile-status").textContent, /saved_name/); // 현재 저장 상태 안내
});
test("이전 계정의 늦은 응답은 새 계정 정보와 오류에 반영하지 않음", async () => // 개인 정보 혼합 방지
{
    let release; // 늦은 조회 결과
    const testHarness = setup(() => new Promise((resolve) => release = resolve)); // 실제 지연 요청
    const pending = testHarness.byId("open-profile").fire("click"); // 이전 계정 조회
    testHarness.ui.clear(); // 계정 종료 경계
    testHarness.change({ ...original, id: "2", username: "other_user" }); // 새 계정
    testHarness.manager.reset(); // 요청 수명 변경
    release({ user: original }); // 오래된 이메일 응답
    await pending; // 실제 응답 처리
    assert.equal(testHarness.applied.length, 0); // 이전 계정 적용 없음
    assert.equal(testHarness.failures(), 0); // 새 계정 인증 오류 전달 없음
    assert.equal(testHarness.byId("profile-email").textContent, ""); // 이전 이메일 비노출
    assert.equal(testHarness.byId("profile-dialog").open, false); // 이전 화면 닫힘
});
test("다른 계정 ID의 성공 응답도 적용 차단", async () => // 잘못된 계약 결과 보호
{
    const testHarness = setup(async () => ({ user: { ...original, id: "2" } })); // 실제 응답 계정 불일치
    await testHarness.byId("open-profile").fire("click"); // 본인 조회
    assert.equal(testHarness.applied.length, 0); // 잘못된 본인 적용 없음
    assert.equal(testHarness.byId("profile-submit").disabled, true); // 미확인 계정 수정 차단
});
test("확장 프로필 상태와 차단 목록을 실제 요청으로 관리", async () => // 사용자 확인 후 상태와 차단 변경
{
    const calls = []; // 수행한 요청
    const testHarness = setup(async (requestPath, body, signal, method) => // 실제 API 경계
    {
        calls.push({ requestPath, body, method }); // 요청 기록
        if (requestPath.includes("profile_details.php") && body === null) // 공개 상태 조회
        {
            return { profile: { id: "1", username: "first_name", status_message: "기존 상태", has_picture: false } }; // 저장 상태
        }
        if (requestPath.includes("user_blocks.php") && body === null) // 차단 목록 조회
        {
            return { users: [] }; // 빈 목록
        }
        if (requestPath.includes("profile_details.php") && body) // 상태 변경
        {
            return { status_message: body.status_message }; // 저장 결과
        }
        return { user: original }; // 기존 프로필
    }); // 요청 경계 끝
    await testHarness.byId("open-profile").fire("click"); // 기존 프로필 확인
    await testHarness.byId("profile-extra-load").fire("click"); // 확장 정보 확인
    assert.equal(testHarness.byId("profile-message").value, "기존 상태"); // 저장 상태 반영
    testHarness.byId("profile-message").value = "새 상태"; // 새 상태 입력
    await testHarness.byId("profile-message-save").fire("click"); // 상태 저장
    assert.ok(calls.some((call) => call.requestPath.endsWith("profile_details.php") && call.method === "PATCH" && call.body.status_message === "새 상태")); // 실제 상태 저장 요청
}); // 확장 정보 검사 끝

test("차단 검색과 해제는 선택한 사용자만 변경", async (context) => // 공개 검색과 본인 차단 관리
{
    const previousDocument = globalThis.document; // 기존 DOM 경계
    globalThis.document = { createElement: () => ({ value: "", textContent: "" }) }; // 선택지 생성 도구
    context.after(() => globalThis.document = previousDocument); // DOM 경계 복원
    const changes = []; // 실제 차단 변경
    let blocked = []; // 서버 차단 상태
    const testHarness = setup(async (requestPath, body, signal, method) => // 실제 요청 계약
    {
        if (requestPath.includes("profile_details.php")) // 확장 상태
        {
            return { profile: { id: "1", status_message: "", has_picture: false } }; // 본인 정보
        }
        if (requestPath.includes("search_users.php")) // 대상 검색
        {
            return { users: [{ id: "2", username: "second" }] }; // 실제 검색 결과
        }
        if (requestPath.includes("user_blocks.php")) // 차단 목록과 변경
        {
            if (body) // 명시적 차단 변경
            {
                changes.push({ body, method }); // 변경 대상 기록
                blocked = method === "POST" ? [{ id: "2", username: "second" }] : []; // 저장 상태 반영
                return { user_id: body.user_id, blocked: method === "POST" }; // 변경 결과
            }
            return { users: blocked }; // 현재 저장 목록
        }
        return { user: original }; // 기존 프로필
    }); // 요청 경계 끝
    await testHarness.byId("open-profile").fire("click"); // 본인 정보 열기
    await testHarness.byId("profile-extra-load").fire("click"); // 차단 목록 확인
    testHarness.byId("profile-block-search").value = "second"; // 검색할 사용자명
    await testHarness.byId("profile-block-find").fire("click"); // 실제 사용자 검색
    await testHarness.byId("profile-block-add").fire("click"); // 선택 사용자 차단
    await testHarness.byId("profile-block-remove").fire("click"); // 본인 차단 해제
    assert.deepEqual(changes, [{ body: { user_id: "2" }, method: "POST" }, { body: { user_id: "2" }, method: "DELETE" }]); // 선택 대상과 요청 방식
}); // 차단 조작 검사 끝
test("프로필 사진은 파일 원본 multipart로 전송하고 성공 시 표시", async () => // 사진 저장의 브라우저 경계
{
    let sentForm = null; // 전송된 파일 본문
    const testHarness = setup(async (requestPath, body) => // 실제 화면 요청
    {
        if (requestPath.includes("profile_details.php")) // 확장 상태 조회
        {
            return { profile: { id: "1", status_message: "", has_picture: false } }; // 현재 사진 없음
        }
        if (requestPath.includes("user_blocks.php")) // 차단 목록 조회
        {
            return { users: [] }; // 빈 목록
        }
        if (requestPath.includes("profile_picture.php")) // 사진 저장
        {
            sentForm = body; // multipart 본문 기록
            return { has_picture: true }; // 저장 확인
        }
        return { user: original }; // 기존 본인 정보
    }); // 요청 경계 끝
    await testHarness.byId("open-profile").fire("click"); // 기존 정보 확인
    await testHarness.byId("profile-extra-load").fire("click"); // 확장 상태 확인
    testHarness.byId("profile-picture-file").files = [new Blob(["png"], { type: "image/png" })]; // 선택한 사진
    await testHarness.byId("profile-picture-save").fire("click"); // 명시적 사진 저장
    assert.ok(sentForm instanceof FormData); // multipart 요청 자료
    assert.ok(sentForm.get("picture") instanceof Blob); // 사진 파일 보존
    assert.equal(testHarness.byId("profile-picture-preview").hidden, false); // 저장 후 사진 표시
    assert.match(testHarness.byId("profile-picture-preview").src, /profile_picture\.php\?user_id=1$/); // 인증된 본인 사진 경로
}); // 사진 화면 검사 끝
test("추가 설정 오류를 해당 영역에 표시", async () => // 보이지 않는 상단 오류 방지
{
    const testHarness = setup(async (requestPath) => // 실제 프로필 요청 경계
    {
        if (requestPath.includes("profile_details.php")) // 추가 상태 조회
        {
            return { profile: { id: "1", status_message: "", has_picture: false } }; // 본인 상태
        }
        if (requestPath.includes("user_blocks.php")) // 차단 목록 조회
        {
            return { users: [] }; // 빈 차단 목록
        }
        return { user: original }; // 기존 본인 정보
    }); // 요청 경계 끝
    await testHarness.byId("open-profile").fire("click"); // 프로필 열기
    await testHarness.byId("profile-extra-load").fire("click"); // 추가 정보 확인
    await testHarness.byId("profile-picture-save").fire("click"); // 파일 없이 저장 요청
    assert.equal(testHarness.byId("profile-extra-status").textContent, "사진 파일을 선택하세요."); // 추가 설정 영역의 오류 안내
    assert.equal(testHarness.byId("profile-picture-feedback").textContent, "사진 파일을 선택하세요."); // 사진 카드의 오류 안내
}); // 추가 설정 오류 검사 끝
test("프로필 상단 버튼과 바깥 클릭으로 닫기", async () => // 두 닫기 경로
{
    const testHarness = setup(async () => ({ user: original })); // 본인 정보 조회
    await testHarness.byId("open-profile").fire("click"); // 프로필 열기
    await testHarness.byId("profile-close-top").fire("click"); // 왼쪽 위 닫기
    assert.equal(testHarness.byId("profile-dialog").open, false); // 실제 창 닫힘
    assert.equal(testHarness.byId("profile-email").textContent, ""); // 닫은 정보 제거
    await testHarness.byId("open-profile").fire("click"); // 다시 열기
    const dialog = testHarness.byId("profile-dialog"); // 실제 대화상자
    dialog.fire("click", { target: dialog, clientX: 50, clientY: 50 }); // 창 내부 빈 영역
    assert.equal(dialog.open, true); // 내부 클릭은 유지
    dialog.fire("click", { target: dialog, clientX: 5, clientY: 5 }); // 창 바깥 배경
    assert.equal(dialog.open, false); // 바깥 클릭은 닫기
    assert.equal(testHarness.byId("profile-email").textContent, ""); // 닫은 정보 제거
}); // 닫기 검사 끝
