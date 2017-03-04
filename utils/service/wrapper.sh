#!/bin/bash

CACHE_PATH=`grep cache_path ~/.unidisk/settings.json | awk -F  ":" '{print $2}' | sed -r 's/[", ]//g'`
mkdir -p $CACHE_PATH
~/Projects/unidisk/udFuse.js -m service ~/ud

