@echo off
chcp 65001 > nul
title KiotPro POS & Inventory Management Server

echo ========================================================
echo   🚀 KIOTPRO - HỆ THỐNG QUẢN LÝ BÁN HÀNG & KHO HÀNG
echo ========================================================
echo.

set PYTHON_PATH="C:\Users\DELL\AppData\Local\Programs\Python\Python311\python.exe"

if exist %PYTHON_PATH% (
    %PYTHON_PATH% "%~dp0backend\server.py"
) else (
    python "%~dp0backend\server.py"
)

pause
