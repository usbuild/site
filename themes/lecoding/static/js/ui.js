function postComment(parentId) {
  window.openedWinsCount = window.openedWinsCount || 0;
  openedWinsCount++;
  window.openedWins = window.openedWins || {};
  var targetName;
  if (parentId) {
    targetName = $("#cmt_" + parentId).find(".author").attr("data-name");
  } else {
    targetName = document.title;
  }

  var author_name = localStorage.getItem("author_name") || "";
  var author_email = localStorage.getItem("author_email") || "";

  var newWindow = window.open("", "comment" + openedWinsCount, "width=400, height=500");
  openedWins[openedWinsCount] = newWindow;
  newWindow.document.write(`

<html lang="zh-CN">

<head>
    <meta charset="utf-8">
    <meta content="width=device-width,minimum-scale=1.0" name=viewport>
    <meta name="format-detection" content="telephone=no">
    <title>发表评论</title>
    <style type="text/css">
        * {
            margin: 0;
            padding: 0
        }

        html,
        body {
            height: 100%
        }

        body {
            font-size: 15px;
            font-family: "Helvetica Neue", arial, sans-serif;
        }

        h3 {
            font-size: 1.3em;
            line-height: 1.5;
            margin: 15px 30px;
            text-align: center
        }

        a {
            color: #2479CC;
            text-decoration: none
        }

        .card {
            margin: 15px 25px;
            text-align: left
        }

        .submit input,
        .submit textarea {
            border: 1px solid #bbb;
            border-radius: 1px;
            font-size: 15px;
            height: 20px;
            line-height: 20px;
            margin-left: 10px;
            padding: 6px 8px
        }

        .submit span {
            position: relative;
            top: 8px
        }

        .submit li {
            display: -webkit-box;
            display: -ms-flexbox;
            display: flex;
            margin: 15px 0
        }

        .submit textarea {
            height: 130px
        }

        .submit .line {
            -webkit-box-flex: 1;
            display: block;
            -ms-flex: 1;
            flex: 1
        }

        .submit .btn-submit {
            -webkit-appearance: none;
            background: #2185d0;
            border: none;
            border-radius: 0;
            box-shadow: inset 0 -5px 20px rgba(0, 0, 0, .1);
            color: #fff;
            cursor: pointer;
            display: block;
            font-size: 14px;
            line-height: 1;
            padding: 0.625em .5em;
            width: 100%
        }

        .submit li.tips {
            color: #999;
            font-size: 14px
        }
    </style>
</head>

<body>
    <h3>评论: ${targetName}</h3>
    <div class=bd>
        <div class="card submit">
            <form onsubmit="return false" id="create_post">
                <ul>
                    <li><span>昵称：</span><input class=line name=author_name required placeholder="昵称" value="${author_name}">
                        <li><span>邮箱：</span><input class=line name=author_email type=email required placeholder="邮箱" value="${author_email}">
                            <li><span>内容：</span><textarea class="line" name="message" required placeholder="回复内容"></textarea>
                                <li><input type=hidden name=parent value="${parentId}">
                                    <input type=hidden name=windows value="${openedWinsCount}">
                                    <button class="btn-submit" type=submit>立即发表</button>
                                    <li><a href="#close" onclick="window.close();void(0)">放弃评论</a></ul>
            </form>
        </div>
    </div>
    <footer></footer>
    <script src="https://cdn.bootcss.com/jquery/3.2.1/jquery.min.js"></script>
    <script>
    $("#create_post").submit(function(){
      var values = {};
      $.each($('#create_post').serializeArray(), function(i, field) {
            values[field.name] = field.value;
      });
      window.opener.onPostComment(values);
    });
    </script>
</body>

</html>
    `);
}

