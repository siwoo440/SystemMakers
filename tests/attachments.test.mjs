import assert from "node:assert/strict"; // 응답 검증
import { execFileSync } from "node:child_process"; // 변경 도구 실행
import { readFileSync } from "node:fs"; // 스키마 파일 읽기
import path from "node:path"; // 실행 경로 조합
import test from "node:test"; // 통합 검사
import { fixture } from "./helpers/management-fixture.mjs"; // 격리된 검사 환경

test("개인 대화의 파일 저장과 다운로드 권한", async (context) => // 실제 파일 전송 검사
{
    const environment = await fixture(context); // 독립 DB와 웹 서버
    execFileSync(environment.php, ["-c", process.env.PHP_TEST_INI || path.join(environment.root, ".runtime/php.ini"), path.join(environment.root, "scripts/migrate-002.php")], { env: environment.env, windowsHide: true }); // 개인 대화 구조 적용
    environment.sql(readFileSync(path.join(environment.root, "backend/sql/migrations/004_attachments.sql"), "utf8")); // 첨부 구조 적용
    const alice = await environment.account("file_alice"); // 파일 전송 사용자
    const bob = await environment.account("file_bob"); // 상대 사용자
    const outsider = await environment.account("file_outsider"); // 외부 사용자
    const conversationId = (await alice.request("create_dm.php", { user_id: bob.id })).data.conversation.id; // 개인 대화 생성
    const form = new FormData(); // 파일 전송 본문
    form.append("kind", "direct"); // 개인 대화 구분
    form.append("target_id", conversationId); // 대화 식별자
    form.append("file", new Blob(["<?php echo 'test'; ?>"]), "한글.php"); // 실행되지 않아야 하는 파일
    const upload = await fetch(environment.origin + "/Team006/backend/api/upload_attachment.php", { method: "POST", headers: { Cookie: alice.cookie, "X-Expected-User-Id": alice.id, "X-CSRF-Token": alice.token }, body: form }); // 인증된 첨부 전송
    assert.equal(upload.status, 201); // 파일과 메시지 저장 성공
    const saved = (await upload.json()).data; // 저장 결과
    assert.equal(saved.attachment.original_name, "한글.php"); // 한글 파일 이름 보존
    const listed = await bob.request("list_attachments.php?kind=direct&target_id=" + conversationId + "&message_ids=" + saved.message.id); // 상대방 메타데이터 조회
    assert.equal(listed.data.attachments[0].id, saved.attachment.id); // 실제 파일 연결
    const download = await fetch(environment.origin + "/Team006/backend/api/download_attachment.php?id=" + saved.attachment.id, { headers: { Cookie: bob.cookie, "X-Expected-User-Id": bob.id } }); // 참여자 다운로드
    assert.equal(download.status, 200); // 다운로드 허용
    assert.match(download.headers.get("content-disposition"), /^attachment;/); // 무조건 다운로드 처리
    assert.equal(await download.text(), "<?php echo 'test'; ?>"); // 원본 바이트 보존
    const denied = await fetch(environment.origin + "/Team006/backend/api/download_attachment.php?id=" + saved.attachment.id, { headers: { Cookie: outsider.cookie, "X-Expected-User-Id": outsider.id } }); // 제3자 다운로드
    assert.equal(denied.status, 403); // 제3자 접근 차단
    environment.sql("INSERT INTO user_blocks (blocker_id,blocked_id) VALUES (" + bob.id + "," + alice.id + ")"); // 양방향 전송 차단
    const blockedForm = new FormData(); // 차단 이후 전송 본문
    blockedForm.append("kind", "direct"); // 개인 대화 구분
    blockedForm.append("target_id", conversationId); // 동일 대화
    blockedForm.append("file", new Blob(["blocked"]), "blocked.txt"); // 차단 대상 파일
    const blocked = await fetch(environment.origin + "/Team006/backend/api/upload_attachment.php", { method: "POST", headers: { Cookie: alice.cookie, "X-Expected-User-Id": alice.id, "X-CSRF-Token": alice.token }, body: blockedForm }); // 차단 이후 실제 요청
    assert.equal(blocked.status, 403); // 차단 중 파일 전송 거절
    assert.equal(environment.sql("SELECT COUNT(*) FROM message_attachments"), "1"); // 차단 파일 미저장
}); // 첨부 통합 검사 끝

test("채널 파일 접근과 업로드 크기 제한", async (context) => // 실제 채널 파일 검사
{
    const environment = await fixture(context); // 독립 DB와 웹 서버
    environment.migrate(); // 기존 서버 관리 구조
    execFileSync(environment.php, ["-c", process.env.PHP_TEST_INI || path.join(environment.root, ".runtime/php.ini"), path.join(environment.root, "scripts/migrate-002.php")], { env: environment.env, windowsHide: true }); // 개인 대화 구조
    execFileSync(environment.php, ["-c", process.env.PHP_TEST_INI || path.join(environment.root, ".runtime/php.ini"), path.join(environment.root, "scripts/migrate-004.php")], { env: environment.env, windowsHide: true }); // 보존형 첨부 구조
    const owner = await environment.account("file_owner"); // 채널 소유자
    const outsider = await environment.account("file_other"); // 외부 사용자
    const channelId = (await owner.request("create_server.php", { name: "파일 검사" })).data.channel.id; // 실제 기본 채널
    const uploadFile = async (session, data, csrf = session.token) => // 실제 첨부 요청
    {
        const form = new FormData(); // 브라우저 파일 본문
        form.append("kind", "channel"); // 채널 구분
        form.append("target_id", channelId); // 대상 채널
        form.append("file", new Blob([data]), "검사.txt"); // 검사 파일
        return fetch(environment.origin + "/Team006/backend/api/upload_attachment.php", { method: "POST", headers: { Cookie: session.cookie, "X-Expected-User-Id": session.id, "X-CSRF-Token": csrf }, body: form }); // 실제 인증 요청
    }; // 전송 함수 끝
    assert.equal((await uploadFile(owner, "파일", "wrong")).status, 403); // CSRF 검사
    assert.equal((await uploadFile(outsider, "외부")).status, 403); // 채널 외부 전송 금지
    assert.equal((await uploadFile(owner, "")).status, 422); // 빈 파일 거절
    assert.equal((await uploadFile(owner, new Uint8Array(5242881))).status, 422); // 5 MiB 초과 거절
    const uploaded = await uploadFile(owner, new Uint8Array(5242880)); // 정확히 5 MiB 전송
    assert.equal(uploaded.status, 201); // 최대 크기 허용
    const saved = (await uploaded.json()).data; // 저장된 첨부 정보
    assert.equal(saved.attachment.file_size, 5242880); // 실제 바이트 기록
    assert.equal((await outsider.request("list_attachments.php?kind=channel&target_id=" + channelId + "&message_ids=" + saved.message.id)).status, 403); // 다른 사용자 목록 조회 차단
    assert.equal((await owner.request("get_messages.php?channel_id=" + channelId)).data.messages[0].id, saved.message.id); // 기존 채널 기록과 연결
    assert.equal(environment.sql("SELECT COUNT(*) FROM message_attachments"), "1"); // 잘못된 요청의 부분 저장 없음
    assert.throws(() => execFileSync(environment.php, ["-c", process.env.PHP_TEST_INI || path.join(environment.root, ".runtime/php.ini"), path.join(environment.root, "scripts/migrate-004.php")], { env: environment.env, windowsHide: true, stdio: "pipe" })); // 재적용과 데이터 덮어쓰기 차단
}); // 채널 첨부 검사 끝
