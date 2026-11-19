import assert from 'node:assert/strict'; // 실제 복원 결과 검사
import { execFileSync } from 'node:child_process'; // Docker와 별도 Node 실행
import { randomBytes } from 'node:crypto'; // 격리된 검사 비밀 값
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'; // 검사 CA와 백업 보관
import { createServer } from 'node:net'; // 빈 검사 포트 확인
import path from 'node:path'; // 검사 파일 위치
import { until } from '../tests/helpers/websocket.mjs'; // 제한된 상태 대기
assert.equal(process.env.SYSTEMMAKERS_DOCKER_TEST, '1', '격리된 검사 실행 표시 필요'); // 운영 오실행 방지
mkdirSync('.runtime', { recursive: true }); // Git 제외 검사 폴더
const scratch = mkdtempSync(path.resolve('.runtime/docker-ci-')); // 이번 실행만의 자료
const project = `smtest${randomBytes(5).toString('hex')}`; // 운영과 다른 볼륨 이름
async function freePort() // 빈 루프백 포트 선택
{
    const server = createServer(); // 임시 포트 예약
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); // 사용 가능한 포트 할당
    const port = server.address().port; // 선택 포트 확인
    await new Promise((resolve) => server.close(resolve)); // 임시 예약 해제
    return String(port); // Compose 설정 값
}
const httpPort = await freePort(); // 검사 HTTP 포트
const httpsPort = await freePort(); // 검사 HTTPS 포트
const proxySegment = 20 + Math.floor(Math.random() * 180); // 실행별 검사 연결망 구분
const environment = { ...process.env, APP_IMAGE: `${project}-php:local`, APP_DOMAIN: 'localhost', MYSQL_DATABASE: 'systemmakers_ci', MYSQL_USER: 'systemmakers_ci', MYSQL_PASSWORD: randomBytes(24).toString('hex'), MYSQL_ROOT_PASSWORD: randomBytes(24).toString('hex'), AUTH_RATE_LIMIT_KEY: randomBytes(32).toString('hex'), PROXY_SUBNET: `172.29.${proxySegment}.0/24`, PROXY_DYNAMIC_RANGE: `172.29.${proxySegment}.128/25`, CADDY_PROXY_IP: `172.29.${proxySegment}.2`, TEST_HTTP_PORT: httpPort, TEST_HTTPS_PORT: httpsPort }; // 운영 비밀 값과 이미지 이름을 사용하지 않는 검사
const baseArguments = ['compose', '-f', 'compose.yaml', '-f', 'docker/compose.test.yaml']; // 승인한 운영 구성에 검사 포트 적용
function compose(args, options = {}, selectedProject = project, selectedEnvironment = environment) // 프로젝트를 제한한 Docker 실행
{
    return execFileSync('docker', [...baseArguments, '-p', selectedProject, ...args], { env: selectedEnvironment, timeout: 600000, maxBuffer: 32 * 1024 * 1024, stdio: 'inherit', ...options }); // 실패 결과를 숨기지 않는 실행
}
function admin(operation, options = {}, selectedProject = project, selectedEnvironment = environment) // 명시적 격리 DB 관리
{
    return compose(['exec', '-T', 'database', 'sh', '/opt/systemmakers/database.sh', operation], options, selectedProject, selectedEnvironment); // 실제 DB 관리 도구
}
const snapshotQuery = 'SELECT COUNT(*) FROM users; SELECT COUNT(*) FROM messages; SELECT COUNT(*) FROM direct_messages; SELECT id,SHA2(file_data,256) FROM message_attachments ORDER BY id'; // 계정·대화·바이너리 보존 기준
function snapshot(selectedProject = project, selectedEnvironment = environment) // 비밀 값 없는 데이터 비교
{
    return compose(['exec', '-T', 'database', 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -u root "$MYSQL_DATABASE" -NB'], { input: snapshotQuery, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8' }, selectedProject, selectedEnvironment).trim(); // 실제 원본과 복원본 결과
}
let restoreProject = null; // 정리할 별도 복원 프로젝트
let restoreEnvironment = null; // 복원망 설정
try // 실패 시에도 검사 자원 정리
{
    compose(['config', '-q']); // Compose 문법과 누락 설정 검사
    compose(['build']); // 실제 PHP 이미지 빌드와 런타임 기능 확인
    compose(['run', '--rm', '--no-deps', 'proxy', 'caddy', 'validate', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile']); // 실제 Caddy 설정 문법
    compose(['up', '-d', '--wait', '--wait-timeout', '180']); // 실제 DB·웹·Ratchet 시작
    compose(['exec', '-T', 'web', 'apachectl', '-t']); // Apache 운영 진입점 문법
    admin('bootstrap-empty'); // 빈 검사 DB만 명시적으로 준비
    admin('restrict-app'); // 실제 DML 전용 계정으로 앱 검사
    const rootCertificate = path.join(scratch, 'root.crt'); // 이번 검사 CA 파일
    await until(() => // CA 발급 완료 대기
    {
        try // 발급 중 파일 누락 처리
        {
            compose(['cp', 'proxy:/data/caddy/pki/authorities/local/root.crt', rootCertificate], { stdio: 'pipe' }); // 검사 CA만 추출
            return true; // CA 준비 완료
        }
        catch // 초기 발급 진행 중
        {
            return false; // 제한된 재확인
        }
    }, 15000); // 인증서 준비 마감
    const testEnvironment = { ...environment, DOCKER_INTEGRATION_URL: `https://localhost:${httpsPort}`, NODE_EXTRA_CA_CERTS: rootCertificate }; // 인증서 검증을 유지하는 검사 설정
    execFileSync(process.execPath, ['--test', 'tests/docker-flow.test.mjs'], { env: testEnvironment, stdio: 'inherit', timeout: 120000 }); // 실제 HTTPS와 WSS 전체 흐름
    const redirect = await fetch(`http://127.0.0.1:${httpPort}/Team006/`, { redirect: 'manual' }); // HTTP 이동 확인
    assert.equal(redirect.status, 308); // HTTPS 이동 유지
    compose(['restart', 'database']); // 기존 PDO 연결의 장애 유발
    await new Promise((resolve) => setTimeout(resolve, 12000)); // DB 감시와 프로세스 재시작 유예
    execFileSync(process.execPath, ['--test', 'tests/docker-flow.test.mjs'], { env: testEnvironment, stdio: 'inherit', timeout: 120000 }); // DB 복구 뒤 실제 로그인과 WSS 재확인
    const before = snapshot(); // 재생성 전 기준
    const backup = admin('backup', { stdio: ['pipe', 'pipe', 'pipe'] }); // 실제 논리 백업
    writeFileSync(path.join(scratch, 'backup.sql'), backup); // Git 제외 백업 보관
    compose(['up', '-d', '--force-recreate', '--wait', '--wait-timeout', '180']); // 볼륨을 유지한 전체 컨테이너 재생성
    assert.equal(snapshot(), before); // 계정·대화·첨부 영속성 확인
    compose(['down']); // 원본 검사 볼륨은 유지한 채 네트워크 해제
    restoreProject = `${project}restore`; // 새로운 복원 볼륨 구분
    restoreEnvironment = { ...environment, PROXY_SUBNET: `172.28.${proxySegment}.0/24`, PROXY_DYNAMIC_RANGE: `172.28.${proxySegment}.128/25`, CADDY_PROXY_IP: `172.28.${proxySegment}.2` }; // 복원 전용 연결망
    compose(['up', '-d', '--wait', '--wait-timeout', '180'], {}, restoreProject, restoreEnvironment); // 별도 빈 DB 시작
    admin('restore-empty', { input: backup, stdio: ['pipe', 'pipe', 'pipe'] }, restoreProject, restoreEnvironment); // 새 볼륨으로만 복원
    admin('restrict-app', {}, restoreProject, restoreEnvironment); // 복원 후 앱 최소 권한
    assert.equal(snapshot(restoreProject, restoreEnvironment), before); // 원본과 복원 데이터 비교
    console.log('컨테이너 HTTPS·WSS·권한·세션·DB 장애 복구·영속성·백업 복원 검사 통과'); // 확인한 결과만 보고
}
finally // 이번 검사 프로젝트만 정리
{
    for (const [selectedProject, selectedEnvironment] of [[project, environment], [restoreProject, restoreEnvironment]]) // 생성한 검사 대상만 선택
    {
        if (selectedProject?.startsWith('smtest')) // 운영 프로젝트 이름 제외
        {
            compose(['logs', '--no-color', '--tail', '60'], { stdio: 'inherit' }, selectedProject, selectedEnvironment); // 실패 원인과 서비스 결과 기록
            compose(['down', '--volumes', '--remove-orphans'], {}, selectedProject, selectedEnvironment); // 생성한 검사 볼륨만 삭제
        }
    }
}
