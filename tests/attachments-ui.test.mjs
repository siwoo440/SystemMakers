import assert from "node:assert/strict"; // 결과 검사
import test from "node:test"; // 기본 검사 도구
import { createAttachmentView, uploadAttachment } from "../frontend/attachments-ui.mjs"; // 실제 첨부 화면 경계
test("첨부 정보는 메시지별 최대 50건으로 조회하며 중복 요청을 피함", async () => // 제한 초과와 반복 조회 차단
{
    const calls = []; // 실제 메타데이터 요청
    const view = createAttachmentView({ kind: "direct", targetId: "7", userId: "1", getUser: () => ({ id: "1" }), request: async (path) => // 권한 검사 요청 경계
    {
        calls.push(path); // 요청 주소 기록
        return { attachments: [] }; // 첨부 없는 메시지
    }, onChange: () => undefined, onError: () => undefined }); // 화면 경계 연결
    const messages = Array.from({ length: 51 }, (_, index) => ({ id: String(index + 1) })); // 두 묶음이 필요한 기록
    await view.load(messages); // 모든 표시 기록 확인
    await view.load(messages); // 동일 기록 재확인
    assert.equal(calls.length, 2); // 최대 50건 분할과 중복 방지
    assert.equal(new URL(calls[0], "https://example.test").searchParams.get("message_ids").split(",").length, 50); // 첫 요청 상한
    view.stop(); // 조회 수명 정리
}); // 묶음 조회 검사 끝
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
}); // 첨부 수명 검사 끝
test("파일 업로드는 대상과 파일을 multipart 본문으로 한 번 전달", async () => // 잘못된 대화와 재전송 차단
{
    const calls = []; // 실제 업로드 요청
    const file = new File(["data"], "문서.txt", { type: "text/plain" }); // 실제 파일
    const result = await uploadAttachment({ kind: "direct", targetId: "7", userId: "1", file, request: async (path, body) => // 업로드 요청 경계
    {
        calls.push({ path, body }); // 실제 요청 보관
        return { message: { id: "2", conversation_id: "7", user_id: "1", username: "alice", content: "파일: 문서.txt", created_at: "2026-11-11T00:00:00Z" }, attachment: { id: "9", message_id: "2", original_name: "문서.txt", file_size: 4 } }; // 저장된 파일 응답
    } }); // 업로드 완료
    assert.equal(calls.length, 1); // 자동 재전송 없음
    assert.equal(calls[0].body.get("kind"), "direct"); // 대화 유형
    assert.equal(calls[0].body.get("target_id"), "7"); // 대상 식별자
    assert.equal(calls[0].body.get("file").name, "문서.txt"); // 실제 선택 파일
    assert.equal(result.attachment.message_id, "2"); // 저장 메시지와 파일 연결
}); // 파일 전송 검사 끝
test("빈 파일과 5 MiB 초과 파일은 업로드 요청 없이 거절", async () => // 제한 밖 파일의 서버 전송 차단
{
    let requests = 0; // 실제 전송 수
    const request = async () => requests++; // 네트워크 요청 관찰
    await assert.rejects(uploadAttachment({ kind: "channel", targetId: "5", userId: "1", file: new File([], "빈파일.txt"), request })); // 빈 파일 거절
    await assert.rejects(uploadAttachment({ kind: "channel", targetId: "5", userId: "1", file: new File([new Uint8Array(5242881)], "큰파일.bin"), request })); // 상한 초과 거절
    assert.equal(requests, 0); // 실제 업로드 요청 없음
}); // 업로드 크기 검사 끝
