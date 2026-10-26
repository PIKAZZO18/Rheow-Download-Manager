#requires -Version 5.1
<#
    Smoke test untuk keamanan HTTP bridge Rheow (127.0.0.1:41789).

    Jalankan aplikasi Rheow terlebih dahulu, lalu:
        powershell -ExecutionPolicy Bypass -File .\scripts\test-bridge.ps1

    Catatan: dua kasus "POST berhasil" akan memunculkan modal Download File Info
    di aplikasi Rheow. Tidak ada file yang benar-benar diunduh sampai Anda
    menekan tombol Download.
#>
[CmdletBinding()]
param(
    [string]$BaseUrl = 'http://127.0.0.1:41789'
)

$ErrorActionPreference = 'Stop'

$healthUrl = "$BaseUrl/api/health"
$addUrl = "$BaseUrl/api/add_download"

function Get-StatusCode {
    param([string[]]$Arguments)

    $code = & curl.exe -s -o NUL -w "%{http_code}" @Arguments
    if ([string]::IsNullOrWhiteSpace($code)) {
        return '000'
    }
    return [string]$code
}

$bodyFile = Join-Path $env:TEMP ("rheow-bridge-body-{0}.json" -f ([guid]::NewGuid().ToString('N')))
$payload = '{"url":"https://example.com/rheow-bridge-test.zip","filename":null,"cookie":null,"referer":null}'
Set-Content -LiteralPath $bodyFile -Value $payload -NoNewline -Encoding Ascii

try {
    $online = Get-StatusCode -Arguments @('-H', 'X-Rheow-Client: rheow-extension', $healthUrl)
    if ($online -eq '000') {
        Write-Host "Rheow tidak berjalan di $BaseUrl." -ForegroundColor Red
        Write-Host "Jalankan dulu: cd Rheow; npm run tauri dev" -ForegroundColor Yellow
        exit 2
    }

    $cases = @(
        [pscustomobject]@{
            Name     = 'Health tanpa header klien'
            Expected = '403'
            Arguments = @($healthUrl)
        }
        [pscustomobject]@{
            Name     = 'Health dengan header klien'
            Expected = '200'
            Arguments = @('-H', 'X-Rheow-Client: rheow-extension', $healthUrl)
        }
        [pscustomobject]@{
            Name     = 'Host palsu (DNS rebinding)'
            Expected = '403'
            Arguments = @('-H', 'Host: evil.example', '-H', 'X-Rheow-Client: rheow-extension', $healthUrl)
        }
        [pscustomobject]@{
            Name     = 'POST dari origin web'
            Expected = '403'
            Arguments = @(
                '-H', 'Origin: https://evil.example',
                '-H', 'Content-Type: application/json',
                '--data-binary', "@$bodyFile",
                $addUrl
            )
        }
        [pscustomobject]@{
            Name     = 'POST dari origin ekstensi'
            Expected = '200'
            Arguments = @(
                '-H', 'Origin: chrome-extension://abcdefghijklmnop',
                '-H', 'Content-Type: application/json',
                '--data-binary', "@$bodyFile",
                $addUrl
            )
        }
        [pscustomobject]@{
            Name     = 'POST dengan header klien'
            Expected = '200'
            Arguments = @(
                '-H', 'X-Rheow-Client: rheow-extension',
                '-H', 'Content-Type: application/json',
                '--data-binary', "@$bodyFile",
                $addUrl
            )
        }
        [pscustomobject]@{
            Name     = 'Preflight origin web'
            Expected = '403'
            Arguments = @(
                '-X', 'OPTIONS',
                '-H', 'Origin: https://evil.example',
                '-H', 'Access-Control-Request-Method: POST',
                $addUrl
            )
        }
        [pscustomobject]@{
            Name     = 'Preflight origin ekstensi'
            Expected = '204'
            Arguments = @(
                '-X', 'OPTIONS',
                '-H', 'Origin: chrome-extension://abcdefghijklmnop',
                '-H', 'Access-Control-Request-Method: POST',
                $addUrl
            )
        }
        [pscustomobject]@{
            Name     = 'POST Content-Type salah'
            Expected = '415'
            Arguments = @(
                '-H', 'Origin: chrome-extension://abcdefghijklmnop',
                '-H', 'Content-Type: text/plain',
                '--data-binary', "@$bodyFile",
                $addUrl
            )
        }
    )

    $failures = 0
    $results = foreach ($case in $cases) {
        $actual = Get-StatusCode -Arguments $case.Arguments
        $passed = $actual -eq $case.Expected
        if (-not $passed) { $failures++ }

        [pscustomobject]@{
            Test     = $case.Name
            Expected = $case.Expected
            Actual   = $actual
            Result   = if ($passed) { 'PASS' } else { 'FAIL' }
        }
    }

    $results | Format-Table -AutoSize

    if ($failures -gt 0) {
        Write-Host "$failures tes GAGAL." -ForegroundColor Red
        exit 1
    }

    Write-Host "Semua $($cases.Count) tes lolos." -ForegroundColor Green
}
finally {
    Remove-Item -LiteralPath $bodyFile -Force -ErrorAction SilentlyContinue
}
