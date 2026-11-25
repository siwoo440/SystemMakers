import assert from "node:assert/strict"; // 응답 검증
import { execFileSync } from "node:child_process"; // 변경 도구 실행
import { readFileSync, readdirSync } from "node:fs"; // 스키마와 실제 저장 파일 확인
import path from "node:path"; // 실행 경로 조합
import test from "node:test"; // 통합 검사
import { fixture } from "./helpers/management-fixture.mjs"; // 격리된 검사 환경
import { uploadMultipart } from "./helpers/attachment-upload.mjs"; // 200 MB의 제한된 메모리 전송

test("개인 대화의 파일 저장과 다운로드 권한", async (context) => // 실제 파일 전송 검사
{
    const environment = await fixture(context); // 독립 DB와 웹 서버
    execFileSync(environment.php, ["-c", process.env.PHP_TEST_INI || path.join(environment.root, ".runtime/php.ini"), path.join(environment.root, "scripts/migrate-002.php")], { env: environment.env, windowsHide: true }); // 개인 대화 구조 적용
    environment.sql(readFileSync(path.join(environment.root, "backend/sql/migrations/004_attachments.sql"), "utf8")); // 첨부 구조 적용
    environment.sql(readFileSync(path.join(environment.root, "backend/sql/migrations/006_attachment_storage.sql"), "utf8")); // 파일 저장소 구조 적용
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
    const historyUrl = "get_dm_messages.php?conversation_id=" + conversationId + "&include_attachments=1"; // 첨부 포함 개인 기록
    const history = await bob.request(historyUrl); // 참여자의 기록 조회
    assert.equal(history.status, 200); // 메타데이터 포함 조회 성공
    assert.deepEqual(history.data.messages[0].attachment, saved.attachment); // 파일 본문 없는 공개 정보
    assert.equal((await outsider.request(historyUrl)).status, 403); // 개인 대화 제삼자 거절
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
});

