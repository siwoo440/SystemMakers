import assert from "node:assert/strict"; // 실제 응답 검증
import test from "node:test"; // 기본 검사 도구
import { fixture } from "./helpers/management-fixture.mjs"; // 독립 PHP·MySQL 경계
test("9단계 채널 관리의 실제 권한·보존·경합", async (context) => // 공개 API 전체 흐름
{
    const f = await fixture(context); // 무작위 전용 DB
    f.migrate(); // 현재 8개 테이블 적용
    const owner = await f.account("channel_owner"); // 실제 소유자
    const admin = await f.account("channel_admin"); // 기존 관리자
    const member = await f.account("channel_member"); // 일반 회원
    const outsider = await f.account("channel_outsider"); // 다른 서버 소유자
    const created = (await owner.request("create_server.php", { name: "채널 검증 서버" })).data; // 기존 서버 생성 기능
    const other = (await outsider.request("create_server.php", { name: "다른 서버" })).data; // 분리된 자료
    const serverId = created.server.id; // 실제 대상 서버
    const generalId = created.channel.id; // 보존할 기본 대화방
    f.sql("INSERT INTO server_members(server_id,user_id,role) VALUES(" + serverId + "," + admin.id + ",'admin'),(" + serverId + "," + member.id + ",'member')"); // 명시한 검사 역할
    let channel; // 관리할 채널
    await context.test("공개 변경 경로는 비로그인 요청 거절", async () => // 미구현 라우터 404 포착
    {
        for (const operation of ["create_channel", "update_channel", "delete_channel"]) // 신규 진입점
        {
            assert.equal((await f.client().request(operation + ".php", {})).status, 401); // 인증 우선 검사
        }
    });
    await context.test("관리자 생성·정규화와 서버별 이름 중복", async () => // 역할·고유 키 계약
    {
        const response = await admin.request("create_channel.php", { server_id: serverId, name: " ".repeat(1200) + "　Dev　" }); // 정규화 뒤 길이 판정
        assert.equal(response.status, 201); // 관리자 허용
        channel = response.data.channel; // 공개 객체
        assert.equal(channel.name, "Dev"); // 내부 대소문자 보존
        assert.equal(channel.server_id, serverId); // 정확한 부모
        assert.equal(channel.server_name, created.server.name); // 기존 목록과 같은 객체
        assert.equal((await owner.request("create_channel.php", { server_id: serverId, name: "dev" })).error.code, "CHANNEL_NAME_TAKEN"); // DB 비교 규칙 중복
        assert.equal((await outsider.request("create_channel.php", { server_id: other.server.id, name: "Dev" })).status, 201); // 다른 서버 이름 허용
    });
    await context.test("일반 회원·미소속·교차 서버 관리 거절", async () => // 다른 서버의 관리자 권한 오용 차단
    {
        for (const actor of [member, outsider]) // 관리 권한 없는 두 경우
        {
            assert.equal((await actor.request("create_channel.php", { server_id: serverId, name: "금지" })).status, 403); // 생성 거절
            assert.equal((await actor.request("update_channel.php", { channel_id: channel.id, name: "금지" })).status, 403); // 이름 변경 거절
            assert.equal((await actor.request("delete_channel.php", { channel_id: channel.id, confirm_name: channel.name })).status, 403); // 삭제 거절
            assert.equal((await actor.request("get_deletion_preview.php?resource_type=channel&resource_id=" + channel.id)).status, 403); // 집계도 비공개
        }
        assert.equal((await admin.request("update_channel.php", { channel_id: other.channel.id, name: "침범" })).status, 403); // 역할은 서버별 적용
    });
    await context.test("입력·CSRF·기대 계정·없는 자원 검사", async () => // 우회 변경과 기본 검증
    {
        for (const name of [" ", "\n이름", "한".repeat(101)]) // 잘못된 정규화 결과
        {
            assert.equal((await owner.request("create_channel.php", { server_id: serverId, name })).status, 422); // 필드 거절
        }
        assert.equal((await owner.request("update_channel.php", { channel_id: channel.id, name: "값", server_id: serverId })).status, 422); // 허용하지 않는 대상 필드
        assert.equal((await owner.request("update_channel.php", { channel_id: channel.id, name: "값" }, { "X-CSRF-Token": "wrong" })).error.code, "CSRF_INVALID"); // 위조 요청 보호
        assert.equal((await owner.request("delete_channel.php", { channel_id: channel.id, confirm_name: channel.name }, { "X-Expected-User-Id": member.id })).error.code, "SESSION_CHANGED"); // 계정 혼합 차단
        assert.equal((await owner.request("update_channel.php", { channel_id: "18446744073709551615", name: "값" })).error.code, "CHANNEL_NOT_FOUND"); // 없는 문자열 ID
    });
    await context.test("이름 변경·동일 이름 재저장·중복 변경 거절", async () => // 영향 행 0과 채널 ID 보존
    {
        const renamed = await owner.request("update_channel.php", { channel_id: channel.id, name: "수정 개발" }); // 소유자 이름 변경
        assert.equal(renamed.status, 200); // 변경 성공
        assert.equal(renamed.data.channel.id, channel.id); // 자원 ID 보존
        channel = renamed.data.channel; // 현재 이름
        assert.equal((await admin.request("update_channel.php", { channel_id: channel.id, name: channel.name })).status, 200); // 같은 이름도 정상
        assert.equal((await admin.request("update_channel.php", { channel_id: channel.id, name: "일반" })).error.code, "CHANNEL_NAME_TAKEN"); // 기존 이름과 중복
        const list = await member.request("get_channels.php"); // 일반 회원의 실제 조회
        assert.equal(list.data.channels.find((c) => c.id === channel.id).name, channel.name); // 기존 목록에 변경 반영
    });
    await context.test("잠금 대기 중 관리자 권한 상실 재검사", async () => // 사전 역할만 확인하는 오류 포착
    {
        const release = await f.hold("SELECT user_id FROM server_members WHERE server_id=" + serverId + " AND user_id=" + admin.id + " FOR UPDATE", "UPDATE server_members SET role='member' WHERE server_id=" + serverId + " AND user_id=" + admin.id); // 잠금 뒤 역할 변경
        const pending = admin.request("update_channel.php", { channel_id: channel.id, name: "거절할 변경" }); // 대기하는 실제 요청
        await new Promise((resolve) => setTimeout(resolve, 150)); // 요청 진입 기회
        await release(); // 권한 변경 커밋
        assert.equal((await pending).status, 403); // 최신 역할 기준 거절
        assert.equal(f.sql("SELECT name FROM channels WHERE id=" + channel.id), channel.name); // 이름 보존
        f.sql("UPDATE server_members SET role='admin' WHERE server_id=" + serverId + " AND user_id=" + admin.id); // 다음 검사 역할 복원
    });
    await context.test("서버 잠금 대기 뒤 소유자 불변식 최신 검사", async () => // 오래된 스냅샷 우회 포착
    {
        const release = await f.hold("SELECT id FROM servers WHERE id=" + serverId + " FOR UPDATE", "DELETE FROM server_members WHERE server_id=" + serverId + " AND user_id=" + owner.id); // 서버 잠금 중 소유자 불일치
        const pending = admin.request("update_channel.php", { channel_id: channel.id, name: "불변식 우회" }); // 부모 후보 조회 뒤 대기
        await new Promise((resolve) => setTimeout(resolve, 150)); // 실제 요청 진입 기회
        await release(); // 불일치 상태 커밋
        const response = await pending; // 최신 상태의 관리 결과
        f.sql("INSERT INTO server_members(server_id,user_id,role) VALUES(" + serverId + "," + owner.id + ",'owner')"); // 다음 검사 소유자 복원
        assert.equal(response.status, 500); // 불일치 변경 중단
        assert.equal(f.sql("SELECT name FROM channels WHERE id=" + channel.id), channel.name); // 부분 변경 없음
    });
    await context.test("부모 삭제 경합도 채널 없음 계약 유지", async () => // 후보 조회 뒤 서버 삭제
    {
        const temporary = (await owner.request("create_server.php", { name: "경합 전용" })).data; // 분리된 삭제 대상
        const release = await f.hold("SELECT id FROM servers WHERE id=" + temporary.server.id + " FOR UPDATE", "DELETE FROM servers WHERE id=" + temporary.server.id); // 서버 전체 삭제 대기
        const pending = owner.request("update_channel.php", { channel_id: temporary.channel.id, name: "없는 대상" }); // 삭제될 부모 잠금 대기
        await new Promise((resolve) => setTimeout(resolve, 150)); // 실제 요청 진입 기회
        await release(); // 부모와 채널 삭제 커밋
        assert.equal((await pending).error.code, "CHANNEL_NOT_FOUND"); // 공개 채널 존재 오류
    });
    await context.test("삭제 영향·정확한 이름·진행 전송·다른 채널 보존", async () => // CASCADE 범위와 잠금 순서
    {
        await member.request("send_message.php", { channel_id: generalId, content: "보존할 일반 대화" }); // 다른 채널 자료
        await member.request("send_message.php", { channel_id: channel.id, content: "삭제할 개발 대화" }); // 대상 자료
        const preview = await admin.request("get_deletion_preview.php?resource_type=channel&resource_id=" + channel.id); // 기존 공통 미리보기
        assert.equal(preview.data.message_count, "1"); // 정확한 영향 수
        assert.equal((await admin.request("delete_channel.php", { channel_id: channel.id, confirm_name: "다른 이름" })).error.code, "NAME_MISMATCH"); // 확인 실패는 무변경
        const release = await f.hold("SELECT id FROM channels WHERE id=" + channel.id + " FOR UPDATE", "INSERT INTO messages(channel_id,user_id,content) VALUES(" + channel.id + "," + member.id + ",'진행 중 전송')"); // 먼저 진행 중인 전송
        const pending = admin.request("delete_channel.php", { channel_id: channel.id, confirm_name: channel.name }); // 채널 삭제 대기
        await new Promise((resolve) => setTimeout(resolve, 150)); // 실제 경합 기회
        await release(); // 메시지 커밋
        assert.equal((await pending).status, 200); // 대기 뒤 원자적 삭제
        assert.equal(f.sql("SELECT COUNT(*) FROM messages WHERE channel_id=" + channel.id), "0"); // 대상 대화만 제거
        assert.equal(f.sql("SELECT COUNT(*) FROM messages WHERE channel_id=" + generalId), "1"); // 다른 채널 대화 보존
        assert.equal((await member.request("get_messages.php?channel_id=" + channel.id)).status, 404); // 이후 조회 차단
        assert.equal((await member.request("send_message.php", { channel_id: channel.id, content: "금지" })).status, 404); // 이후 전송 차단
    });
    await context.test("마지막 채널 삭제 뒤 서버 유지·채널 재생성", async () => // 빈 서버의 사용 복구
    {
        assert.equal((await owner.request("delete_channel.php", { channel_id: generalId, confirm_name: "일반" })).status, 200); // 마지막 채널 삭제
        assert.equal((await owner.request("list_servers.php")).data.servers[0].id, serverId); // 서버 유지
        assert.deepEqual((await member.request("get_channels.php")).data.channels, []); // 빈 목록 정상
        assert.equal((await admin.request("create_channel.php", { server_id: serverId, name: "재시작" })).status, 201); // 관리자 재생성
        assert.equal(f.sql("SELECT COUNT(*) FROM users"), "4"); // 계정 보존
        assert.equal(f.sql("SELECT COUNT(*) FROM servers"), "2"); // 다른 서버 보존
        assert.equal(f.sql("SELECT COUNT(*) FROM channels WHERE server_id=" + other.server.id), "2"); // 다른 채널 보존
    });
}); // 실제 채널 관리 검사 종료
