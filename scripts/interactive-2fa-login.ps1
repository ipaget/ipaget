param(
    [string]$BaseUrl = "http://127.0.0.1:8769",
    [string]$Email = "zetxa@icloud.com",
    [string]$Password = "Jack_81010"
)

$ErrorActionPreference = "Stop"

function Invoke-JsonPost {
    param(
        [string]$Url,
        [hashtable]$Body
    )

    $json = $Body | ConvertTo-Json -Compress
    $response = Invoke-WebRequest -Uri $Url -Method POST -ContentType "application/json" -Body $json -UseBasicParsing
    return [pscustomobject]@{
        StatusCode = [int]$response.StatusCode
        Content    = $response.Content
        Json       = if ($response.Content) { $response.Content | ConvertFrom-Json } else { $null }
    }
}

Write-Host "Using service: $BaseUrl"
Write-Host "Starting login for: $Email"

$login = Invoke-JsonPost -Url "$BaseUrl/auth/login" -Body @{
    email = $Email
    password = $Password
}

Write-Host "Login response status: $($login.StatusCode)"
Write-Host $login.Content

if (-not $login.Json) {
    throw "Login response is empty"
}

if ($login.Json.success -eq $true) {
    Write-Host "Login completed without 2FA prompt."
    exit 0
}

if ($login.Json.requires_2fa -ne $true) {
    throw "Login did not enter 2FA state."
}

Write-Host "Trusted-device 2FA was requested. Check your iPhone/iPad/Mac for the Apple verification prompt."
Write-Host "If it does not appear immediately, wait a few seconds before entering the code."

$code = Read-Host "Enter the 6-digit Apple verification code"

if ([string]::IsNullOrWhiteSpace($code)) {
    throw "Verification code is required"
}

$verify = Invoke-JsonPost -Url "$BaseUrl/auth/verify2fa" -Body @{
    email = $Email
    password = $Password
    code = $code.Trim()
}

Write-Host "Verify response status: $($verify.StatusCode)"
Write-Host $verify.Content

if ($verify.Json -and $verify.Json.success -eq $true) {
    Write-Host "2FA verification completed successfully."
    exit 0
}

Write-Host "2FA verification did not complete successfully."
exit 1