test("검증한 PNG·JPEG·WebP만 보호된 미리보기와 기존 BLOB 보존", async (context) => // 이미지와 이관 호환성 검사
{
    const environment = await fixture(context); // 독립 DB와 파일 저장소
    environment.migrate(); // 서버 관리 구조 적용
    environment.sql(readFileSync(path.join(environment.root, "backend/sql/migrations/002_direct_messages.sql"), "utf8")); // 개인 대화 구조 적용
    environment.sql(readFileSync(path.join(environment.root, "backend/sql/migrations/004_attachments.sql"), "utf8")); // 기존 BLOB 구조 적용
    const owner = await environment.account("preview_owner"); // 채널 소유자
    const outsider = await environment.account("preview_other"); // 미소속 사용자
    const channelId = (await owner.request("create_server.php", { name: "이미지 검사" })).data.channel.id; // 실제 채널
    environment.sql("INSERT INTO messages(channel_id,user_id,content) VALUES(" + channelId + "," + owner.id + ",'legacy'); INSERT INTO message_attachments(channel_message_id,original_name,file_size,file_data) VALUES(LAST_INSERT_ID(),'old.bin',3,X'00FF01')"); // 기존 바이너리 원본
    const legacyId = environment.sql("SELECT id FROM message_attachments"); // 이관 이전 첨부 번호
    environment.sql(readFileSync(path.join(environment.root, "backend/sql/migrations/006_attachment_storage.sql"), "utf8")); // 바이트 이동 없는 구조 변경
    const legacyDownload = await fetch(environment.origin + "/Team006/backend/api/download_attachment.php?id=" + legacyId, { headers: { Cookie: owner.cookie } }); // 기존 BLOB 다운로드
    assert.equal(legacyDownload.status, 200); // 기존 원본 접근 유지
    assert.deepEqual(Buffer.from(await legacyDownload.arrayBuffer()), Buffer.from([0, 255, 1])); // 기존 바이너리 보존
    for (const format of ["png", "jpeg", "webp", "svg", "fake"]) // 검증한 이미지와 비허용 파일
    {
        let bytes; // 실제 업로드 원본
        if (["png", "jpeg", "webp"].includes(format)) // 허용한 실제 이미지 준비
        {
            const source = '$image=imagecreatetruecolor(2,2); image' + format + '($image); imagedestroy($image);'; // 해당 GD 인코더
            bytes = execFileSync(environment.php, ["-c", process.env.PHP_TEST_INI || path.join(environment.root, ".runtime/php.ini"), "-r", source], { windowsHide: true }); // 실제 이미지 바이트
        }
        else // 파일 확장자와 내용 위조 준비
        {
            bytes = Buffer.from(format === "svg" ? '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' : 'not a PNG'); // 원본 다운로드 전용 내용
        }
        const form = new FormData(); // 실제 업로드 본문
        form.append("kind", "channel"); // 채널 첨부 종류
        form.append("target_id", channelId); // 승인한 대화
        form.append("file", new Blob([bytes], { type: "image/png" }), format + ".png"); // 신뢰하지 않는 브라우저 MIME과 확장자
        const uploaded = await fetch(environment.origin + "/Team006/backend/api/upload_attachment.php", { method: "POST", headers: { Cookie: owner.cookie, "X-Expected-User-Id": owner.id, "X-CSRF-Token": owner.token }, body: form }); // 실제 업로드 요청
        assert.equal(uploaded.status, 201); // 형식과 무관한 원본 파일 보존
        const attachment = (await uploaded.json()).data.attachment; // 저장된 공개 메타데이터
        const expectedMime = ["png", "jpeg", "webp"].includes(format) ? "image/" + format : null; // 실제 내용 기반 형식
        assert.equal(attachment.preview_mime, expectedMime); // 위조된 MIME 무시
        assert.equal(Object.hasOwn(attachment, "storage_key"), false); // 비공개 저장 키 비노출
        const url = environment.origin + "/Team006/backend/api/download_attachment.php?id=" + attachment.id; // 보호된 원본 API
        const preview = await fetch(url + "&preview=1", { headers: { Cookie: owner.cookie } }); // 보호된 미리보기 요청
        assert.equal(preview.status, expectedMime ? 200 : 404); // 실제 검증한 이미지만 inline 승인
        if (expectedMime) // 검증한 이미지 응답 검사
        {
            assert.equal(preview.headers.get("content-type"), expectedMime); // 서버 검증 MIME 적용
            assert.match(preview.headers.get("content-disposition"), /^inline;/); // 브라우저 이미지 표시
            assert.deepEqual(Buffer.from(await preview.arrayBuffer()), bytes); // 원본 이미지 바이트 보존
        }
        assert.equal((await fetch(url + "&preview=1", { headers: { Cookie: outsider.cookie } })).status, 403); // 제삼자 이미지 접근 거절
        assert.equal((await fetch(url + "&preview=1")).status, 401); // 비로그인 이미지 접근 거절
        assert.equal((await fetch(url + "&preview=0", { headers: { Cookie: owner.cookie } })).status, 400); // 잘못된 미리보기 인수 거절
        const download = await fetch(url, { headers: { Cookie: owner.cookie } }); // 원본 강제 다운로드
        assert.equal(download.headers.get("content-type"), "application/octet-stream"); // 다운로드 실행 방지
        assert.match(download.headers.get("content-disposition"), /^attachment;/); // 원본 다운로드 유지
        assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes); // 모든 파일 원본 무결성
    }
    assert.equal(environment.sql("SELECT HEX(file_data) FROM message_attachments WHERE id=" + legacyId), "00FF01"); // 신규 업로드 후 기존 BLOB 보존
});

