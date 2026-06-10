@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "PYTHON=D:\Anaconda\envs\py310\python.exe"

echo.
echo ============================================
echo   MEM Analyzer Web
echo   Python: %PYTHON%
echo ============================================
echo.
echo   [1] Dev Mode (hot reload, two servers)
echo   [2] Prod Mode (build frontend, one port)
echo.
set /p choice="Select (1 or 2): "

if "%choice%"=="1" (
    call :run_dev
) else if "%choice%"=="2" (
    call :run_prod
) else (
    echo Invalid choice.
    pause
)
exit /b

:run_dev
echo.
echo ======================================
echo   Dev Mode
echo   Backend:  http://localhost:8000
echo   Frontend: http://localhost:3000
echo ======================================
echo.
echo Installing backend dependencies...
call "%PYTHON%" -m pip install -r "%~dp0backend\requirements.txt" --quiet
echo Starting backend...
start "MEM Backend" cmd /k "cd /d "%~dp0backend" && "%PYTHON%" main.py"
timeout /t 2 >nul

if not exist "%~dp0frontend\node_modules" (
    echo Installing frontend dependencies...
    cd /d "%~dp0frontend"
    call npm install
    cd /d "%~dp0"
)

echo Starting frontend...
start "MEM Frontend" cmd /k "cd /d "%~dp0frontend" && npm run dev"
timeout /t 3 >nul
echo.
echo Both servers started! Open http://localhost:3000
echo.
pause
exit /b

:run_prod
echo.
echo ======================================
echo   Prod Mode
echo   URL: http://localhost:8000
echo ======================================
echo.
echo Installing backend dependencies...
call "%PYTHON%" -m pip install -r "%~dp0backend\requirements.txt" --quiet
echo.

if not exist "%~dp0frontend\node_modules" (
    echo Installing frontend dependencies...
    cd /d "%~dp0frontend"
    call npm install
    cd /d "%~dp0"
)

if not exist "%~dp0frontend\dist\index.html" (
    echo Building frontend...
    cd /d "%~dp0frontend"
    call npm run build
    cd /d "%~dp0"
    if errorlevel 1 (
        echo Build failed!
        pause
        exit /b
    )
)

echo Starting server...
start "MEM Analyzer" cmd /k "cd /d "%~dp0backend" && "%PYTHON%" main.py && echo. && echo Server stopped. && pause >nul"
timeout /t 2 >nul
echo.
echo Server started! Open http://localhost:8000
echo.
pause
exit /b
