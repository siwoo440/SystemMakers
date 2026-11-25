import assert from "node:assert/strict"; // 결과 검사
import test from "node:test"; // 기본 검사 도구
import { createAttachmentElements, createAttachmentView, uploadAttachment, validAttachment } from "../frontend/attachments-ui.mjs"; // 실제 첨부 화면 경계
test("첨부 정보는 메시지별 최대 50건으로 조회하며 중복 요청을 피함", async () => // 제한 초과와 반복 조회 차단
{
    const calls = []; // 실제 메타데이터 요청
    let changes = 0; // 첨부 링크 갱신 횟수
    const view = createAttachmentView({ kind: "direct", targetId: "7", userId: "1", getUser: () => ({ id: "1" }), request: async (path) => // 권한 검사 요청 경계
    {
        calls.push(path); // 요청 주소 기록
        return { attachments: [] }; // 첨부 없는 메시지
    }, onChange: () => changes++, onError: () => undefined }); // 화면 경계 연결
    const messages = Array.from({ length: 51 }, (_, index) => ({ id: String(index + 1) })); // 두 묶음이 필요한 기록
    await view.load(messages); // 모든 표시 기록 확인
    await view.load(messages); // 동일 기록 재확인
    assert.equal(calls.length, 2); // 최대 50건 분할과 중복 방지
    assert.equal(changes, 0); // 빈 첨부 응답의 화면 교체 생략
    assert.equal(new URL(calls[0], "https://example.test").searchParams.get("message_ids").split(",").length, 50); // 첫 요청 상한
    view.stop(); // 조회 수명 정리
});
test("이전 계정의 늦은 첨부 정보는 표시하지 않음", async () => // 다른 계정이나 대화에 파일 노출 차단
{
    let finish; // 지연 응답 제어
    let changed = 0; // 실제 화면 갱신 수
    const view = createAttachmentView({ kind: "channel", targetId: "5", userId: "1", getUser: () => ({ id: "1" }), request: () => new Promise((resolve) => finish = resolve), onChange: () => changed++, onError: () => undefined }); // 지연된 메타데이터 응답
    const pending = view.load([{ id: "2" }]); // 현재 기록 조회
    view.stop(); // 대화 또는 계정 전환
    finish({ attachments: [{ id: "9", message_id: "2", original_name: "파일.txt", file_size: 4 }] }); // 늦은 이전 응답
    await pending; // 완료 처리 대기
    assert.equal(view.get("2"), null); // 이전 첨부 미반영
    assert.equal(changed, 0); // 이전 화면 갱신 차단
});
test("첨부 조회 중 도착한 페이지와 실패한 묶음은 다음 조회에서 복구", async () => // 빈 페이지에서의 첨부 재시도
{
    const batches = []; // 실제 조회된 메시지 묶음
    let rejectFirst; // 첫 응답의 실패 제어
    const view = createAttachmentView({ kind: "channel", targetId: "7", userId: "1", getUser: () => ({ id: "1" }), request: async (path) => // 파일 정보 요청 관측
    {
        batches.push(new URL(path, "https://example.test").searchParams.get("message_ids")); // 대상 메시지 기록
        if (batches.length === 1) // 첫 요청 지연
        {
            return new Promise((resolve, reject) => rejectFirst = reject); // 통신 오류 대기
        }
        return { attachments: [] }; // 재시도 성공
    }, onChange: () => undefined, onError: () => undefined }); // 조회 경계 준비
    const first = view.load([{ id: "1" }]); // 첫 페이지 확인
    const second = view.load([{ id: "2" }]); // 조회 중 새 페이지 도착
    rejectFirst(new Error("offline")); // 첫 묶음 실패
    await Promise.all([first, second]); // 요청 종료 확인
    await view.load([]); // 새 메시지 없는 다음 갱신
    await view.load([]); // 확인 완료 뒤 유휴 갱신
    assert.deepEqual(batches, ["1", "1,2"]); // 누락과 중복 없는 재조회
});
test("파일 업로드는 대상과 파일을 multipart 본문으로 한 번 전달", async () => // 잘못된 대화와 재전송 차단
{
    const calls = []; // 실제 업로드 요청
    const file = new File(["data"], "문서.txt", { type: "text/plain" }); // 실제 파일
    const result = await uploadAttachment({ kind: "direct", targetId: "7", userId: "1", file, request: async (path, body) => // 업로드 요청 경계
    {
        calls.push({ path, body }); // 실제 요청 보관
        return { message: { id: "2", conversation_id: "7", user_id: "1", username: "alice", content: "파일: 문서.txt", created_at: "2026-11-11T00:00:00Z" }, attachment: { id: "9", message_id: "2", original_name: "문서.txt", file_size: 4 } }; // 저장된 파일 응답
    } });
    assert.equal(calls.length, 1); // 자동 재전송 없음
    assert.equal(calls[0].body.get("kind"), "direct"); // 대화 유형
    assert.equal(calls[0].body.get("target_id"), "7"); // 대상 식별자
    assert.equal(calls[0].body.get("file").name, "문서.txt"); // 실제 선택 파일
    assert.equal(result.attachment.message_id, "2"); // 저장 메시지와 파일 연결
});
test("빈 파일과 200 MB 초과 파일은 업로드 요청 없이 거절", async () => // 제한 밖 파일의 서버 전송 차단
{
    let requests = 0; // 실제 전송 수
    const request = async () => requests++; // 네트워크 요청 관찰
    await assert.rejects(uploadAttachment({ kind: "channel", targetId: "5", userId: "1", file: new File([], "빈파일.txt"), request })); // 빈 파일 거절
    await assert.rejects(uploadAttachment({ kind: "channel", targetId: "5", userId: "1", file: { size: 200000001 }, request })); // 메모리 할당 없는 초과 확인
    assert.equal(requests, 0); // 실제 업로드 요청 없음
});
test("첨부 기록은 200 MB 경계와 검증된 미리보기 형식을 사용", () => // 브라우저 표시와 이전 첨부 호환
{
    const limits = { id: "1", message_id: "2", original_name: "파일", file_size: 200000000 }; // 최대 크기의 첨부
    assert.equal(validAttachment(limits), true); // 이전 형식과 정확한 상한 허용
    assert.equal(validAttachment({ ...limits, file_size: 200000001 }), false); // 초과한 서버 응답 거절
    assert.equal(validAttachment({ ...limits, preview_mime: "image/svg+xml" }), false); // 실행 가능 이미지 형식 제외
    const element = (tagName) => ({ tagName }); // 표시 요소와 속성만 관측
    const [preview, download] = createAttachmentElements({ ...limits, preview_mime: "image/webp" }, element); // 허용 이미지와 원본
    assert.equal(preview.tagName, "img"); // 실제 이미지 요소
    assert.match(preview.src, /download_attachment\.php\?id=1&preview=1$/); // 보호된 읽기 경로
    assert.equal(download.tagName, "a"); // 원본 다운로드 링크
    assert.deepEqual(createAttachmentElements(limits, element), [download]); // 이전 파일 다운로드 유지
});
