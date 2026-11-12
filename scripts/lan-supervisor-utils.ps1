function Select-SystemMakersLanAddress # 사설 IPv4 선택
{
    param([string[]]$candidates) # 검사할 주소 목록
    foreach ($candidate in $candidates) # 네트워크 주소 순회
    {
        $address = [Net.IPAddress]::None # 주소 변환 결과
        if (-not [Net.IPAddress]::TryParse($candidate, [ref]$address) -or $address.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) # 유효 IPv4 검사
        {
            continue # 잘못된 주소 제외
        }
        $octets = $address.GetAddressBytes() # 네트워크 구간
        $private = $octets[0] -eq 10 -or ($octets[0] -eq 172 -and $octets[1] -ge 16 -and $octets[1] -le 31) -or ($octets[0] -eq 192 -and $octets[1] -eq 168) # 사설망 주소 확인
        if ($private) # 공유 가능한 사설 주소
        {
            return $address.ToString() # 첫 번째 사설 주소 반환
        }
    }
    return $null # 사설 주소 없음
}
function Get-SystemMakersWifiAddress # 현재 와이파이 IPv4 조회
{
    $interfaces = [Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() | Where-Object { $_.NetworkInterfaceType -eq [Net.NetworkInformation.NetworkInterfaceType]::Wireless80211 -and $_.OperationalStatus -eq [Net.NetworkInformation.OperationalStatus]::Up } # 연결된 무선 장치
    foreach ($networkInterface in $interfaces) # 무선 장치 순회
    {
        $networkProperties = $networkInterface.GetIPProperties() # 장치 주소와 경로
        if (@($networkProperties.GatewayAddresses | Where-Object { $_.Address.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork }).Count -eq 0) # 기본 경로 확인
        {
            continue # 외부 경로 없는 가상 장치 제외
        }
        $candidates = @($networkProperties.UnicastAddresses | Where-Object { $_.Address.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork } | ForEach-Object { $_.Address.ToString() }) # IPv4 후보
        $selected = Select-SystemMakersLanAddress -Candidates $candidates # 사설 주소 선택
        if ($selected) # 선택 성공
        {
            return $selected # 현재 와이파이 주소 반환
        }
    }
    return $null # 연결된 와이파이 없음
}
function Test-SystemMakersListener # 기존 수신 소켓 검사
{
    param([string]$address, [int]$port) # 확인할 주소와 포트
    $client = [Net.Sockets.TcpClient]::new() # 검사 연결 생성
    try # 시간 제한 연결
    {
        $pending = $client.BeginConnect($address, $port, $null, $null) # 비동기 연결 시작
        if (-not $pending.AsyncWaitHandle.WaitOne(750)) # 연결 지연 제한
        {
            return $false # 응답 없는 포트
        }
        $client.EndConnect($pending) # 연결 완료 확인
        return $true # 사용 중인 포트
    }
    catch # 연결 거절과 오류
    {
        return $false # 사용하지 않는 포트
    }
    finally # 검사 연결 정리
    {
        $client.Dispose() # 소켓 해제
    }
}
