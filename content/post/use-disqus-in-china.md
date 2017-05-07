+++
date = "2017-05-07T18:11:51+08:00"
description = ""
draft = false
tags = ["disqus"]
title = "让disqus支持大陆访问"
topics = []

+++

由于众所周知的原因，[disqus](https://disqus.com/) 在大陆难以访问，随着[多说](https://duoshuo.com)的关闭，无法正常地使用评论功能已经成为
「静态博客生成器类博客」的一个问题。 好在 disqus 提供了一些 [api](https://disqus.com/api/docs/) ，在这里我们可以使用一些方法实现评论的功能。

# 后端
之前已经有部分的解决方案，其中最完善的是 [这里](https://shijianan.com/2017/01/02/build-your-own-disqus/) ，其中使用的方法是创建一个
[disqus application](https://disqus.com/api/applications/) ，
然后使用各种 api ，这里可以使用 python 或者直接使用 nginx 的反向代理。我也更新这段 [python](https://github.com/shijn/disqus-proxy) 代码，但是在
创建评论的时候总是出错， 提示 `This application cannot create posts on the chosen forum (code 12)` 。在尝试了多种
[方法](http://stackoverflow.com/questions/15416688/disqus-api-create-comment-as-guest)，查阅了众多网页均没有解决。后来找到一种说法，说是这个接口无法使用
自己创建的`api_key`，最终找到了[解决方案](http://spirytoos.blogspot.com/2013/12/not-so-easy-posting-as-guest-via-disqus.html)。

其实答案就在 disqus 的前端 js 里面。使用 chrome network tools 可以看到有一些访问：

```
Request URL:https://disqus.com/api/3.0/embed/threadDetails.json?thread=5781899723
&api_key=E8Uh5l5fHZ6gD8U3KycjAIAk46f68Zw7C6eW8WSjZvCLXebZ7p0r1yrYDrLilk2F
Request Method:GET
Status Code:200 OK
Remote Address:127.0.0.1:1081
Referrer Policy:no-referrer-when-downgrade
```
其中 disqus 官方的 js 也是使用了这套 api ，其中 api_key 赫然在列，并且在3年后的今天这个 key 依然有效，并且这个 key cd 是无限的，不像 [disqus application ](https://data.disqus.com/capabilities/)
有着 1000 次/hour 的全局限制。值得注意的是，使用这个 api_key 要求必须提供 Referer 和 Origin，并且都要是官方的地址：

```
Referer https://disqus.com;
Origin https://disqus.com;
```
所以本站采用的一个反向代理的配置为
```
location ~ ^/disqus/(.*) {
    proxy_pass https://disqus.com/api/3.0/$1?api_key=E8Uh5l5fHZ6gD8U3KycjAIAk46f68Zw7C6eW8WSjZvCLXebZ7p0r1yrYDrLilk2F&$args;
    proxy_set_header Referer https://disqus.com;
    proxy_set_header Origin https://disqus.com;
    proxy_redirect off;
}
```

接下来就可以直接使用正常的接口了。大部分的接口都是支持 jsonp 的，所以可以跨域调用，对于 POST 请求如发表评论等无法使用 jsonp 的情况，只能放在同一个服务器下面了。期待有人能做一个支持跨域的公共接口 :)。

# 前端

前端的部分有点麻烦，但是至少是有解决方案的，可以使用各种插件如[jquery comments](https://github.com/Viima/jquery-comments)等，本站使用的是一个自己随便写的实现，所以界面比较挫，有兴趣的可以看看
本站的[代码实现](https://github.com/usbuild/site)。

对于一些有「梯子」的用户，我们还是希望能够这些用户能够正常访问，所以使用了一个策略：当能够正常加载 disqus 官方 js 时就使用官方版本，否则就使用简易版本，代码如下：
```js
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
```

本站的代码实现相当简陋，仅仅提供一个思路，希望能有所帮助。