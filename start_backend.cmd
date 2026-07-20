@echo off
echo ==========================================
echo   EnergyTool: Starting Backend Server
echo ==========================================
cd backend
if exist .venv\Scripts\activate.bat (
    echo Activating virtual environment - .venv...
    call .venv\Scripts\activate.bat
) else (
    echo WARNING: Virtual environment - .venv not found. Running with global python...
)
python -m uvicorn app.main:app --host 0.0.0.0 --reload --port 8000
pause
