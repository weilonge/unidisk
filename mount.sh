#!/bin/sh

UD_ROOT=/tmp/ud # $1
MOUNTPATH=$UD_ROOT/root
CACHEPATH=$UD_ROOT/cache

trap umountUd SIGINT

mkdir -p $MOUNTPATH
mkdir -p $CACHEPATH

rm $CACHEPATH/*

umountUd() {
  if type fusermount &> /dev/null; then
    fusermount -u $MOUNTPATH
  else
    umount $MOUNTPATH
  fi
}

umountUd
node udFuse.js -m pcs $MOUNTPATH


