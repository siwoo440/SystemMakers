. (Join-Path $PSScriptRoot 'lan-supervisor-utils.ps1') # 와이파이와 포트 검사 함수
$wifiAddress = Get-SystemMakersWifiAddress # 현재 와이파이 주소
if (-not $wifiAddress) # 사설 와이파이 미연결
{
    Write-Output '사설 Wi-Fi 연결을 확인하세요.' # 연결 안내
    exit 1 # 주소 조회 실패
}
$siteUrl = "http://${wifiAddress}:8088/Team006/index.html" # 현재 사이트 주소
Write-Output "사이트 주소: $siteUrl" # 공유할 주소 출력
if (-not (Test-SystemMakersListener -Address $wifiAddress -Port 8088)) # 웹 서버 상태 확인
{
    Write-Output '웹 서버가 아직 준비되지 않았습니다. 잠시 후 다시 확인하세요.' # 자동 복구 대기 안내
}
