#!/usr/bin/env pwsh

# Export iOS device information using idevicediagnostics and ideviceinfo
# This script exports various IORegistry entries and device info to XML files

# Define known ideviceinfo domains
$infoDomains = @(
    "com.apple.disk_usage",
    "com.apple.disk_usage.factory",
    "com.apple.mobile.battery",
    "com.apple.iqagent",
    "com.apple.purplebuddy",
    "com.apple.PurpleBuddy",
    "com.apple.mobile.chaperone",
    "com.apple.mobile.third_party_termination",
    "com.apple.mobile.lockdownd",
    "com.apple.mobile.lockdown_cache",
    "com.apple.xcode.developerdomain",
    "com.apple.international",
    "com.apple.mobile.data_sync",
    "com.apple.mobile.tethered_sync",
    "com.apple.mobile.mobile_application_usage",
    "com.apple.mobile.backup",
    "com.apple.mobile.nikita",
    "com.apple.mobile.restriction",
    "com.apple.mobile.user_preferences",
    "com.apple.mobile.sync_data_class",
    "com.apple.mobile.software_behavior",
    "com.apple.mobile.iTunes.SQLMusicLibraryPostProcessCommands",
    "com.apple.mobile.iTunes.accessories",
    "com.apple.mobile.internal",
    "com.apple.mobile.wireless_lockdown",
    "com.apple.fairplay",
    "com.apple.iTunes",
    "com.apple.mobile.iTunes.store",
    "com.apple.mobile.iTunes",
    "com.apple.fmip",
    "com.apple.Accessibility"
)

# Define the list of IORegistry entries to export
$entries = @(
    "AppleAPFSContainer",
    "AppleStockholmControl",
    "AppleSPUAppDriver",
    "AppleSPUProfileDriver",
    "AppleSPU",
    "AppleSPUHIDDevice",
    "AppleSPUFirmwareService",
    "Audio",
    "AppleAOPAudioController",
    "AppleAOPVoiceTriggerController",
    "Interfaces",
    "IOPP",
    "IOHIDInterface",
    "AppleARMPE",
    "AVD",
    "AppleAVD",
    "AppleAVE2Driver",
    "IODARTMapper",
    "RTBuddyService",
    "IOAccessoryTRM",
    "IOAccessoryUSBConnectShim",
    "USB2",
    "USB3",
    "AppleJPEGDriver",
    "AGXArmFirmwareMapper",
    "AppleT8015TempSensor",
    "AppleMobsiTmpSADC",
    "AppleDialogSPMIPMU",
    "AppleDialogSPMIPMURTC",
    "AppleCLPC",
    "AppleMesaSEPDriver",
    "AppleBiometricServices",
    "AppleSEPXARTService",
    "AppleSMC",
    "AppleARMPMUPowerSensor",
    "AppleARMPMUTempSensor",
    "AppleSmartBattery",
    "AppleSmartBatteryManager",
    "AppleSMCPMU",
    "AppleDiagnosticDataAccessReadOnly",
    "AppleMesaShim",
    "AppleMultitouchDevice",
    "IOSerialBSDClient",
    "AppleSerialShim",
    "IONetworkStack",
    "AppleBCMWLANBusInterfacePCIe",
    "AppleBCMWLANCore",
    "AppleOLYHAL",
    "AppleARMBacklight",
    "AppleM68Buttons",
    "AppleARMCPU",
    "AppleMobileApNonce",
    "AppleImage4",
    "product",
    "sacm",
    "AppleARMSlowAdaptiveClockingManager",
    "IOResources"
)

# Create output directory if it doesn't exist
$outputDir = Join-Path $PSScriptRoot "..\device-info-exports"
if (-not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir | Out-Null
    Write-Host "Created output directory: $outputDir" -ForegroundColor Green
}

# Check if required tools are available
try {
    $null = Get-Command idevicediagnostics -ErrorAction Stop
    $null = Get-Command ideviceinfo -ErrorAction Stop
} catch {
    Write-Host "Error: Required tools not found. Please ensure libimobiledevice is installed." -ForegroundColor Red
    Write-Host "Required: idevicediagnostics, ideviceinfo" -ForegroundColor Yellow
    exit 1
}

# =============================================================================
# Export ideviceinfo data
# =============================================================================
Write-Host "`n" + ("=" * 60) -ForegroundColor Cyan
Write-Host "PART 1: Exporting ideviceinfo data" -ForegroundColor Cyan
Write-Host ("=" * 60) -ForegroundColor Cyan

$infoSuccessCount = 0
$infoFailCount = 0
$infoTotalCount = $infoDomains.Count + 1

# Export basic device info (no domain)
Write-Host "`n[1/$infoTotalCount] Exporting basic device info..." -NoNewline
try {
    $output = & ideviceinfo -x 2>&1
    if ($LASTEXITCODE -eq 0) {
        $output | Out-File -FilePath (Join-Path $outputDir "device_info.xml") -Encoding utf8
        Write-Host " OK" -ForegroundColor Green
        $infoSuccessCount++
    } else {
        Write-Host " FAILED (exit code: $LASTEXITCODE)" -ForegroundColor Red
        $infoFailCount++
    }
} catch {
    Write-Host " ERROR: $($_.Exception.Message)" -ForegroundColor Red
    $infoFailCount++
}

