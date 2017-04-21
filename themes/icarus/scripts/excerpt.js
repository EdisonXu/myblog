/**
* Excerpt Helper
* @description Get the excerpt from a post
* @example
*     <%- excerpt(post) %>
*/
hexo.extend.helper.register('excerpt', function (post) {
    var excerpt;
    if (post.excerpt) {
        //excerpt = post.excerpt.replace(/\<[^\>]+\>/g, '');
        excerpt = post.excerpt;
    } else {
        //excerpt = post.content.replace(/\<[^\>]+\>/g, '').substring(0, 200);
        var valueable_br =-1;
        var br=-1;
        for (var idx=0 ; idx < 2; idx++){
          br = post.content.indexOf('\n',br)
          if(br < 0) {
             break;
          }else{
            valueable_br = br;
          }
        }
       if(valueable_br < 0) {
        excerpt = 0;
         } else {
           excerpt = post.content.substring(0, br) ;
      }
    return excerpt;
  }
});
