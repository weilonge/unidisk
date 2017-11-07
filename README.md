# unidisk

This project can help you to use Cloud Storage in a new way and provide the following features:

*   Available storages

    *   JSON FS, Dropbox, BaiduYun

*   Data/Meta Cache to improve response time

*   Read-only (or support write-able file system partially)

*   Adjustable Data Cache Pool size

*   Prefetch data to improve the performance

*   Download blocks in multi-threading

*   Support Linux and MacOSX

## Prerequisite

### MacOSX

*   [OSXFUSE](http://osxfuse.github.io/)
*   brew install pkg-config

### Linux

*   sudo apt-get install libfuse-dev

### Prepare settings.json

*   Copy `settings.json` to your home folder and customize `cache_path`.

~~~
$ mkdir ~/.unidisk && cp dist/settings.json.SAMPLE ~/.unidisk/settings.json
~~~

## Let's start

unidisk supports three kinds of storage to access: SampleJSON FS, Dropbox, and BaiduYun. The following instructions will guide you how to use them.

### Sample JSON FS

*   Please prepare a valid JSON file or get it from `dist/samplefs.json`
*   Give the absolute path to `JSONPath` of `Sample` profile in `settings.json`
*   Use the command to mount JSON FS with your sample JSON file:

~~~
$ ./udFuse.js -p Sample [mount point]
~~~

*   The storage is ready at the mount point you gave.

### Dropbox

*   Please apply a Dropbox development account , and keep your `API_KEY` and `API_SECRET`
*   Use this command to get the authorization link and browser the link then login your account

~~~
$ ./ud.js Dropbox getAuthLink [API_KEY]
== Result ====================
{ authLink: 'https://www.dropbox.com/1/oauth2/authorize?client_id=API_KEY&response_type=code' }
==============================
~~~

*   Keep `device_code` shown in the page after login and authrization:

~~~
QrlXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
~~~

*   Use this command to get the `acess_token`:

~~~
$ ./ud.js Dropbox getAccessToken [API_KEY] [API_SECRET] [DEVICE_CODE]
== Result ====================
{ access_token: 'QrlXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXYYYYYYYYYYYYYYYYYYYYYYYYYYYY' }
==============================
~~~

*   Edit `~/.unidisk/settings.json` and add the line in your Dropbox profile (e.g. MyDropbox):

~~~
token: "QrlXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXYYYYYYYYYYYYYYYYYYYYYYYYYYYY"
~~~

*   Use this command to mount Dropbox:

~~~
$ ./udFuse.js -p MyDropbox [mount point]
~~~

*   The storage is ready at the mount point you gave.

### BaiduYun

*   Please apply a BaiduYun development account, and keep your `API_KEY` and `API_SECRET`
*   Use this command to get the authrization link and browser the link then login your account and input `DEVICE_CODE`:

~~~
$ ./ud.js pcs getAccessToken [API_KEY] [API_SECRET]
https://openapi.baidu.com/device
DEVICE_CODE
waiting for verification...
waiting for verification...
== Result ====================
{ access_token: '23.XXXXXXXXXXXXXXXXXXXXXXXXXXXX' }
==============================
~~~

*   Edit `~/.unidisk/settings.json` and add the line in your PCS profile (e.g. MyPCS):

~~~
token: "23.XXXXXXXXXXXXXXXXXXXXXXXXXXXX"
~~~

*   Use this command to mount BaiduYun PCS:

~~~
$ ./udFuse.js -p MyPCS [mount point]
~~~

*   The storage is ready at the mount point you gave.

## Reference

*   [FUSE: Filesystem in Userspace](http://fuse.sourceforge.net/)
