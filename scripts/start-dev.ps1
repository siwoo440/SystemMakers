param # 개발 서버 인수
( # 인수 목록 시작
    [int]$Port = 8088, # 로컬 웹 포트
    [string]$PhpPath = '' # 별도 PHP 실행 경로
) # 인수 목록 종료
$ErrorActionPreference = 'Stop' # 실행 오류 즉시 중단
$siteProjectRoot = Split-Path -Parent $PSScriptRoot # 저장소 루트 계산
$siteLocalSettings = Join-Path $siteProjectRoot '.runtime/web-env.json' # 개인 실행 설정 위치
if (Test-Path -LiteralPath $siteLocalSettings) # 개인 설정 존재 여부
{
    $siteConfiguration = Get-Content -LiteralPath $siteLocalSettings -Raw -Encoding UTF8 | ConvertFrom-Json # 개인 설정 읽기
    foreach ($siteProperty in $siteConfiguration.PSObject.Properties) # 실행 설정 순회
    {
        [Environment]::SetEnvironmentVariable($siteProperty.Name, [string]$siteProperty.Value, 'Process') # 현재 프로세스에만 적용
    }
}
if ([string]::IsNullOrWhiteSpace($PhpPath)) # PHP 경로 자동 선택
{
    $PhpPath = Join-Path $siteProjectRoot '.runtime/php/php.exe' # 프로젝트 전용 PHP 선택
}
if (-not (Test-Path -LiteralPath $PhpPath)) # 실행 도구 확인
{
    throw 'PHP 실행 경로를 -PhpPath 인수로 지정하세요.' # 누락된 도구 안내
}
if ($Port -lt 1024 -or $Port -gt 65535) # 웹 포트 범위 확인
{
    throw '웹 포트는 1024~65535 사이여야 합니다.' # 포트 입력 오류 안내
}
$sitePortProbe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port) # 같은 로컬 주소의 포트 검사
try # 포트 사용 가능 여부 확인
{
    $sitePortProbe.Start() # 임시 포트 예약
}
catch [Net.Sockets.SocketException] # 포트 예약 오류 확인
{
    if ($_.Exception.SocketErrorCode -eq [Net.Sockets.SocketError]::AddressAlreadyInUse) # 기존 서버의 포트 점유
    {
        throw "포트 $Port 사용 중입니다. -Port 인수로 다른 포트를 지정하세요." # 기존 서버 충돌 방지
    }
    throw # 다른 연결 오류 전달
}
finally # 포트 검사 종료
{
    $sitePortProbe.Stop() # 임시 예약 해제
}
$sitePhpArguments = @() # PHP 실행 옵션
$sitePhpIni = Join-Path $siteProjectRoot '.runtime/php.ini' # 검증용 PHP 설정
if (Test-Path -LiteralPath $sitePhpIni) # 별도 PHP 설정 여부
{
    $sitePhpArguments += @('-c', $sitePhpIni) # MySQL 확장과 세션 설정 적용
}
$sitePhpArguments += @('-S', "127.0.0.1:$Port", '-t', (Join-Path $siteProjectRoot 'frontend'), (Join-Path $siteProjectRoot 'router.php')) # 로컬 전용 웹 경로
Write-Output "SystemMakers: http://127.0.0.1:$Port/" # 사용자 접속 주소
& $PhpPath @sitePhpArguments # PHP 개발 서버 실행
exit $LASTEXITCODE # 서버 종료 상태 전달