function onPostComment(data) {
  var postData = {
    message: data.message,
    "thread": api.threadId,
    "author_name": data.author_name,
    "author_email": data.author_email
  };
  localStorage.setItem("author_name", data.author_name);
  localStorage.setItem("author_email", data.author_email);

  if (data.parent) {
    postData["parent"] = data.parent;
  }
  api.post("posts/create", postData, function(resp){
    if (resp.code == 0) {
      openedWins[data.windows].close();
      alert("评论已提交，请等待审核");
    } else if (resp.code == 2) {
      alert("已发表过相同内容");
    }
  });
}

var commentAPI = {

  get : function(api, args, callback){
    $.ajax({
      url: this.apiPath + api + ".json",
      jsonp: "callback",
      dataType: "jsonp",
      data: args,
      success : function(response) {
        if (callback) {
          callback(response)
        }
      }});
  },

  post : function(api, args, callback) {
    $.post(
      this.apiPath + api + ".json",
      args,
      function(response) {
        if (callback) {
          callback(response)
        }
      });
  },

  buildComment: function(comment) {
    var baseUrl = $("body").attr("data-url");
    return $(`
      <div class="comment" id="cmt_${comment.id}">
    <a class="avatar" href="${comment.author.profileUrl}">
      <img src="${comment.author.avatar.permalink}" onerror="this.src='${baseUrl}img/noavatar.png'">
    </a>
    <div class="comment-msg">
      <div class="metadata">
      <span class="author" data-name="${comment.author.name}"> <a href="${comment.author.profileUrl}">${comment.author.name}</a> </span>
        <span class="date">${new Date(comment.createdAt).toLocaleString()}</span>
        <span class="actions">
          <a class="reply" href="javascript: postComment('${comment.id}')">回复</a>
        </span>
      </div>
      <div class="text">
        ${comment.message}
      </div>
    </div>
  </div>
      `);
  },

  handlePostList : function(cursor, comments) {
    var self = this;
    var todo = comments.length;
    while(todo > 0) {
      comments.forEach(function(comment){
        if (!comment.lec_cont) {
          if (comment.parent) {
            var p = $("#cmt_" + comment.parent);
            if (p.length > 0) {
              if (!p.find(".comments").length) {
                p.append('<div class="comments"></div>')
              }
              var cmd = self.buildComment(comment);
              var pf = p.find(".comments");
              pf.append(cmd);
              comment.lec_cont = true;
              todo--;
            }
          } else {
            $("#cmt_root").append(self.buildComment(comment));
            comment.lec_cont = true;
              todo--;
          }
        }
      });
    }
    this.commentsCount += comments.length;
    $("#comment_count").html(this.commentsCount);
  }
}



function CommentAPI(forum, apiPath, selector, url) {
  this.forum = forum;
  this.threadId = {}
  this.apiPath = apiPath;
  this.commentsCount = 0;
  var root = $('<div class="comments" id="cmt_root"><div class="comment-header">评论&nbsp;(<span id="comment_count"></span>) <span><a href="javascript:postComment()" class="post-comment-btn btn">发表评论</a></span></div></div>');
  $(selector).append(root);

  var self = this;
  this.get("threads/listPosts", {forum: this.forum, thread: "link:" + url}, function(response){
    if (response.response.length > 0) {
      self.threadId = response.response[0].thread;
      self.handlePostList(response.cursor, response.response);
    } else {
      this.get("threads/details", {forum: this.forum, thread: "link:" + url}, function(resp){
        self.threadId = resp.response.thread;
        self.handlePostList(response.cursor, response.response);
      });
    }
  });
}

CommentAPI.prototype = commentAPI;

function RenderComment(forum, apiPath, selector, url) {
  var done = false;
  var dsq = document.createElement('script');
  dsq.src = '//'+forum+'.disqus.com/embed.js';
  dsq.onload = function()  {
    done = true;
  };
  document.head.appendChild(dsq);
  setTimeout(function () { if (!done)
    api = new CommentAPI(forum, apiPath, selector, url);
  }, 2000);
}
