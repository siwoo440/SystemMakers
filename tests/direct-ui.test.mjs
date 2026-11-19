import assert from "node:assert/strict"; // 결과 검증
import test from "node:test"; // 기본 검사 도구
import { mountDirectUI } from "../frontend/direct-ui.mjs"; // 실제 개인 대화 화면
function element() // 최소 화면 요소
{
    const events = new Map(); // 사용자 동작 목록
    const item = { value: "", textContent: "", disabled: false, hidden: false, children: [], scrollTop: 0, scrollHeight: 0, setAttribute: () => undefined, focus: () => undefined }; // 화면 상태
    item.addEventListener = (name, action) => events.set(name, action); // 동작 연결
    item.fire = (name, event = { preventDefault: () => undefined }) => events.get(name)?.(event); // 사용자 동작 실행
    item.replaceChildren = (...children) => item.children = children; // 안전한 목록 교체
    item.insertBefore = (node, anchor) => item.children.splice(anchor === null ? item.children.length : item.children.indexOf(anchor), 0, node); // 지정 위치에 말풍선 삽입
    item.replaceChild = (node, old) => item.children.splice(item.children.indexOf(old), 1, node); // 기존 말풍선 교체
    item.removeChild = (node) => item.children.splice(item.children.indexOf(node), 1); // 사라진 말풍선 정리
    return item; // 화면 요소 반환
}
function setup(request, timers = { set: () => 1, clear: () => undefined }) // 실제 화면과 테스트 경계
{
    const elements = new Map(); // 식별자별 화면 요소
    const byId = (id) => // 화면 요소 조회
    {
        if (!elements.has(id)) // 최초 조회
        {
            elements.set(id, element()); // 화면 요소 준비
        }
        return elements.get(id); // 현재 요소 반환
    };
    globalThis.document = { createElement: element }; // 버튼 생성 경계
    let user = { id: "1", username: "alice" }; // 로그인 계정
    const ui = mountDirectUI({ byId, request, getUser: () => user, isReady: () => Boolean(user), onOpen: () => undefined, onError: async (error) => error.message, createMessage: (message) => message, setTimer: timers.set, clearTimer: timers.clear }); // 실제 화면 연결
    return { byId, ui, setUser: (value) => user = value }; // 관찰 경계
}
const emptyPage = { messages: [], pagination: { mode: "initial", has_more: false, next_before_id: null, next_after_id: "0" } }; // 빈 최초 기록 응답
test("로그인하면 개인 대화의 로그인 안내 제거", async () => // 인증 상태별 안내
{
    const harness = setup(async () => ({ conversations: [] })); // 로그인 계정과 빈 목록
    harness.byId("direct-status").textContent = "로그인 후 개인 대화를 이용하세요."; // 기존 게스트 안내
    harness.ui.render(); // 로그인 상태 반영
    assert.equal(harness.byId("direct-status").textContent, ""); // 게스트 안내 제거
    await new Promise((resolve) => setImmediate(resolve)); // 목록 응답 완료
    harness.ui.clear(); // 조회 수명 정리
});
test("개인 대화에서 선택한 파일만 전송 전에 취소", async () => // 선택 취소와 업로드 차단
{
    const calls = []; // 실제 요청 기록
    const harness = setup(async (path) => // 공개 요청 경계
    {
        calls.push(path); // 요청 주소 기록
        return path.includes("list_dms") ? { conversations: [{ id: "10", other_user: { id: "2", username: "bob" } }] } : emptyPage; // 대화와 빈 기록
    });
    await harness.ui.refresh(); // 기존 대화 조회
    await harness.byId("direct-list").children[0].fire("click"); // 실제 대화 선택
    const input = harness.byId("direct-file"); // 파일 선택 영역
    let files = [new File(["data"], "예시.txt")]; // 선택한 예시 파일
    Object.defineProperty(input, "files", { get: () => files }); // 현재 선택 관측
    Object.defineProperty(input, "value", { set: (value) => // 브라우저 선택 해제
    {
        if (value === "") // 빈 파일 입력
        {
            files = []; // 선택 파일 제거
        }
    } });
    input.fire("change"); // 선택 상태 반영
    assert.equal(harness.byId("direct-file-clear").disabled, false); // 선택 취소 가능
    harness.byId("direct-file-clear").fire("click"); // 명시적 선택 취소
    assert.equal(input.files.length, 0); // 선택한 파일 제거
    assert.equal(harness.byId("direct-upload").disabled, true); // 파일 전송 비활성
    assert.equal(harness.byId("direct-file-status").textContent, "최대 약 5.24 MB"); // 기본 안내 복구
    assert.equal(calls.some((path) => path.includes("upload_attachment")), false); // 서버 전송 없음
    harness.ui.clear(); // 조회 수명 정리
});
test("사용자 검색부터 개인 대화 생성과 본인 메시지 전송", async () => // 실제 버튼과 API 연결
{
    const calls = []; // 실제 요청 관찰
    const harness = setup(async (path, body) => // 서버 응답 경계
    {
        calls.push({ path, body }); // 요청 내용 기록
        if (path.includes("search_users")) // 사용자 검색
        {
            return { users: [{ id: "2", username: "bob" }] }; // 사용자 검색 응답
        }
        if (path.includes("create_dm")) // 대화 생성
        {
            return { conversation: { id: "10", other_user: { id: "2", username: "bob" } } }; // 생성 응답
        }
        if (path.includes("get_dm_messages")) // 기록 조회
        {
            return emptyPage; // 빈 기록 응답
        }
        if (path.includes("send_dm")) // 메시지 전송
        {
            return { message: { id: "3", conversation_id: "10", user_id: "1", username: "alice", content: body.content, created_at: "2026-11-11T00:00:00Z" } }; // 저장 응답
        }
        return { conversations: [] }; // 기존 대화 목록
    });
    harness.byId("direct-search-input").value = "bob"; // 검색어 입력
    await harness.byId("direct-search-form").fire("submit"); // 명시적 검색
    await harness.byId("direct-search-results").children[0].fire("click"); // 상대방 선택
    harness.byId("direct-input").value = "안녕하세요"; // 본인 메시지 작성
    await harness.byId("direct-form").fire("submit"); // 명시적 전송
    assert.deepEqual(calls.find((call) => call.path.includes("send_dm")).body, { conversation_id: "10", content: "안녕하세요" }); // 정확한 대화와 내용 전송
    assert.equal(harness.byId("direct-messages").children[0].name, "alice"); // 본인 이름 표시
    assert.equal(harness.byId("direct-messages").children[0].isOwn, true); // 본인 메시지 시각 구분
    assert.equal(harness.byId("direct-messages").children[0].text, "안녕하세요"); // 저장한 본문 표시
    assert.equal(harness.byId("direct-input").value, ""); // 성공한 초안 제거
    harness.ui.clear(); // 조회 수명 종료
});
test("대화 전환과 계정 종료 후 늦은 기록 응답 무시", async () => // 다른 상대방과 계정의 기록 혼합 차단
{
    let resolveOld; // 이전 조회 응답 제어
    const oldPage = new Promise((resolve) => resolveOld = resolve); // 지연된 기록
    const harness = setup(async (path) => // 서버 응답 경계
    {
        if (path.includes("list_dms")) // 대화 목록
        {
            return { conversations: [{ id: "10", other_user: { id: "2", username: "bob" } }, { id: "20", other_user: { id: "3", username: "carol" } }] }; // 확인된 대화 목록
        }
        if (path.includes("conversation_id=10")) // 첫 대화 기록
        {
            return oldPage; // 첫 대화의 늦은 응답
        }
        return emptyPage; // 두 번째 대화 기록
    });
    await harness.ui.refresh(); // 실제 대화 목록 조회
    const pending = harness.byId("direct-list").children[0].fire("click"); // 첫 상대방 선택
    await harness.byId("direct-list").children[1].fire("click"); // 다른 상대방 선택
    resolveOld({ messages: [{ id: "1", conversation_id: "10", user_id: "2", username: "bob", content: "이전 대화", created_at: "2026-11-11T00:00:00Z" }], pagination: { mode: "initial", has_more: false, next_before_id: "1", next_after_id: "1" } }); // 이전 기록 도착
    await pending; // 지연 응답 완료
    assert.equal(harness.byId("direct-title").textContent, "carol"); // 선택한 상대방 유지
    assert.equal(harness.byId("direct-messages").children.length, 0); // 이전 상대방 기록 미노출
    harness.setUser(null); // 계정 종료
    harness.ui.clear(); // 이전 계정 자료 제거
    assert.equal(harness.byId("direct-list").children.length, 0); // 이전 목록 제거
    assert.equal(harness.byId("direct-input").value, ""); // 이전 초안 제거
});
test("대화 생성 응답이 늦어도 이후 선택한 상대방 유지", async () => // 생성 결과의 화면 전환 경합 차단
{
    let finishCreate; // 늦은 생성 응답 제어
    const pendingCreate = new Promise((resolve) => finishCreate = resolve); // 보류 중인 생성 응답
    const harness = setup(async (path) => // 공개 API 응답
    {
        if (path.includes("list_dms")) // 기존 대화 조회
        {
            return { conversations: [{ id: "20", other_user: { id: "3", username: "carol" } }] }; // 기존 상대방
        }
        if (path.includes("search_users")) // 새 상대방 검색
        {
            return { users: [{ id: "2", username: "bob" }] }; // 검색 상대방
        }
        if (path.includes("create_dm")) // 새 대화 생성
        {
            return pendingCreate; // 지연된 생성 결과
        }
        return emptyPage; // 기존 대화 기록
    });
    await harness.ui.refresh(); // 기존 대화 목록
    harness.byId("direct-search-input").value = "bob"; // 새 상대방 검색어
    await harness.byId("direct-search-form").fire("submit"); // 검색 실행
    const pending = harness.byId("direct-search-results").children[0].fire("click"); // 새 대화 생성 요청
    await harness.byId("direct-list").children[0].fire("click"); // 다른 기존 대화 선택
    finishCreate({ conversation: { id: "10", other_user: { id: "2", username: "bob" } } }); // 늦은 생성 완료
    await pending; // 생성 처리 종료
    assert.equal(harness.byId("direct-title").textContent, "carol"); // 이후 선택한 상대방 유지
    harness.ui.clear(); // 대화 수명 정리
});
test("개인 대화 자동 갱신은 마지막 조회 이후 메시지만 추가", async () => // 새 메시지 누락과 중복 표시 차단
{
    let nextTimer; // 다음 갱신 예약
    const paths = []; // 실제 조회 주소
    const harness = setup(async (path) => // 공개 API 응답
    {
        paths.push(path); // 조회 커서 기록
        if (path.includes("list_dms")) // 참여 대화 목록
        {
            return { conversations: [{ id: "10", other_user: { id: "2", username: "bob" } }] }; // 확인된 상대방
        }
        if (path.includes("after_id=1")) // 신규 기록 조회
        {
            return { messages: [{ id: "2", conversation_id: "10", user_id: "2", username: "bob", content: "답장", created_at: "2026-11-11T00:00:01Z" }], pagination: { mode: "after", has_more: false, next_before_id: "2", next_after_id: "2" } }; // 신규 메시지
        }
        if (path.includes("after_id=2")) // 신규 기록 없는 조회
        {
            return { messages: [], pagination: { mode: "after", has_more: false, next_before_id: null, next_after_id: "2" } }; // 마지막 커서 유지
        }
        if (path.includes("list_attachments")) // 파일 정보 확인
        {
            return { attachments: [] }; // 파일 없는 대화
        }
        return { messages: [{ id: "1", conversation_id: "10", user_id: "1", username: "alice", content: "첫 메시지", created_at: "2026-11-11T00:00:00Z" }], pagination: { mode: "initial", has_more: false, next_before_id: "1", next_after_id: "1" } }; // 최초 기록
    }, { set: (callback) => nextTimer = callback, clear: () => undefined }); // 가상 갱신 예약
    await harness.ui.refresh(); // 대화 목록 확인
    await harness.byId("direct-list").children[0].fire("click"); // 대화 선택과 최초 조회
    const firstBubble = harness.byId("direct-messages").children[0]; // 새 기록 도착 전 말풍선
    await nextTimer(); // 예약된 신규 기록 확인
    assert.equal(harness.byId("direct-messages").children[0], firstBubble); // 이전 말풍선 객체 유지
    assert.ok(paths.some((path) => path.includes("after_id=1"))); // 실제 조회 커서 사용
    assert.deepEqual(harness.byId("direct-messages").children.map((message) => message.text), ["첫 메시지", "답장"]); // 본인 기록과 답장 표시
    assert.deepEqual(harness.byId("direct-messages").children.map((message) => message.isOwn), [true, false]); // 본인과 상대 메시지 구분
    const displayed = harness.byId("direct-messages").children; // 현재 대화 노드 목록
    await nextTimer(); // 새 메시지 없는 다음 조회
    assert.equal(harness.byId("direct-messages").children, displayed); // 기존 노드와 읽는 위치 유지
    harness.setUser({ id: "1", username: "alice2" }); // 확인된 본인 이름 변경
    harness.ui.renameUser("1", "alice2"); // 개인 대화에 프로필 반영
    assert.equal(harness.byId("direct-messages").children[0].name, "alice2"); // 다음 메시지 전에 이름 갱신
    harness.ui.clear(); // 예약 수명 종료
});
test("개인 파일 전송은 저장 메시지에 확인된 다운로드 정보를 표시", async () => // 전송한 파일의 메시지 연결 누락 차단
{
    const uploads = []; // 실제 전송 요청
    const harness = setup(async (path, body) => // 공개 API 응답
    {
        if (path.includes("list_dms")) // 기존 개인 대화
        {
            return { conversations: [{ id: "10", other_user: { id: "2", username: "bob" } }] }; // 확인된 대화
        }
        if (path.includes("upload_attachment")) // 파일 저장
        {
            uploads.push(body); // 실제 본문 관찰
            return { message: { id: "7", conversation_id: "10", user_id: "1", username: "alice", content: "파일: 문서.txt", created_at: "2026-11-11T00:00:00Z" }, attachment: { id: "9", message_id: "7", original_name: "문서.txt", file_size: 4 } }; // 확정된 저장 결과
        }
        return emptyPage; // 최초 빈 기록
    });
    await harness.ui.refresh(); // 대화 목록 확인
    await harness.byId("direct-list").children[0].fire("click"); // 실제 상대방 선택
    harness.byId("direct-file").files = [new File(["data"], "문서.txt")]; // 사용자 파일 선택
    harness.byId("direct-file").fire("change"); // 선택 상태 반영
    await harness.byId("direct-upload").fire("click"); // 명시적 파일 전송
    assert.equal(uploads.length, 1); // 한 번의 실제 전송
    assert.equal(uploads[0].get("target_id"), "10"); // 선택한 대화의 파일
    assert.equal(harness.byId("direct-messages").children[0].attachment.original_name, "문서.txt"); // 메시지에 첨부 정보 표시
    harness.ui.clear(); // 조회 수명 종료
});
test("개인 파일 전송 중에는 선택 취소를 막음", async () => // 저장 결과 대기 보호
{
    let finishUpload; // 업로드 완료 제어
    const uploadResult = new Promise((resolve) => finishUpload = resolve); // 응답 대기 경계
    const harness = setup(async (path) => // 실제 요청 경계
    {
        if (path.includes("list_dms")) // 대화 목록 요청
        {
            return { conversations: [{ id: "10", other_user: { id: "2", username: "bob" } }] }; // 확인된 대화
        }
        if (path.includes("upload_attachment")) // 파일 업로드 요청
        {
            return uploadResult; // 저장 결과 대기
        }
        return emptyPage; // 빈 대화 기록
    });
    await harness.ui.refresh(); // 대화 목록 조회
    await harness.byId("direct-list").children[0].fire("click"); // 개인 대화 선택
    harness.byId("direct-file").files = [new File(["data"], "문서.txt")]; // 전송할 파일 선택
    harness.byId("direct-file").fire("change"); // 파일 상태 반영
    const pending = harness.byId("direct-upload").fire("click"); // 파일 전송 시작
    assert.equal(harness.byId("direct-file-clear").disabled, true); // 전송 중 취소 차단
    harness.byId("direct-file-clear").fire("click"); // 전송 중 취소 시도
    assert.equal(harness.byId("direct-file").files.length, 1); // 기존 선택 유지
    finishUpload({ message: { id: "7", conversation_id: "10", user_id: "1", username: "alice", content: "파일: 문서.txt", created_at: "2026-11-11T00:00:00Z" }, attachment: { id: "9", message_id: "7", original_name: "문서.txt", file_size: 4 } }); // 정상 저장 응답
    await pending; // 저장 결과 처리
    harness.ui.clear(); // 조회 수명 정리
});
test("복원한 개인 메시지의 첨부는 별도 권한 조회 뒤 표시", async () => // 새로고침 뒤 파일 링크 누락 차단
{
    const harness = setup(async (path) => // 공개 API 응답
    {
        if (path.includes("list_dms")) // 기존 대화 목록
        {
            return { conversations: [{ id: "10", other_user: { id: "2", username: "bob" } }] }; // 확인된 상대방
        }
        if (path.includes("list_attachments")) // 현재 메시지의 권한 확인
        {
            return { attachments: [{ id: "9", message_id: "7", original_name: "공유.txt", file_size: 3 }] }; // 상대방의 첨부 정보
        }
        return { messages: [{ id: "7", conversation_id: "10", user_id: "2", username: "bob", content: "파일: 공유.txt", created_at: "2026-11-11T00:00:00Z" }], pagination: { mode: "initial", has_more: false, next_before_id: "7", next_after_id: "7" } }; // 복원된 저장 메시지
    });
    await harness.ui.refresh(); // 대화 목록 확인
    await harness.byId("direct-list").children[0].fire("click"); // 기록과 파일 정보 조회
    await new Promise((resolve) => setImmediate(resolve)); // 비동기 파일 조회 완료
    assert.equal(harness.byId("direct-messages").children[0].attachment.original_name, "공유.txt"); // 상대방 파일 표시
    harness.ui.clear(); // 조회 수명 종료
});
test("개인 기록의 첨부는 추가 요청 없이 표시", async () => // 개인 기록과 파일 정보 통합
{
    const paths = []; // 화면의 실제 요청 목록
    const attachment = { id: "9", message_id: "7", original_name: "공유.txt", file_size: 3 }; // 공개 첨부 정보
    const harness = setup(async (path) => // 실제 화면 요청의 응답
    {
        paths.push(path); // 요청 횟수 기록
        if (path.includes("list_dms")) // 대화 목록 조회
        {
            return { conversations: [{ id: "10", other_user: { id: "2", username: "bob" } }] }; // 참여 중인 대화
        }
        return { messages: [{ id: "7", conversation_id: "10", user_id: "2", username: "bob", content: "파일", created_at: "2026-11-11T00:00:00Z", attachment }], pagination: { mode: "initial", has_more: false, next_before_id: "7", next_after_id: "7" } }; // 권한 확인된 페이지
    });
    harness.ui.render(); // 로그인 화면의 최초 목록 조회
    await new Promise((resolve) => setImmediate(resolve)); // 최초 목록 표시 완료
    paths.length = 0; // 기록 열기 시점부터 집계
    await harness.byId("direct-list").children[0].fire("click"); // 대화 선택
    assert.equal(paths.length, 1); // 추가 첨부 조회 없음
    assert.equal(new URL(paths[0], "http://localhost").searchParams.get("include_attachments"), "1"); // 메타데이터 동시 요청
    assert.deepEqual(harness.byId("direct-messages").children[0].attachment, attachment); // 다운로드 링크 자료
    harness.ui.clear(); // 화면 정리
});
test("이전 개인 기록을 앞에 붙여도 읽던 말풍선과 위치 유지", async () => // 과거 페이지 삽입과 스크롤 회귀
{
    const harness = setup(async (path) => // 대화 선택과 이전 페이지 요청
    {
        if (path.includes("list_dms")) // 참여 중인 대화 확인
        {
            return { conversations: [{ id: "10", other_user: { id: "2", username: "bob" } }] }; // 대화 한 개
        }
        const older = path.includes("before_id=15"); // 이전 기록 조회 여부
        const ids = older ? ["1", "9"] : ["15"]; // 화면에 추가할 순서
        const messages = ids.map((id) => ({ id, conversation_id: "10", user_id: "2", username: "bob", content: id, created_at: "2026-11-11T00:00:00Z", attachment: null })); // 첨부 없는 기록
        return { messages, pagination: { mode: older ? "before" : "initial", has_more: !older, next_before_id: ids[0], next_after_id: ids.at(-1) } }; // 실제 ID 기준 페이지
    });
    harness.ui.render(); // 로그인한 대화 화면 준비
    await new Promise((resolve) => setImmediate(resolve)); // 대화 목록 도착
    const list = harness.byId("direct-messages"); // 기록 목록
    const scroll = harness.byId("direct-scroll"); // 스크롤 영역
    Object.defineProperty(scroll, "scrollHeight", { get: () => list.children.length * 30 }); // 말풍선당 높이 30인 화면
    await harness.byId("direct-list").children[0].fire("click"); // 최신 페이지 열기
    const reading = list.children[0]; // 읽던 말풍선 보관
    scroll.scrollTop = 5; // 말풍선 안의 읽던 위치
    await harness.byId("direct-older").fire("click"); // 이전 두 건 추가
    assert.deepEqual(list.children.map((node) => node.text), ["1", "9", "15"]); // 숫자 ID 오름차순
    assert.equal(list.children[2], reading); // 기존 요소 유지
    assert.equal(scroll.scrollTop, 65); // 추가 높이만큼 읽던 위치 보정
    harness.ui.clear(); // 계정 화면 정리
    assert.equal(list.children.length, 0); // 권한 종료 후 화면 정리
});
