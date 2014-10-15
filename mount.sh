#!/bin/sh

UD_ROOT=/tmp/ud # $1
MOUNTPATH=$UD_ROOT/root
CACHEPATH=$UD_ROOT/cache

mkdir -p $MOUNTPATH
mkdir -p $CACHEPATH

rm $CACHEPATH/*

if type fusermount &> /dev/null; then
  fusermount -u $MOUNTPATH
else
  umount $MOUNTPATH
fi

node udFuse.js node_modules/fuse4js/example/sample.json $MOUNTPATH


