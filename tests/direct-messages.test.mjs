import assert from "node:assert/strict"; // 실제 응답 검증
import { execFileSync, spawn } from "node:child_process"; // 변경 도구와 웹 서버
import { createServer } from "node:net"; // 빈 포트 확보
import path from "node:path"; // 실행 경로 조합
import test from "node:test"; // 검사 실행
import { fixture } from "./helpers/management-fixture.mjs"; // 격리된 실제 DB

test("개인 대화의 참여자 권한과 차단 경계", async (context) => // 실제 API 통합 검사
{
    const environment = await fixture(context); // 독립 검사 환경
    execFileSync(environment.php, ["-c", process.env.PHP_TEST_INI || path.join(environment.root, ".runtime/php.ini"), path.join(environment.root, "scripts/migrate-002.php")], { env: environment.env, encoding: "utf8", windowsHide: true }); // 보존형 변경 적용
    const alice = await environment.account("dm_alice"); // 첫 참여자
    const bob = await environment.account("dm_bob"); // 둘째 참여자
    const outsider = await environment.account("dm_outsider"); // 제3자
    const search = await alice.request("search_users.php?q=dm_bob"); // 사용자 검색
    assert.deepEqual(search.data.users, [{ id: bob.id, username: "dm_bob" }]); // 비밀 없는 검색 결과
    assert.equal((await alice.request("create_dm.php", { user_id: alice.id })).status, 422); // 본인 대화 거절
    const probe = createServer(); // 임시 포트 탐색
    await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve)); // 빈 포트 할당
    const secondPort = probe.address().port; // 둘째 서버 포트
    await new Promise((resolve) => probe.close(resolve)); // 탐색 서버 종료
    const secondServer = spawn(environment.php, ["-c", process.env.PHP_TEST_INI || path.join(environment.root, ".runtime/php.ini"), "-d", "session.save_path=" + path.join(environment.root, ".runtime", environment.env.MYSQL_DATABASE), "-S", "127.0.0.1:" + secondPort, path.join(environment.root, "router.php")], { env: environment.env, windowsHide: true, stdio: "ignore" }); // 독립 PHP 프로세스
    context.after(() => secondServer.kill()); // 검사 후 둘째 서버 종료
    for (let attempt = 0; attempt < 100; attempt++) // 둘째 서버 준비 대기
    {
        try // 실제 HTTP 연결 검사
        {
            await fetch("http://127.0.0.1:" + secondPort + "/api/health.php"); // 준비 확인
            break; // 연결 성공
        }
        catch // 서버 시작 중
        {
            await new Promise((resolve) => setTimeout(resolve, 25)); // 재검사 간격
        }
    }
    const releaseCreation = await environment.hold("SELECT id FROM users WHERE id=" + alice.id + " FOR UPDATE"); // 두 생성 요청의 공통 잠금
    const firstCreation = alice.request("create_dm.php", { user_id: bob.id }); // 첫 프로세스 생성 요청
    const secondCreation = fetch("http://127.0.0.1:" + secondPort + "/api/create_dm.php", { method: "POST", headers: { Cookie: bob.cookie, "X-Expected-User-Id": bob.id, "Content-Type": "application/json", "X-CSRF-Token": bob.token }, body: JSON.stringify({ user_id: alice.id }), signal: AbortSignal.timeout(5000) }); // 둘째 프로세스 역방향 요청
    await new Promise((resolve) => setTimeout(resolve, 200)); // 생성 요청의 잠금 대기
    await releaseCreation(); // 동시 생성 진행
    const [created, concurrentResponse] = await Promise.all([firstCreation, secondCreation]); // 두 생성 결과
    const concurrent = await concurrentResponse.json(); // 둘째 생성 응답
    assert.equal(created.status, 201); // 생성 성공
    const conversationId = created.data.conversation.id; // 생성 대화 ID
    assert.equal(concurrentResponse.status, 201); // 경합 요청 성공
    assert.equal(concurrent.data.conversation.id, conversationId); // 경합 결과 동일 대화
    const reused = await bob.request("create_dm.php", { user_id: alice.id }); // 역방향 생성 요청
    assert.equal(reused.data.conversation.id, conversationId); // 대화 재사용
    assert.equal(environment.sql("SELECT COUNT(*) FROM direct_conversations"), "1"); // 중복 대화 없음
    assert.equal((await environment.client().request("list_dms.php")).status, 401); // 비로그인 목록 거절
    assert.equal((await alice.request("send_dm.php", { conversation_id: conversationId, content: "위조", user_id: bob.id })).status, 422); // 작성자 위조 거절
    assert.equal((await alice.request("create_dm.php", { user_id: "18446744073709551615" })).status, 404); // 없는 큰 사용자 ID
    assert.equal((await alice.request("get_dm_messages.php?conversation_id=" + conversationId + "&before_id=1&after_id=0")).status, 400); // 상충 커서 거절
    assert.equal((await alice.request("list_dms.php")).data.conversations[0].other_user.id, bob.id); // 상대방 목록
    assert.equal((await bob.request("list_dms.php")).data.conversations[0].other_user.id, alice.id); // 역방향 상대방 목록
    assert.equal((await outsider.request("get_dm_messages.php?conversation_id=" + conversationId)).status, 403); // 제3자 조회 차단
    assert.equal((await outsider.request("send_dm.php", { conversation_id: conversationId, content: "침입" })).status, 403); // 제3자 전송 차단
    const first = await alice.request("send_dm.php", { conversation_id: conversationId, content: "첫 메시지" }); // 첫 참여자 저장
    const second = await bob.request("send_dm.php", { conversation_id: conversationId, content: "답장" }); // 둘째 참여자 저장
    assert.equal(first.status, 201); // 첫 메시지 생성
    assert.equal(second.data.message.user_id, bob.id); // 인증된 작성자
    const latest = (await bob.request("get_dm_messages.php?conversation_id=" + conversationId + "&limit=1")).data; // 최신 페이지
    assert.equal(latest.messages[0].id, second.data.message.id); // 최신 메시지
    const earlier = (await alice.request("get_dm_messages.php?conversation_id=" + conversationId + "&before_id=" + latest.pagination.next_before_id)).data; // 이전 페이지
    assert.deepEqual(earlier.messages.map((message) => message.id), [first.data.message.id]); // 중복 없는 이전 메시지
    const after = (await alice.request("get_dm_messages.php?conversation_id=" + conversationId + "&after_id=" + first.data.message.id)).data; // 신규 페이지
    assert.deepEqual(after.messages.map((message) => message.id), [second.data.message.id]); // 중복 없는 신규 메시지
    environment.sql("INSERT INTO user_blocks (blocker_id,blocked_id) VALUES (" + bob.id + "," + alice.id + ")"); // 둘째 참여자의 차단
    assert.equal((await alice.request("send_dm.php", { conversation_id: conversationId, content: "거절" })).status, 403); // 차단당한 쪽 전송 거절
    assert.equal((await bob.request("send_dm.php", { conversation_id: conversationId, content: "거절" })).status, 403); // 차단한 쪽 전송 거절
    assert.equal((await bob.request("get_dm_messages.php?conversation_id=" + conversationId)).data.messages.length, 2); // 기존 대화 보존
    environment.sql("DELETE FROM user_blocks"); // 차단 해제
    assert.equal((await alice.request("send_dm.php", { conversation_id: conversationId, content: "복구" })).status, 201); // 차단 해제 후 전송
    const release = await environment.hold("SELECT id FROM users WHERE id=" + alice.id + " FOR UPDATE", "INSERT INTO user_blocks (blocker_id,blocked_id) VALUES (" + bob.id + "," + alice.id + ")"); // 차단 직전 참여자 잠금
    const pending = alice.request("send_dm.php", { conversation_id: conversationId, content: "경합" }); // 차단 중 전송 경합
    await new Promise((resolve) => setTimeout(resolve, 200)); // 잠금 대기 진입
    await release(); // 차단 커밋
    assert.equal((await pending).status, 403); // 커밋된 차단 검사
    assert.equal(environment.sql("SELECT COUNT(*) FROM direct_messages"), "3"); // 차단 경합 중 무저장
    environment.sql("DELETE FROM user_blocks; CREATE TRIGGER dm_test_failure BEFORE INSERT ON direct_messages FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='private_dm_failure'"); // 실제 저장 장애 재현
    const failed = await alice.request("send_dm.php", { conversation_id: conversationId, content: "실패" }); // 저장 장애 요청
    assert.equal(failed.status, 500); // 내부 오류 응답
    assert.doesNotMatch(JSON.stringify(failed), /private_dm_failure|PDO|SQLSTATE/); // 내부 원인 비노출
    assert.equal(environment.sql("SELECT COUNT(*) FROM direct_messages"), "3"); // 실패 저장 롤백
    environment.sql("DROP TRIGGER dm_test_failure"); // 장애 제거
    assert.equal((await bob.request("send_dm.php", { conversation_id: conversationId, content: "정상" })).status, 201); // 실패 후 잠금 해제
}); // 개인 대화 통합 검사 끝

