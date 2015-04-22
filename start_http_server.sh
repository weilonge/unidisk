#!/bin/bash

ROOT=web
BUNDLE_PATH=$ROOT/unidisk.js
BROWSERIFY_ENTRY=$ROOT/export.js

rm $BUNDLE_PATH

browserify $BROWSERIFY_ENTRY -o $BUNDLE_PATH

cd $ROOT
python -m SimpleHTTPServer
cd -
