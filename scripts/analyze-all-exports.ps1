#!/usr/bin/env pwsh

# Comprehensive analysis of all exported device files

$outputDir = Join-Path $PSScriptRoot "..\device-info-exports"
$reportFile = Join-Path $outputDir "full-analysis-report.txt"

if (-not (Test-Path $outputDir)) {
    Write-Host "Error: Output directory not found" -ForegroundColor Red
    exit 1
}

$report = @()
$report += "=" * 100
$report += "COMPLETE DEVICE EXPORT ANALYSIS"
$report += "=" * 100
$report += "Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
$report += ""

# Get all XML files
$allFiles = Get-ChildItem -Path $outputDir -Filter "*.xml" | Sort-Object Length -Descending

$report += "SUMMARY STATISTICS"
$report += "-" * 100
$report += "Total XML files: $($allFiles.Count)"
$report += "Total size: $([math]::Round(($allFiles | Measure-Object -Property Length -Sum).Sum / 1MB, 2)) MB"
$report += ""

# Categorize files
$emptyFiles = @()
$tinyFiles = @()          # < 1KB
$smallFiles = @()         # 1-5KB
$mediumFiles = @()        # 5-20KB
$largeFiles = @()         # > 20KB
$filesWithSerials = @()

foreach ($file in $allFiles) {
    $sizeKB = [math]::Round($file.Length / 1KB, 1)
    $content = Get-Content $file.FullName -Raw
    
    # Check if empty (only XML header)
    if ($content -match '<dict\s*/>\s*</plist>') {
        $emptyFiles += [PSCustomObject]@{
            Name = $file.Name
            Size = $sizeKB
        }
    }
    # Check size categories
    elseif ($sizeKB -lt 1) {
        $tinyFiles += [PSCustomObject]@{
            Name = $file.Name
            Size = $sizeKB
        }
    }
    elseif ($sizeKB -lt 5) {
        $smallFiles += [PSCustomObject]@{
            Name = $file.Name
            Size = $sizeKB
        }
    }
    elseif ($sizeKB -lt 20) {
        $mediumFiles += [PSCustomObject]@{
            Name = $file.Name
            Size = $sizeKB
        }
    }
    else {
        $largeFiles += [PSCustomObject]@{
            Name = $file.Name
            Size = $sizeKB
        }
    }
    
    # Check for serial numbers or identifiers
    if ($content -match 'serial|Serial|SN|UUID|UDID|IMEI|identifier') {
        $filesWithSerials += $file.Name
    }
}

$report += "FILE SIZE DISTRIBUTION"
$report += "-" * 100
$report += "Empty files (only XML header):   $($emptyFiles.Count)"
$report += "Tiny files (< 1KB):               $($tinyFiles.Count)"
$report += "Small files (1-5KB):              $($smallFiles.Count)"
$report += "Medium files (5-20KB):            $($mediumFiles.Count)"
$report += "Large files (> 20KB):             $($largeFiles.Count)"
$report += ""

# Empty files list
if ($emptyFiles.Count -gt 0) {
    $report += "EMPTY FILES (No Data)"
    $report += "-" * 100
    foreach ($f in $emptyFiles) {
        $report += "  - $($f.Name)"
    }
    $report += ""
}

# Large files (most likely to contain useful data)
$report += "LARGE FILES (> 20KB) - Likely contain detailed information"
$report += "-" * 100
foreach ($f in $largeFiles) {
    $report += "  $("{0,-60}" -f $f.Name) ${f.Size} KB"
}
$report += ""

# Medium files
$report += "MEDIUM FILES (5-20KB) - May contain useful data"
$report += "-" * 100
foreach ($f in $mediumFiles) {
    $report += "  $("{0,-60}" -f $f.Name) ${f.Size} KB"
}
$report += ""

# Files potentially containing serial numbers
$report += "FILES POTENTIALLY CONTAINING IDENTIFIERS/SERIALS"
$report += "-" * 100
foreach ($fname in $filesWithSerials) {
    $file = $allFiles | Where-Object { $_.Name -eq $fname }
    $sizeKB = [math]::Round($file.Length / 1KB, 1)
    $report += "  $("{0,-60}" -f $fname) ${sizeKB} KB"
}
$report += ""

# Detailed content analysis for key files
$report += "=" * 100
$report += "DETAILED CONTENT ANALYSIS"
$report += "=" * 100
$report += ""