test("개인 대화 변경의 기존 자료 보존과 재적용 차단", async (context) => // 실제 DDL 상태 검사
{
    const environment = await fixture(context); // 독립 검사 환경
    const alice = await environment.account("migration_alice"); // 기존 계정
    const migration = () => execFileSync(environment.php, ["-c", process.env.PHP_TEST_INI || path.join(environment.root, ".runtime/php.ini"), path.join(environment.root, "scripts/migrate-002.php")], { env: environment.env, encoding: "utf8", windowsHide: true, stdio: "pipe" }); // 실제 변경 실행
    migration(); // 최초 변경 적용
    assert.equal(environment.sql("SELECT username FROM users WHERE id=" + alice.id), "migration_alice"); // 기존 계정 보존
    assert.throws(migration); // 재적용 중단
    assert.equal(environment.sql("SELECT COUNT(*) FROM users"), "1"); // 재적용 실패 후 자료 보존
}); // 보존형 변경 검사 끝

test("개인 대화 변경의 부분 적용 감지", async (context) => // 불완전한 DDL 재실행 차단
{
    const environment = await fixture(context); // 독립 검사 환경
    environment.sql("CREATE TABLE user_blocks (placeholder INT)"); // 부분 적용 상태 재현
    assert.throws(() => execFileSync(environment.php, ["-c", process.env.PHP_TEST_INI || path.join(environment.root, ".runtime/php.ini"), path.join(environment.root, "scripts/migrate-002.php")], { env: environment.env, encoding: "utf8", windowsHide: true, stdio: "pipe" })); // 부분 상태 거절
    assert.equal(environment.sql("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='direct_conversations'"), "0"); // 추가 DDL 미실행
}); // 부분 적용 검사 끝
