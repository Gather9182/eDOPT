@echo off
echo ==========================================
echo   EnergyTool: Installing Dependencies
echo ==========================================

echo Installing Frontend dependencies...
cd frontend
call npm install
cd ..

echo Installing Backend dependencies...
cd backend
if not exist .venv (
    echo Creating virtual environment - .venv...
    python -m venv .venv
)
echo Activating virtual environment...
call .venv\Scripts\activate.bat
echo Installing requirements...
python -m pip install --upgrade pip
pip install -r requirements.txt
cd ..

echo.
echo Setup complete. You can now use start_backend.cmd and start_frontend.cmd
pause
