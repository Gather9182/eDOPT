@echo off
echo ==========================================
echo   EnergyTool: Starting Frontend Server
echo ==========================================
cd frontend
call npm run dev -- --host
pause
