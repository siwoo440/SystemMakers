import assert from "node:assert/strict"; // 검증 도구
import { execFileSync } from "node:child_process"; // MySQL 명령 실행
import { randomBytes } from "node:crypto"; // 전용 DB 이름 생성
import { existsSync, readFileSync } from "node:fs"; // 스키마 파일 읽기
import { fileURLToPath } from "node:url"; // 로컬 파일 경로 변환
import test from "node:test"; // 기본 테스트 도구
const schemaPath = fileURLToPath(new URL("../backend/sql/schema.sql", import.meta.url)); // 검증할 스키마
const client = process.env.MYSQL_TEST_CLIENT || "mysql"; // MySQL 클라이언트 경로
const port = process.env.MYSQL_TEST_PORT || "33360"; // 격리된 테스트 포트
const database = "systemmakers_test_" + randomBytes(6).toString("hex"); // 테스트 전용 DB
const expectedTables = ["auth_rate_limits", "channels", "messages", "server_members", "servers", "users"]; // 계약 테이블
function query(sql, useDatabase = true) // 실제 SQL 실행
{ // 실행 범위 시작
    const args = ["--no-defaults", "--protocol=TCP", "--host=127.0.0.1", "--port=" + port, "--user=root", "--batch", "--skip-column-names", "--default-character-set=utf8mb4"]; // 로컬 전용 연결
    if (useDatabase) // 선택 DB 사용 여부
    { // DB 지정 시작
        args.push(database); // 전용 DB 지정
    } // DB 지정 종료
    return execFileSync(client, args, // MySQL 실행
    { // 실행 옵션 시작
        input: "SET SESSION time_zone = '+00:00'; SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION';\n" + sql, // UTC와 엄격한 입력 모드
        encoding: "utf8", // UTF-8 결과
        stdio: ["pipe", "pipe", "pipe"], // 입력과 오류 분리
        windowsHide: true // 실행 창 숨김
    }).replace(/\r\n/g, "\n").trim(); // 운영체제별 줄바꿈 통일
} // 실행 범위 종료
function rejectsSql(sql, code) // DB 거절 결과 확인
{ // 거절 검사 시작
    assert.throws(() => query(sql), // 실패해야 하는 SQL
    (error) => // 실제 오류 검사
    { // 오류 검사 시작
        assert.match(String(error.stderr), new RegExp("ERROR " + code + " ")); // MySQL 오류 코드 비교
        return true; // 예상 거절 확인
    }); // 거절 검사 완료
} // 거절 검사 종료
test("schema.sql의 실제 MySQL 관계와 제약", async (context) => // 전체 통합 검증
{ // 통합 검사 시작
    assert.ok(existsSync(schemaPath), "schema.sql 미구현"); // 스키마 구현 여부
    assert.match(port, /^\d+$/); // 포트 형식 확인
    assert.notEqual(port, "3306", "기존 기본 DB 포트 사용 금지"); // 기존 DB 접근 방지
    assert.match(database, /^systemmakers_test_[a-f0-9]{12}$/); // 삭제 대상 이름 제한
    query("CREATE DATABASE " + database + " CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;", false); // 빈 전용 DB 생성
    try // 실패 시에도 전용 DB 정리
    { // 검증 범위 시작
        query(readFileSync(schemaPath, "utf8")); // 실제 스키마 적용
        await context.test("6개 테이블의 엔진과 문자셋", () => // 생성 구조 확인
        { // 구조 검사 시작
            const tables = query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME;").split("\n"); // 실제 테이블 목록
            assert.deepEqual(tables, expectedTables); // 계약 테이블 비교
            assert.equal(query("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND ENGINE = 'InnoDB' AND TABLE_COLLATION = 'utf8mb4_0900_as_ci';"), "6"); // 엔진과 비교 규칙 확인
            assert.equal(query("SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'messages' AND COLUMN_NAME = 'id';"), "bigint unsigned"); // 식별자 자료형 확인
            assert.equal(query("SELECT CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'password_hash';"), "255"); // 해시 저장 길이 확인
            assert.equal(query("SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND UPDATE_RULE='RESTRICT';"), "6"); // 참조 식별자 변경 차단
            assert.equal(query("SELECT @@session.time_zone;"), "+00:00"); // UTC 연결 확인
        }); // 구조 검사 종료
        const hash = "$2y$12$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi."; // 테스트 전용 해시 문자열
        query("INSERT INTO users (id, username, email, password_hash) VALUES (1,'owner_one','one@example.com','" + hash + "'),(2,'owner_two','two@example.com','" + hash + "'),(3,'writer','writer@example.com','" + hash + "'),(4,'visitor','visitor@example.com','" + hash + "'),(5,'silent_owner','silent@example.com','" + hash + "');"); // 소유자와 작성자 분리 준비
        query("INSERT INTO servers (id, name, owner_id) VALUES (1,'서버 하나',1),(2,'서버 둘',2),(3,'빈 서버',5);"); // 삭제 검사용 서버 준비
        query("INSERT INTO server_members (server_id,user_id,role) VALUES (1,1,'owner'),(2,2,'owner'),(3,5,'owner'),(1,3,'member'),(1,4,'member');"); // 분리된 서버 소속 준비
        query("INSERT INTO channels (id,server_id,name) VALUES (10,1,'general'),(20,2,'general'),(30,1,'temporary');"); // 서버별 채널 준비
        query("INSERT INTO messages (id,channel_id,user_id,content) VALUES (100,10,3,'첫 메시지'),(110,10,1,'둘째 메시지'),(120,20,2,'다른 서버 메시지'),(130,10,3,'셋째 메시지'),(140,30,3,'삭제 검사 메시지');"); // 조회와 삭제 검사용 메시지
        await context.test("대소문자를 바꾼 이메일과 사용자명 중복 거절", () => // 고유 사용자 검사
        { // 고유 값 검사 시작
            rejectsSql("INSERT INTO users (username,email,password_hash) VALUES ('new_user','ONE@example.com','test-hash');", 1062); // 이메일 중복 거절
            rejectsSql("INSERT INTO users (username,email,password_hash) VALUES ('OWNER_ONE','new@example.com','test-hash');", 1062); // 사용자명 중복 거절
        }); // 고유 값 검사 종료
        await context.test("중복 멤버십과 같은 서버 채널명 거절", () => // 복합 고유 키 검사
        { // 복합 키 검사 시작
            rejectsSql("INSERT INTO server_members (server_id,user_id) VALUES (1,3);", 1062); // 중복 가입 거절
            rejectsSql("INSERT INTO channels (server_id,name) VALUES (1,'GENERAL');", 1062); // 같은 서버 채널명 거절
            assert.equal(query("SELECT COUNT(*) FROM channels WHERE name='general';"), "2"); // 다른 서버 같은 이름 허용
        }); // 복합 키 검사 종료
        await context.test("존재하지 않는 부모 참조 모두 거절", () => // 외래 키 무결성 검사
        { // 외래 키 검사 시작
            const cases = // 부모 누락 입력 목록
            [ // 입력 목록 시작
                "INSERT INTO servers (name,owner_id) VALUES ('유령 서버',999);", // 없는 소유자
                "INSERT INTO server_members (server_id,user_id) VALUES (999,1);", // 없는 소속 서버
                "INSERT INTO server_members (server_id,user_id) VALUES (1,999);", // 없는 소속 사용자
                "INSERT INTO channels (server_id,name) VALUES (999,'ghost');", // 없는 채널 서버
                "INSERT INTO messages (channel_id,user_id,content) VALUES (999,1,'내용');", // 없는 메시지 채널
                "INSERT INTO messages (channel_id,user_id,content) VALUES (10,999,'내용');" // 없는 메시지 작성자
            ]; // 입력 목록 종료
            for (const sql of cases) // 각 참조 검사
            { // 참조 검사 시작
                rejectsSql(sql, 1452); // 외래 키 거절 확인
            } // 참조 검사 종료
        }); // 외래 키 검사 종료
        await context.test("역할 기본값과 잘못된 역할 거절", () => // 역할 제한 확인
        { // 역할 검사 시작
            query("INSERT INTO server_members (server_id,user_id) VALUES (2,4);"); // 기본 역할 가입
            assert.equal(query("SELECT role FROM server_members WHERE server_id=2 AND user_id=4;"), "member"); // 기본 멤버 역할
            rejectsSql("UPDATE server_members SET role='superuser' WHERE server_id=2 AND user_id=4;", 1265); // 허용되지 않은 역할
        }); // 역할 검사 종료
        await context.test("본문 길이 경계와 한글 이모지 저장", () => // 문자 수 제한 확인
        { // 본문 검사 시작
            rejectsSql("INSERT INTO messages (channel_id,user_id,content) VALUES (10,1,'');", 3819); // 빈 본문 거절
            rejectsSql("INSERT INTO messages (channel_id,user_id,content) VALUES (10,1,REPEAT('가',2001));", 3819); // 2001자 거절
            query("INSERT INTO messages (channel_id,user_id,content) VALUES (30,1,REPEAT('😀',2000));"); // 2000개 이모지 저장
            assert.equal(query("SELECT CONCAT(CHAR_LENGTH(content),':',LENGTH(content)) FROM messages WHERE channel_id=30 AND CHAR_LENGTH(content)=2000;"), "2000:8000"); // 문자와 바이트 구분
        }); // 본문 검사 종료
        await context.test("채널별 최초 이전 신규 조회와 인덱스", () => // 메시지 조회 계약 확인
        { // 조회 검사 시작
            assert.equal(query("SELECT id FROM messages WHERE channel_id=10 ORDER BY id DESC LIMIT 2;"), "130\n110"); // 최신 두 메시지 선택
            assert.equal(query("SELECT id FROM messages WHERE channel_id=10 AND id<130 ORDER BY id DESC LIMIT 2;"), "110\n100"); // 이전 두 메시지 선택
            assert.equal(query("SELECT id FROM messages WHERE channel_id=10 AND id>100 ORDER BY id ASC LIMIT 2;"), "110\n130"); // 다른 채널 제외 신규 조회
            assert.equal(query("SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='messages' AND INDEX_NAME='idx_messages_channel_id';"), "channel_id,id"); // 복합 인덱스 순서 확인
            const indexes = // 목록과 정리용 인덱스 계약
            [ // 인덱스 목록 시작
                ["servers", "idx_servers_owner", "owner_id"], // 소유 서버 조회
                ["server_members", "idx_members_user", "user_id,server_id"], // 사용자별 소속 조회
                ["channels", "idx_channels_server", "server_id,id"], // 서버별 채널 조회
                ["messages", "idx_messages_user", "user_id"], // 작성자 참조 지원
                ["auth_rate_limits", "idx_rate_limits_updated", "updated_at"] // 오래된 제한 정리
            ]; // 인덱스 목록 종료
            for (const [table, name, columns] of indexes) // 계약 인덱스 순회
            { // 인덱스 검사 시작
                assert.equal(query("SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='" + table + "' AND INDEX_NAME='" + name + "';"), columns); // 실제 인덱스 열 순서 확인
            } // 인덱스 검사 종료
        }); // 조회 검사 종료
        await context.test("소유자와 작성자 삭제 제한", () => // 사용자 기록 보존
        { // 삭제 제한 검사 시작
            rejectsSql("DELETE FROM users WHERE id=5;", 1451); // 작성 기록 없는 서버 소유자 보호
            rejectsSql("DELETE FROM users WHERE id=3;", 1451); // 메시지 작성자 보호
        }); // 삭제 제한 검사 종료
        await context.test("서버 탈퇴 후 작성 메시지 유지", () => // 멤버십과 기록 분리
        { // 탈퇴 검사 시작
            query("DELETE FROM server_members WHERE server_id=1 AND user_id=3;"); // 소속 정보 제거
            assert.equal(query("SELECT COUNT(*) FROM messages WHERE user_id=3;"), "3"); // 기존 작성 메시지 유지
            assert.equal(query("SELECT COUNT(*) FROM server_members WHERE server_id=1 AND user_id=3;"), "0"); // 멤버십 제거 확인
        }); // 탈퇴 검사 종료
        await context.test("참조 없는 계정 삭제 시 멤버십 정리", () => // 계정 소속 연쇄 삭제
        { // 계정 정리 검사 시작
            query("DELETE FROM users WHERE id=4;"); // 작성 기록 없는 계정 삭제
            assert.equal(query("SELECT COUNT(*) FROM server_members WHERE user_id=4;"), "0"); // 두 서버 소속 제거
        }); // 계정 정리 검사 종료
        await context.test("채널 삭제 시 해당 채널 메시지만 정리", () => // 채널 연쇄 삭제
        { // 채널 삭제 검사 시작
            query("DELETE FROM channels WHERE id=30;"); // 임시 채널 삭제
            assert.equal(query("SELECT COUNT(*) FROM messages WHERE channel_id=30;"), "0"); // 관련 메시지 제거
            assert.equal(query("SELECT COUNT(*) FROM messages WHERE channel_id=10;"), "3"); // 다른 채널 보존
        }); // 채널 삭제 검사 종료
        await context.test("서버 삭제 시 채널 소속 메시지 정리", () => // 서버 연쇄 삭제
        { // 서버 삭제 검사 시작
            query("DELETE FROM servers WHERE id=2;"); // 두 번째 서버 삭제
            assert.equal(query("SELECT COUNT(*) FROM channels WHERE server_id=2;"), "0"); // 소속 채널 제거
            assert.equal(query("SELECT COUNT(*) FROM server_members WHERE server_id=2;"), "0"); // 소속 회원 관계 제거
            assert.equal(query("SELECT COUNT(*) FROM messages WHERE channel_id=20;"), "0"); // 소속 채널 메시지 제거
            assert.equal(query("SELECT COUNT(*) FROM users WHERE id=2;"), "1"); // 사용자 계정 유지
        }); // 서버 삭제 검사 종료
        await context.test("로그인 제한 버킷 고유 키와 기본 횟수", () => // 공유 제한 저장 구조
        { // 버킷 검사 시작
            query("INSERT INTO auth_rate_limits (bucket_key,scope,window_started_at,updated_at) VALUES (REPEAT('a',64),'login_email',UTC_TIMESTAMP(),UTC_TIMESTAMP());"); // 가상 제한 버킷 생성
            assert.equal(query("SELECT attempts FROM auth_rate_limits WHERE bucket_key=REPEAT('a',64);"), "0"); // 기본 시도 수 확인
            rejectsSql("INSERT INTO auth_rate_limits (bucket_key,scope,window_started_at,updated_at) VALUES (REPEAT('a',64),'login_ip',UTC_TIMESTAMP(),UTC_TIMESTAMP());", 1062); // 중복 버킷 차단
        }); // 버킷 검사 종료
        await context.test("기존 테이블 재적용 거절과 데이터 보존", () => // 비파괴 초기 스키마
        { // 재적용 검사 시작
            rejectsSql(readFileSync(schemaPath, "utf8"), 1050); // 중복 스키마 적용 거절
            assert.equal(query("SELECT COUNT(*) FROM messages WHERE channel_id=10;"), "3"); // 기존 메시지 보존
        }); // 재적용 검사 종료
    } // 검증 범위 종료
    finally // 전용 DB 종료 정리
    { // 정리 범위 시작
        query("DROP DATABASE " + database + ";", false); // 무작위 전용 DB만 삭제
    } // 정리 범위 종료
}); // 전체 통합 검증 종료
