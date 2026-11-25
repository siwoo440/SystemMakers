import { request as requestHttp } from 'node:http'; // 로컬 HTTP 전송
import { request as requestHttps } from 'node:https'; // 인증서를 확인하는 HTTPS 전송
import { Readable } from 'node:stream'; // 실제 응답 스트림 변환
export function uploadMultipart(url, session, kind, targetId, bytes, name = 'container.bin', token = session.token) // 대용량 원본의 추가 복사 없는 실제 전송
{
    const boundary = 'SystemMakersAttachmentBoundary'; // 검사 전용 multipart 경계
    const prefix = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\n${kind}\r\n--${boundary}\r\nContent-Disposition: form-data; name="target_id"\r\n\r\n${targetId}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`); // 실제 브라우저 형식의 파일 앞부분
    const suffix = Buffer.from(`\r\n--${boundary}--\r\n`); // multipart 종료 경계
    const request = url.startsWith('https:') ? requestHttps : requestHttp; // 실제 연결 방식
    return new Promise((resolve, reject) => // 실제 응답 준비
    {
        const outgoing = request(url, { method: 'POST', headers: { Cookie: session.cookie, 'X-Expected-User-Id': session.id, 'X-CSRF-Token': token, 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': prefix.length + bytes.length + suffix.length }, timeout: 900000 }, (incoming) => // 15분 대용량 전송과 정확한 본문 길이
        {
            resolve(new Response(Readable.toWeb(incoming), { status: incoming.statusCode, headers: incoming.headers })); // 원래 HTTP 상태와 응답 스트림
        });
        outgoing.on('error', reject); // 연결 실패 전달
        outgoing.on('timeout', () => outgoing.destroy(new Error('첨부 검사 요청 시간 초과'))); // 무한 전송 대기 차단
        outgoing.write(prefix); // 파일 입력 필드 전송
        outgoing.write(bytes); // 전체 Blob 복사 없이 원본 전송
        outgoing.end(suffix); // 실제 요청 종료
    });
}
