@echo off
echo ==========================================
echo   eDOPT: Uploading to GitHub
echo ==========================================

git config --global user.email "martin.pfeiffer9182@gmail.com"
git config --global user.name "Gather9182"

git init
git add .
git commit -m "Initial commit: eDOPT Tool mit lightweight Setup und Lizenz"
git branch -M main
git remote add origin https://github.com/Gather9182/eDOPT.git
git push -u origin main

echo.
echo Upload process finished.
pause