# Analyze device_info.xml
$report += "1. DEVICE_INFO.XML - Basic Device Information"
$report += "-" * 100
$deviceInfoFile = Join-Path $outputDir "device_info.xml"
if (Test-Path $deviceInfoFile) {
    [xml]$xml = Get-Content $deviceInfoFile
    $dict = $xml.plist.dict
    $keys = @("SerialNumber", "UDID", "ProductType", "ProductVersion", "ModelNumber", 
              "MLBSerialNumber", "WiFiAddress", "BluetoothAddress", "WirelessBoardSerialNumber",
              "IMEI", "IMEI2", "ICCID", "ICCID2", "PhoneNumber")
    
    for ($i = 0; $i -lt $dict.key.Count; $i++) {
        if ($keys -contains $dict.key[$i]) {
            $value = $dict.ChildNodes[$i * 2 + 1].'#text'
            $report += "  $($dict.key[$i].PadRight(30)): $value"
        }
    }
}
$report += ""

# Analyze apple_smart_battery.xml
$report += "2. APPLE_SMART_BATTERY.XML - Battery Information"
$report += "-" * 100
$batteryFile = Join-Path $outputDir "apple_smart_battery.xml"
if (Test-Path $batteryFile) {
    [xml]$xml = Get-Content $batteryFile
    $dict = $xml.plist.dict.dict
    $keys = @("Serial", "CycleCount", "MaxCapacity", "DesignCapacity", "CurrentCapacity", 
              "ManufacturerData")
    
    for ($i = 0; $i -lt $dict.key.Count; $i++) {
        if ($keys -contains $dict.key[$i]) {
            $value = $dict.ChildNodes[$i * 2 + 1]
            if ($value.Name -eq "string") {
                $report += "  $($dict.key[$i].PadRight(30)): $($value.'#text')"
            } elseif ($value.Name -eq "integer") {
                $report += "  $($dict.key[$i].PadRight(30)): $($value.'#text')"
            } elseif ($value.Name -eq "data") {
                $decoded = try {
                    $bytes = [System.Convert]::FromBase64String($value.'#text')
                    [System.Text.Encoding]::UTF8.GetString($bytes).Trim([char]0)
                } catch { $value.'#text' }
                $report += "  $($dict.key[$i].PadRight(30)): $decoded"
            }
        }
    }
}
$report += ""

# Analyze product.xml
$report += "3. PRODUCT.XML - Hardware Components & Sensors"
$report += "-" * 100
$productFile = Join-Path $outputDir "product.xml"
if (Test-Path $productFile) {
    [xml]$xml = Get-Content $productFile
    $dict = $xml.plist.dict.dict
    $keys = @("ambient-light-sensor-serial-num", "rosaline-serial-num", "coverglass-serial-number",
              "product-name", "wifi-chipset")
    
    for ($i = 0; $i -lt $dict.key.Count; $i++) {
        if ($keys -contains $dict.key[$i]) {
            $value = $dict.ChildNodes[$i * 2 + 1]
            if ($value.Name -eq "data") {
                $decoded = try {
                    $bytes = [System.Convert]::FromBase64String($value.'#text')
                    [System.Text.Encoding]::UTF8.GetString($bytes).Trim([char]0)
                } catch { $value.'#text' }
                $report += "  $($dict.key[$i].PadRight(35)): $decoded"
            }
        }
    }
}
$report += ""

# Analyze apple_o_l_y_h_a_l.xml (WiFi)
$report += "4. APPLE_O_L_Y_H_A_L.XML - WiFi Module"
$report += "-" * 100
$wifiFile = Join-Path $outputDir "apple_o_l_y_h_a_l.xml"
if (Test-Path $wifiFile) {
    [xml]$xml = Get-Content $wifiFile
    $dict = $xml.plist.dict.dict
    for ($i = 0; $i -lt $dict.key.Count; $i++) {
        if ($dict.key[$i] -eq "wifi-module-sn") {
            $value = $dict.ChildNodes[$i * 2 + 1]
            $decoded = try {
                $bytes = [System.Convert]::FromBase64String($value.'#text')
                [System.Text.Encoding]::UTF8.GetString($bytes).Trim([char]0)
            } catch { $value.'#text' }
            $report += "  WiFi Module Serial Number: $decoded"
        }
        if ($dict.key[$i] -eq "ModuleInfo") {
            $value = $dict.ChildNodes[$i * 2 + 1]
            $report += "  Module Info: $($value.'#text')"
        }
    }
}
$report += ""

