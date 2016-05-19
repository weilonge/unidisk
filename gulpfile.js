'use strict';

var gulp = require('gulp');
var gutil = require('gutil');
var mocha = require('gulp-mocha');

var TEST_PATH = 'test/*_test.js';

gulp.task('unit-test', function() {
  return gulp.src([TEST_PATH], {read: false})
    .pipe(mocha({reporter: 'list'})).on('error', gutil.log);
});

// By default, we always run 'unit-test'. But 'unit-test' relies on 'jshint'
gulp.task('default', ['unit-test']);
