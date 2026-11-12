export function realtimeUrlForLocation(location) // 내부망 실시간 주소 계산
{
    const hostname = location?.hostname ?? ''; // 현재 페이지 주소
    const octets = hostname.split('.'); // IPv4 숫자 분리
    if (location?.protocol !== 'http:' || octets.length !== 4 || octets.some((octet) => !/^(0|[1-9]\d{0,2})$/.test(octet) || Number(octet) > 255)) // HTTP와 유효 IPv4 검사
    {
        return null; // 지원하지 않는 주소 차단
    }
    const [first, second] = octets.map(Number); // 네트워크 영역 확인
    if (!(first === 127 || first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168))) // 루프백과 사설망 제한
    {
        return null; // 공개 주소 차단
    }
    return `ws://${hostname}:8090/Team006/realtime`; // 페이지와 같은 호스트 사용
}
export function createRealtimeClient({ url, subscription, WebSocketImpl = globalThis.WebSocket, onMessage = () => undefined, onStateChange = () => undefined, setTimer = (callback, delay) => globalThis.setTimeout(callback, delay), clearTimer = (id) => globalThis.clearTimeout(id), minRetryMs = 1000, maxRetryMs = 30000 }) // 실시간 연결과 외부 경계
{ // 생성 시작
    let active = false; // 연결 수명 상태
    let socket = null; // 현재 연결
    let timer = null; // 재연결 예약
    let failures = 0; // 연속 연결 실패 횟수
    let generation = 0; // 취소된 수명 구분
    function connect() // 현재 수명의 연결 시도
    { // 연결 시작
        if (!active || socket) // 중단 또는 중복 연결 여부
        { // 연결 거절 시작
            return; // 불필요한 연결 중단
        } // 연결 거절 끝
        const currentGeneration = generation; // 현재 수명 번호
        onStateChange("connecting"); // 연결 시도 상태 전달
        if (!active || generation !== currentGeneration) // 상태 처리 중 수명 변경 여부
        { // 수명 변경 시작
            return; // 이전 수명 연결 중단
        } // 수명 변경 끝
        let connection; // 생성할 연결 객체
        let subscribed = false; // 현재 연결의 구독 승인 여부
        try // 브라우저 연결 생성
        { // 생성 시도 시작
            connection = new WebSocketImpl(url); // 인증 쿠키를 사용하는 연결
            socket = connection; // 현재 연결 보관
        } // 생성 시도 끝
        catch // 연결 생성 실패
        { // 생성 실패 시작
            schedule(currentGeneration); // 제한된 재시도 예약
            return; // 실패한 연결 종료
        } // 생성 실패 끝
        function isCurrent() // 이전 연결과 종료 수명 구분
        { // 확인 시작
            return active && generation === currentGeneration && socket === connection; // 현재 연결 여부
        } // 확인 끝
        function fail() // 오류 또는 종료 처리
        { // 실패 처리 시작
            if (!isCurrent()) // 이전 이벤트 여부
            { // 이전 이벤트 시작
                return; // 중복 처리 방지
            } // 이전 이벤트 끝
            socket = null; // 이전 연결 폐기
            try // 오류 뒤 연결 자원 정리
            { // 종료 시도 시작
                connection.close(); // 브라우저 연결 종료
            } // 종료 시도 끝
            catch // 이미 종료된 연결
            { // 종료 실패 시작
            } // 종료 실패 끝
            schedule(currentGeneration); // 후속 재연결 예약
        } // 실패 처리 끝
        connection.onopen = () => // 연결 성공 이벤트
        { // 연결 성공 시작
            if (!isCurrent()) // 취소된 연결 여부
            { // 이전 연결 시작
                return; // 늦은 이벤트 무시
            } // 이전 연결 끝
            try // 현재 채널과 조회 기준 구독
            { // 구독 시작
                const currentSubscription = subscription(); // 최신 구독 기준
                const request = currentSubscription.conversation_id !== undefined ? { type: "subscribe_direct", conversation_id: currentSubscription.conversation_id, after_id: currentSubscription.after_id } : { type: "subscribe", channel_id: currentSubscription.channel_id, after_id: currentSubscription.after_id }; // 구독 대상별 요청
                connection.send(JSON.stringify(request)); // 인증된 구독 요청
            } // 구독 끝
            catch // 구독 정보 또는 전송 오류
            { // 구독 실패 시작
                fail(); // 연결 종료와 재시도
                return; // 성공 상태 전달 중단
            } // 구독 실패 끝
            onStateChange("open"); // 열린 연결 상태 전달
        }; // 연결 성공 끝
        connection.onmessage = (event) => // 서버 신호 수신
        { // 수신 시작
            if (!isCurrent() || typeof event.data !== "string") // 현재 연결과 문자열 확인
            { // 수신 거절 시작
                return; // 이전 또는 지원하지 않는 신호 무시
            } // 수신 거절 끝
            let signal; // 해석된 서버 신호
            try // JSON 형식 확인
            { // 해석 시작
                signal = JSON.parse(event.data); // 서버 신호 해석
            } // 해석 끝
            catch // 잘못된 서버 자료
            { // 해석 실패 시작
                return; // 손상된 신호 무시
            } // 해석 실패 끝
            if (signal?.type === "message.created" && subscribed) // 승인된 새 메시지 존재 신호
            { // 메시지 신호 시작
                onMessage(); // 권한 확인을 포함한 기존 조회 호출
            } // 메시지 신호 끝
            else if (signal?.type === "subscribed") // 서버 구독 승인 신호
            { // 승인 신호 시작
                subscribed = true; // 현재 연결의 구독 승인
                failures = 0; // 구독 성공 뒤 실패 횟수 초기화
                onStateChange("subscribed"); // 구독 완료 상태 전달
            } // 승인 신호 끝
        }; // 수신 끝
        connection.onerror = fail; // 연결 오류 재시도
        connection.onclose = fail; // 연결 종료 재시도
    } // 연결 끝
    function schedule(currentGeneration) // 제한된 지수 간격 재연결
    { // 예약 시작
        if (!active || generation !== currentGeneration || timer !== null) // 종료 또는 중복 예약 여부
        { // 예약 거절 시작
            return; // 추가 예약 중단
        } // 예약 거절 끝
        const delay = Math.min(maxRetryMs, minRetryMs * (2 ** Math.min(failures, 30))); // 재시도 대기 상한
        failures += 1; // 연속 실패 횟수 증가
        onStateChange("closed"); // 연결 종료 상태 전달
        if (!active || generation !== currentGeneration) // 상태 처리 중 종료 여부
        { // 종료 확인 시작
            return; // 취소된 수명의 예약 방지
        } // 종료 확인 끝
        timer = setTimer(() => // 지연된 재연결
        { // 타이머 시작
            if (!active || generation !== currentGeneration) // 취소된 타이머 여부
            { // 취소 확인 시작
                return; // 이전 수명의 연결 방지
            } // 취소 확인 끝
            timer = null; // 실행된 예약 제거
            connect(); // 현재 수명 재연결
        }, delay); // 제한된 대기 적용
    } // 예약 끝
    return ( // 공개 수명 도구 반환
    { // 반환 객체 시작
        start() // 연결 수명 시작
        { // 시작 처리 시작
            if (active) // 이미 시작한 수명 여부
            { // 중복 시작 확인
                return; // 중복 연결 방지
            } // 중복 시작 끝
            active = true; // 연결 허용
            failures = 0; // 새 수명의 실패 횟수 초기화
            generation += 1; // 새 수명 구분
            connect(); // 최초 연결
        }, // 시작 처리 끝
        stop() // 연결 수명 종료
        { // 종료 처리 시작
            if (!active) // 이미 종료된 수명 여부
            { // 중복 종료 확인
                return; // 중복 종료 방지
            } // 중복 종료 끝
            active = false; // 새 연결 방지
            generation += 1; // 대기 중 이벤트 무효화
            if (timer !== null) // 예약 존재 여부
            { // 예약 취소 시작
                clearTimer(timer); // 재연결 예약 취소
                timer = null; // 예약 참조 제거
            } // 예약 취소 끝
            const previousSocket = socket; // 종료할 연결 보관
            socket = null; // 늦은 연결 이벤트 무효화
            if (previousSocket) // 연결 존재 여부
            { // 연결 정리 시작
                try // 브라우저 연결 종료
                { // 종료 시도 시작
                    previousSocket.close(); // 연결 종료 요청
                } // 종료 시도 끝
                catch // 이미 종료된 연결
                { // 종료 실패 시작
                } // 종료 실패 끝
            } // 연결 정리 끝
            onStateChange("closed"); // 종료 상태 전달
        }, // 종료 처리 끝
    }); // 반환 객체 끝
} // 생성 끝
