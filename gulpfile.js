var gulp = require('gulp');
var minifycss = require('gulp-minify-css');
var uglify = require('gulp-uglify');
var htmlmin = require('gulp-htmlmin');
var htmlclean = require('gulp-htmlclean');
var imagemin = require('gulp-imagemin');
var $ = require('gulp-load-plugins')();

// 压缩css文件
gulp.task('minify-css', ['cb'], function() {
  return gulp.src('./public/**/*.css')
  .pipe(minifycss())
  .pipe(gulp.dest('./public'));
});
// 压缩html文件
gulp.task('minify-html', ['cb'], function() {
  return gulp.src('./public/**/*.html')
  .pipe(htmlclean())
  .pipe(htmlmin({
    removeComments: true,//清除 HTML 注释
    removeEmptyAttributes: true,//删除所有空格作属性值 <input id="" /> ==> <input />
    minifyJS: true,
    minifyCSS: true,
    minifyURLs: true,
  }))
  .pipe(gulp.dest('./public'))
});
// 压缩js文件
gulp.task('minify-js', ['cb'], function() {
  return gulp.src('./public/**/*.js')
  .pipe(uglify())
  .pipe(gulp.dest('./public'));
});
// 压缩 public/uploads 目录内图片
gulp.task('minify-images', ['cb'], function() {
    gulp.src('./public/css/images/*.*')
        .pipe(imagemin({
           optimizationLevel: 5, //类型：Number  默认：3  取值范围：0-7（优化等级）
           progressive: true, //类型：Boolean 默认：false 无损压缩jpg图片
           interlaced: false, //类型：Boolean 默认：false 隔行扫描gif进行渲染
           multipass: false, //类型：Boolean 默认：false 多次优化svg直到完全优化
        }))
        .pipe(gulp.dest('./public/uploads'));
});
gulp.task('cb',$.shell.task('hexo clean && hexo g'));
gulp.task('mini', [
  'minify-html','minify-css','minify-js','minify-images'
]);
// 默认任务
gulp.task('default', [
  'cb','minify-html','minify-css','minify-js','minify-images'
], $.shell.task('hexo d'));
