import assert from "node:assert/strict"; // 응답 검증
import { execFileSync } from "node:child_process"; // 실제 변경 도구 실행
import path from "node:path"; // 실행 경로 조합
import test from "node:test"; // 통합 검사
import { fixture } from "./helpers/management-fixture.mjs"; // 독립 DB와 서버

test("친구 요청은 상대방 수락 후 양쪽에 표시", async (context) => // 실제 API와 DB 검사
{
    const environment = await fixture(context); // 격리된 테스트 환경
    for (const migration of ["002", "003", "004", "005"]) // 선행 변경 순서
    {
        execFileSync(environment.php, ["-c", process.env.PHP_TEST_INI || path.join(environment.root, ".runtime/php.ini"), path.join(environment.root, "scripts/migrate-" + migration + ".php")], { env: environment.env, windowsHide: true }); // 보존형 변경 적용
    }
    const alice = await environment.account("friend_alice"); // 첫 사용자
    const bob = await environment.account("friend_bob"); // 둘째 사용자
    const outsider = await environment.account("friend_other"); // 제3자
    assert.equal((await alice.request("friends.php", { action: "request", user_id: alice.id })).status, 422); // 본인 요청 거절
    assert.equal((await alice.request("friends.php", { action: "request", user_id: bob.id }, { "X-CSRF-Token": "wrong" })).status, 403); // 보호 토큰 확인
    assert.equal((await alice.request("friends.php", { action: "request", user_id: bob.id })).status, 200); // 친구 요청
    assert.deepEqual((await alice.request("friends.php")).data.outgoing.map((user) => user.id), [bob.id]); // 보낸 요청만 표시
    assert.deepEqual((await bob.request("friends.php")).data.incoming.map((user) => user.id), [alice.id]); // 상대방의 받은 요청
    assert.equal((await bob.request("friends.php")).data.friends.length, 0); // 수락 전 친구 미표시
    assert.equal((await alice.request("friends.php", { action: "accept", user_id: bob.id })).status, 409); // 요청자 본인 수락 차단
    assert.equal((await outsider.request("friends.php", { action: "accept", user_id: alice.id })).status, 409); // 제3자 수락 차단
    assert.equal((await bob.request("friends.php", { action: "accept", user_id: alice.id })).status, 200); // 상대방 수락
    assert.deepEqual((await alice.request("friends.php")).data.friends.map((user) => user.id), [bob.id]); // 요청자 친구 목록
    assert.deepEqual((await bob.request("friends.php")).data.friends.map((user) => user.id), [alice.id]); // 수락자 친구 목록
    assert.equal((await alice.request("friends.php", { action: "remove", user_id: bob.id })).status, 200); // 친구 관계 제거
    assert.equal((await bob.request("friends.php")).data.friends.length, 0); // 양쪽 관계 제거
    assert.equal((await alice.request("friends.php", { action: "request", user_id: bob.id })).status, 200); // 다시 요청
    environment.sql("INSERT INTO user_blocks (blocker_id,blocked_id) VALUES (" + bob.id + "," + alice.id + ")"); // 수락 전 차단
    assert.equal((await bob.request("friends.php", { action: "accept", user_id: alice.id })).status, 403); // 차단된 관계 수락 거절
    assert.equal((await bob.request("friends.php")).data.friends.length, 0); // 차단 중 친구 미생성
    assert.equal((await bob.request("friends.php", { action: "decline", user_id: alice.id })).status, 200); // 차단 중 요청 거절 가능
    environment.sql("DELETE FROM user_blocks"); // 독립 검사 DB의 차단 해제
    assert.equal((await alice.request("friends.php", { action: "request", user_id: bob.id })).status, 200); // 경합 검사 요청
    const release = await environment.hold("SELECT id FROM users WHERE id=" + alice.id + " FOR UPDATE", "INSERT INTO user_blocks (blocker_id,blocked_id) VALUES (" + bob.id + "," + alice.id + ")"); // 차단 전 사용자 잠금
    const pendingAccept = bob.request("friends.php", { action: "accept", user_id: alice.id }); // 차단 중 수락 경합
    await new Promise((resolve) => setTimeout(resolve, 200)); // 잠금 대기 진입
    await release(); // 차단 확정
    assert.equal((await pendingAccept).status, 403); // 확정된 차단 이후 수락 거절
    assert.equal((await bob.request("friends.php")).data.friends.length, 0); // 경합 중 친구 미생성
    assert.throws(() => execFileSync(environment.php, ["-c", process.env.PHP_TEST_INI || path.join(environment.root, ".runtime/php.ini"), path.join(environment.root, "scripts/migrate-005.php")], { env: environment.env, windowsHide: true, stdio: "pipe" })); // 재적용과 기존 관계 덮어쓰기 차단
}); // 친구 관계 검사 끝
