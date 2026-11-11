import { execFileSync } from "node:child_process"; // 실제 마이그레이션 실행
import assert from "node:assert/strict"; // 실제 응답 검사
import test from "node:test"; // 기본 검사 도구
import { readFileSync } from "node:fs"; // 실제 마이그레이션 읽기
import path from "node:path"; // 경로 조합
import { fixture } from "./helpers/management-fixture.mjs"; // 독립 MySQL과 PHP

test("프로필 상태와 차단 및 안전한 사진", async (context) => // 인증과 실제 데이터 검사
{
    let origin = ""; // 검사 서버 주소
    const originalFetch = globalThis.fetch; // 실제 fetch 보관
    globalThis.fetch = (url, options) => // 검사 서버 주소 확인
    {
        origin = new URL(url).origin; // 실제 요청 출처
        return originalFetch(url, options); // 원래 요청 수행
    }; // fetch 래퍼 종료
    context.after(() => // 전역 요청 복원
    {
        globalThis.fetch = originalFetch; // 원래 fetch 복원
    }); // 정리 경계
    const testFixture = await fixture(context); // 검사 전용 데이터베이스
    testFixture.sql(readFileSync(path.join(testFixture.root, "backend/sql/migrations/002_direct_messages.sql"), "utf8")); // 개인 대화 구조 적용
    const migration = () => execFileSync(testFixture.php, ["-c", process.env.PHP_TEST_INI || path.join(testFixture.root, ".runtime/php.ini"), path.join(testFixture.root, "scripts/migrate-003.php")], { env: testFixture.env, encoding: "utf8", windowsHide: true, stdio: "pipe" }); // 보존형 변경 도구
    assert.match(migration(), /003/); // 확장 프로필 적용
    assert.throws(migration); // 재실행 차단
    const owner = await testFixture.account("detail_owner"); // 상태 변경 계정
    const other = await testFixture.account("detail_other"); // 차단 대상 계정
    const detail = (actor, target) => actor.request("profile_details.php?user_id=" + target); // 공개 상태 조회
    const change = (actor, status) => actor.request("profile_details.php", { status_message: status }, {}, "PATCH"); // 본인 상태 변경
    const block = (actor, target, method = "POST") => actor.request("user_blocks.php", { user_id: target }, {}, method); // 차단 변경
    assert.equal((await detail(testFixture.client(), owner.id)).status, 401); // 비로그인 조회 차단
    assert.deepEqual((await detail(other, owner.id)).data.profile, { id: owner.id, username: "detail_owner", status_message: "", has_picture: false }); // 기본 공개 상태
    assert.equal((await change(owner, "안녕하세요")).status, 200); // 본인 상태 저장
    assert.equal((await detail(other, owner.id)).data.profile.status_message, "안녕하세요"); // 타인의 공개 상태 조회
    assert.equal((await change(owner, "x".repeat(201))).status, 422); // 상태 길이 제한
    assert.equal((await change(owner, "")).status, 200); // 빈 상태 복원
    assert.equal((await owner.request("profile_details.php", { status_message: "x", user_id: other.id }, {}, "PATCH")).status, 422); // 타인 변경 필드 차단
    assert.equal((await owner.request("profile_details.php", { status_message: "x" }, { "X-CSRF-Token": "wrong" }, "PATCH")).status, 403); // 위조 요청 차단
    assert.equal((await block(owner, owner.id)).status, 422); // 본인 차단 금지
    assert.equal((await block(owner, other.id)).status, 200); // 차단 저장
    assert.equal((await block(owner, other.id)).status, 200); // 중복 차단 허용
    assert.deepEqual((await owner.request("user_blocks.php")).data.users, [{ id: other.id, username: "detail_other" }]); // 본인 차단 목록
    assert.deepEqual((await other.request("user_blocks.php")).data.users, []); // 상대 차단 여부 비노출
    assert.equal((await block(other, owner.id)).status, 200); // 상대도 차단
    assert.equal((await block(owner, other.id, "DELETE")).status, 200); // 본인 차단 해제
    assert.deepEqual((await other.request("user_blocks.php")).data.users, [{ id: owner.id, username: "detail_owner" }]); // 상대 차단 보존
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAADElEQVQImWNg+M8AAAICAQAuFKzOAAAAAElFTkSuQmCC", "base64"); // 검증된 한 픽셀 PNG
    const upload = async (bytes, token = owner.token) => // 실제 multipart 업로드
    {
        const form = new FormData(); // 파일 전송 본문
        form.append("picture", new Blob([bytes], { type: "image/png" }), "avatar.png"); // 검사 파일
        const response = await originalFetch(origin + "/Team006/backend/api/profile_picture.php", { method: "POST", headers: { Cookie: owner.cookie, "X-Expected-User-Id": owner.id, "X-CSRF-Token": token }, body: form }); // 세션과 요청 토큰
        return { status: response.status, body: await response.json() }; // JSON 결과
    }; // 업로드 함수 끝
    assert.equal((await upload(png, "wrong")).status, 403); // 사진 CSRF 차단
    assert.equal((await upload(Buffer.from("not an image"))).status, 422); // 위조 사진 차단
    assert.equal((await upload(Buffer.alloc(1048577))).status, 422); // 사진 바이트 상한
    assert.equal((await upload(png.subarray(0, 40))).status, 422); // 서명만 있는 손상 사진 차단
    assert.equal((await upload(png)).status, 200); // 정상 이미지 저장
    assert.equal((await detail(other, owner.id)).data.profile.has_picture, true); // 사진 존재 공개
    assert.equal((await upload(Buffer.from("malformed"))).status, 422); // 저장된 사진 위조 변경 차단
    assert.equal((await detail(other, owner.id)).data.profile.has_picture, true); // 기존 사진 보존
    const imageResponse = await originalFetch(origin + "/Team006/backend/api/profile_picture.php?user_id=" + owner.id, { headers: { Cookie: other.cookie, "X-Expected-User-Id": other.id } }); // 로그인 사용자의 사진 조회
    assert.equal(imageResponse.status, 200); // 사진 조회 성공
    assert.equal(imageResponse.headers.get("content-type"), "image/png"); // 서버 판별 유형
    assert.equal(imageResponse.headers.get("x-content-type-options"), "nosniff"); // 형식 추측 차단
    assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()).subarray(0, 8), png.subarray(0, 8)); // 실제 PNG 서명
    assert.equal((await owner.request("profile_picture.php", {}, {}, "DELETE")).status, 200); // 사진 삭제
    assert.equal((await detail(other, owner.id)).data.profile.has_picture, false); // 삭제 상태 반영
    assert.equal((await detail(other, owner.id)).data.profile.status_message, ""); // 상태 메시지 보존
}); // 검사 종료
