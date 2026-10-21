import assert from "node:assert/strict"; // 결과 검증
import test from "node:test"; // 기본 검사 도구
import { fixture } from "./helpers/management-fixture.mjs"; // 실제 공개 API 경계
test("8단계 공개 API와 보존 마이그레이션", async (context) => // 실제 계약 전체 연결
{
    const f = await fixture(context); // 독립 DB와 HTTP
    const owner = await f.account("management_owner"); // 실제 소유자 계정
    const member = await f.account("management_member"); // 실제 참여자 계정
    const outsider = await f.account("management_outsider"); // 실제 미참여자
    await context.test("신규 서버 목록 경로는 인증된 빈 목록 제공", async () => // 라우터 누락 포착
    {
        const result = await owner.request("list_servers.php"); // 신규 공개 경로
        assert.equal(result.status, 200); // 구현 전 404와 구별
        assert.deepEqual(result.data.servers, []); // 가입만으로 소속 없음
    });
    await context.test("변경 적용은 기존 계정을 보존하고 재실행 거절", () => // 파괴적 초기화와 중복 DDL 차단
    {
        assert.match(f.migrate(), /적용 완료/); // 실제 CLI 변경
        assert.equal(f.sql("SELECT COUNT(*) FROM users"), "3"); // 기존 가입 계정 보존
        assert.equal(f.sql("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()"), "8"); // 신규 두 테이블
        assert.throws(() => f.migrate()); // 재실행 명시적 거절
    });
    let serverId; // 생성 서버 식별자
    let channelId; // 기본 채널 식별자
    let code; // 현재 초대 원문
    await context.test("기본 채널 저장 실패 시 서버와 소속 전체 롤백", async () => // 부분 생성 방지
    {
        f.sql("CREATE TRIGGER reject_default_channel BEFORE INSERT ON channels FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test failure'"); // 실제 DB 실패 경계
        try // 강제 실패 뒤 상태 확인
        {
            assert.equal((await owner.request("create_server.php", { name: "롤백 대상" })).status, 500); // 공개 일반 오류
            assert.equal(f.sql("SELECT COUNT(*) FROM servers"), "0"); // 서버 부분 생성 없음
            assert.equal(f.sql("SELECT COUNT(*) FROM server_members"), "0"); // 소속 부분 생성 없음
        }
        finally // 검사 전용 트리거 정리
        {
            f.sql("DROP TRIGGER reject_default_channel"); // 정상 업무 복구
        }
    });
    await context.test("서버·소유자·기본 채널 생성과 입력 검사", async () => // 부분 생성과 위조 소유자 차단
    {
        assert.equal((await owner.request("create_server.php", { name: "\n잘못된 이름" })).status, 422); // 제어 문자 거절
        assert.equal((await owner.request("create_server.php", { name: "이름", owner_id: member.id })).status, 422); // 소유자 지정 거절
        const created = await owner.request("create_server.php", { name: " ".repeat(1200) + "　검증 서버　" }); // 긴 앞 공백도 정규화 뒤 길이 판정
        assert.equal(created.status, 201); // 원자적 생성 성공
        assert.equal(created.data.server.name, "검증 서버"); // 정규화 결과
        assert.equal(created.data.server.role, "owner"); // 실제 역할
        assert.equal(created.data.channel.name, "일반"); // 기본 채널
        serverId = created.data.server.id; // 실제 서버
        channelId = created.data.channel.id; // 실제 채널
        assert.equal(f.sql("SELECT COUNT(*) FROM server_members WHERE server_id=" + serverId), "1"); // 유일 소유자 소속
    });
    await context.test("초대 발급·권한·해시 보관과 중복 참여 역할 유지", async () => // 코드 유출과 권한 승격 차단
    {
        assert.equal((await outsider.request("get_server_invite.php?server_id=" + serverId)).status, 403); // 미참여 거절
        const issued = await owner.request("create_server_invite.php", { server_id: serverId }); // 소유자 발급
        assert.equal(issued.status, 201); // 새 코드 발급
        code = issued.data.code; // 이번 응답 원문
        assert.match(code, /^[a-f0-9]{64}$/); // 고정 난수 형식
        assert.equal(f.sql("SELECT OCTET_LENGTH(token_hash) FROM server_invites"), "32"); // 원문 없는 해시
        const state = await owner.request("get_server_invite.php?server_id=" + serverId); // 재조회 경계
        assert.equal(state.data.invite.active, true); // 유효 상태
        assert.equal(JSON.stringify(state).includes(code), false); // 재조회 원문 비노출
        const joined = await member.request("join_server.php", { code }); // 실제 회원 참여
        assert.equal(joined.status, 201); // 신규 소속
        assert.equal(joined.data.server.role, "member"); // 최소 역할
        f.sql("UPDATE server_members SET role='admin' WHERE server_id=" + serverId + " AND user_id=" + member.id); // 기존 관리자 자료
        const repeated = await member.request("join_server.php", { code }); // 유효 코드 중복 참여
        assert.equal(repeated.status, 200); // 멱등 참여
        assert.equal(repeated.data.already_member, true); // 중복 여부
        assert.equal(repeated.data.server.role, "admin"); // 기존 역할 보존
        assert.equal((await member.request("create_server_invite.php", { server_id: serverId })).status, 403); // 관리자 초대 차단
    });
    await context.test("멤버십 잠금 대기 중 초대 만료 시 참여 거절", async () => // 시각 판정 뒤 잠금 대기 오류
    {
        f.sql("UPDATE server_invites SET created_at=UTC_TIMESTAMP()-INTERVAL 1 DAY, expires_at=UTC_TIMESTAMP()+INTERVAL 2 SECOND"); // 짧은 유효 경계
        const release = await f.hold("SELECT user_id FROM server_members WHERE server_id=" + serverId + " AND user_id=" + member.id + " FOR UPDATE"); // 본인 소속 잠금
        const pending = member.request("join_server.php", { code }); // 실제 대기 요청
        await new Promise((resolve) => setTimeout(resolve, 3000)); // 만료 경계 초과
        await release(); // 대기 해소
        const result = await pending; // 커밋 여부 판정
        assert.equal(result.status, 400); // 만료 초대 거절
        assert.equal(result.error.code, "INVALID_INVITE"); // 정보 없는 공통 코드
    });
    await context.test("코드 교체·폐기·만료 경계와 기존 소속 유지", async () => // 오래된 코드 재사용 차단
    {
        const fresh = await owner.request("create_server_invite.php", { server_id: serverId }); // 재발급
        assert.notEqual(fresh.data.code, code); // 다른 난수
        assert.equal((await outsider.request("join_server.php", { code })).error.code, "INVALID_INVITE"); // 이전 코드 거절
        code = fresh.data.code; // 현재 코드
        f.sql("UPDATE server_invites SET created_at=UTC_TIMESTAMP()-INTERVAL 1 DAY, expires_at=UTC_TIMESTAMP()"); // 만료 시각 경계
        assert.equal((await outsider.request("join_server.php", { code })).error.code, "INVALID_INVITE"); // 경계는 만료
        code = (await owner.request("create_server_invite.php", { server_id: serverId })).data.code; // 새 유효 코드
        assert.equal((await owner.request("revoke_server_invite.php", { server_id: serverId })).status, 200); // 폐기 성공
        assert.equal((await owner.request("revoke_server_invite.php", { server_id: serverId })).status, 200); // 반복 폐기
        assert.equal((await outsider.request("join_server.php", { code })).error.code, "INVALID_INVITE"); // 폐기 코드 거절
        assert.equal(f.sql("SELECT COUNT(*) FROM server_members WHERE server_id=" + serverId), "2"); // 기존 소속 보존
    });
    await context.test("코드 조회 뒤 서버 삭제 경합도 같은 무효 초대 응답", async () => // 후보 조회 뒤 존재 정보 분기 차단
    {
        const created = await owner.request("create_server.php", { name: "삭제 경합 서버" }); // 독립 경합 자료
        const id = created.data.server.id; // 경합 서버 식별자
        const issued = await owner.request("create_server_invite.php", { server_id: id }); // 삭제 전 유효 코드
        const release = await f.hold("SELECT id FROM servers WHERE id=" + id + " FOR UPDATE", "DELETE FROM servers WHERE id=" + id); // 독립 삭제 업무 대기
        const joining = outsider.request("join_server.php", { code: issued.data.code }); // 후보 조회 뒤 서버 잠금 대기
        await new Promise((resolve) => setTimeout(resolve, 150)); // 후보 조회 진입 기회
        await release(); // 서버와 초대 삭제 커밋
        const result = await joining; // 현재 코드 판정
        assert.equal(result.status, 400); // 일반 무효 초대와 같은 상태
        assert.equal(result.error.code, "INVALID_INVITE"); // 서버 존재 분기 비노출
    });
    await context.test("대화 후 탈퇴는 대화 보존·소유자 탈퇴 거절", async () => // 소속 변경 경계
    {
        assert.equal((await member.request("send_message.php", { channel_id: channelId, content: "탈퇴 후에도 남는 기록" })).status, 201); // 기존 실제 대화
        assert.equal((await owner.request("leave_server.php", { server_id: serverId })).error.code, "OWNER_CANNOT_LEAVE"); // 소유자 보호
        assert.equal((await member.request("leave_server.php", { server_id: serverId })).status, 200); // 본인 탈퇴
        assert.equal(f.sql("SELECT COUNT(*) FROM messages WHERE channel_id=" + channelId), "1"); // 작성 기록 보존
        assert.equal((await member.request("get_messages.php?channel_id=" + channelId)).status, 403); // 이후 조회 차단
        assert.equal((await member.request("send_message.php", { channel_id: channelId, content: "금지" })).status, 403); // 이후 전송 차단
    });
    await context.test("횟수 제한·잘못된 계정·CSRF와 창 경계", async () => // 우회와 경계 오류 차단
    {
        f.sql("DELETE FROM management_rate_limits"); // 해당 무작위 DB의 창 초기화
        for (let i = 0; i < 10; i++) // 허용된 참여 시도
        {
            assert.equal((await outsider.request("join_server.php", { code: "a".repeat(64) })).status, 400); // 허용 후 무효 코드
        }
        const limited = await outsider.request("join_server.php", { code: "a".repeat(64) }); // 초과 시도
        assert.equal(limited.status, 429); // 계정 제한
        assert.ok(Number(limited.retry) > 0); // 재시도 초
        f.sql("UPDATE management_rate_limits SET window_started_at=UTC_TIMESTAMP()-INTERVAL 600 SECOND"); // 정확한 창 경계
        assert.equal((await outsider.request("join_server.php", { code: "a".repeat(64) })).status, 400); // 새 창 허용
        f.sql("UPDATE management_rate_limits SET attempts=100, window_started_at=UTC_TIMESTAMP() WHERE scope='invite_join_ip'"); // IP 상한 경계
        assert.equal((await owner.request("join_server.php", { code: "a".repeat(64) })).status, 429); // 계정 변경으로 IP 제한 우회 불가
        f.sql("DELETE FROM management_rate_limits"); // 다른 종류의 경계 준비
        for (let i = 0; i < 10; i++) // 발급의 마지막 허용까지 확인
        {
            assert.equal((await owner.request("create_server_invite.php", { server_id: serverId })).status, 201); // 허용된 발급
        }
        assert.equal((await owner.request("create_server_invite.php", { server_id: serverId })).status, 429); // 발급 상한 초과
        assert.equal((await owner.request("delete_server.php", { server_id: serverId, confirm_name: "검증 서버" }, { "X-Expected-User-Id": member.id })).error.code, "SESSION_CHANGED"); // 저장 전 계정 일치
        assert.equal((await owner.request("delete_server.php", { server_id: serverId, confirm_name: "검증 서버" }, { "X-CSRF-Token": "wrong" })).error.code, "CSRF_INVALID"); // 삭제 CSRF 보호
    });
    await context.test("빈 서버 목록과 삭제 영향·이름 확인·CASCADE", async () => // 빈 채널 서버 누락과 다른 자료 손상 차단
    {
        const empty = await owner.request("create_server.php", { name: "빈 서버" }); // 별도 서버
        f.sql("DELETE FROM channels WHERE server_id=" + empty.data.server.id); // 검사 자료의 빈 서버
        assert.equal((await owner.request("list_servers.php")).data.servers.length, 2); // 채널 없는 서버도 표시
        const preview = await owner.request("get_deletion_preview.php?resource_type=server&resource_id=" + serverId); // 현재 영향
        assert.equal(preview.data.message_count, "1"); // 실제 대화 수
        assert.equal(preview.data.channel_count, "1"); // 실제 채널 수
        assert.equal((await outsider.request("delete_server.php", { server_id: serverId, confirm_name: "검증 서버" })).status, 403); // 직접 API 역할 거절
        assert.equal((await owner.request("delete_server.php", { server_id: serverId, confirm_name: "다른 이름" })).error.code, "NAME_MISMATCH"); // 이름 확인
        const release = await f.hold("SELECT id FROM channels WHERE id=" + channelId + " FOR UPDATE", "INSERT INTO messages(channel_id,user_id,content) VALUES(" + channelId + "," + owner.id + ",'삭제와 겹친 전송')"); // 진행 중 전송의 실제 채널 잠금
        const deleting = owner.request("delete_server.php", { server_id: serverId, confirm_name: "검증 서버" }); // 삭제의 잠금 대기
        await new Promise((resolve) => setTimeout(resolve, 150)); // 독립 요청 진입 기회
        assert.equal(f.sql("SELECT COUNT(*) FROM servers WHERE id=" + serverId), "1"); // 전송 커밋 전 삭제 미완료
        await release(); // 앞선 전송 커밋
        assert.equal((await deleting).status, 200); // 대기 뒤 전체 삭제 성공
        assert.equal(f.sql("SELECT COUNT(*) FROM messages"), "0"); // 해당 대화 정리
        assert.equal(f.sql("SELECT COUNT(*) FROM servers"), "1"); // 다른 서버 보존
        assert.equal(f.sql("SELECT COUNT(*) FROM users"), "3"); // 계정 보존
    });
}); // 전체 인수 종료
