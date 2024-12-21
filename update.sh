# bash 
sleep 1s
rm -r app-bak.asar
mv $1/app.asar app-bak.asar
mv $1/update.asar app.asar
start "" $2
