'use strict';

var gulp = require('gulp');
var gutil = require('gutil');
var mocha = require('gulp-mocha');
var browserify = require('browserify');
var source = require('vinyl-source-stream');
var connect = require('gulp-connect');
var eslint = require('gulp-eslint');

const TEST_PATH = 'test/*_test.js';
const WEB_PATH = 'web/';

gulp.task('unit-test', () => {
  return gulp.src([TEST_PATH], {read: false})
    .pipe(mocha({reporter: 'list'})).on('error', gutil.log);
});

gulp.task('test', ['unit-test']);

gulp.task('default', ['test']);

gulp.task('build-web', () => {
  return browserify('web/export.js')
    .bundle()
    .pipe(source('unidisk.js'))
    .pipe(gulp.dest(WEB_PATH));
});

gulp.task('start-web', () => {
  connect.server({
    root: WEB_PATH,
  });
});

gulp.task('lint', () => {
  return gulp.src(['**/*.js','!node_modules/**', '!web/unidisk.js'])
    .pipe(eslint())
    .pipe(eslint.format())
    .pipe(eslint.failAfterError());
});

