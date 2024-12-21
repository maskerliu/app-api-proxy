# bash 
sleep 1s
rm -r app-bak.asar
mv $1/app.asar $1/app-bak.asar
mv $1/update.asar $1/app.asar
start "" $2
