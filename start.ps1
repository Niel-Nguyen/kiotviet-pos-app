# PowerShell Launch Script for KiotPro POS
$Host.UI.RawUI.WindowTitle = "KiotPro POS Server"
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "   🚀 KIOTPRO - HỆ THỐNG QUẢN LÝ BÁN HÀNG & KHO HÀNG" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""

$pythonExe = "C:\Users\DELL\AppData\Local\Programs\Python\Python311\python.exe"
$serverScript = Join-Path $PSScriptRoot "backend\server.py"

if (Test-Path $pythonExe) {
    & $pythonExe $serverScript
} else {
    python $serverScript
}