test("채널 파일 접근과 업로드 크기 제한", async (context) => // 실제 채널 파일 검사
{
    const environment = await fixture(context); // 독립 DB와 웹 서버
    environment.migrate(); // 기존 서버 관리 구조
    execFileSync(environment.php, ["-c", process.env.PHP_TEST_INI || path.join(environment.root, ".runtime/php.ini"), path.join(environment.root, "scripts/migrate-002.php")], { env: environment.env, windowsHide: true }); // 개인 대화 구조
    execFileSync(environment.php, ["-c", process.env.PHP_TEST_INI || path.join(environment.root, ".runtime/php.ini"), path.join(environment.root, "scripts/migrate-004.php")], { env: environment.env, windowsHide: true }); // 보존형 첨부 구조
    execFileSync(environment.php, ["-c", process.env.PHP_TEST_INI || path.join(environment.root, ".runtime/php.ini"), path.join(environment.root, "scripts/migrate-006.php")], { env: environment.env, windowsHide: true }); // 기존 첨부를 보존하는 파일 저장소 변경
    const owner = await environment.account("file_owner"); // 채널 소유자
    const outsider = await environment.account("file_other"); // 외부 사용자
    const channelId = (await owner.request("create_server.php", { name: "파일 검사" })).data.channel.id; // 실제 기본 채널
    const uploadFile = async (session, data, csrf = session.token) => // 실제 첨부 요청
    {
        return uploadMultipart(environment.origin + "/Team006/backend/api/upload_attachment.php", session, "channel", channelId, typeof data === 'string' ? Buffer.from(data) : data, "검사.txt", csrf); // 실제 인증과 원본 스트림 요청
    };
    assert.equal((await uploadFile(owner, "파일", "wrong")).status, 403); // CSRF 검사
    assert.equal((await uploadFile(outsider, "외부")).status, 403); // 채널 외부 전송 금지
    assert.equal((await uploadFile(owner, "")).status, 422); // 빈 파일 거절
    const fullHttp = process.platform !== 'win32' || process.env.ATTACHMENT_FULL_HTTP_TEST === '1'; // Apache 검사와 명시적 Windows 전체 전송 구분
    const httpBytes = fullHttp ? 200000000 : 12000000; // Windows 개발 서버의 느린 본문 파싱을 구분한 실제 전송
    if (fullHttp) // 전체 대용량 HTTP 경계 검사 여부
    {
        assert.equal((await uploadFile(owner, new Uint8Array(200000001))).status, 422); // 정확한 200 MB 초과 거절
    }
    const uploaded = await uploadFile(owner, new Uint8Array(httpBytes)); // 이전 상한보다 큰 실제 파일 전송
    assert.equal(uploaded.status, 201); // 최대 크기 허용
    const saved = (await uploaded.json()).data; // 저장된 첨부 정보
    assert.equal(saved.attachment.file_size, httpBytes); // 실제 전송한 원본 바이트 기록
    assert.equal(environment.sql("SELECT file_data IS NULL FROM message_attachments"), "1"); // 대용량 BLOB 저장 방지
    assert.equal(readdirSync(environment.env.ATTACHMENT_STORAGE_DIR).length, 1); // 저장된 비공개 파일 한 개
    const downloaded = await fetch(environment.origin + "/Team006/backend/api/download_attachment.php?id=" + saved.attachment.id, { headers: { Cookie: owner.cookie } }); // 대용량 원본 다운로드
    assert.equal(downloaded.status, 200); // 스트리밍 다운로드 승인
    let downloadSize = 0; // 실제 수신 바이트 합계
    for await (const chunk of downloaded.body) // 전체 파일의 제한된 메모리 수신
    {
        assert.equal(chunk.every((byte) => byte === 0), true); // 원본 바이트 무결성
        downloadSize += chunk.length; // 실제 수신 크기 누적
    }
    assert.equal(downloadSize, httpBytes); // 전송한 원본 전체 수신
    const historyUrl = "get_messages.php?channel_id=" + channelId + "&include_attachments=1"; // 첨부 포함 채널 기록
    const history = await owner.request(historyUrl); // 소속 회원의 조회
    assert.equal(history.status, 200); // 첨부 포함 조회 성공
    assert.deepEqual(history.data.messages[0].attachment, saved.attachment); // 대용량 바이트를 제외한 파일 정보
    assert.equal((await outsider.request(historyUrl)).status, 403); // 다른 서버의 첨부 정보 거절
    assert.equal((await environment.client().request(historyUrl)).status, 401); // 로그인하지 않은 조회 거절
    await owner.request("send_message.php", { channel_id: channelId, content: "텍스트" }); // 파일 없는 메시지
    const newer = await owner.request(historyUrl + "&after_id=" + saved.message.id); // 신규 페이지 조회
    assert.equal(newer.data.messages[0].attachment, null); // 첨부 없는 상태를 명시
    const older = await owner.request(historyUrl + "&before_id=" + newer.data.messages[0].id); // 과거 페이지 조회
    assert.deepEqual(older.data.messages[0].attachment, saved.attachment); // 과거 페이지의 파일 연결
    assert.equal((await outsider.request("list_attachments.php?kind=channel&target_id=" + channelId + "&message_ids=" + saved.message.id)).status, 403); // 다른 사용자 목록 조회 차단
    assert.equal((await owner.request("get_messages.php?channel_id=" + channelId)).data.messages[0].id, saved.message.id); // 기존 채널 기록과 연결
    assert.equal(environment.sql("SELECT COUNT(*) FROM message_attachments"), "1"); // 잘못된 요청의 부분 저장 없음
    assert.throws(() => execFileSync(environment.php, ["-c", process.env.PHP_TEST_INI || path.join(environment.root, ".runtime/php.ini"), path.join(environment.root, "scripts/migrate-004.php")], { env: environment.env, windowsHide: true, stdio: "pipe" })); // 재적용과 데이터 덮어쓰기 차단
    assert.throws(() => execFileSync(environment.php, ["-c", process.env.PHP_TEST_INI || path.join(environment.root, ".runtime/php.ini"), path.join(environment.root, "scripts/migrate-006.php")], { env: environment.env, windowsHide: true, stdio: "pipe" })); // 저장소 변경의 재적용 차단
});
