const validId = (value) => typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value) && (value.length < 20 || value <= "18446744073709551615"); // 문자열 사용자 식별자 검사
const validUser = (user) => user && validId(user.id) && typeof user.username === "string" && user.username.length > 0; // 공개 사용자 검사
export function mountFriendsUI({ byId, request, getUser, isReady, onOpen, onError }) // 친구 목록과 요청 화면 연결
{
    let identity = null; // 확인된 계정 식별자
    let version = 0; // 계정 수명 번호
    let searchVersion = 0; // 검색 결과 순서
    let requestBusy = false; // 중복 변경 차단
    let listBusy = false; // 중복 조회 차단
    let timer = null; // 후속 조회 예약
    let searchController = null; // 이전 검색 취소 도구
    function clear() // 로그아웃과 계정 변경
    {
        version++; // 이전 응답 무효화
        searchVersion++; // 이전 검색 무효화
        identity = null; // 이전 계정 제거
        requestBusy = false; // 이전 변경 잠금 제거
        listBusy = false; // 이전 조회 잠금 제거
        window.clearTimeout(timer); // 이전 갱신 예약 취소
        searchController?.abort(); // 이전 검색 취소
        byId("friend-search-input").value = ""; // 이전 검색어 제거
        for (const elementId of ["friend-search-results", "friend-list", "friend-incoming", "friend-outgoing"]) // 계정별 목록
        {
            byId(elementId).replaceChildren(); // 이전 사용자 목록 제거
        }
        byId("friend-status").textContent = "로그인 후 친구를 확인하세요."; // 게스트 안내
    }
    function render() // 로그인과 보호 정보 상태
    {
        const ready = Boolean(getUser() && isReady()); // 실제 사용 가능 상태
        byId("friend-search-input").disabled = !ready || requestBusy; // 검색 입력 제한
        byId("friend-search-submit").disabled = !ready || requestBusy; // 검색 동작 제한
        byId("friend-refresh").disabled = !ready || requestBusy; // 수동 조회 제한
        if (ready && identity !== getUser().id) // 새 계정의 최초 조회
        {
            identity = getUser().id; // 중복 조회 방지
            refresh(); // 친구와 요청 조회
        }
    }
    function schedule() // 현재 계정의 자동 갱신
    {
        window.clearTimeout(timer); // 이전 예약 제거
        if (identity && getUser()?.id === identity) // 같은 계정 유지 여부
        {
            timer = window.setTimeout(refresh, 15000); // 15초 뒤 요청 확인
        }
    }
    async function report(error, requestVersion, userId) // 이전 계정 오류 차단
    {
        if (requestVersion !== version || getUser()?.id !== userId) // 계정 수명 확인
        {
            return; // 오래된 오류 무시
        }
        const message = await onError(error); // 기존 인증 오류 처리
        if (requestVersion === version && getUser()?.id === userId) // 오류 처리 후 계정 재검사
        {
            byId("friend-status").textContent = message || "친구 목록을 확인하지 못했습니다."; // 현재 계정 오류 안내
        }
    }
    function button(text, title, action) // 이름과 기능이 있는 버튼
    {
        const element = document.createElement("button"); // 실제 버튼 생성
        element.type = "button"; // 폼 제출 방지
        element.textContent = text; // 안전한 버튼 글자
        element.title = title; // 마우스 설명
        element.setAttribute("aria-label", title); // 보조 기술 설명
        element.addEventListener("click", action); // 명시적 동작 연결
        return element; // 생성된 버튼
    }
    function row(user, kind) // 친구 또는 요청 한 칸
    {
        const element = document.createElement("div"); // 사용자 항목
        element.className = "friend-row"; // 사용자 칸 스타일
        if (kind === "friends") // 수락된 친구
        {
            const name = button(user.username, user.username + "님과 대화", () => onOpen(user)); // 개인 대화 시작
            name.className = "friend-name"; // 긴 이름 정렬
            element.append(name, button("×", user.username + " 친구 삭제", () => change("remove", user))); // 대화와 관계 제거
        }
        else // 검색 결과 또는 대기 요청
        {
            const name = document.createElement("span"); // 이름 표시
            name.className = "friend-name"; // 긴 이름 정렬
            name.textContent = user.username; // HTML 실행 없는 이름
            element.append(name); // 확인된 사용자 표시
            if (kind === "incoming") // 받은 요청
            {
                element.append(button("수락", user.username + " 친구 요청 수락", () => change("accept", user)), button("거절", user.username + " 친구 요청 거절", () => change("decline", user))); // 명시적 수락과 거절
            }
            else if (kind === "outgoing") // 보낸 요청
            {
                element.append(button("취소", user.username + " 친구 요청 취소", () => change("cancel", user))); // 대기 요청 취소
            }
            else // 검색 결과
            {
                element.append(button("추가", user.username + " 친구 요청", () => change("request", user))); // 상대방에게 수락 요청
            }
        }
        return element; // 완성된 사용자 칸
    }
    async function refresh() // 서버의 친구와 요청 확인
    {
        const userId = getUser()?.id; // 조회 계정
        if (!userId || identity !== userId || listBusy || !isReady()) // 계정과 중복 조회 검사
        {
            schedule(); // 일시적 잠금 이후 재확인
            return; // 현재 조회 중단
        }
        const requestVersion = version; // 현재 계정 수명
        listBusy = true; // 중복 조회 방지
        try // 인증된 친구 목록 요청
        {
            const data = await request("./backend/api/friends.php"); // 실제 친구 관계 조회
            if (requestVersion !== version || getUser()?.id !== userId) // 이전 계정 응답
            {
                return; // 이전 사용자 목록 무시
            }
            for (const key of ["friends", "incoming", "outgoing"]) // 공개 목록 검증
            {
                if (!Array.isArray(data[key]) || data[key].some((user) => !validUser(user) || user.id === userId)) // 응답 형식 검사
                {
                    throw new Error("친구 목록 응답을 확인하지 못했습니다."); // 잘못된 목록 차단
                }
            }
            byId("friend-list").replaceChildren(...data.friends.map((user) => row(user, "friends"))); // 수락된 친구 세로 표시
            byId("friend-incoming").replaceChildren(...data.incoming.map((user) => row(user, "incoming"))); // 받은 요청 표시
            byId("friend-outgoing").replaceChildren(...data.outgoing.map((user) => row(user, "outgoing"))); // 보낸 요청 표시
            byId("friend-status").textContent = data.friends.length ? "친구 " + data.friends.length + "명" : "수락된 친구가 없습니다."; // 현재 목록 안내
        }
        catch (error) // 실제 조회 실패
        {
            await report(error, requestVersion, userId); // 현재 계정 오류 안내
        }
        finally // 현재 조회 종료
        {
            if (requestVersion === version) // 여전히 같은 계정
            {
                listBusy = false; // 조회 잠금 해제
                schedule(); // 다음 요청 확인 예약
            }
        }
    }
    async function change(action, user) // 친구 요청 또는 관계 변경
    {
        const userId = getUser()?.id; // 현재 계정
        const requestVersion = version; // 계정 수명
        if (!userId || !isReady() || requestBusy || !validUser(user)) // 중복과 대상 검사
        {
            return; // 변경 중단
        }
        requestBusy = true; // 변경 잠금
        render(); // 입력 상태 갱신
        try // 명시적 변경 요청
        {
            await request("./backend/api/friends.php", { action, user_id: user.id }); // 서버 권한과 CSRF 확인
            if (requestVersion !== version || getUser()?.id !== userId) // 이전 계정 응답
            {
                return; // 이전 결과 무시
            }
            byId("friend-search-results").replaceChildren(); // 이전 검색 결과 제거
            byId("friend-status").textContent = action === "request" ? "친구 요청을 보냈습니다." : "친구 관계를 변경했습니다."; // 변경 안내
            await refresh(); // 실제 관계 재조회
        }
        catch (error) // 변경 실패
        {
            await report(error, requestVersion, userId); // 실제 오류 표시
        }
        finally // 현재 변경 종료
        {
            if (requestVersion === version) // 같은 계정 여부
            {
                requestBusy = false; // 변경 잠금 해제
                render(); // 조작 가능 상태 복구
            }
        }
    }
    byId("friend-search-form").addEventListener("submit", async (event) => // 명시적 친구 검색
    {
        event.preventDefault(); // 페이지 이동 방지
        const userId = getUser()?.id; // 현재 계정
        const searchTerm = byId("friend-search-input").value.trim(); // 입력한 사용자명
        if (!userId || !isReady() || !/^[a-zA-Z0-9_가-힣]{1,32}$/u.test(searchTerm)) // 검색 형식 검사
        {
            byId("friend-status").textContent = "사용자명을 확인하세요."; // 검색 조건 안내
            return; // 잘못된 검색 중단
        }
        const requestVersion = version; // 계정 수명
        const searchOrder = ++searchVersion; // 최신 검색 순서
        searchController?.abort(); // 이전 검색 취소
        const controller = new AbortController(); // 이번 검색 취소 도구
        searchController = controller; // 계정 종료 연결
        try // 실제 사용자 검색
        {
            const data = await request("./backend/api/search_users.php?" + new URLSearchParams({ q: searchTerm }), null, controller.signal); // 검색어 인코딩
            if (requestVersion !== version || searchOrder !== searchVersion || getUser()?.id !== userId) // 이전 계정과 검색 결과
            {
                return; // 오래된 결과 무시
            }
            if (!Array.isArray(data.users) || data.users.some((user) => !validUser(user) || user.id === userId)) // 공개 사용자 형식
            {
                throw new Error("검색 결과를 확인하지 못했습니다."); // 잘못된 검색 결과 차단
            }
            byId("friend-search-results").replaceChildren(...data.users.map((user) => row(user, "search"))); // 요청할 사용자 표시
            byId("friend-status").textContent = data.users.length ? "친구 요청을 보낼 사용자를 선택하세요." : "일치하는 사용자가 없습니다."; // 검색 결과 안내
        }
        catch (error) // 검색 오류
        {
            if (searchOrder === searchVersion) // 최신 검색 오류 여부
            {
                await report(error, requestVersion, userId); // 현재 계정 오류 안내
            }
        }
    }); // 검색 연결 끝
    byId("friend-search-input").addEventListener("input", () => // 검색어 변경
    {
        searchVersion++; // 이전 결과 무효화
        searchController?.abort(); // 이전 검색 취소
        byId("friend-search-results").replaceChildren(); // 이전 결과 제거
    }); // 검색어 연결 끝
    byId("friend-refresh").addEventListener("click", refresh); // 명시적 목록 확인
    return { render, refresh, clear }; // 계정과 목록 수명 연결
}
