#!/bin/bash

# Define script directory
SCRIPT_DIR=/home/webadmin/scripts

# Navigate to script directory
cd $SCRIPT_DIR

echo "GitUsername: manodhaaraa"
echo "GitPassword: " `cat $SCRIPT_DIR/GITPAT`
echo "####### GIT CLONE #######"

# Check if directory exists, if so just pull, don't clone
if [ -d "$SCRIPT_DIR/TijaeroERP" ]; then
    echo "Directory exists, skipping clone..."
    cd $SCRIPT_DIR/TijaeroERP
else
    git clone https://github.com/manodhaaraa/TijaeroERP.git -b main
    cd $SCRIPT_DIR/TijaeroERP
fi

echo "####### GIT PULL #######"
git reset --hard
git pull --rebase

echo "####### REFRESHING ONLY BACKEND AND FRONTEND #######"
sudo docker compose -f docker-compose.yml -f docker-compose.server.yml --env-file .env.server up -d --force-recreate --build frontend backend

