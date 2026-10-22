import assert from "node:assert/strict"; // 연결 결과 검사
import test from "node:test"; // 기본 검사 도구
import { fixture } from "./helpers/management-fixture.mjs"; // 독립 실제 PHP·MySQL
test("11단계 공개 API의 서버·채널·프로필·대화 전체 연결", async (context) => // seed 없는 실제 이용 흐름
{
    const f = await fixture(context); // 전용33361 무작위 DB
    f.migrate(); // 기존8개 테이블
    const owner = await f.account("flow_owner"); // 실제 가입·로그인 소유자
    const member = await f.account("flow_member"); // 실제 가입·로그인 참여자
    const outsider = await f.account("flow_outside"); // 미소속 계정
    let server; // 생성된 서버
    let channel; // 관리할 채널
    let code; // 검증용 초대 원문
    let second; // 같은 계정의 공유 쿠키 탭
    await context.test("빈 소속부터 서버 생성·초대·중복 참여", async () => // 역할과 소속 준비 연결
    {
        assert.deepEqual((await member.request("list_servers.php")).data.servers, []); // 새 계정 빈 서버
        assert.deepEqual((await member.request("get_channels.php")).data.channels, []); // 새 계정 빈 채널
        const created = await owner.request("create_server.php", { name: "통합 서버" }); // 명령어 준비 없는 생성
        server = created.data.server; // 실제 소유 서버
        channel = (await owner.request("create_channel.php", { server_id: server.id, name: "개발" })).data.channel; // 같은 서버 관리 기능
        code = (await owner.request("create_server_invite.php", { server_id: server.id })).data.code; // 소유자 발급
        assert.equal((await member.request("join_server.php", { code })).status, 201); // 새 소속 생성
        assert.equal((await member.request("join_server.php", { code })).data.already_member, true); // 중복 소속 없음
        assert.equal((await member.request("list_servers.php")).data.servers[0].role, "member"); // 본인 역할
        second = f.client(); // 같은 쿠키의 별도 탭 경계
        Object.assign(second, { cookie: member.cookie, token: member.token, id: member.id }); // 실제 공유 세션
    }); // 서버·초대 흐름 검사 끝
    await context.test("역할 거절과 채널별 대화·이전 기록", async () => // 화면 기능 사이의 권한 경계
    {
        assert.equal((await outsider.request("get_messages.php?channel_id=" + channel.id)).status, 403); // 미소속 대화 거절
        assert.equal((await member.request("update_channel.php", { channel_id: channel.id, name: "침범" })).status, 403); // 일반 회원 관리 거절
        for (let i = 0; i < 55; i++) // 실제 공개 저장으로 두 페이지 준비
        {
            assert.equal((await member.request("send_message.php", { channel_id: channel.id, content: "연결 대화 " + i })).status, 201); // 본인 작성자 저장
        }
        const latest = (await owner.request("get_messages.php?channel_id=" + channel.id)).data; // 실제 최신 페이지
        assert.equal(latest.messages.length, 50); // 기본50개
        assert.equal(latest.pagination.has_more, true); // 이전 기록 존재
        const older = (await owner.request("get_messages.php?channel_id=" + channel.id + "&before_id=" + latest.pagination.next_before_id)).data; // 이전 페이지 연결
        assert.equal(older.messages.length, 5); // 누락 없는 나머지
        assert.equal(new Set([...older.messages, ...latest.messages].map((m) => m.id)).size, 55); // 중복 없음
        const saved = await owner.request("send_message.php", { channel_id: channel.id, content: "소유자 답장" }); // 두 번째 작성자
        const after = (await member.request("get_messages.php?channel_id=" + channel.id + "&after_id=" + latest.pagination.next_after_id)).data; // 신규 커서 연결
        assert.equal(after.messages[0].id, saved.data.message.id); // 새 답장 한 번
    }); // 역할·대화 흐름 검사 끝
    await context.test("프로필·채널 이름 변경 뒤 작성 관계 유지", async () => // 이름 변경과 대화 조회 연결
    {
        const renamed = await member.request("profile.php", { username: " FLOW_RENAMED " }, {}, "PATCH"); // 같은 가입 정규화
        assert.equal(renamed.data.user.id, member.id); // 사용자 번호 보존
        assert.equal(renamed.data.user.username, "flow_renamed"); // 실제 저장 이름
        const changed = await owner.request("update_channel.php", { channel_id: channel.id, name: "수정 개발" }); // 채널 이름 변경
        assert.equal(changed.data.channel.id, channel.id); // 채널 번호 보존
        channel = changed.data.channel; // 삭제 확인에 쓸 최신 이름
        const messages = (await second.request("get_messages.php?channel_id=" + channel.id)).data.messages; // 다른 공유 탭의 조회
        assert.ok(messages.filter((m) => m.user_id === member.id).every((m) => m.username === "flow_renamed")); // DB 최신 이름
        assert.equal(f.sql("SELECT COUNT(*) FROM messages WHERE channel_id=" + channel.id), "56"); // 작성 자료 보존
    }); // 이름·작성 관계 검사 끝
    await context.test("같은 계정 다른 탭 탈퇴·재참여·삭제 영향", async () => // 소속 변경의 즉시 API 경계
    {
        assert.equal((await member.request("leave_server.php", { server_id: server.id })).status, 200); // 일반 회원 본인 탈퇴
        assert.equal((await second.request("get_messages.php?channel_id=" + channel.id)).status, 403); // 공유 탭도 접근 거절
        assert.equal((await second.request("send_message.php", { channel_id: channel.id, content: "거절" })).status, 403); // 전송 거절
        assert.equal(f.sql("SELECT COUNT(*) FROM messages WHERE user_id=" + member.id), "55"); // 탈퇴도 기존 작성 자료 보존
        assert.equal((await second.request("join_server.php", { code })).status, 201); // 같은 계정 재참여
        const preview = (await owner.request("get_deletion_preview.php?resource_type=channel&resource_id=" + channel.id)).data; // 현재 이름과 영향
        assert.equal(preview.name, "수정 개발"); // 실제 최신 이름
        assert.equal(preview.message_count, "56"); // 정확한 범위
        assert.equal((await owner.request("delete_channel.php", { channel_id: channel.id, confirm_name: channel.name })).status, 200); // 소유자 실제 삭제
        assert.equal((await second.request("get_messages.php?channel_id=" + channel.id)).status, 404); // 공유 탭 존재 상실
        assert.equal((await member.request("get_channels.php")).data.channels.length, 1); // 다른 일반 채널 보존
    }); // 탈퇴·재참여·삭제 검사 끝
    await context.test("서버 삭제·공유 세션 로그아웃·계정 보존", async () => // 전체 흐름 종료
    {
        assert.equal((await owner.request("delete_server.php", { server_id: server.id, confirm_name: server.name })).status, 200); // 남은 검증 서버 삭제
        assert.deepEqual((await second.request("get_channels.php")).data.channels, []); // 소속 채널 제거
        assert.equal((await member.request("logout.php", {})).status, 200); // 공유 쿠키 로그아웃
        assert.equal((await second.request("profile.php")).status, 401); // 다른 탭 인증 종료
        assert.equal(f.sql("SELECT COUNT(*) FROM users"), "3"); // 계정 보존
        assert.equal(f.sql("SELECT COUNT(*) FROM messages"), "0"); // 서버 범위 대화 삭제
    }); // 전체 종료·보존 검사 끝
}); // 실제 통합 흐름 검사 끝
