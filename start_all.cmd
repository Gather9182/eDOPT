@echo off
echo ==========================================
echo   EnergyTool: Starting Full Application
echo ==========================================

echo Starting Backend in new window...
start cmd /k "start_backend.cmd"

echo Starting Frontend in new window...
start cmd /k "start_frontend.cmd"

echo.
echo Both servers are starting up. 
echo Backend will be at http://localhost:8000 (and your local network IP)
echo Frontend will be at http://localhost:5173 (and your local network IP)
echo.
pause
