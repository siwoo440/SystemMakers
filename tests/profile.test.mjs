import assert from "node:assert/strict"; // 공개 결과 검사
import test from "node:test"; // 기본 검사 도구
import { fixture } from "./helpers/management-fixture.mjs"; // 실제 PHP·독립 MySQL
test("10단계 본인 프로필의 조회·변경·보존", async (context) => // 공개 HTTP 인수
{
    const f = await fixture(context); // 검사 전용 무작위 DB
    f.migrate(); // 기존 8개 테이블
    const owner = await f.account("profile_owner"); // 변경할 계정
    const other = await f.account("profile_other"); // 보호할 타 계정
    const created = (await owner.request("create_server.php", { name: "프로필 검증" })).data; // 기존 소속 관계
    await owner.request("send_message.php", { channel_id: created.channel.id, content: "이름 변경 전 대화" }); // 보존할 대화
    const before = f.sql("SELECT id,email,password_hash,created_at FROM users ORDER BY id"); // 공개하지 않는 보존 비교
    const relations = f.sql("SELECT id,owner_id FROM servers; SELECT server_id,user_id,role,joined_at FROM server_members; SELECT id,channel_id,user_id,content,created_at FROM messages"); // 기존 관계 전체
    const patch = (actor, body, headers = {}) => actor.request("profile.php", body, headers, "PATCH"); // 명시한 변경 메서드
    await context.test("공개 경로·인증·메서드 우선 검사", async () => // 미구현 404 포착
    {
        assert.equal((await f.client().request("profile.php")).status, 401); // 본인 조회 인증
        assert.equal((await patch(f.client(), { username: "new_name" })).status, 401); // 변경 인증 우선
        assert.equal((await owner.request("profile.php", {})).status, 405); // POST 거절
    });
    await context.test("본인 공개 정보와 조회 조건 제한", async () => // 타인 정보와 비밀 차단
    {
        const response = await owner.request("profile.php"); // 실제 본인 조회
        assert.equal(response.status, 200); // 조회 성공
        assert.deepEqual(Object.keys(response.data.user).sort(), ["created_at", "email", "id", "username"]); // 공개 필드만
        assert.equal(response.data.user.id, owner.id); // 세션 기준 본인
        assert.equal(response.data.user.email, "profile_owner@example.test"); // 본인 이메일
        assert.match(response.data.user.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/); // UTC 시각
        assert.equal((await owner.request("profile.php?user_id=" + other.id)).status, 400); // 조회 대상 위조 거절
    });
    await context.test("CSRF·기대 계정·필드·사용자명 입력 검사", async () => // 우회 변경 방지
    {
        assert.equal((await patch(owner, { username: "new_name" }, { "X-CSRF-Token": "wrong" })).error.code, "CSRF_INVALID"); // 위조 요청
        assert.equal((await patch(owner, { username: "new_name" }, { "X-Expected-User-Id": other.id })).error.code, "SESSION_CHANGED"); // 계정 혼합
        for (const field of ["user_id", "email", "password", "role"]) // 허용하지 않는 변경
        {
            assert.equal((await patch(owner, { username: "new_name", [field]: other.id })).status, 422); // 대상·비밀·권한 변경 차단
        }
        for (const username of [null, 123, [], "ab", "한글이름", "has space", "a".repeat(33)]) // 가입과 같은 규칙
        {
            assert.equal((await patch(owner, { username })).status, 422); // 형식 오류
        }
        assert.equal((await patch(owner, {})).status, 422); // 필수 값
        assert.equal((await patch(owner, { username: "valid_name" }, { "Content-Type": "text/plain" })).status, 415); // JSON 유형
        assert.equal((await patch(owner, { username: "x".repeat(33000) })).status, 413); // 본문 크기
    });
    await context.test("정규화 변경·동일 이름 저장·기존 작성 관계 보존", async () => // 핵심 정상 흐름
    {
        const response = await patch(owner, { username: "  Profile_Changed  " }); // 대소문자와 공백
        assert.equal(response.status, 200); // 변경 성공
        assert.equal(response.data.user.username, "profile_changed"); // 기존 가입 정규화
        assert.equal(response.data.user.id, owner.id); // 계정 번호 보존
        assert.equal((await patch(owner, { username: "profile_changed" })).status, 200); // 영향 행 0도 정상
        assert.equal((await owner.request("get_current_user.php")).data.user.username, "profile_changed"); // 현재 세션 이름
        const messages = (await owner.request("get_messages.php?channel_id=" + created.channel.id)).data.messages; // 과거 대화 재조회
        assert.equal(messages[0].username, "profile_changed"); // 현재 작성자명 반영
        assert.equal(messages[0].user_id, owner.id); // 기존 작성자 번호
        assert.equal(f.sql("SELECT id,email,password_hash,created_at FROM users ORDER BY id"), before); // 이메일·암호·가입일 불변
        assert.equal(f.sql("SELECT id,owner_id FROM servers; SELECT server_id,user_id,role,joined_at FROM server_members; SELECT id,channel_id,user_id,content,created_at FROM messages"), relations); // 소속·대화 보존
    });
    await context.test("다른 계정과 대소문자 중복은 409", async () => // 고유 이름 보호
    {
        const response = await patch(owner, { username: "PROFILE_OTHER" }); // 다른 계정의 정규화 이름
        assert.equal(response.status, 409); // 중복 거절
        assert.equal(response.error.code, "USERNAME_TAKEN"); // 기존 계약
        assert.equal((await other.request("profile.php")).data.user.username, "profile_other"); // 타 계정 보존
        assert.equal((await owner.request("profile.php")).data.user.username, "profile_changed"); // 기존 이름 보존
    });
    await context.test("잠금 대기 중 중복 발생도 부분 변경 없음", async () => // 사전 검사 뒤 경쟁 포착
    {
        const release = await f.hold("SELECT id FROM users WHERE id=" + owner.id + " FOR UPDATE", "UPDATE users SET username='profile_race' WHERE id=" + other.id); // 다른 연결의 동시 이름 선점
        const pending = patch(owner, { username: "profile_race" }); // 대기할 실제 변경
        await new Promise((resolve) => setTimeout(resolve, 150)); // 실제 요청 진입 기회
        await release(); // 선점 커밋
        assert.equal((await pending).error.code, "USERNAME_TAKEN"); // DB UNIQUE 경합 변환
        assert.equal((await owner.request("profile.php")).data.user.username, "profile_changed"); // 원래 변경 보존
    });
    await context.test("강제 DB 실패는 500과 기존 이름 보존", async () => // 성공 추정과 부분 변경 방지
    {
        f.sql("CREATE TRIGGER reject_profile BEFORE UPDATE ON users FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test failure'"); // 검사 전용 실패
        const response = await patch(owner, { username: "failed_change" }); // 실제 DB 오류
        f.sql("DROP TRIGGER reject_profile"); // 다음 검사 복구
        assert.equal(response.status, 500); // 공통 내부 오류
        assert.equal((await owner.request("profile.php")).data.user.username, "profile_changed"); // 변경 미확정
        assert.equal(f.sql("SELECT id,email,password_hash,created_at FROM users ORDER BY id"), before); // 민감 필드 보존
    });
    await context.test("변경 뒤 기존 이메일·비밀번호 로그인 유지", async () => // 인증 회귀
    {
        const login = f.client(); // 별도 세션
        await login.request("csrf.php"); // 실제 토큰
        const response = await login.request("login.php", { email: "profile_owner@example.test", password: "ManagementTest123!" }); // 기존 로그인 수단
        assert.equal(response.status, 200); // 기존 비밀번호 인증
        assert.equal(response.data.user.username, "profile_changed"); // 새 표시 이름 복원
        assert.equal(response.data.user.id, owner.id); // 같은 계정
    });
}); // 실제 프로필 인수 끝