# Analyze APFS container
$report += "5. APPLE_A_P_F_S_CONTAINER.XML - File System"
$report += "-" * 100
$apfsFile = Join-Path $outputDir "apple_a_p_f_s_container.xml"
if (Test-Path $apfsFile) {
    [xml]$xml = Get-Content $apfsFile
    $dict = $xml.plist.dict.dict
    $keys = @("UUID", "Status", "ContainerBlockSize")
    
    for ($i = 0; $i -lt $dict.key.Count; $i++) {
        if ($keys -contains $dict.key[$i]) {
            $value = $dict.ChildNodes[$i * 2 + 1].'#text'
            $report += "  $($dict.key[$i].PadRight(30)): $value"
        }
    }
}
$report += ""

# Disk usage
$report += "6. DEVICE_INFO_DISK_USAGE.XML - Storage Information"
$report += "-" * 100
$diskFile = Join-Path $outputDir "device_info_disk_usage.xml"
if (Test-Path $diskFile) {
    [xml]$xml = Get-Content $diskFile
    $dict = $xml.plist.dict
    $keys = @("AmountDataAvailable", "AmountDataReserved", "AmountRestoreAvailable")
    
    for ($i = 0; $i -lt $dict.key.Count; $i++) {
        if ($keys -contains $dict.key[$i]) {
            $value = [long]$dict.ChildNodes[$i * 2 + 1].'#text'
            $valueGB = [math]::Round($value / 1GB, 2)
            $report += "  $($dict.key[$i].PadRight(30)): $valueGB GB"
        }
    }
}
$report += ""

# Summary of serial numbers found
$report += "=" * 100
$report += "SUMMARY: ALL SERIAL NUMBERS & IDENTIFIERS FOUND"
$report += "=" * 100
$report += ""
$report += "From device_info.xml:"
$report += "  - Device Serial Number"
$report += "  - UDID"
$report += "  - MLB Serial Number"
$report += "  - WiFi/Bluetooth/Ethernet MAC Addresses"
$report += "  - Wireless Board Serial Number"
$report += "  - IMEI/ICCID (cellular identifiers)"
$report += ""
$report += "From product.xml:"
$report += "  - Ambient Light Sensor Serial"
$report += "  - Proximity Sensor (Rosaline) Serial"
$report += "  - Cover Glass Serial Number"
$report += ""
$report += "From apple_smart_battery.xml:"
$report += "  - Battery Serial Number"
$report += "  - Battery Manufacturer Data"
$report += ""
$report += "From apple_o_l_y_h_a_l.xml:"
$report += "  - WiFi Module Serial Number"
$report += ""
$report += "From apple_a_p_f_s_container.xml:"
$report += "  - APFS Container UUID"
$report += "  - Partition Type: GUID_partition_scheme (from device_info.xml)"
$report += ""
$report += "NOT FOUND (may require additional tools or are not exposed):"
$report += "  - Dot Matrix (Face ID) Serial Number"
$report += "  - IR Camera (Face ID) Serial Number"
$report += "  - Note: These may be in encoded data within:"
$report += "    * apple_diagnostic_data_access_read_only.xml (194KB binary data)"
$report += "    * apple_s_p_u_h_i_d_device.xml (19KB HID device data)"
$report += ""
$report += "=" * 100

# Save report
$report | Out-File -FilePath $reportFile -Encoding utf8

Write-Host "`nAnalysis complete!" -ForegroundColor Green
Write-Host "Report saved to: $reportFile`n" -ForegroundColor Yellow

# Display summary
Write-Host ("=" * 100) -ForegroundColor Cyan
Write-Host "SUMMARY" -ForegroundColor Cyan
Write-Host ("=" * 100) -ForegroundColor Cyan
Write-Host "Total files:     $($allFiles.Count)" -ForegroundColor Yellow
Write-Host "Empty files:     $($emptyFiles.Count)" -ForegroundColor Gray
Write-Host "Useful files:    $($allFiles.Count - $emptyFiles.Count)" -ForegroundColor Green
Write-Host "Large files:     $($largeFiles.Count) (> 20KB)" -ForegroundColor Green
Write-Host "With IDs:        $($filesWithSerials.Count)" -ForegroundColor Green
Write-Host ("=" * 100) -ForegroundColor Cyan
