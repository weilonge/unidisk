#!/bin/sh

UD_ROOT=/tmp/ud # $1
MOUNTPATH=$UD_ROOT/root
CACHEPATH=$UD_ROOT/cache

mkdir -p $MOUNTPATH
mkdir -p $CACHEPATH

rm $CACHEPATH/*
fusermount -u $MOUNTPATH

node udFuse.js node_modules/fuse4js/example/sample.json $MOUNTPATH


