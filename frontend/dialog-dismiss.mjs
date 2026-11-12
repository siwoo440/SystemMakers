export function bindBackdropDismiss(dialog, canDismiss = () => true) // 대화상자 바깥 닫기 연결
{
    dialog.addEventListener("click", (uiEvent) => // 실제 클릭 위치 확인
    {
        if (!canDismiss() || uiEvent.target !== dialog) // 요청 중 또는 내부 요소 선택
        {
            return; // 닫기 생략
        }
        const bounds = dialog.getBoundingClientRect(); // 대화상자 화면 경계
        if (uiEvent.clientX < bounds.left || uiEvent.clientX > bounds.right || uiEvent.clientY < bounds.top || uiEvent.clientY > bounds.bottom) // 실제 바깥 영역
        {
            dialog.close(); // 기존 닫기 정리 실행
        }
    }); // 바깥 클릭 연결 끝
} // 공통 처리 끝
