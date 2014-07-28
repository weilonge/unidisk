#!/bin/sh

MOUNTPATH=$1/root
CACHEPATH=$1/cache

mkdir -p $MOUNTPATH
mkdir -p $CACHEPATH

rm $CACHEPATH/*
fusermount -u $MOUNTPATH

node udFuse.js node_modules/fuse4js/example/sample.json $MOUNTPATH