Start-Sleep -Milliseconds 100

# Export domain-specific info
$counter = 2
foreach ($domain in $infoDomains) {
    # Convert domain name to filename (e.g., com.apple.disk_usage -> device_info_disk_usage.xml)
    $domainShort = $domain -replace '^com\.apple\.', '' -replace '^com\.', ''
    $domainShort = $domainShort -replace '\.', '_'
    $fileName = "device_info_${domainShort}.xml"
    $filePath = Join-Path $outputDir $fileName
    
    Write-Host "[$counter/$infoTotalCount] Exporting domain: $domain..." -NoNewline
    
    try {
        $output = & ideviceinfo -q $domain -x 2>&1
        if ($LASTEXITCODE -eq 0) {
            $output | Out-File -FilePath $filePath -Encoding utf8
            Write-Host " OK" -ForegroundColor Green
            $infoSuccessCount++
        } else {
            Write-Host " FAILED (exit code: $LASTEXITCODE)" -ForegroundColor Red
            $infoFailCount++
        }
    } catch {
        Write-Host " ERROR: $($_.Exception.Message)" -ForegroundColor Red
        $infoFailCount++
    }
    
    Start-Sleep -Milliseconds 100
    $counter++
}

Write-Host "`nideviceinfo export summary:" -ForegroundColor Cyan
Write-Host "  Success: $infoSuccessCount / $infoTotalCount" -ForegroundColor Green

# =============================================================================
# Export IORegistry entries
# =============================================================================
Write-Host "`n" + ("=" * 60) -ForegroundColor Cyan
Write-Host "PART 2: Exporting IORegistry entries" -ForegroundColor Cyan
Write-Host ("=" * 60) -ForegroundColor Cyan

$registrySuccessCount = 0
$registryFailCount = 0
$registryTotalCount = $entries.Count

foreach ($entry in $entries) {
    # Convert entry name to snake_case for filename
    $fileName = $entry -creplace '([A-Z])', '_$1'
    $fileName = $fileName.TrimStart('_').ToLower()
    $fileName = "${fileName}.xml"
    $filePath = Join-Path $outputDir $fileName
    
    Write-Host "[$('{0,3}' -f ($entries.IndexOf($entry) + 1))/$registryTotalCount] Exporting $entry..." -NoNewline
    
    try {
        # Execute idevicediagnostics and save to file
        $output = & idevicediagnostics ioregentry $entry 2>&1
        
        if ($LASTEXITCODE -eq 0) {
            $output | Out-File -FilePath $filePath -Encoding utf8
            Write-Host " OK" -ForegroundColor Green
            $registrySuccessCount++
        } else {
            Write-Host " FAILED (exit code: $LASTEXITCODE)" -ForegroundColor Red
            $registryFailCount++
        }
    } catch {
        Write-Host " ERROR: $($_.Exception.Message)" -ForegroundColor Red
        $registryFailCount++
    }
    
    # Small delay to avoid overwhelming the device
    Start-Sleep -Milliseconds 100
}

Write-Host "`nIORegistry export summary:" -ForegroundColor Cyan
Write-Host "  Success: $registrySuccessCount / $registryTotalCount" -ForegroundColor Green

# =============================================================================
# Final Summary
# =============================================================================
Write-Host "`n" + ("=" * 60) -ForegroundColor Cyan
Write-Host "ALL EXPORTS COMPLETED!" -ForegroundColor Cyan
Write-Host ("=" * 60) -ForegroundColor Cyan

$totalSuccess = $infoSuccessCount + $registrySuccessCount
$totalFail = $infoFailCount + $registryFailCount
$grandTotal = $infoTotalCount + $registryTotalCount

Write-Host "`nideviceinfo:" -ForegroundColor Yellow
Write-Host "  Success: $infoSuccessCount" -ForegroundColor Green
Write-Host "  Failed:  $infoFailCount" -ForegroundColor $(if ($infoFailCount -gt 0) { "Red" } else { "Gray" })
Write-Host "  Total:   $infoTotalCount" -ForegroundColor Cyan

Write-Host "`nIORegistry:" -ForegroundColor Yellow
Write-Host "  Success: $registrySuccessCount" -ForegroundColor Green
Write-Host "  Failed:  $registryFailCount" -ForegroundColor $(if ($registryFailCount -gt 0) { "Red" } else { "Gray" })
Write-Host "  Total:   $registryTotalCount" -ForegroundColor Cyan

Write-Host "`nGrand Total:" -ForegroundColor Yellow
Write-Host "  Success: $totalSuccess" -ForegroundColor Green
Write-Host "  Failed:  $totalFail" -ForegroundColor $(if ($totalFail -gt 0) { "Red" } else { "Gray" })
Write-Host "  Total:   $grandTotal" -ForegroundColor Cyan

Write-Host "`n" + ("=" * 60) -ForegroundColor Cyan
Write-Host "Output files saved to: $outputDir" -ForegroundColor Green
